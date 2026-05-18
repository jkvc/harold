import { waitUntil } from "@vercel/functions";
import { errorResponse, successResponse } from "@/app/lib/api-response";
import { runHaroldLoop } from "@/app/lib/harold/loop";
import { verifyQstashRequest } from "@/app/lib/qstash";
import { isValidVisitorId } from "@/app/lib/visitor";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const rawBody = await request.text();
  const verified = await verifyQstashRequest(request, rawBody);

  if (!verified) {
    return errorResponse(401, "Invalid wake signature.", "BAD_REQUEST");
  }

  const body = safeParseBody(rawBody);
  const visitorId = typeof body.visitorId === "string" ? body.visitorId : null;
  const model = typeof body.model === "string" ? body.model : undefined;

  if (!isValidVisitorId(visitorId)) {
    return errorResponse(400, "Invalid visitor ID.", "BAD_REQUEST");
  }

  waitUntil(runHaroldLoop({ visitorId, model }));

  return successResponse({ accepted: true });
}

function safeParseBody(rawBody: string): Record<string, unknown> {
  try {
    return JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return {};
  }
}
