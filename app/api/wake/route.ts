import { waitUntil } from "@vercel/functions";
import { errorResponse, successResponse } from "@/app/lib/api-response";
import { dispatchWake } from "@/app/lib/qstash";
import { getVisitorIdFromCookie } from "@/app/lib/visitor-server";

export async function POST() {
  const visitorId = await getVisitorIdFromCookie();

  if (!visitorId) {
    return errorResponse(401, "Missing visitor ID.", "MISSING_VISITOR");
  }

  waitUntil(
    dispatchWake({ visitorId }).then((result) => {
      if (!result.success) {
        console.error("Failed to dispatch Harold wake", result.error);
      }
    }),
  );

  return successResponse({ accepted: true });
}
