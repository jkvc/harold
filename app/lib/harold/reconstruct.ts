import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/app/lib/db";
import { runs } from "@/app/lib/db/schema";

type ClaudeMessage = {
  role: "user" | "assistant";
  content: unknown;
};

type ReconstructableRun = {
  status: string;
  error: string | null;
  turnMessages: unknown;
};

const SERVER_TOOL_BLOCK_TYPES = new Set([
  "web_search_tool_result",
  "code_execution_tool_result",
  "server_tool_use",
  "thinking",
]);

const MAX_RUNS_FETCH = 12;

export async function reconstructRunMessages(visitorId: string) {
  const runRows = await getDb()
    .select({
      status: runs.status,
      error: runs.error,
      turnMessages: runs.turnMessages,
    })
    .from(runs)
    .where(
      and(
        eq(runs.visitorId, visitorId),
        eq(runs.status, "completed"),
        isNull(runs.error),
      ),
    )
    .orderBy(desc(runs.createdAt))
    .limit(MAX_RUNS_FETCH);

  const messages = selectReconstructableRuns(runRows)
    .reverse()
    .flatMap((run) => coerceMessages(run.turnMessages))
    .map(pruneServerToolBlocks);

  return normalizeAlternatingMessages(messages);
}

export function selectReconstructableRuns<T extends ReconstructableRun>(
  runRows: T[],
) {
  return runRows.filter(
    (run) =>
      run.status === "completed" &&
      run.error === null &&
      Array.isArray(run.turnMessages),
  );
}

export function pruneServerToolBlocks(message: ClaudeMessage): ClaudeMessage {
  if (message.role !== "assistant" || !Array.isArray(message.content)) {
    return message;
  }

  const content = message.content as Array<Record<string, unknown>>;
  const filtered = content
    .filter((block) => !SERVER_TOOL_BLOCK_TYPES.has(String(block.type)))
    .map((block) => {
      if (block.type !== "text" || !("citations" in block)) {
        return block;
      }

      const nextBlock = { ...block };
      delete nextBlock.citations;
      return nextBlock;
    });

  return filtered.length > 0 ? { ...message, content: filtered } : message;
}

export function normalizeAlternatingMessages(messages: ClaudeMessage[]) {
  const normalized: ClaudeMessage[] = [];

  for (const message of messages) {
    const previous = normalized[normalized.length - 1];
    if (!previous || previous.role !== message.role) {
      normalized.push(message);
      continue;
    }

    normalized[normalized.length - 1] = {
      role: previous.role,
      content: mergeContent(previous.content, message.content),
    };
  }

  return normalized;
}

function coerceMessages(value: unknown): ClaudeMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((message): message is ClaudeMessage => {
    return (
      Boolean(message) &&
      typeof message === "object" &&
      ((message as ClaudeMessage).role === "user" ||
        (message as ClaudeMessage).role === "assistant") &&
      "content" in message
    );
  });
}

function mergeContent(first: unknown, second: unknown) {
  if (Array.isArray(first) && Array.isArray(second)) {
    return [...first, ...second];
  }

  if (typeof first === "string" && typeof second === "string") {
    return `${first}\n\n${second}`;
  }

  return [
    ...coerceContentBlocks(first),
    ...coerceContentBlocks(second),
  ];
}

function coerceContentBlocks(content: unknown) {
  if (Array.isArray(content)) {
    return content;
  }

  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }

  return [];
}
