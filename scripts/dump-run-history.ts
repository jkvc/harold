/**
 * Dump completed Harold runs from Neon for LLM replay benchmarks.
 * Usage: pnpm dlx tsx scripts/dump-run-history.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/app/lib/db";
import { messages, runs } from "@/app/lib/db/schema";

function loadEnvLocal(): void {
  const path = join(process.cwd(), ".env.local");
  const raw = readFileSync(path, "utf8");
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

async function main(): Promise<void> {
  loadEnvLocal();
  const outDir = join(process.cwd(), "tmp/llm-benchmark");
  mkdirSync(outDir, { recursive: true });

  const runRows = await getDb()
    .select({
      id: runs.id,
      visitorId: runs.visitorId,
      model: runs.model,
      status: runs.status,
      error: runs.error,
      turnMessages: runs.turnMessages,
      createdAt: runs.createdAt,
      completedAt: runs.completedAt,
    })
    .from(runs)
    .where(and(eq(runs.status, "completed"), isNull(runs.error)))
    .orderBy(desc(runs.createdAt))
    .limit(200);

  const visitorCounts = await getDb()
    .select({
      visitorId: runs.visitorId,
      n: sql<number>`count(*)::int`,
    })
    .from(runs)
    .where(eq(runs.status, "completed"))
    .groupBy(runs.visitorId)
    .orderBy(desc(sql`count(*)`))
    .limit(20);

  const messageCounts = await getDb()
    .select({
      visitorId: messages.visitorId,
      n: sql<number>`count(*)::int`,
    })
    .from(messages)
    .groupBy(messages.visitorId)
    .orderBy(desc(sql`count(*)`))
    .limit(20);

  writeFileSync(
    join(outDir, "runs-dump.json"),
    JSON.stringify(
      {
        dumpedAt: new Date().toISOString(),
        runCount: runRows.length,
        visitorCounts,
        messageCounts,
        runs: runRows,
      },
      null,
      2,
    ),
  );

  console.log(`runs=${runRows.length}`);
  console.log("top visitors by runs:", visitorCounts.slice(0, 8));
  console.log("top visitors by messages:", messageCounts.slice(0, 8));
  console.log(`→ ${join(outDir, "runs-dump.json")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
