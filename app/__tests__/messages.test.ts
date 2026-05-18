import { describe, expect, it } from "vitest";
import {
  serializeMessage,
  serializeMessagesWithReactions,
} from "@/app/lib/messages";
import type { Message, MessageReaction } from "@/app/lib/db/schema";

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
      reactions: [],
    });
  });

  it("attaches reaction rows to the matching serialized message", () => {
    const createdAt = new Date("2026-05-17T12:34:56.000Z");
    const message: Message = {
      id: "message-1",
      visitorId: "visitor_00000000-0000-4000-8000-000000000000",
      role: "user",
      content: "hello",
      replyToId: null,
      createdAt,
    };
    const reaction: MessageReaction = {
      id: "reaction-1",
      visitorId: message.visitorId,
      messageId: message.id,
      actor: "harold",
      emoji: "👍",
      createdAt,
    };

    expect(serializeMessagesWithReactions([message], [reaction])).toEqual([
      {
        ...message,
        createdAt: createdAt.toISOString(),
        reactions: [
          {
            ...reaction,
            createdAt: createdAt.toISOString(),
          },
        ],
      },
    ]);
  });
});
