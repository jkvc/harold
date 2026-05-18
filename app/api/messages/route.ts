import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import { errorResponse, successResponse } from "@/app/lib/api-response";
import { getDb } from "@/app/lib/db";
import { messageReactions, messages } from "@/app/lib/db/schema";
import { serializeMessagesWithReactions } from "@/app/lib/messages";
import { getVisitorIdFromCookie } from "@/app/lib/visitor-server";

export const runtime = "nodejs";

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

export async function GET(request: Request) {
  const visitorId = await getVisitorIdFromCookie();

  if (!visitorId) {
    return errorResponse(401, "Missing visitor ID.", "MISSING_VISITOR");
  }

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const before = parseBeforeCursor(
    url.searchParams.get("beforeCreatedAt"),
    url.searchParams.get("beforeId"),
  );

  if (
    (url.searchParams.has("beforeCreatedAt") ||
      url.searchParams.has("beforeId")) &&
    !before
  ) {
    return errorResponse(400, "Invalid before cursor.", "BAD_REQUEST");
  }

  try {
    const rows = await getDb()
      .select()
      .from(messages)
      .where(
        before
          ? and(
              eq(messages.visitorId, visitorId),
              or(
                lt(messages.createdAt, before.createdAt),
                and(
                  eq(messages.createdAt, before.createdAt),
                  lt(messages.id, before.id),
                ),
              ),
            )
          : eq(messages.visitorId, visitorId),
      )
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const pageMessages = rows.slice(0, limit).reverse();
    const reactions =
      pageMessages.length > 0
        ? await getDb()
            .select()
            .from(messageReactions)
            .where(
              and(
                eq(messageReactions.visitorId, visitorId),
                inArray(
                  messageReactions.messageId,
                  pageMessages.map((message) => message.id),
                ),
              ),
            )
        : [];

    return successResponse({
      messages: serializeMessagesWithReactions(pageMessages, reactions),
      hasMore,
    });
  } catch (error) {
    console.error("Failed to fetch messages", error);
    return errorResponse(503, "Messages are unavailable.", "DB_UNAVAILABLE");
  }
}

function parseLimit(value: string | null) {
  if (!value) {
    return DEFAULT_PAGE_SIZE;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.min(parsed, MAX_PAGE_SIZE);
}

function parseBeforeCursor(createdAtValue: string | null, id: string | null) {
  if (!createdAtValue && !id) {
    return null;
  }

  if (!createdAtValue || !id) {
    return null;
  }

  const createdAt = new Date(createdAtValue);
  if (Number.isNaN(createdAt.getTime())) {
    return null;
  }

  return { createdAt, id };
}
