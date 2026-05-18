import { describe, expect, it } from "vitest";
import {
  formatSseMessage,
  haroldChannelName,
  serializeDebugEvent,
} from "@/app/lib/event-bus";
import type { HaroldEvent } from "@/app/lib/db/schema";

describe("Harold event bus helpers", () => {
  it("uses a project-specific Redis namespace", () => {
    // This Redis instance is shared by multiple projects; the first segment is
    // the collision boundary, so keep it app-specific instead of generic.
    expect(
      haroldChannelName("visitor_00000000-0000-4000-8000-000000000000"),
    ).toBe("harold:visitor_00000000-0000-4000-8000-000000000000:events");
  });

  it("serializes durable events with the cursor and original payload", () => {
    const createdAt = new Date("2026-05-18T07:30:00.000Z");
    const row: HaroldEvent = {
      id: 42,
      visitorId: "visitor_00000000-0000-4000-8000-000000000000",
      eventType: "run_end",
      payload: {
        type: "run_end",
        runId: "run-1",
        status: "completed",
      },
      runId: "run-1",
      messageId: null,
      createdAt,
    };

    // SSE replay and the debug timeline both depend on this durable id being
    // exposed, not just the transient Redis payload.
    expect(serializeDebugEvent(row)).toEqual({
      id: 42,
      visitorId: row.visitorId,
      eventType: "run_end",
      payload: row.payload,
      runId: "run-1",
      messageId: null,
      createdAt: createdAt.toISOString(),
    });
  });

  it("formats SSE messages with a native event id", () => {
    // Browsers use the native id field for reconnect semantics, while Harold's
    // payload keeps eventId for client-side dedupe and debug rendering.
    expect(
      formatSseMessage({
        type: "run_end",
        runId: "run-1",
        status: "completed",
        eventId: 42,
        visitorId: "visitor_00000000-0000-4000-8000-000000000000",
        createdAt: "2026-05-18T07:30:00.000Z",
      }),
    ).toBe(
      'id: 42\ndata: {"type":"run_end","runId":"run-1","status":"completed","eventId":42,"visitorId":"visitor_00000000-0000-4000-8000-000000000000","createdAt":"2026-05-18T07:30:00.000Z"}\n\n',
    );
  });
});
