import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/app/lib/db";
import {
  memory,
  messageReactions,
  messages,
} from "@/app/lib/db/schema";
import { publishEvent } from "@/app/lib/event-bus";
import {
  serializeMessage,
  serializeReaction,
} from "@/app/lib/messages";

type ToolContext = {
  visitorId: string;
  runId: string;
  inboxWatermark?: InboxWatermark | null;
  recordInboxWatermark?: (watermark: InboxWatermark) => void;
};

export type InboxWatermark = {
  messageId: string;
};

export const HAROLD_TOOLS: Record<string, unknown>[] = [
  {
    name: "check_inbox",
    description:
      "Read new user messages since Harold last checked the inbox. The engine automatically runs check_inbox when Harold wakes and before Harold sleeps, so you usually do not need to call it yourself.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "send_message",
    description: "Send a complete Harold chat bubble to the user.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string" },
        replyToId: { type: "string" },
      },
      required: ["content"],
      additionalProperties: false,
    },
  },
  {
    name: "react_to",
    description: "React to a user message with a short emoji reaction.",
    input_schema: {
      type: "object",
      properties: {
        messageId: { type: "string" },
        emoji: { type: "string" },
      },
      required: ["messageId", "emoji"],
      additionalProperties: false,
    },
  },
  {
    name: "update_memory",
    description: "Replace Harold's durable free-form memory memo.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string" },
      },
      required: ["content"],
      additionalProperties: false,
    },
  },
  {
    type: "web_search_20260209",
    name: "web_search",
    allowed_callers: ["direct"],
  },
];

export async function executeHaroldTool(
  name: string,
  input: unknown,
  context: ToolContext,
) {
  if (name === "check_inbox") {
    return checkInbox(context);
  }

  if (name === "send_message") {
    return sendMessage(input, context);
  }

  if (name === "react_to") {
    return reactTo(input, context);
  }

  if (name === "update_memory") {
    return updateMemory(input, context);
  }

  return {
    success: false,
    error: `Unknown tool: ${name}`,
  };
}

export async function checkInbox(context: ToolContext) {
  const rows = await previewInboxMessages(context.visitorId, {
    after: context.inboxWatermark,
  });

  const newestMessage = rows[rows.length - 1];
  if (newestMessage) {
    context.recordInboxWatermark?.({
      messageId: newestMessage.id,
    });
  }

  return {
    success: true,
    messages: serializeInboxMessages(rows),
  };
}

export async function previewCheckInbox(visitorId: string) {
  const rows = await previewInboxMessages(visitorId);

  return {
    messages: serializeInboxMessages(rows),
  };
}

export async function hasUnreadInboxMessages(
  visitorId: string,
  after?: InboxWatermark | null,
) {
  const rows = await previewInboxMessages(visitorId, { after, limit: 1 });
  return rows.length > 0;
}

async function previewInboxMessages(
  visitorId: string,
  options: { after?: InboxWatermark | null; limit?: number } = {},
) {
  return getDb()
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.visitorId, visitorId),
        eq(messages.role, "user"),
        unreadInboxSql(visitorId),
        options.after ? afterWatermarkSql(options.after) : undefined,
      ),
    )
    .orderBy(asc(messages.createdAt), asc(messages.id))
    .limit(options.limit ?? 20);
}

function unreadInboxSql(visitorId: string) {
  return sql`
    (
    NOT EXISTS (
      SELECT 1
      FROM harold_state s
      WHERE s.visitor_id = ${visitorId}
        AND s.last_processed_at IS NOT NULL
        AND s.last_processed_message_id IS NOT NULL
    )
    OR EXISTS (
      SELECT 1
      FROM harold_state s
      WHERE s.visitor_id = ${visitorId}
        AND s.last_processed_at IS NOT NULL
        AND s.last_processed_message_id IS NOT NULL
        AND ${messages.id} <> s.last_processed_message_id
        AND (${messages.createdAt}, ${messages.id}) > (
          s.last_processed_at,
          s.last_processed_message_id
        )
    )
    )
  `;
}

