# Phase 2 Runtime And Debug Timeline

**Date:** 2026-05-18

## Summary

Phase 2 shipped Harold as a real responding agent instead of a persisted chat shell. A visitor can send a message, the client debounces a meaning-free wake, Harold wakes through the QStash/local wake path, reads the database-backed inbox, calls Claude with tools, writes Harold messages/reactions, publishes durable events, and the UI receives live SSE updates. The debug timeline also shipped early from the original Phase 3 scope so the runtime can be inspected while it is still being shaped.

The main commit for this work is `d5f6580 implement Harold phase 2 runtime and debug timeline`. Follow-up documentation moved behavioral memory to Phase 4 after the runtime review clarified that Phase 2 creates the memory table but does not inject memory into Harold's prompt yet.

## Scope

The Phase 2 milestone is now: message -> debounce -> wake -> agent loop -> durable events + SSE -> Harold message appears, with reactions and a live timeline-only debug view. It is not the full Not Really runtime. Time-budgeted loops, bounce refresh, full CAS/pending-run cleanup, memory prompt injection, token-budget compaction, and rate/cost controls are intentionally deferred.

The debug timeline was included because the runtime is educational and needs a visible audit trail. The Phase 3 debug panel remains larger: memory/status cards and richer read-only state views are still future work.

## Schema And Migration

Phase 2 adds `runs`, `memory`, `harold_state`, `message_reactions`, and `harold_events` in `drizzle/0002_phase_2_harold.sql` and mirrors them in `app/lib/db/schema.ts`. The `messages` table from Phase 1 now returns reactions with serialized message DTOs.

`runs` stores the Claude turn history for reconstruction. `harold_state` stores Harold's current status, active run, pending wake flag, and composite inbox watermark. `message_reactions` stores first-class tapback-style reactions. `harold_events` is the durable replay/debug timeline source. `memory` exists so Phase 4 can add behavioral memory without another conceptual schema pass, but prompt injection is not part of Phase 2.

The migration was hand-authored rather than generated interactively, following the project rule to avoid non-TTY `drizzle-kit generate/push` hangs. The migration was applied locally only after explicit approval during implementation.

## Event Bus And SSE

`app/lib/event-bus.ts` persists every durable event before publishing it to Redis. This persist-first rule means the debug timeline and replay API see the same event stream that live clients see. Redis channels are namespaced as `harold:{visitorId}:events` to avoid collisions on the shared Redis instance.

`GET /api/events` is cookie-scoped. It replays missed durable events after a cursor and then subscribes to Redis. SSE payloads include both native SSE `id:` lines and JSON `eventId`, so browser reconnect and client-side dedupe have stable cursors. One known limitation remains: replay currently happens before Redis subscribe, so an event can land in the small gap between those operations. That race is accepted for Phase 2 and should be revisited in robustness work.

The client hook in `app/hooks/use-harold-events.ts` maintains the latest event cursor and recreates the `EventSource` after errors with the current cursor. The UI merges message, reaction, run, and error events into local state without breaking optimistic user sends.

## Wake System

`POST /api/wake` is the public cookie-scoped wake endpoint. It accepts no public model override and dispatches a meaning-free wake: the wake says only "check your phone"; message content remains in Postgres.

`app/lib/qstash.ts` sends production wakes through QStash and local development wakes through a direct fetch to `/api/wake/run` with `x-harold-local-wake: 1`. `/api/wake/run` verifies QStash in production and the local wake header outside Vercel, then runs `runHaroldLoop()` via `waitUntil()`.

The integration tests call `/api/wake/run` directly with the local wake header so they can force `claude-haiku-4-5` without reopening public model selection. Broad local model override is still a known development-only sharp edge.

## Agent Loop

The runtime lives in `app/lib/harold/loop.ts`. Each run reconstructs recent history, creates a `runs` row, acquires the `harold_state` lock, publishes `run_start`, injects an initial inbox result, then calls Claude in a bounded loop. Tools are executed synchronously and return Anthropic `tool_result` blocks. On success, the run publishes `run_end`, persists final `turnMessages`, advances the durable inbox watermark, and releases the lock. On failure, it publishes durable debug error events and releases the lock without inserting a normal chat apology.

Phase 2 uses `MAX_ITERATIONS = 8` as a simple loop guard. This is a deliberate simplification versus Not Really's elapsed-time guard plus bounce refresh. Comments in the loop and `TECH_DEBT.md` record that bounce refresh should replace this in Phase 5 Robustness & Polish.

Duplicate wakes are handled by `harold_state.pending_wake_requested_at`: if a wake arrives while Harold is already working, the active loop can drain the pending flag at safe points. This is sufficient for Phase 2 but simpler than Not Really's full CAS + pending-run drain model. Full duplicate-run cleanup is deferred with bounce refresh.

## Check Inbox Injection

`check_inbox` remains visible to Harold as a tool, but the engine owns the important lifecycle calls. This follows the Not Really pattern: visible as an escape hatch, automatically injected when the runtime knows the agent needs inbox context.

Wake-start inbox is always run and injected, even when empty. This saves a model turn and makes the wake context explicit in run history.

Mid-loop inbox checks happen after tool-use turns only when a pending wake flag exists or the database shows unread messages after the run-local watermark. Empty mid-loop checks are silent: no debug event, no history injection, and no extra Claude turn. Non-empty mid-loop checks are logged, injected as synthetic `assistant tool_use` + `user tool_result`, and cause the loop to continue.

Before sleeping, Harold always runs and records a final inbox check. Empty final checks document that Harold checked and can sleep. Non-empty final checks are injected and keep the loop going so late-arriving user messages can be handled before the wake ends.

