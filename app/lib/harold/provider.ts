/** OpenRouter chat-completions adapter for Harold (Luna and other non-Claude models). */

export type ClaudeMessage = {
  role: "user" | "assistant";
  content: unknown;
};

export type AnthropicToolUse = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
};

export type HaroldClientTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

/** OpenRouter server tool — portable web search for any model. */
export const OPENROUTER_WEB_SEARCH_TOOL = {
  type: "openrouter:web_search",
  parameters: { max_results: 5 },
} as const;

export function usesOpenRouterProvider(model: string): boolean {
  return !model.startsWith("claude");
}

export function clientToolsToOpenAI(tools: HaroldClientTool[]) {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

/**
 * Convert Anthropic-style Harold history (tool_use / tool_result) into OpenAI
 * chat messages for OpenRouter.
 */
export function anthropicHistoryToOpenAI(
  messages: ClaudeMessage[],
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        out.push({ role: "user", content: msg.content });
        continue;
      }
      if (!Array.isArray(msg.content)) continue;

      const texts: string[] = [];
      const toolResults: Array<Record<string, unknown>> = [];
      for (const block of msg.content) {
        if (!block || typeof block !== "object") continue;
        const record = block as Record<string, unknown>;
        if (record.type === "text" && typeof record.text === "string") {
          texts.push(record.text);
        }
        if (record.type === "tool_result") {
          toolResults.push({
            role: "tool",
            tool_call_id: String(record.tool_use_id ?? ""),
            content:
              typeof record.content === "string"
                ? record.content
                : JSON.stringify(record.content ?? {}),
          });
        }
      }
      if (texts.length > 0) {
        out.push({ role: "user", content: texts.join("\n") });
      }
      out.push(...toolResults);
      continue;
    }

    // assistant
    if (typeof msg.content === "string") {
      out.push({ role: "assistant", content: msg.content });
      continue;
    }
    if (!Array.isArray(msg.content)) continue;

    const texts = msg.content
      .filter(
        (b): b is Record<string, unknown> =>
          Boolean(b) &&
          typeof b === "object" &&
          (b as { type?: string }).type === "text",
      )
      .map((b) => String(b.text ?? ""))
      .filter(Boolean);

    const toolUses = msg.content.filter(
      (b): b is Record<string, unknown> =>
        Boolean(b) &&
        typeof b === "object" &&
        (b as { type?: string }).type === "tool_use",
    );

    const assistant: Record<string, unknown> = {
      role: "assistant",
      content: texts.length > 0 ? texts.join("\n") : null,
    };
    if (toolUses.length > 0) {
      assistant.tool_calls = toolUses.map((b) => ({
        id: String(b.id ?? crypto.randomUUID()),
        type: "function",
        function: {
          name: String(b.name ?? ""),
          arguments: JSON.stringify(b.input ?? {}),
        },
      }));
    }
    out.push(assistant);
  }

  return out;
}

/** Map OpenAI tool_calls into Anthropic tool_use blocks for durable run history. */
export function openAIToolCallsToAnthropicContent(
  message: {
    content?: string | null;
    tool_calls?: Array<{
      id?: string;
      function?: { name?: string; arguments?: string };
    }>;
  } | null,
): unknown[] {
  const content: unknown[] = [];
  const text = message?.content?.trim();
  if (text) {
    content.push({ type: "text", text });
  }

  for (const call of message?.tool_calls ?? []) {
    let input: unknown = {};
    try {
      input = JSON.parse(call.function?.arguments ?? "{}");
    } catch {
      input = {};
    }
    content.push({
      type: "tool_use",
      id: call.id ?? crypto.randomUUID(),
      name: String(call.function?.name ?? ""),
      input,
    } satisfies AnthropicToolUse);
  }

  return content;
}

export type OpenRouterCompletion = {
  content: unknown[];
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
  rawMessage: {
    content?: string | null;
    tool_calls?: Array<{
      id?: string;
      function?: { name?: string; arguments?: string };
    }>;
  } | null;
};

export async function completeOpenRouter(options: {
  apiKey: string;
  model: string;
  system: string;
  messages: ClaudeMessage[];
  clientTools: HaroldClientTool[];
  maxTokens: number;
}): Promise<OpenRouterCompletion> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER ?? "https://harold.chat",
      "X-Title": process.env.OPENROUTER_APP_TITLE ?? "harold",
    },
    body: JSON.stringify({
      model: options.model,
      max_tokens: options.maxTokens,
      messages: [
        { role: "system", content: options.system },
        ...anthropicHistoryToOpenAI(options.messages),
      ],
      tools: [
        ...clientToolsToOpenAI(options.clientTools),
        OPENROUTER_WEB_SEARCH_TOOL,
      ],
      tool_choice: "auto",
    }),
  });

  const body = (await res.json()) as {
    error?: { message?: string };
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      cost?: number;
    };
  };

  if (!res.ok) {
    throw new Error(body.error?.message ?? `OpenRouter HTTP ${res.status}`);
  }

  const rawMessage = body.choices?.[0]?.message ?? null;
  return {
    content: openAIToolCallsToAnthropicContent(rawMessage),
    promptTokens: body.usage?.prompt_tokens,
    completionTokens: body.usage?.completion_tokens,
    costUsd: body.usage?.cost,
    rawMessage,
  };
}

/** Delay between consecutive send_message tool executions in one model turn. */
export const SEND_MESSAGE_STAGGER_MS = 350;

export function shouldStaggerBeforeTool(options: {
  toolName: string;
  previousToolName: string | null;
}): boolean {
  return (
    options.toolName === "send_message" &&
    options.previousToolName === "send_message"
  );
}
