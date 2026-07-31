import { describe, expect, it } from "vitest";
import {
  anthropicHistoryToOpenAI,
  openAIToolCallsToAnthropicContent,
  shouldStaggerBeforeTool,
  usesOpenRouterProvider,
} from "@/app/lib/harold/provider";
import { DEFAULT_HAROLD_MODEL } from "@/app/lib/harold/system-prompt";

describe("Harold OpenRouter provider", () => {
  it("routes Claude models to Anthropic and others to OpenRouter", () => {
    expect(usesOpenRouterProvider("claude-sonnet-4-6")).toBe(false);
    expect(usesOpenRouterProvider("claude-haiku-4-5")).toBe(false);
    expect(usesOpenRouterProvider("openai/gpt-5.6-luna")).toBe(true);
    expect(usesOpenRouterProvider(DEFAULT_HAROLD_MODEL)).toBe(true);
  });

  it("defaults Harold to Luna on OpenRouter", () => {
    expect(DEFAULT_HAROLD_MODEL).toBe("openai/gpt-5.6-luna");
  });

  it("converts Anthropic tool history into OpenAI chat messages", () => {
    expect(
      anthropicHistoryToOpenAI([
        {
          role: "user",
          content: "You've been woken up.",
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
                messages: [{ id: "m1", content: "hi" }],
              }),
            },
          ],
        },
      ]),
    ).toEqual([
      { role: "user", content: "You've been woken up." },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "check-1",
            type: "function",
            function: {
              name: "check_inbox",
              arguments: "{}",
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "check-1",
        content: JSON.stringify({
          success: true,
          messages: [{ id: "m1", content: "hi" }],
        }),
      },
    ]);
  });

  it("keeps user text ahead of tool_result blocks in the same user turn", () => {
    expect(
      anthropicHistoryToOpenAI([
        {
          role: "user",
          content: [
            { type: "text", text: "also look at this" },
            {
              type: "tool_result",
              tool_use_id: "t1",
              content: '{"ok":true}',
            },
          ],
        },
      ]),
    ).toEqual([
      { role: "user", content: "also look at this" },
      { role: "tool", tool_call_id: "t1", content: '{"ok":true}' },
    ]);
  });

  it("maps OpenAI tool_calls back to Anthropic tool_use blocks for storage", () => {
    expect(
      openAIToolCallsToAnthropicContent({
        content: null,
        tool_calls: [
          {
            id: "call-1",
            function: {
              name: "send_message",
              arguments: JSON.stringify({ content: "Hey!" }),
            },
          },
          {
            id: "call-2",
            function: {
              name: "send_message",
              arguments: JSON.stringify({ content: "Still here." }),
            },
          },
        ],
      }),
    ).toEqual([
      {
        type: "tool_use",
        id: "call-1",
        name: "send_message",
        input: { content: "Hey!" },
      },
      {
        type: "tool_use",
        id: "call-2",
        name: "send_message",
        input: { content: "Still here." },
      },
    ]);
  });

  it("preserves assistant text alongside tool_calls", () => {
    expect(
      openAIToolCallsToAnthropicContent({
        content: "thinking out loud",
        tool_calls: [
          {
            id: "call-1",
            function: {
              name: "react_to",
              arguments: JSON.stringify({ messageId: "m1", emoji: "👍" }),
            },
          },
        ],
      }),
    ).toEqual([
      { type: "text", text: "thinking out loud" },
      {
        type: "tool_use",
        id: "call-1",
        name: "react_to",
        input: { messageId: "m1", emoji: "👍" },
      },
    ]);
  });

  it("staggers only consecutive send_message tool calls", () => {
    expect(
      shouldStaggerBeforeTool({
        toolName: "send_message",
        previousToolName: null,
      }),
    ).toBe(false);
    expect(
      shouldStaggerBeforeTool({
        toolName: "send_message",
        previousToolName: "react_to",
      }),
    ).toBe(false);
    expect(
      shouldStaggerBeforeTool({
        toolName: "send_message",
        previousToolName: "send_message",
      }),
    ).toBe(true);
  });
});
