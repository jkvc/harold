import { cookies } from "next/headers";
import { isValidVisitorId, VISITOR_COOKIE_NAME } from "@/app/lib/visitor";

export async function getVisitorIdFromCookie(): Promise<string | null> {
  const visitorId = (await cookies()).get(VISITOR_COOKIE_NAME)?.value;
  return isValidVisitorId(visitorId) ? visitorId : null;
}
