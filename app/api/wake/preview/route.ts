import { eq } from "drizzle-orm";
import { errorResponse, successResponse } from "@/app/lib/api-response";
import { getDb } from "@/app/lib/db";
import { haroldState } from "@/app/lib/db/schema";
import { previewCheckInbox } from "@/app/lib/harold/tools";
import { getVisitorIdFromCookie } from "@/app/lib/visitor-server";

export async function GET() {
  const visitorId = await getVisitorIdFromCookie();

  if (!visitorId) {
    return errorResponse(401, "Missing visitor ID.", "MISSING_VISITOR");
  }

  try {
    const [state] = await getDb()
      .select({
        status: haroldState.status,
        activeRunId: haroldState.activeRunId,
      })
      .from(haroldState)
      .where(eq(haroldState.visitorId, visitorId))
      .limit(1);
    const preview = await previewCheckInbox(visitorId);

    return successResponse({
      ...preview,
      status: state?.status ?? "sleeping",
      activeRunId: state?.activeRunId ?? null,
    });
  } catch (error) {
    console.error("Failed to build Harold wake preview", error);
    return errorResponse(500, "Unable to build wake preview.", "DB_UNAVAILABLE");
  }
}