The durable inbox watermark advances only after the wake completes successfully. `check_inbox` updates a run-local candidate watermark, and `advanceInboxWatermark()` writes the exact Postgres `created_at` for the selected message ID to avoid JavaScript millisecond truncation. This fixed a real regression where the second wake reread an already processed message.

## Tools

`send_message` inserts `role = "harold"` messages and publishes message events. It validates `replyToId` ownership before writing, so a leaked or hallucinated message ID cannot create a cross-visitor reply reference.

`react_to` inserts first-class reactions and publishes reaction events. It validates target message ownership and de-dupes by message/actor/emoji.

`update_memory` exists and writes the `memory` table, but behavioral memory has moved to Phase 4. Until prompt injection is added, Harold should not be considered memory-capable.

Anthropic web search is enabled as a server-side tool. Harold is instructed not to announce tool details; web search appears in debug events but not in chat UI.

## Context Reconstruction

`app/lib/harold/reconstruct.ts` loads recent run histories, prunes server web-search result blocks, strips citations from text blocks, prunes future thinking blocks, and normalizes adjacent same-role messages so Claude receives alternating roles.

This is intentionally simpler than the design ideal. There is no token-budget compaction yet, and skipped/duplicate wake run history cleanup is deferred to the CAS/bounce work. Those are robustness concerns, not blockers for the Phase 2 demo milestone.

## Failure Semantics

Runtime failures no longer create normal Harold chat bubbles. Earlier in the implementation, failures inserted a friendly Harold apology message, but that would incorrectly make an unhandled user message look answered. Now failures publish `error` and failed `run_end` debug events and the client shows a transient toast. The events are durable for debug replay, so the correct wording is "not a chat message" rather than "not persisted anywhere."

Because the durable watermark advances only after success, the next manual or message-triggered wake can reprocess any inbox messages Harold did not actually handle.

## Chat UI

`app/page.tsx` now consumes Harold SSE events. User messages remain optimistic and are reconciled after `POST /api/message`. Harold messages and reactions arrive from SSE and are de-duped by ID. The awake/typing indicator is derived from `run_start` and cleared on `run_end` or `error`; there are no durable typing/status events.

The More menu opens the debug timeline and persists that state through `?debug=true`. The URL state survives refresh and browser back/forward. Refresh Chat, Copy Visitor ID, and About This Demo remain in the same menu.

Reply previews were restyled to be quieter and more consistent with the old-phone visual language. The empty-state copy no longer says Harold will answer in Phase 2 because Harold now does answer.

## Debug Timeline

`app/components/debug-timeline.tsx` renders durable events from `/api/debug` and live SSE events. Desktop shows a second phone-width panel beside the chat and recenters the two-panel layout; mobile slides the debug screen over the chat. The close button is on the left and the manual Wake button is on the right.

Manual Wake opens a preview modal before dispatching. The preview shows the actual formatted JSON returned by `check_inbox`, not a custom card rendering, because the purpose is to show what the runtime will feed Harold. The Wake button is disabled while Harold is already awake.

Timeline rows use concise labels/icons: Wake, Sleep, tool names, Harold message, User message, Harold text, and Harold deep thought. `assistant_text` is debug-only model text that was not sent via `send_message`. `assistant_thinking` is future-proofed for possible thinking output, but thinking is not enabled and is pruned from reconstruction.

## Documentation And Tech Debt

`docs/roadmap.md` was updated so Phase 2 is the responding runtime + debug timeline, Phase 4 owns behavioral memory, and Phase 5 is now Robustness & Polish. `docs/design.md` documents the current runtime choices, inbox injection semantics, durable error debugging, and deferrals. `README.md` documents Phase 2 environment variables and the integration test command. `CLAUDE.md` records the expensive integration test rule.

`TECH_DEBT.md` tracks the main conscious shortcuts: no rate/volume limits, timeline-only debug panel, bounce refresh deferred, fixed iteration cap, and duplicate wake cleanup deferred to CAS/bounce work.

## Tests And Verification

Unit tests were added for message serialization with reactions, event-bus helpers, runtime helper decisions, server tool pruning, injected inbox history shape, and the mid-loop/final inbox injection semantics.

The live integration suite in `app/__tests__/harold-smoke.integration.test.ts` uses `claude-haiku-4-5` and is intentionally expensive. It verifies a full user message -> wake -> Harold response path, durable debug evidence, injected `check_inbox` ordering before model output, state cleanup, the inbox watermark regression, and that plain assistant text does not render as chat unless `send_message` is used.

During implementation, `pnpm run type-check`, `pnpm run lint`, `pnpm test`, `CHECK_BUILD=1 pnpm run build`, and `pnpm test:integration` were run successfully. The pre-push hook also passed type-check, lint, tests, and build before `d5f6580` was pushed.

## Decisions To Remember

Wake signals stay meaning-free. Do not put message content, user intent, or command semantics into `/api/wake`; store facts in Postgres and let `check_inbox` read them.

Keep `check_inbox` visible to Harold, but do not rely on Harold to call it at lifecycle boundaries. The engine injects it at wake start and before sleep, and only surfaces mid-loop checks when non-empty.

Do not render plain model text as chat. Only `send_message` creates Harold bubbles. Plain assistant text belongs in debug history.

Failure notifications are debug/toast events, not Harold messages. A failed wake should not mark an unread message as answered.

Memory behavior belongs to Phase 4. The table exists now, but Harold does not remember across wakes until memory is loaded into the system prompt.

Before public release, add rate/cost controls and harden local model override, SSE replay race, duplicate wake cleanup, and bounce refresh.
