import { describe, expect, it } from "vitest";
import { serializeMessage } from "@/app/lib/messages";
import type { Message } from "@/app/lib/db/schema";

describe("message helpers", () => {
  it("serializes message dates for JSON responses", () => {
    const createdAt = new Date("2026-05-17T12:34:56.000Z");
    const message: Message = {
      id: "message-1",
      visitorId: "visitor_00000000-0000-4000-8000-000000000000",
      role: "user",
      content: "hello",
      replyToId: null,
      createdAt,
    };

    expect(serializeMessage(message)).toEqual({
      ...message,
      createdAt: createdAt.toISOString(),
    });
  });
});
