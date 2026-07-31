import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { getDb } from "@/app/lib/db";
import { runs } from "@/app/lib/db/schema";
import { publishEvent } from "@/app/lib/event-bus";
import {
  completeOpenRouter,
  SEND_MESSAGE_STAGGER_MS,
  shouldStaggerBeforeTool,
  usesOpenRouterProvider,
} from "@/app/lib/harold/provider";
import {
  DEFAULT_HAROLD_MODEL,
  HAROLD_SYSTEM_PROMPT,
} from "@/app/lib/harold/system-prompt";
import {
  acquireRunLock,
  advanceInboxWatermark,
  consumePendingWake,
  markPendingWake,
  releaseRunLock,
} from "@/app/lib/harold/state";
import {
  executeHaroldTool,
  HAROLD_CLIENT_TOOLS,
  HAROLD_TOOLS,
  hasUnreadInboxMessages,
  type InboxWatermark,
} from "@/app/lib/harold/tools";
import { reconstructRunMessages } from "@/app/lib/harold/reconstruct";

type RunHaroldLoopParams = {
  visitorId: string;
  model?: string;
};

type ClaudeMessage = {
  role: "user" | "assistant";
  content: unknown;
};

type RunState = {
  watermark: InboxWatermark | null;
};

type DecideSleepInput = {
  pendingWake: boolean;
  iteration: number;
  maxIterations: number;
  toolUseCount: number;
};

type InjectedInboxDecisionInput = {
  hasMessages: boolean;
  phase: "mid_loop" | "before_sleep";
};

// Phase 2 uses a small iteration cap instead of Not Really's time-budget +
// bounce-refresh loop. If a final injected inbox lands right at the cap, the
// current run may defer truly robust continuation handling to Phase 5.
const MAX_ITERATIONS = 8;

let anthropic: Anthropic | null = null;

export function decideSleepAction(input: DecideSleepInput) {
  if (input.pendingWake) {
    return "continue" as const;
  }

  if (input.iteration >= input.maxIterations || input.toolUseCount === 0) {
    return "sleep" as const;
  }

  return "continue" as const;
}

export function decideInjectedInboxAction(input: InjectedInboxDecisionInput) {
  if (input.phase === "before_sleep") {
    return {
      inject: true,
      continueLoop: input.hasMessages,
    };
  }

  return {
    inject: input.hasMessages,
    continueLoop: input.hasMessages,
  };
}

export function buildModelMessages(
  previousMessages: ClaudeMessage[],
  turnMessages: ClaudeMessage[],
) {
  return [...previousMessages, ...turnMessages];
}

