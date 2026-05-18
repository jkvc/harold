import Redis from "ioredis";
import { getDb } from "@/app/lib/db";
import { haroldEvents } from "@/app/lib/db/schema";
import { getRedis } from "@/app/lib/redis";
import type {
  DebugEventDto,
  HaroldEventPayload,
  HaroldSseEvent,
} from "@/app/lib/harold/types";

type EventMeta = {
  runId?: string | null;
  messageId?: string | null;
};

type EventHandler = (event: HaroldSseEvent) => void;

const channelSubscribers = new Map<string, Set<EventHandler>>();
let subscriberRedis: Redis | null = null;
let globalListenerAttached = false;

export function haroldChannelName(visitorId: string) {
  return `harold:${visitorId}:events`;
}

export async function publishEvent(
  visitorId: string,
  event: HaroldEventPayload,
  meta: EventMeta = {},
): Promise<HaroldSseEvent> {
  const [row] = await getDb()
    .insert(haroldEvents)
    .values({
      visitorId,
      eventType: event.type,
      payload: event as unknown as Record<string, unknown>,
      runId: meta.runId ?? getRunIdFromEvent(event),
      messageId: meta.messageId ?? getMessageIdFromEvent(event),
    })
    .returning();

  const payload = serializeEvent(row);
  await getRedis().publish(haroldChannelName(visitorId), JSON.stringify(payload));

  return payload;
}

export function subscribeToVisitor(
  visitorId: string,
  onEvent: EventHandler,
): () => void {
  const channel = haroldChannelName(visitorId);
  const redis = getSubscriberRedis();

  ensureGlobalListener();

  let handlers = channelSubscribers.get(channel);
  if (!handlers) {
    handlers = new Set();
    channelSubscribers.set(channel, handlers);
    void redis.subscribe(channel);
  }

  handlers.add(onEvent);

  return () => {
    const currentHandlers = channelSubscribers.get(channel);
    if (!currentHandlers) {
      return;
    }

    currentHandlers.delete(onEvent);

    if (currentHandlers.size === 0) {
      channelSubscribers.delete(channel);
      void redis.unsubscribe(channel);
    }
  };
}

export function serializeDebugEvent(row: typeof haroldEvents.$inferSelect): DebugEventDto {
  return {
    id: row.id,
    visitorId: row.visitorId,
    eventType: row.eventType as HaroldEventPayload["type"],
    payload: row.payload as HaroldEventPayload,
    runId: row.runId,
    messageId: row.messageId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function formatSseMessage(event: HaroldSseEvent) {
  return `id: ${event.eventId}\ndata: ${JSON.stringify(event)}\n\n`;
}

function serializeEvent(row: typeof haroldEvents.$inferSelect): HaroldSseEvent {
  return {
    ...(row.payload as HaroldEventPayload),
    eventId: row.id,
    visitorId: row.visitorId,
    createdAt: row.createdAt.toISOString(),
  };
}

function getSubscriberRedis(): Redis {
  if (!subscriberRedis) {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error("REDIS_URL is required");
    }
    subscriberRedis = new Redis(url);
  }

  return subscriberRedis;
}

function ensureGlobalListener() {
  if (globalListenerAttached) {
    return;
  }

  getSubscriberRedis().on("message", (channel: string, message: string) => {
    const handlers = channelSubscribers.get(channel);
    if (!handlers || handlers.size === 0) {
      return;
    }

    let event: HaroldSseEvent;
    try {
      event = JSON.parse(message) as HaroldSseEvent;
    } catch {
      return;
    }

    for (const handler of handlers) {
      handler(event);
    }
  });

  globalListenerAttached = true;
}

function getRunIdFromEvent(event: HaroldEventPayload): string | null {
  if ("runId" in event && event.runId) {
    return event.runId;
  }

  return null;
}

function getMessageIdFromEvent(event: HaroldEventPayload): string | null {
  if (event.type === "message") {
    return event.message.id;
  }

  if (event.type === "reaction") {
    return event.reaction.messageId;
  }

  return null;
}
