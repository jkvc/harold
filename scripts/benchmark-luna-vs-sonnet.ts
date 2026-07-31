/**
 * Replay Harold history turns: Claude Sonnet 4.6 vs GPT-5.6 Luna.
 * Cases from Neon run history (inbox → first send_message).
 *
 * Usage: pnpm dlx tsx scripts/benchmark-luna-vs-sonnet.ts
 * Output: tmp/llm-benchmark/luna-vs-sonnet-{results.json,report.md}
 *
 * Requires ANTHROPIC_API_KEY (Harold .env.local) and OPENROUTER_API_KEY
 * (from Harold or jkvc .env.local).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { HAROLD_SYSTEM_PROMPT } from "@/app/lib/harold/system-prompt";

const OUT_DIR = join(process.cwd(), "tmp/llm-benchmark");
const CASES_PATH = join(OUT_DIR, "replay-cases.json");
const CONCURRENCY = 4;
const MAX_TOKENS = 1200;

const SONNET = "claude-sonnet-4-6";
const LUNA = "openai/gpt-5.6-luna";

/** Client tools only — Anthropic server web_search is not portable to Luna. */
const CLIENT_TOOLS_ANTHROPIC = [
  {
    name: "check_inbox",
    description:
      "Read new user messages since Harold last checked the inbox. The engine automatically runs check_inbox when Harold wakes and before Harold sleeps, so you usually do not need to call it yourself.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "send_message",
    description: "Send a complete Harold chat bubble to the user.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string" },
        replyToId: { type: "string" },
      },
      required: ["content"],
      additionalProperties: false,
    },
  },
  {
    name: "react_to",
    description: "React to a user message with a short emoji reaction.",
    input_schema: {
      type: "object",
      properties: {
        messageId: { type: "string" },
        emoji: { type: "string" },
      },
      required: ["messageId", "emoji"],
      additionalProperties: false,
    },
  },
  {
    name: "update_memory",
    description: "Replace Harold's durable free-form memory memo.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string" },
      },
      required: ["content"],
      additionalProperties: false,
    },
  },
] as const;

type ClaudeMessage = {
  role: "user" | "assistant";
  content: unknown;
};

type ReplayCase = {
  runId: string;
  visitorId: string;
  model: string | null;
  assistantIndex: number;
  inbox: string[];
  goldSend: string;
  goldTools: string[];
  prefix: ClaudeMessage[];
  gold: unknown[];
};

type ModelResult = {
  model: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
  toolNames: string[];
  sendContent: string | null;
  rawPreview: string;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
};

type CaseResult = {
  caseIndex: number;
  runId: string;
  visitorId: string;
  inbox: string[];
  goldSend: string;
  goldTools: string[];
  sonnet: ModelResult;
  luna: ModelResult;
  scores: {
    bothSent: boolean;
    lunaSent: boolean;
    sonnetSent: boolean;
    toolSetMatch: boolean;
    sendOverlap: number;
  };
};

function loadEnvFiles(): void {
  for (const candidate of [
    join(process.cwd(), ".env.local"),
    join(process.cwd(), "../jkvc/.env.local"),
  ]) {
    try {
      const raw = readFileSync(candidate, "utf8");
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
      }
    } catch {
      /* optional */
    }
  }
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

function extractToolUses(content: unknown): Array<{
  name: string;
  input: Record<string, unknown>;
}> {
  if (!Array.isArray(content)) return [];
  return content
    .filter(
      (b): b is Record<string, unknown> =>
        Boolean(b) &&
        typeof b === "object" &&
        (b as { type?: string }).type === "tool_use",
    )
    .map((b) => ({
      name: String(b.name ?? ""),
      input:
        b.input && typeof b.input === "object"
          ? (b.input as Record<string, unknown>)
          : {},
    }));
}