function afterWatermarkSql(watermark: InboxWatermark) {
  return sql`
    (${messages.createdAt}, ${messages.id}) > (
      (SELECT created_at FROM messages WHERE id = ${watermark.messageId}),
      ${watermark.messageId}
    )
  `;
}

function serializeInboxMessages(rows: Array<typeof messages.$inferSelect>) {
  return rows.map((message) => ({
    id: message.id,
    content: message.content,
    replyToId: message.replyToId,
    createdAt: message.createdAt.toISOString(),
  }));
}

async function sendMessage(input: unknown, context: ToolContext) {
  const content = readString(input, "content")?.trim();
  const replyToId = readString(input, "replyToId") ?? null;

  if (!content) {
    return { success: false, error: "content is required" };
  }

  if (replyToId && !(await messageBelongsToVisitor(replyToId, context.visitorId))) {
    return { success: false, error: "replyToId does not belong to this visitor" };
  }

  const [message] = await getDb()
    .insert(messages)
    .values({
      id: crypto.randomUUID(),
      visitorId: context.visitorId,
      role: "harold",
      content,
      replyToId,
    })
    .returning();

  const serialized = serializeMessage(message);
  await publishEvent(
    context.visitorId,
    { type: "message", message: serialized },
    { runId: context.runId, messageId: message.id },
  );

  return { success: true, message: serialized };
}

async function reactTo(input: unknown, context: ToolContext) {
  const messageId = readString(input, "messageId");
  const emoji = readString(input, "emoji")?.trim();

  if (!messageId || !emoji) {
    return { success: false, error: "messageId and emoji are required" };
  }

  if (!(await messageBelongsToVisitor(messageId, context.visitorId))) {
    return { success: false, error: "messageId does not belong to this visitor" };
  }

  const [inserted] = await getDb()
    .insert(messageReactions)
    .values({
      id: crypto.randomUUID(),
      visitorId: context.visitorId,
      messageId,
      actor: "harold",
      emoji,
    })
    .onConflictDoNothing()
    .returning();

  const reaction =
    inserted ??
    (
      await getDb()
        .select()
        .from(messageReactions)
        .where(
          and(
            eq(messageReactions.visitorId, context.visitorId),
            eq(messageReactions.messageId, messageId),
            eq(messageReactions.actor, "harold"),
            eq(messageReactions.emoji, emoji),
          ),
        )
        .limit(1)
    )[0];

  if (!reaction) {
    return { success: false, error: "Unable to store reaction" };
  }

  const serialized = serializeReaction(reaction);
  if (inserted) {
    await publishEvent(
      context.visitorId,
      { type: "reaction", reaction: serialized },
      { runId: context.runId, messageId },
    );
  }

  return { success: true, reaction: serialized, duplicate: !inserted };
}

async function messageBelongsToVisitor(messageId: string, visitorId: string) {
  const [message] = await getDb()
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.visitorId, visitorId)))
    .limit(1);

  return Boolean(message);
}

async function updateMemory(input: unknown, context: ToolContext) {
  const content = readString(input, "content")?.trim();

  if (!content) {
    return { success: false, error: "content is required" };
  }

  await getDb()
    .insert(memory)
    .values({
      id: crypto.randomUUID(),
      visitorId: context.visitorId,
      content,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: memory.visitorId,
      set: {
        content,
        updatedAt: new Date(),
      },
    });

  await publishEvent(context.visitorId, {
    type: "memory_updated",
    runId: context.runId,
  });

  return { success: true };
}

function readString(input: unknown, key: string) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

export function isAfterInboxWatermark(
  message: { id: string; createdAt: Date },
  watermark: { id: string; createdAt: Date } | null,
) {
  if (!watermark) {
    return true;
  }

  if (message.createdAt.getTime() > watermark.createdAt.getTime()) {
    return true;
  }

  return (
    message.createdAt.getTime() === watermark.createdAt.getTime() &&
    message.id > watermark.id
  );
}
