/**
 * Live smoke: Harold wake loop on openai/gpt-5.6-luna via local /api/wake/run.
 *
 * Usage: pnpm dlx tsx scripts/live-luna-smoke.ts
 * Requires: next server on HAROLD_SMOKE_BASE_URL (default http://localhost:3000),
 * OPENROUTER_API_KEY + DATABASE_URL in .env.local.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/app/lib/db";
import { messages, runs } from "@/app/lib/db/schema";
import { DEFAULT_HAROLD_MODEL } from "@/app/lib/harold/system-prompt";

const BASE_URL = process.env.HAROLD_SMOKE_BASE_URL ?? "http://localhost:3000";
const MODEL = process.env.HAROLD_SMOKE_MODEL ?? DEFAULT_HAROLD_MODEL;

function loadEnvLocal(): void {
  const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function cookieFor(visitorId: string) {
  return `harold_visitor_id=${encodeURIComponent(visitorId)}`;
}

async function postJson(
  path: string,
  cookie: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-json */
  }
  return { ok: res.ok, status: res.status, json, text };
}

async function waitForHaroldMessages(
  visitorId: string,
  minCount: number,
  timeoutMs = 120_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await getDb()
      .select()
      .from(messages)
      .where(
        and(eq(messages.visitorId, visitorId), eq(messages.role, "harold")),
      )
      .orderBy(messages.createdAt);
    if (rows.length >= minCount) return rows;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return getDb()
    .select()
    .from(messages)
    .where(and(eq(messages.visitorId, visitorId), eq(messages.role, "harold")))
    .orderBy(messages.createdAt);
}

async function latestRun(visitorId: string) {
  const rows = await getDb()
    .select()
    .from(runs)
    .where(eq(runs.visitorId, visitorId))
    .orderBy(desc(runs.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

async function waitForTerminalRun(visitorId: string, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await latestRun(visitorId);
    if (run && (run.status === "completed" || run.status === "failed")) {
      return run;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return latestRun(visitorId);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function scenarioReply(): Promise<void> {
  const visitorId = `visitor_${crypto.randomUUID()}`;
  const cookie = cookieFor(visitorId);
  console.log(`\n[reply] visitor=${visitorId} model=${MODEL}`);

  const msg = await postJson("/api/message", cookie, {
    content: "Say a very short hello using send_message.",
  });
  assert(msg.ok, `message failed: ${msg.status} ${msg.text}`);

  const wake = await postJson(
    "/api/wake/run",
    cookie,
    { visitorId, model: MODEL },
    { "x-harold-local-wake": "1" },
  );
  assert(wake.ok, `wake failed: ${wake.status} ${wake.text}`);

  const haroldMsgs = await waitForHaroldMessages(visitorId, 1);
  assert(haroldMsgs.length >= 1, "no Harold message after wake");
  console.log(`  harold: ${JSON.stringify(haroldMsgs[0]!.content)}`);

  const run = await waitForTerminalRun(visitorId);
  assert(run, "no run row after wake");
  assert(
    run.status === "completed",
    `run status=${run.status} error=${run.error ?? "none"}`,
  );
  assert(run.model === MODEL, `run.model=${run.model} expected ${MODEL}`);
  const turns = Array.isArray(run.turnMessages) ? run.turnMessages : [];
  const hasSend = JSON.stringify(turns).includes("send_message");
  assert(hasSend, "completed run missing send_message tool_use");
  console.log(`  run ok model=${run.model} turns=${turns.length}`);
}

async function scenarioMultiSend(): Promise<void> {
  const visitorId = `visitor_${crypto.randomUUID()}`;
  const cookie = cookieFor(visitorId);
  console.log(`\n[multi-send] visitor=${visitorId} model=${MODEL}`);

  const msg = await postJson("/api/message", cookie, {
    content:
      "Send exactly three short chat bubbles with send_message, in order: first 'one', then 'two', then 'three'. Nothing else.",
  });
  assert(msg.ok, `message failed: ${msg.status} ${msg.text}`);

  const t0 = Date.now();
  const wake = await postJson(
    "/api/wake/run",
    cookie,
    { visitorId, model: MODEL },
    { "x-harold-local-wake": "1" },
  );
  assert(wake.ok, `wake failed: ${wake.status} ${wake.text}`);

  // Wait for terminal run first — bubbles may arrive mid-loop before finishRun.
  const run = await waitForTerminalRun(visitorId, 150_000);
  assert(run, "no run row for multi-send");
  assert(
    run.status === "completed",
    `run status=${run.status} error=${run.error ?? "none"}`,
  );
  const haroldMsgs = await waitForHaroldMessages(visitorId, 1, 5_000);
  assert(haroldMsgs.length >= 1, "no Harold messages for multi-send");
  const elapsed = Date.now() - t0;
  console.log(
    `  got ${haroldMsgs.length} bubble(s) in ${elapsed}ms:`,
    haroldMsgs.map((m) => m.content),
  );

  const turns = JSON.stringify(run.turnMessages ?? []);
  const sendCount = (turns.match(/"name":"send_message"/g) ?? []).length;
  console.log(`  send_message tool_uses in run history: ${sendCount}`);

  // Soft assert: prefer ≥2 bubbles when model complies; still pass if 1 with content
  if (haroldMsgs.length >= 2) {
    console.log("  multi-bubble path exercised ✓");
  } else {
    console.log(
      "  note: model returned a single bubble (acceptable; stagger path may not fire)",
    );
  }
}

async function scenarioEmptyInboxNoSpam(): Promise<void> {
  const visitorId = `visitor_${crypto.randomUUID()}`;
  const cookie = cookieFor(visitorId);
  console.log(`\n[empty-inbox] visitor=${visitorId} model=${MODEL}`);

  const wake = await postJson(
    "/api/wake/run",
    cookie,
    { visitorId, model: MODEL },
    { "x-harold-local-wake": "1" },
  );
  assert(wake.ok, `wake failed: ${wake.status} ${wake.text}`);

  const run = await waitForTerminalRun(visitorId, 90_000);
  assert(run, "empty-inbox wake did not produce a run");
  assert(
    run.status === "completed",
    `run status=${run.status} error=${run.error ?? "none"}`,
  );
  const haroldMsgs = await getDb()
    .select()
    .from(messages)
    .where(and(eq(messages.visitorId, visitorId), eq(messages.role, "harold")));
  console.log(
    `  harold bubbles=${haroldMsgs.length} (prefer 0) run.status=${run.status}`,
  );
  if (haroldMsgs.length > 0) {
    console.log(
      "  note: empty inbox still sent a message — prompt compliance soft fail",
      haroldMsgs.map((m) => m.content),
    );
  } else {
    console.log("  slept without spam ✓");
  }
}

async function main(): Promise<void> {
  loadEnvLocal();
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY missing");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL missing");
  }

  const health = await fetch(BASE_URL).catch(() => null);
  if (!health) {
    throw new Error(
      `Server not reachable at ${BASE_URL}. Start with: pnpm dev`,
    );
  }

  console.log(`Live Luna smoke against ${BASE_URL} model=${MODEL}`);
  await scenarioReply();
  await scenarioMultiSend();
  await scenarioEmptyInboxNoSpam();
  console.log("\nAll live smoke scenarios finished.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