function extractSend(content: unknown): string | null {
  const send = extractToolUses(content).find((t) => t.name === "send_message");
  if (!send) return null;
  return typeof send.input.content === "string" ? send.input.content : null;
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(
    a
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
  const tb = new Set(
    b
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

function anthropicToolsToOpenAI() {
  return CLIENT_TOOLS_ANTHROPIC.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

/** Convert Anthropic message history → OpenAI chat messages (incl. tools). */
function toOpenAIMessages(prefix: ClaudeMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];

  for (const msg of prefix) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        out.push({ role: "user", content: msg.content });
        continue;
      }
      if (!Array.isArray(msg.content)) continue;

      const toolResults = msg.content.filter(
        (b): b is Record<string, unknown> =>
          Boolean(b) &&
          typeof b === "object" &&
          (b as { type?: string }).type === "tool_result",
      );
      const texts = msg.content
        .filter(
          (b): b is Record<string, unknown> =>
            Boolean(b) &&
            typeof b === "object" &&
            (b as { type?: string }).type === "text",
        )
        .map((b) => String(b.text ?? ""))
        .filter(Boolean);

      if (texts.length > 0) {
        out.push({ role: "user", content: texts.join("\n") });
      }
      for (const tr of toolResults) {
        out.push({
          role: "tool",
          tool_call_id: String(tr.tool_use_id ?? ""),
          content:
            typeof tr.content === "string"
              ? tr.content
              : JSON.stringify(tr.content ?? {}),
        });
      }
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

function sanitizeAnthropicMessages(prefix: ClaudeMessage[]): ClaudeMessage[] {
  // Drop server-only blocks that confuse replay; keep tool_use/tool_result/text.
  return prefix.map((msg) => {
    if (!Array.isArray(msg.content)) return msg;
    const filtered = msg.content.filter((b) => {
      if (!b || typeof b !== "object") return true;
      const t = String((b as { type?: string }).type ?? "");
      return (
        t === "text" ||
        t === "tool_use" ||
        t === "tool_result" ||
        t === "input_json"
      );
    });
    return { role: msg.role, content: filtered.length > 0 ? filtered : msg.content };
  });
}

async function callSonnet(
  anthropic: Anthropic,
  prefix: ClaudeMessage[],
): Promise<ModelResult> {
  const start = performance.now();
  try {
    const response = await anthropic.messages.create({
      model: SONNET,
      max_tokens: MAX_TOKENS,
      system: HAROLD_SYSTEM_PROMPT,
      tools: CLIENT_TOOLS_ANTHROPIC as never,
      messages: sanitizeAnthropicMessages(prefix) as never,
    });
    const content = response.content as unknown[];
    const tools = extractToolUses(content);
    return {
      model: SONNET,
      ok: true,
      latencyMs: Math.round(performance.now() - start),
      toolNames: tools.map((t) => t.name),
      sendContent: extractSend(content),
      rawPreview: JSON.stringify(content).slice(0, 800),
      promptTokens: response.usage?.input_tokens,
      completionTokens: response.usage?.output_tokens,
    };
  } catch (err) {
    return {
      model: SONNET,
      ok: false,
      latencyMs: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : String(err),
      toolNames: [],
      sendContent: null,
      rawPreview: "",
    };
  }
}

async function callLuna(
  apiKey: string,
  prefix: ClaudeMessage[],
): Promise<ModelResult> {
  const start = performance.now();
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://harold.local",
        "X-Title": "harold luna-vs-sonnet",
      },
      body: JSON.stringify({
        model: LUNA,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: "system", content: HAROLD_SYSTEM_PROMPT },
          ...toOpenAIMessages(sanitizeAnthropicMessages(prefix)),
        ],
        tools: anthropicToolsToOpenAI(),
        tool_choice: "auto",
      }),
    });
    const body = (await res.json()) as {
      error?: { message?: string };
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
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

    const message = body.choices?.[0]?.message;
    const toolCalls = message?.tool_calls ?? [];
    const tools = toolCalls.map((tc) => {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(tc.function?.arguments ?? "{}") as Record<
          string,
          unknown
        >;
      } catch {
        input = {};
      }
      return { name: String(tc.function?.name ?? ""), input };
    });
    const send = tools.find((t) => t.name === "send_message");
    const sendContent =
      send && typeof send.input.content === "string"
        ? send.input.content
        : null;

    return {
      model: LUNA,
      ok: true,
      latencyMs: Math.round(performance.now() - start),
      toolNames: tools.map((t) => t.name),
      sendContent,
      rawPreview: JSON.stringify(message ?? {}).slice(0, 800),
      promptTokens: body.usage?.prompt_tokens,
      completionTokens: body.usage?.completion_tokens,
      costUsd: body.usage?.cost,
    };
  } catch (err) {
    return {
      model: LUNA,
      ok: false,
      latencyMs: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : String(err),
      toolNames: [],
      sendContent: null,
      rawPreview: "",
    };
  }
}

function scoreCase(
  goldSend: string,
  goldTools: string[],
  sonnet: ModelResult,
  luna: ModelResult,
) {
  const lunaSent = Boolean(luna.sendContent);
  const sonnetSent = Boolean(sonnet.sendContent);
  const goldToolSet = new Set(goldTools.filter((n) => n !== "web_search"));
  const lunaSet = new Set(luna.toolNames);
  const toolSetMatch =
    goldToolSet.size > 0 &&
    [...goldToolSet].every((n) => lunaSet.has(n)) &&
    luna.toolNames.every((n) => goldToolSet.has(n) || n === "check_inbox");

  const sendOverlap = luna.sendContent
    ? Math.max(
        tokenOverlap(luna.sendContent, goldSend),
        sonnet.sendContent
          ? tokenOverlap(luna.sendContent, sonnet.sendContent)
          : 0,
      )
    : 0;

  return {
    bothSent: lunaSent && sonnetSent,
    lunaSent,
    sonnetSent,
    toolSetMatch,
    sendOverlap,
  };
}

