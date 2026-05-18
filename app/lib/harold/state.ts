import { and, eq, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/app/lib/db";
import { haroldState } from "@/app/lib/db/schema";

const STALE_LOCK_MS = 5 * 60 * 1000;

export async function acquireRunLock(visitorId: string, runId: string) {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - STALE_LOCK_MS);

  const rows = await getDb()
    .insert(haroldState)
    .values({
      visitorId,
      status: "working",
      activeRunId: runId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: haroldState.visitorId,
      set: {
        status: "working",
        activeRunId: runId,
        pendingWakeRequestedAt: null,
        updatedAt: now,
      },
      where: or(
        eq(haroldState.status, "sleeping"),
        lt(haroldState.updatedAt, staleBefore),
      ),
    })
    .returning();

  return rows.length > 0;
}

export async function markPendingWake(visitorId: string) {
  const now = new Date();

  await getDb()
    .insert(haroldState)
    .values({
      visitorId,
      status: "sleeping",
      pendingWakeRequestedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: haroldState.visitorId,
      set: {
        pendingWakeRequestedAt: now,
        updatedAt: now,
      },
    });
}

export async function consumePendingWake(visitorId: string, runId: string) {
  const [state] = await getDb()
    .select()
    .from(haroldState)
    .where(
      and(
        eq(haroldState.visitorId, visitorId),
        eq(haroldState.activeRunId, runId),
      ),
    )
    .limit(1);

  if (!state?.pendingWakeRequestedAt) {
    return false;
  }

  await getDb()
    .update(haroldState)
    .set({
      pendingWakeRequestedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(haroldState.visitorId, visitorId),
        eq(haroldState.activeRunId, runId),
      ),
    );

  return true;
}

export async function releaseRunLock(visitorId: string, runId: string) {
  await getDb()
    .update(haroldState)
    .set({
      status: "sleeping",
      activeRunId: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(haroldState.visitorId, visitorId),
        eq(haroldState.activeRunId, runId),
      ),
    );
}

export async function advanceInboxWatermark(params: {
  visitorId: string;
  messageId: string;
}) {
  await getDb()
    .update(haroldState)
    .set({
      lastProcessedAt: sql`(SELECT created_at FROM messages WHERE id = ${params.messageId})`,
      lastProcessedMessageId: params.messageId,
      updatedAt: new Date(),
    })
    .where(eq(haroldState.visitorId, params.visitorId));
}
