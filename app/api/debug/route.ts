import { and, desc, eq, lt } from "drizzle-orm";
import { errorResponse, successResponse } from "@/app/lib/api-response";
import { getDb } from "@/app/lib/db";
import { haroldEvents } from "@/app/lib/db/schema";
import { serializeDebugEvent } from "@/app/lib/event-bus";
import type { DebugEventPageDto } from "@/app/lib/harold/types";
import { getVisitorIdFromCookie } from "@/app/lib/visitor-server";

const PAGE_SIZE = 100;

export async function GET(request: Request) {
  const visitorId = await getVisitorIdFromCookie();

  if (!visitorId) {
    return errorResponse(401, "Missing visitor ID.", "MISSING_VISITOR");
  }

  const url = new URL(request.url);
  const before = parseCursor(url.searchParams.get("before"));

  try {
    const rows = await getDb()
      .select()
      .from(haroldEvents)
      .where(
        before
          ? and(eq(haroldEvents.visitorId, visitorId), lt(haroldEvents.id, before))
          : eq(haroldEvents.visitorId, visitorId),
      )
      .orderBy(desc(haroldEvents.id))
      .limit(PAGE_SIZE + 1);

    const pageRows = rows.slice(0, PAGE_SIZE).reverse();
    const events = pageRows.map(serializeDebugEvent);
    const data: DebugEventPageDto = {
      events,
      hasMore: rows.length > PAGE_SIZE,
      lastId: events[0]?.id ?? null,
    };

    return successResponse(data);
  } catch (error) {
    console.error("Failed to load Harold debug events", error);
    return errorResponse(500, "Unable to load debug events.", "DB_UNAVAILABLE");
  }
}

function parseCursor(value: string | null) {
  if (!value) {
    return null;
  }

  const cursor = Number.parseInt(value, 10);
  return Number.isFinite(cursor) && cursor > 0 ? cursor : null;
}
