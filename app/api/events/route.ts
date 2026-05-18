import { and, asc, eq, gt } from "drizzle-orm";
import { getDb } from "@/app/lib/db";
import { haroldEvents } from "@/app/lib/db/schema";
import {
  formatSseMessage,
  serializeDebugEvent,
  subscribeToVisitor,
} from "@/app/lib/event-bus";
import type { HaroldSseEvent } from "@/app/lib/harold/types";
import { getVisitorIdFromCookie } from "@/app/lib/visitor-server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const visitorId = await getVisitorIdFromCookie();

  if (!visitorId) {
    return new Response("Missing visitor ID.", { status: 401 });
  }

  const url = new URL(request.url);
  const cursor = parseCursor(url.searchParams.get("cursor"));
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function emit(event: HaroldSseEvent) {
        controller.enqueue(
          encoder.encode(formatSseMessage(event)),
        );
      }

      try {
        if (cursor > 0) {
          const missedEvents = await getDb()
            .select()
            .from(haroldEvents)
            .where(
              and(eq(haroldEvents.visitorId, visitorId), gt(haroldEvents.id, cursor)),
            )
            .orderBy(asc(haroldEvents.id))
            .limit(500);

          for (const row of missedEvents) {
            const debugEvent = serializeDebugEvent(row);
            emit({
              ...debugEvent.payload,
              eventId: debugEvent.id,
              visitorId: debugEvent.visitorId,
              createdAt: debugEvent.createdAt,
            });
          }
        }
      } catch (error) {
        console.error("Failed to replay Harold events", error);
      }

      const unsubscribe = subscribeToVisitor(visitorId, emit);

      const heartbeat = windowlessInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          heartbeat.clear();
        }
      }, 30_000);

      request.signal.addEventListener("abort", () => {
        heartbeat.clear();
        unsubscribe();
        try {
          controller.close();
        } catch {
          // The stream can already be closed by the time abort fires.
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function parseCursor(value: string | null) {
  if (!value) {
    return 0;
  }

  const cursor = Number.parseInt(value, 10);
  return Number.isFinite(cursor) && cursor > 0 ? cursor : 0;
}

function windowlessInterval(callback: () => void, ms: number) {
  const id = setInterval(callback, ms);
  return {
    clear: () => clearInterval(id),
  };
}
