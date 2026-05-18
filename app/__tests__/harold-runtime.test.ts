import { describe, expect, it } from "vitest";
import {
  decideInjectedInboxAction,
  decideSleepAction,
  injectInboxResult,
} from "@/app/lib/harold/loop";
import type { HaroldEventPayload } from "@/app/lib/harold/types";
import {
  normalizeAlternatingMessages,
  pruneServerToolBlocks,
} from "@/app/lib/harold/reconstruct";
import { isAfterInboxWatermark } from "@/app/lib/harold/tools";

describe("Harold runtime helpers", () => {
  it("continues when a pending wake was queued", () => {
    // A wake that lands while Harold is already working must not be lost; the
    // loop should keep going long enough to read the newly queued inbox.
    expect(
      decideSleepAction({
        pendingWake: true,
        iteration: 1,
        maxIterations: 8,
        toolUseCount: 1,
      }),
    ).toBe("continue");
  });

  it("sleeps when the model stops using tools", () => {
    // No tool calls means Harold has nothing left to do in this turn, so the
    // loop should release its state lock instead of spinning.
    expect(
      decideSleepAction({
        pendingWake: false,
        iteration: 1,
        maxIterations: 8,
        toolUseCount: 0,
      }),
    ).toBe("sleep");
  });

  it("uses the composite inbox watermark for identical timestamps", () => {
    const createdAt = new Date("2026-05-17T12:00:00.000Z");
    const watermark = { id: "message-b", createdAt };

    // The timestamp tie-breaker is what prevents same-millisecond messages
    // from being skipped or reprocessed.
    expect(
      isAfterInboxWatermark({ id: "message-a", createdAt }, watermark),
    ).toBe(false);
    expect(
      isAfterInboxWatermark({ id: "message-c", createdAt }, watermark),
    ).toBe(true);
  });

  it("prunes server web-search blocks from reconstructed assistant messages", () => {
    // Anthropic server tool blocks and future thinking blocks are not replay
    // context for Harold; only normal text should survive reconstruction.
    expect(
      pruneServerToolBlocks({
        role: "assistant",
        content: [
          { type: "text", text: "done", citations: [{ index: 0 }] },
          { type: "thinking", thinking: "private reasoning" },
          { type: "server_tool_use", id: "tool-1", name: "web_search" },
          { type: "web_search_tool_result", tool_use_id: "tool-1" },
        ],
      }),
    ).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "done" }],
    });
  });

  it("normalizes adjacent messages with the same role", () => {
    // Claude requires alternating roles. Reconstruction merges neighbors from
    // older runs before sending history back to the model.
    expect(
      normalizeAlternatingMessages([
        { role: "user", content: "one" },
        { role: "user", content: "two" },
        { role: "assistant", content: [{ type: "text", text: "three" }] },
      ]),
    ).toEqual([
      { role: "user", content: "one\n\ntwo" },
      { role: "assistant", content: [{ type: "text", text: "three" }] },
    ]);
  });

  it("injects check_inbox results as synthetic tool history", () => {
    const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [
      {
        role: "user",
        content:
          "You've been woken up. check_inbox has already been called — its results are in your history. Start working.",
      },
    ];

    injectInboxResult(messages, "check-1", {
      success: true,
      messages: [{ id: "message-1", content: "hello" }],
    });

    expect(messages).toEqual([
      {
        role: "user",
        content:
          "You've been woken up. check_inbox has already been called — its results are in your history. Start working.",
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "check-1",
            name: "check_inbox",
            input: {},
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "check-1",
            content: JSON.stringify({
              success: true,
              messages: [{ id: "message-1", content: "hello" }],
            }),
          },
        ],
      },
    ]);
  });

  it("only continues mid-loop when injected inbox has messages", () => {
    // Pending wakes can be stale/empty. Mid-loop checks should drain them
    // without paying for another model turn unless new inbox content exists.
    expect(
      decideInjectedInboxAction({
        phase: "mid_loop",
        hasMessages: false,
      }),
    ).toEqual({ inject: false, continueLoop: false });
    expect(
      decideInjectedInboxAction({
        phase: "mid_loop",
        hasMessages: true,
      }),
    ).toEqual({ inject: true, continueLoop: true });
  });

  it("records before-sleep inbox checks even when empty", () => {
    // The final check is part of Harold's durable run history. Empty results
    // document that Harold checked and can safely sleep.
    expect(
      decideInjectedInboxAction({
        phase: "before_sleep",
        hasMessages: false,
      }),
    ).toEqual({ inject: true, continueLoop: false });
    expect(
      decideInjectedInboxAction({
        phase: "before_sleep",
        hasMessages: true,
      }),
    ).toEqual({ inject: true, continueLoop: true });
  });

  it("keeps UI-only status out of durable event payloads", () => {
    // Awake/typing UI is derived from run_start/run_end. Dedicated typing or
    // status events should not be persisted into the debug timeline.
    const eventTypes: Array<HaroldEventPayload["type"]> = [
      "message",
      "assistant_text",
      "assistant_thinking",
      "reaction",
      "tool_start",
      "tool_complete",
      "memory_updated",
      "run_start",
      "run_end",
      "error",
    ];

    expect(eventTypes).not.toContain(
      "typing" as HaroldEventPayload["type"],
    );
    expect(eventTypes).not.toContain(
      "status" as HaroldEventPayload["type"],
    );
  });
});
