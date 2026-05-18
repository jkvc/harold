import { messages } from "@/app/lib/db/schema";
import { getDb } from "@/app/lib/db";
import { errorResponse, successResponse } from "@/app/lib/api-response";
import { serializeMessage } from "@/app/lib/messages";
import { getVisitorIdFromCookie } from "@/app/lib/visitor-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const visitorId = await getVisitorIdFromCookie();

  if (!visitorId) {
    return errorResponse(401, "Missing visitor ID.", "MISSING_VISITOR");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Request body must be valid JSON.", "BAD_REQUEST");
  }

  const content = parseMessageContent(body);
  if (!content) {
    return errorResponse(400, "Message cannot be empty.", "EMPTY_MESSAGE");
  }

  try {
    const [message] = await getDb()
      .insert(messages)
      .values({
        id: crypto.randomUUID(),
        visitorId,
        role: "user",
        content,
      })
      .returning();

    return successResponse(serializeMessage(message));
  } catch (error) {
    console.error("Failed to store message", error);
    return errorResponse(503, "Message storage is unavailable.", "DB_UNAVAILABLE");
  }
}

function parseMessageContent(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("content" in body)) {
    return null;
  }

  const content = (body as { content: unknown }).content;
  if (typeof content !== "string") {
    return null;
  }

  const trimmedContent = content.trim();
  return trimmedContent.length > 0 ? trimmedContent : null;
}