function mean(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function renderReport(results: CaseResult[]): string {
  const lines: string[] = [
    "# Harold: Luna vs Sonnet 4.6 (history replay)",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Cases: ${results.length} real Neon runs (first send_message after inbox)`,
    `Models: \`${SONNET}\` (Anthropic) vs \`${LUNA}\` (OpenRouter)`,
    "",
    "Note: Anthropic server tool `web_search` excluded from both for a fair portable-tools comparison.",
    "",
    "## Summary",
    "",
  ];

  const sonnetOk = results.filter((r) => r.sonnet.ok).length;
  const lunaOk = results.filter((r) => r.luna.ok).length;
  const bothSent = results.filter((r) => r.scores.bothSent).length;
  const lunaSent = results.filter((r) => r.scores.lunaSent).length;
  const sonnetSent = results.filter((r) => r.scores.sonnetSent).length;
  const toolMatch = results.filter((r) => r.scores.toolSetMatch).length;
  const overlaps = results
    .filter((r) => r.scores.lunaSent)
    .map((r) => r.scores.sendOverlap);

  lines.push(
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Sonnet OK | ${sonnetOk}/${results.length} |`,
    `| Luna OK | ${lunaOk}/${results.length} |`,
    `| Sonnet called send_message | ${sonnetSent}/${results.length} |`,
    `| Luna called send_message | ${lunaSent}/${results.length} |`,
    `| Both sent | ${bothSent}/${results.length} |`,
    `| Luna tool-set ≈ gold | ${toolMatch}/${results.length} |`,
    `| Avg send token overlap (Luna vs gold/sonnet) | ${overlaps.length ? mean(overlaps).toFixed(2) : "—"} |`,
    `| Sonnet avg latency | ${Math.round(mean(results.filter((r) => r.sonnet.ok).map((r) => r.sonnet.latencyMs)))} ms |`,
    `| Luna avg latency | ${Math.round(mean(results.filter((r) => r.luna.ok).map((r) => r.luna.latencyMs)))} ms |`,
    "",
  );

  lines.push("## Per-case", "");
  for (const r of results) {
    lines.push(
      `### ${r.caseIndex + 1}. \`${r.runId.slice(0, 8)}\` — inbox: ${JSON.stringify(r.inbox[0]?.slice(0, 80) ?? "")}`,
      "",
      `Gold (${r.goldTools.join(", ")}): ${JSON.stringify(r.goldSend.slice(0, 160))}`,
      "",
      `| | tools | send | ms |`,
      `|---|-------|------|----|`,
      `| Sonnet | ${r.sonnet.ok ? r.sonnet.toolNames.join(", ") || "(none)" : `FAIL ${r.sonnet.error}`} | ${JSON.stringify((r.sonnet.sendContent ?? "").slice(0, 100))} | ${r.sonnet.latencyMs} |`,
      `| Luna | ${r.luna.ok ? r.luna.toolNames.join(", ") || "(none)" : `FAIL ${r.luna.error}`} | ${JSON.stringify((r.luna.sendContent ?? "").slice(0, 100))} | ${r.luna.latencyMs} |`,
      "",
      `Scores: bothSent=${r.scores.bothSent} toolMatch=${r.scores.toolSetMatch} overlap=${r.scores.sendOverlap.toFixed(2)}`,
      "",
    );
  }

  lines.push(
    "## Migration recommendation",
    "",
    "_Filled after qualitative review._",
    "",
  );
  return lines.join("\n");
}

async function main(): Promise<void> {
  loadEnvFiles();
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY missing");
  }
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY missing (Harold or ../jkvc .env.local)");
  }

  const cases = JSON.parse(readFileSync(CASES_PATH, "utf8")) as ReplayCase[];
  if (cases.length < 15) {
    throw new Error(`Need ≥15 replay cases, found ${cases.length}`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const orKey = process.env.OPENROUTER_API_KEY;

  console.log(`Replaying ${cases.length} history cases (concurrency ${CONCURRENCY})…`);

  let done = 0;
  const results = await mapPool(cases, CONCURRENCY, async (c, caseIndex) => {
    const [sonnet, luna] = await Promise.all([
      callSonnet(anthropic, c.prefix),
      callLuna(orKey, c.prefix),
    ]);
    done += 1;
    console.log(
      `  ${done}/${cases.length} ${c.runId.slice(0, 8)} ` +
        `sonnet=${sonnet.ok ? sonnet.toolNames.join("+") || "∅" : "FAIL"} ` +
        `luna=${luna.ok ? luna.toolNames.join("+") || "∅" : "FAIL"}`,
    );
    return {
      caseIndex,
      runId: c.runId,
      visitorId: c.visitorId,
      inbox: c.inbox,
      goldSend: c.goldSend,
      goldTools: c.goldTools,
      sonnet,
      luna,
      scores: scoreCase(c.goldSend, c.goldTools, sonnet, luna),
    } satisfies CaseResult;
  });

  writeFileSync(
    join(OUT_DIR, "luna-vs-sonnet-results.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sonnet: SONNET,
        luna: LUNA,
        caseCount: results.length,
        results,
      },
      null,
      2,
    ),
  );
  writeFileSync(join(OUT_DIR, "luna-vs-sonnet-report.md"), renderReport(results));
  console.log(`\nDone → ${join(OUT_DIR, "luna-vs-sonnet-report.md")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
