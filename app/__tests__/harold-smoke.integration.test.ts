import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { ApiResponse } from "@/app/lib/api-types";
import { getDb } from "@/app/lib/db";
import { haroldState, runs } from "@/app/lib/db/schema";
import type {
  DebugEventPageDto,
  HaroldEventPayload,
} from "@/app/lib/harold/types";
import type { MessageDto, MessagePageDto } from "@/app/lib/messages";

const BASE_URL = process.env.HAROLD_INTEGRATION_BASE_URL ?? "http://localhost:3000";
const TEST_MODEL = "claude-haiku-4-5";

describe("Harold integration smoke", () => {
  it("runs one complete Harold wake and leaves replayable evidence", async () => {
    const visitorId = `visitor_${crypto.randomUUID()}`;
    const cookie = `harold_visitor_id=${encodeURIComponent(visitorId)}`;

    // The integration test uses one real Claude call; keep the prompt short so
    // the test covers wiring without spending tokens on answer quality.
    const messageResponse = await fetch(`${BASE_URL}/api/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        content:
          "Please send one short Harold chat message back to me using send_message.",
      }),
    });
    const messagePayload = (await messageResponse.json()) as ApiResponse<MessageDto>;
    expect(messagePayload.success).toBe(true);

    // Integration wakes call the local signed endpoint directly so this live
    // test always uses Haiku; the public wake endpoint has no model override.
    await dispatchWake(cookie);

    // A Harold bubble proves the end-to-end path: message API -> wake dispatch
    // -> agent loop -> send_message tool -> persisted message.
    const haroldMessage = await waitForHaroldMessage(cookie);
    expect(haroldMessage?.role).toBe("harold");

    // Durable debug events are the replay source for both the SSE cursor and
    // the debug timeline, so the live smoke test should verify they were saved.
    const debugEvents = await waitForDebugEvents(cookie, [
      "message",
      "run_start",
      "tool_start",
      "tool_complete",
      "run_end",
    ]);
    expect(debugEvents.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        "message",
        "run_start",
        "tool_start",
        "tool_complete",
        "run_end",
      ]),
    );
    expect(debugEvents.some((event) => event.payload.type === "message")).toBe(
      true,
    );
    expect(debugEvents.map((event) => event.eventType)).not.toEqual(
      expect.arrayContaining(["typing", "status"]),
    );
    expectCheckInboxInjectedBeforeModelOutput(debugEvents);

    // State cleanup catches the most common serverless failure mode: a run that
    // responds successfully but leaves Harold stuck in "working".
    const [state] = await getDb()
      .select()
      .from(haroldState)
      .where(eq(haroldState.visitorId, visitorId))
      .limit(1);
    expect(state?.status).toBe("sleeping");
    expect(state?.activeRunId).toBeNull();

    const completedRunIds = getCompletedRunIds(debugEvents);
    await expectPersistedRunHistoryIsCurrentTurnOnly(completedRunIds[0]);
  });

  it("does not re-read already processed inbox messages across wakes", async () => {
    const visitorId = `visitor_${crypto.randomUUID()}`;
    const cookie = `harold_visitor_id=${encodeURIComponent(visitorId)}`;

    // This guards the Postgres microsecond vs JS millisecond regression: the
    // first message timestamp must be stored/compared exactly, or the second
    // wake will see it again.
    const firstMessage = await sendUserMessage(cookie, "first watermark message");
    await dispatchWake(cookie);
    await waitForRunCount(cookie, 1);

    const secondMessage = await sendUserMessage(cookie, "second watermark message");
    await dispatchWake(cookie);
    const debugEvents = await waitForRunCount(cookie, 2);

    const completedRunIds = getCompletedRunIds(debugEvents);
    const secondInboxResult = getFirstCheckInboxResultForRun(
      debugEvents,
      completedRunIds[1],
    ) as
      | { messages?: Array<{ id: string }> }
      | undefined;

    expect(secondInboxResult?.messages?.map((message) => message.id)).toEqual([
      secondMessage.id,
    ]);
    expect(secondInboxResult?.messages?.map((message) => message.id)).not.toContain(
      firstMessage.id,
    );
    await expectPersistedRunHistoryIsCurrentTurnOnly(completedRunIds[0]);
    await expectPersistedRunHistoryIsCurrentTurnOnly(completedRunIds[1]);
  });

  it("does not render assistant text unless send_message is used", async () => {
    const visitorId = `visitor_${crypto.randomUUID()}`;
    const cookie = `harold_visitor_id=${encodeURIComponent(visitorId)}`;

    // With an empty inbox, Claude may say "no response needed" as plain text.
    // That text belongs in run history only; visible chat bubbles must come
    // from the send_message tool.
    await dispatchWake(cookie);
    const debugEvents = await waitForRunCount(cookie, 1);

    const response = await fetch(`${BASE_URL}/api/messages`, {
      headers: { Cookie: cookie },
    });
    const payload = (await response.json()) as ApiResponse<MessagePageDto>;

    expect(payload.success).toBe(true);
    expect(payload.success ? payload.data.messages : []).toEqual([]);
    expect(
      debugEvents.some((event) => event.payload.type === "assistant_text"),
    ).toBe(true);
    expectCheckInboxInjectedBeforeModelOutput(debugEvents);
  });
});

function expectCheckInboxInjectedBeforeModelOutput(
  events: DebugEventPageDto["events"],
) {
  const completedRunIds = getCompletedRunIds(events);
  const runId = completedRunIds[0];
  expect(runId).toBeTruthy();

  const runEvents = events.filter((event) => event.runId === runId);
  const checkInboxStartIndex = runEvents.findIndex(
    (event) =>
      event.payload.type === "tool_start" &&
      event.payload.name === "check_inbox",
  );
  const checkInboxCompleteIndex = runEvents.findIndex(
    (event) =>
      event.payload.type === "tool_complete" &&
      event.payload.name === "check_inbox",
  );
  const firstModelOutputIndex = runEvents.findIndex((event) => {
    if (event.payload.type === "assistant_text") {
      return true;
    }

    return (
      event.payload.type === "tool_start" &&
      event.payload.name === "send_message"
    );
  });

  // The engine should inject the first check_inbox before the model has a
  // chance to spend a turn asking for it or responding without inbox context.
  expect(checkInboxStartIndex).toBeGreaterThanOrEqual(0);
  expect(checkInboxCompleteIndex).toBeGreaterThan(checkInboxStartIndex);
  expect(firstModelOutputIndex).toBeGreaterThan(checkInboxCompleteIndex);
}

function getCompletedRunIds(events: DebugEventPageDto["events"]) {
  return events
    .map((event) => event.payload)
    .filter(
      (
        payload,
      ): payload is Extract<HaroldEventPayload, { type: "run_end" }> =>
        payload.type === "run_end" && payload.status === "completed",
    )
    .map((payload) => payload.runId);
}

function getFirstCheckInboxResultForRun(
  events: DebugEventPageDto["events"],
  runId: string | undefined,
) {
  const event = events.find(
    (event) =>
      event.runId === runId &&
      event.payload.type === "tool_complete" &&
      event.payload.name === "check_inbox",
  );

  return event?.payload.type === "tool_complete"
    ? event.payload.result
    : undefined;
}

async function expectPersistedRunHistoryIsCurrentTurnOnly(runId: string | undefined) {
  expect(runId).toBeTruthy();

  const [run] = await getDb()
    .select({ turnMessages: runs.turnMessages })
    .from(runs)
    .where(eq(runs.id, runId ?? ""))
    .limit(1);

  const turnMessages = Array.isArray(run?.turnMessages) ? run.turnMessages : [];
  const wakeMessages = turnMessages.filter((message) => {
    if (!message || typeof message !== "object") {
      return false;
    }

    return (
      "role" in message &&
      (message as { role?: unknown }).role === "user" &&
      "content" in message &&
      (message as { content?: unknown }).content ===
        "You've been woken up. check_inbox has already been called — its results are in your history. Start working."
    );
  });

  // Regression guard for exponential history duplication: persisted turn history
  // should describe this wake only, not copied reconstructed history.
  expect(wakeMessages).toHaveLength(1);
  expect(turnMessages.length).toBeLessThan(40);
}

async function sendUserMessage(cookie: string, content: string) {
  const response = await fetch(`${BASE_URL}/api/message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ content }),
  });
  const payload = (await response.json()) as ApiResponse<MessageDto>;

  if (!payload.success) {
    throw new Error(payload.error);
  }

  return payload.data;
}

