# Runtime History Growth Incident

**Date:** 2026-05-18

## Summary

Harold hit Anthropic request-size failures in production for `visitor_97e8f9f2-3892-4eb5-aa2a-ca160066e5a0` even though the visible chat did not contain many user messages. The observed errors were `Request exceeds the maximum size` and `messages: too many messages: 105878 > 100000`. Investigation confirmed the problem was not ordinary conversation length or Claude's token limit. It was an exponential persistence bug in Harold's run history.

The fix separates reconstructed prior history from the current wake's persisted turn history, prevents duplicate/contending wakes from leaving reconstructable copied-history run rows, and filters reconstruction to successful completed runs only. Fresh live integration runs after the fix persisted small `turn_messages` arrays, while the old broken visitor's historical rows showed the huge counts that explained the production failures.

## What Happened

`app/lib/harold/loop.ts` reconstructed recent history at the start of a wake using `reconstructRunMessages(visitorId)`. The bug was that this reconstructed prior history was assigned directly to `turnMessages`, the same array that the current wake mutates and saves back into `runs.turn_messages`.

That meant every new run started with all prior reconstructed turn history, appended the new wake's messages, and then persisted the whole combined array as if it were only the current turn. On the next wake, reconstruction loaded that combined array again, copied it into a new run, appended more messages, and saved the larger combined array. This created geometric growth in stored history.

The duplicate-wake path made the problem worse. `runHaroldLoop()` inserted a `runs` row before acquiring the `harold_state` lock. If lock acquisition failed because another run was active, it marked that pre-inserted run as `completed` with error text `"Another run is active."`, but the row still contained the copied reconstructed history. Those skipped runs then became additional reconstruction input, amplifying the bad history.

## Evidence

A database spot-check of recent runs showed the exact pattern we expected. New post-fix integration visitors had small turn counts like `6` and `8`, while the production failure visitor had older rows with counts like `52943`, `105878`, and `211728`.

The huge rows were not visible chat volume. They were copied prompt/history state. Some of the large rows were failed Anthropic calls and some were `"Another run is active."` rows, which confirmed both parts of the hypothesis: current-run persistence included reconstructed history, and contending duplicate wakes were preserving copied history as reconstructable rows.

## Fix

`runHaroldLoop()` now keeps two separate arrays. `previousMessages` comes from `reconstructRunMessages(visitorId)` and is used only as model context. `turnMessages` starts as an empty array and contains only the current wake's wake prompt, injected inbox tool history, assistant output, tool calls, and tool results. Claude receives `buildModelMessages(previousMessages, turnMessages)`, but only `turnMessages` is saved to `runs.turn_messages`.

The initial `runs` insert now stores `turnMessages: []`. If lock acquisition fails, Harold marks a pending wake and deletes the just-created run row instead of completing it with copied history. This avoids adding skipped duplicate wakes to reconstruction history.

`app/lib/harold/reconstruct.ts` now selects only rows where `status = "completed"` and `error is null`, and `selectReconstructableRuns()` additionally requires `turnMessages` to be an array. Failed runs, skipped/contending wakes, and malformed rows are not replayed into future Claude context.

## Tests Added

`app/__tests__/harold-runtime.test.ts` now covers `buildModelMessages()` so previous history can be combined for model context without mutating or copying it into current turn history. It also covers `selectReconstructableRuns()` so failed, error-marked, and malformed runs are excluded from reconstruction.

`app/__tests__/harold-smoke.integration.test.ts` now includes a regression guard that reads the persisted `runs.turn_messages` for completed live integration runs. Each run must contain exactly one wake-start message and fewer than 40 turn entries. The watermark integration case checks this across two wakes for the same visitor, which is where the old growth bug would have started to show.

The first integration prompt was also made more explicit: it asks Harold to use `send_message`. This reduces live-test flake from Haiku deciding that plain assistant text is sufficient, while the separate empty-inbox test still verifies that plain assistant text is debug-only and does not render as chat.

## Verification

Before this note was written, the fix passed `pnpm run type-check`, `pnpm run lint`, `pnpm test`, `pnpm test:integration`, and `CHECK_BUILD=1 pnpm run build`. The live integration suite passed after the regression assertions were added.

An ad hoc DB check after the fix showed fresh integration runs persisting small histories, while older broken rows for the production failure visitor remained large. We did not backfill, delete, or migrate those old rows. That is intentional: reconstruction now ignores failed/error rows, and project rules say not to backfill or migrate existing data unless explicitly requested.

## Decisions To Remember

`runs.turn_messages` means "messages produced during this run", not "full context sent to Claude". Full context is assembled at call time from successful prior runs plus the current run's turn messages.

Failed and skipped runs are useful for debugging through `harold_events` and run metadata, but they should not become future prompt context. Only successful completed run histories should be reconstructable.

If Harold later adds token-budget compaction or Not Really-style sliding windows, preserve this invariant: compaction may change `previousMessages`, but it must not copy previous history into the current run's persisted `turnMessages`.