export async function runHaroldLoop({
  visitorId,
  model = DEFAULT_HAROLD_MODEL,
}: RunHaroldLoopParams) {
  const runId = crypto.randomUUID();
  const previousMessages: ClaudeMessage[] = await reconstructRunMessages(visitorId);
  const turnMessages: ClaudeMessage[] = [];

  await getDb().insert(runs).values({
    id: runId,
    visitorId,
    status: "running",
    model,
    turnMessages: [],
  });

  const acquired = await acquireRunLock(visitorId, runId);
  if (!acquired) {
    await markPendingWake(visitorId);
    await deleteRun(runId);
    return;
  }

  try {
    await publishEvent(visitorId, { type: "run_start", runId, model });

    turnMessages.push({
      role: "user",
      content:
        "You've been woken up. check_inbox has already been called — its results are in your history. Start working.",
    });

    let iteration = 0;
    let pendingWake = false;
    const runState: RunState = {
      watermark: null,
    };
    // Wake-start inbox is always injected, even when empty. This saves Harold
    // a first model turn and makes the wake context explicit in run history.
    const preCheck = await runInjectedCheckInbox(visitorId, runId, runState);
    injectInboxResult(turnMessages, preCheck.id, preCheck.result);
    await updateRunMessages(runId, turnMessages);

    while (iteration < MAX_ITERATIONS) {
      iteration += 1;
      const modelMessages = buildModelMessages(previousMessages, turnMessages);
      const assistantContent = usesOpenRouterProvider(model)
        ? (
            await completeOpenRouter({
              apiKey: getOpenRouterApiKey(),
              model,
              system: HAROLD_SYSTEM_PROMPT,
              messages: modelMessages,
              clientTools: HAROLD_CLIENT_TOOLS,
              maxTokens: 1200,
            })
          ).content
        : ((
            await getAnthropic().messages.create({
              model,
              max_tokens: 1200,
              system: HAROLD_SYSTEM_PROMPT,
              tools: HAROLD_TOOLS as never,
              messages: modelMessages as never,
            })
          ).content as unknown[]);

      turnMessages.push({ role: "assistant", content: assistantContent });
      await publishAssistantTextEvents(visitorId, runId, assistantContent);
      await publishAssistantThinkingEvents(visitorId, runId, assistantContent);
      await publishServerToolEvents(visitorId, runId, assistantContent);

      const toolUseBlocks = assistantContent.filter(isToolUseBlock);
      if (toolUseBlocks.length === 0) {
        pendingWake = await consumePendingWake(visitorId, runId);
        // Before sleeping, always record the final inbox check. Empty results
        // document that Harold checked and can sleep; non-empty results become
        // the next model turn so late-arriving user messages are handled.
        const finalCheck = await runInjectedCheckInbox(visitorId, runId, runState);
        const finalInboxAction = decideInjectedInboxAction({
          phase: "before_sleep",
          hasMessages: finalCheck.hasMessages,
        });
        if (finalInboxAction.inject) {
          injectInboxResult(turnMessages, finalCheck.id, finalCheck.result);
          await updateRunMessages(runId, turnMessages);
        }

        const action = decideSleepAction({
          pendingWake: pendingWake || finalInboxAction.continueLoop,
          iteration,
          maxIterations: MAX_ITERATIONS,
          toolUseCount: 0,
        });

        if (action === "continue" && finalInboxAction.continueLoop) {
          continue;
        }

        break;
      }

      const toolResults = [];
      let previousToolName: string | null = null;
      for (const block of toolUseBlocks) {
        if (
          shouldStaggerBeforeTool({
            toolName: block.name,
            previousToolName,
          })
        ) {
          await sleep(SEND_MESSAGE_STAGGER_MS);
        }

        await publishEvent(visitorId, {
          type: "tool_start",
          id: block.id,
          name: block.name,
          input: coerceObject(block.input),
          runId,
        });

        const result = await executeHaroldTool(block.name, block.input, {
          visitorId,
          runId,
          inboxWatermark: runState.watermark,
          recordInboxWatermark: (watermark) => {
            runState.watermark = watermark;
          },
        });

        await publishEvent(visitorId, {
          type: "tool_complete",
          id: block.id,
          name: block.name,
          result,
          runId,
        });

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
        previousToolName = block.name;
      }

      turnMessages.push({ role: "user", content: toolResults });
      await updateRunMessages(runId, turnMessages);

      pendingWake = await consumePendingWake(visitorId, runId);
      let injectedPendingInbox = false;
      if (
        pendingWake ||
        (await hasUnreadInboxMessages(visitorId, runState.watermark))
      ) {
        // Mid-loop checks are only surfaced when they contain messages. Empty
        // checks drain stale wake signals without polluting debug history or
        // reconstructed Claude history.
        const midCheck = await runInjectedCheckInbox(visitorId, runId, runState, {
          publishWhenEmpty: false,
        });
        const midInboxAction = decideInjectedInboxAction({
          phase: "mid_loop",
          hasMessages: midCheck.hasMessages,
        });
        if (midInboxAction.inject) {
          injectInboxResult(turnMessages, midCheck.id, midCheck.result);
          await updateRunMessages(runId, turnMessages);
        }
        if (midInboxAction.continueLoop) {
          injectedPendingInbox = true;
        }
      }

      const action = decideSleepAction({
        pendingWake: pendingWake || injectedPendingInbox,
        iteration,
        maxIterations: MAX_ITERATIONS,
        toolUseCount: toolUseBlocks.length,
      });

      if (action === "sleep" && !pendingWake) {
        break;
      }
    }

    const finalWatermark = runState.watermark;
    if (finalWatermark) {
      await advanceInboxWatermark({
        visitorId,
        messageId: finalWatermark.messageId,
      });
    }

    await publishEvent(visitorId, {
      type: "run_end",
      runId,
      status: "completed",
    });
    await finishRun(runId, turnMessages, "completed");
  } catch (error) {
    const message = (error as Error).message;
    await publishEvent(visitorId, {
      type: "error",
      message,
      runId,
    }).catch(() => {});
    await publishEvent(visitorId, {
      type: "run_end",
      runId,
      status: "failed",
      error: message,
    }).catch(() => {});
    await finishRun(runId, turnMessages, "failed", message).catch(() => {});
  } finally {
    await releaseRunLock(visitorId, runId);
  }
}

function getAnthropic() {
  if (!anthropic) {
    const apiKey = process.env.CLAUDE_API_KEY ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("CLAUDE_API_KEY is required");
    }

    anthropic = new Anthropic({ apiKey });
  }

  return anthropic;
}