async function dispatchWake(cookie: string) {
  const visitorId = decodeURIComponent(cookie.replace("harold_visitor_id=", ""));
  const response = await fetch(`${BASE_URL}/api/wake/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-harold-local-wake": "1",
      Cookie: cookie,
    },
    body: JSON.stringify({
      visitorId,
      model: TEST_MODEL,
    }),
  });

  expect(response.ok).toBe(true);
}

async function waitForHaroldMessage(cookie: string) {
  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    const response = await fetch(`${BASE_URL}/api/messages`, {
      headers: { Cookie: cookie },
    });
    const payload = (await response.json()) as ApiResponse<MessagePageDto>;

    if (payload.success) {
      const haroldMessage = payload.data.messages.find(
        (message) => message.role === "harold",
      );
      if (haroldMessage) {
        return haroldMessage;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  return null;
}

async function waitForDebugEvents(
  cookie: string,
  expectedTypes: HaroldEventPayload["type"][],
) {
  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    const response = await fetch(`${BASE_URL}/api/debug`, {
      headers: { Cookie: cookie },
    });
    const payload = (await response.json()) as ApiResponse<DebugEventPageDto>;

    if (payload.success) {
      const presentTypes = new Set(
        payload.data.events.map((event) => event.eventType),
      );
      if (expectedTypes.every((type) => presentTypes.has(type))) {
        return payload.data.events;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  return [];
}

async function waitForRunCount(cookie: string, runCount: number) {
  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    const response = await fetch(`${BASE_URL}/api/debug`, {
      headers: { Cookie: cookie },
    });
    const payload = (await response.json()) as ApiResponse<DebugEventPageDto>;

    if (payload.success) {
      const completedRuns = payload.data.events.filter(
        (event) =>
          event.payload.type === "run_end" &&
          event.payload.status === "completed",
      );
      if (completedRuns.length >= runCount) {
        return payload.data.events;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  return [];
}
