import { describe, expect, it } from "vitest";
import {
  generateVisitorId,
  isValidVisitorId,
  readVisitorCookie,
  VISITOR_COOKIE_NAME,
} from "@/app/lib/visitor";

describe("visitor helpers", () => {
  it("generates valid visitor IDs", () => {
    expect(isValidVisitorId(generateVisitorId())).toBe(true);
  });

  it("reads a valid visitor ID from a cookie header", () => {
    const visitorId = generateVisitorId();
    const cookieHeader = `theme=dark; ${VISITOR_COOKIE_NAME}=${visitorId}; other=1`;

    expect(readVisitorCookie(cookieHeader)).toBe(visitorId);
  });

  it("rejects missing or malformed visitor IDs", () => {
    expect(readVisitorCookie("theme=dark")).toBeNull();
    expect(readVisitorCookie(`${VISITOR_COOKIE_NAME}=visitor_bad`)).toBeNull();
    expect(readVisitorCookie(`${VISITOR_COOKIE_NAME}=%E0%A4%A`)).toBeNull();
    expect(isValidVisitorId("not-a-visitor")).toBe(false);
  });
});