function getOpenRouterApiKey() {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required for OpenRouter models");
  }
  return apiKey;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function updateRunMessages(runId: string, turnMessages: ClaudeMessage[]) {
  await getDb()
    .update(runs)
    .set({ turnMessages })
    .where(eq(runs.id, runId));
}

async function deleteRun(runId: string) {
  await getDb().delete(runs).where(eq(runs.id, runId));
}

async function runInjectedCheckInbox(
  visitorId: string,
  runId: string,
  runState: RunState,
  options: { publishWhenEmpty?: boolean } = {},
) {
  const id = crypto.randomUUID();
  const publishWhenEmpty = options.publishWhenEmpty ?? true;
  let started = false;

  if (publishWhenEmpty) {
    await publishEvent(visitorId, {
      type: "tool_start",
      id,
      name: "check_inbox",
      input: {},
      runId,
    });
    started = true;
  }

  const result = await executeHaroldTool("check_inbox", {}, {
    visitorId,
    runId,
    inboxWatermark: runState.watermark,
    recordInboxWatermark: (watermark) => {
      runState.watermark = watermark;
    },
  });
  const hasMessages = getInboxMessageCount(result) > 0;

  if (!started && hasMessages) {
    await publishEvent(visitorId, {
      type: "tool_start",
      id,
      name: "check_inbox",
      input: {},
      runId,
    });
    started = true;
  }

  if (started) {
    await publishEvent(visitorId, {
      type: "tool_complete",
      id,
      name: "check_inbox",
      result,
      runId,
    });
  }

  return {
    id,
    result,
    hasMessages,
  };
}

export function injectInboxResult(
  messages: ClaudeMessage[],
  toolUseId: string,
  result: unknown,
) {
  messages.push(
    {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: toolUseId,
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
          tool_use_id: toolUseId,
          content: JSON.stringify(result),
        },
      ],
    },
  );
}

function getInboxMessageCount(result: unknown) {
  if (!result || typeof result !== "object") {
    return 0;
  }

  const messages = (result as { messages?: unknown }).messages;
  return Array.isArray(messages) ? messages.length : 0;
}

async function finishRun(
  runId: string,
  turnMessages: ClaudeMessage[],
  status: "completed" | "failed",
  error?: string,
) {
  await getDb()
    .update(runs)
    .set({
      status,
      error: error ?? null,
      turnMessages,
      completedAt: new Date(),
    })
    .where(eq(runs.id, runId));
}

async function publishServerToolEvents(
  visitorId: string,
  runId: string,
  content: unknown[],
) {
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }

    const record = block as Record<string, unknown>;
    if (record.type === "server_tool_use") {
      await publishEvent(visitorId, {
        type: "tool_start",
        id: String(record.id ?? crypto.randomUUID()),
        name: String(record.name ?? "web_search"),
        input: coerceObject(record.input),
        runId,
      });
    }

    if (record.type === "web_search_tool_result") {
      await publishEvent(visitorId, {
        type: "tool_complete",
        id: String(record.tool_use_id ?? crypto.randomUUID()),
        name: "web_search",
        result: { success: true },
        runId,
      });
    }
  }
}

async function publishAssistantTextEvents(
  visitorId: string,
  runId: string,
  content: unknown[],
) {
  const text = extractText(content);
  if (!text) {
    return;
  }

  await publishEvent(visitorId, {
    type: "assistant_text",
    text,
    runId,
  });
}

async function publishAssistantThinkingEvents(
  visitorId: string,
  runId: string,
  content: unknown[],
) {
  const text = extractThinking(content);
  if (!text) {
    return;
  }

  await publishEvent(visitorId, {
    type: "assistant_thinking",
    text,
    runId,
  });
}

function isToolUseBlock(block: unknown): block is {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
} {
  return (
    Boolean(block) &&
    typeof block === "object" &&
    (block as Record<string, unknown>).type === "tool_use" &&
    typeof (block as Record<string, unknown>).id === "string" &&
    typeof (block as Record<string, unknown>).name === "string"
  );
}

function extractText(content: unknown[]) {
  return content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }

      const record = block as Record<string, unknown>;
      return record.type === "text" && typeof record.text === "string"
        ? record.text
        : "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function extractThinking(content: unknown[]) {
  return content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }

      const record = block as Record<string, unknown>;
      if (record.type !== "thinking") {
        return "";
      }

      return typeof record.thinking === "string"
        ? record.thinking
        : typeof record.text === "string"
          ? record.text
          : "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function coerceObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
