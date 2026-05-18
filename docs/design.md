# Harold — Design Document

Harold is a minimal, educational demo of a non-turn-based LLM harness. It looks and feels like texting a friend — no blocking prompt box, no turn-taking, no "assistant" energy. You send messages whenever you want, Harold reads them when he wakes up, and responds like a person: short bursts, multiple messages, natural pacing.

The architecture is a simplified extraction of the [Not Really](https://notreally.jkvc.ai) multi-agent system, stripped down to a single agent in a single conversation thread. The same core primitives apply — watermark-based inbox, meaning-free wake signals, persistent memory, sliding window context reconstruction — but without the multi-agent coordination, CAS locks, hatsets, or canvas system.

## Architecture Overview

```
┌──────────────────┐                          ┌──────────────────────┐
│                  │  POST /api/message        │                      │
│   Browser        │ ────────────────────────→ │  Store message in DB │
│                  │                           │  (appears in UI      │
│   iMessage-style │  POST /api/wake           │   immediately)       │
│   chat UI        │ ──── (3s debounce) ─────→ │                      │
│                  │                           │  Dispatch wake via   │
│   + SSE listener │                           │  QStash              │
│                  │ ←──── SSE events ──────── │                      │
└──────────────────┘                           └──────────┬───────────┘
                                                          │
                                                          ▼
                                               ┌──────────────────────┐
                                               │   QStash             │
                                               │   (async delivery)   │
                                               └──────────┬───────────┘
                                                          │
                                                          ▼
                                               ┌──────────────────────┐
                                               │   Wake Endpoint      │
                                               │   POST /api/wake/run │
                                               │                      │
                                               │   Uses waitUntil()   │
                                               │   to run agent loop  │
                                               │   in background      │
                                               └──────────┬───────────┘
                                                          │
                                                          ▼
                                               ┌──────────────────────┐
                                               │   Agent Loop         │
                                               │                      │
                                               │   1. check_inbox     │
                                               │   2. Claude thinks   │
                                               │   3. Use tools       │
                                               │   4. send_message(s) │
│   5. Final inbox     │
│   6. Sleep / continue│
                                               └──────────────────────┘
```

### Request Flow

1. User types a message and hits send.
2. Client POSTs to `/api/message` — message is stored in Postgres, returns immediately. Message appears in the chat UI instantly (optimistic).
3. Client resets a 3-second debounce timer. If the user sends another message within 3 seconds, the timer resets. This lets Harold see batched messages, like reading multiple unread texts at once.
4. When the debounce fires, client POSTs to `/api/wake`. This endpoint dispatches a wake to Harold via QStash.
5. QStash delivers the wake to `/api/wake/run` — a Vercel serverless function that runs Harold's agent loop via `waitUntil()`.
6. The agent loop runs: reads inbox, calls Claude with web search available, executes tools, sends messages, and records compact debug events. Each replayable event is persisted to `harold_events` first, then published over Redis pub/sub.
7. The client's SSE listener receives events and renders Harold's messages, reactions, typing state, and debug timeline updates as they arrive.

## Core Primitives

### Watermark-Based Inbox

Harold tracks a composite watermark: the last processed message timestamp plus message ID. When he wakes, `check_inbox` queries all user messages after that pair in the same order as message pagination. Whether one message or five arrived while he was asleep, he sees them all at once as a batch.

This is the fundamental mechanism that makes the system non-turn-based. The user never waits for Harold to finish before sending more messages. Messages accumulate in the database, and Harold reads them in bulk on his next wake.

After a wake completes successfully, the watermark advances to the newest message actually included, avoiding gaps when messages share a timestamp. Runtime failures publish a transient error event rather than a normal Harold message; the durable watermark is not advanced for failed work, so the next wake can retry unprocessed inbox messages.

### Meaning-Free Wake Signal

The wake signal carries zero information about what happened. It's just "hey Harold, check your phone." All actual content lives in the database, retrieved by `check_inbox`.

Why: wake signals are unreliable. They can double-fire, get dropped, or arrive out of order. If you put message content in the wake signal, you lose it when the signal misfires. The database is the source of truth; the wake is just a notification.

### Sliding Window Context Reconstruction

Harold has no persistent in-memory conversation. Every time he wakes, his conversation history is reconstructed from stored run segments in the database.

Each completed run persists its `turnMessages` (the messages exchanged during that wake) to the `runs` table. On the next wake, recent runs are loaded newest-first until a token budget (~30,000 tokens) is reached. Oldest runs get dropped. Chatty tool results (like `check_inbox` output) get compacted to one-line summaries.

This means Harold can be killed at any time — crash, timeout, bad behavior — and the next wake starts clean with full history from the database.

### Persistent Memory

Harold maintains a free-form text memo about the user — things he's learned across conversations. "Prefers direct answers." "Works on a Next.js project." "Name is Alex."

This memo is stored as a single row in the `memory` table, keyed by visitor ID. It is injected into Harold's system prompt on every wake (not a tool — always present). Harold updates it via the `update_memory` tool when he learns something worth remembering.

Memory is visible only in the debug panel, not in the main chat UI.

### Bounce Refresh (Session Continuation)

Bounce refresh is planned for the Robustness & Polish phase, not required for the Phase 2 round trip.

Vercel serverless functions have a 300-second timeout (with Fluid Compute). Harold's agent loop runs within that boundary, exiting at ~270s to leave cleanup buffer.

If Harold has unprocessed events but less than ~90 seconds remaining, he performs a bounce refresh: persists his current run, releases his status back to "sleeping," and dispatches a continuation wake to himself via QStash. The new function picks up seamlessly with full history from the database.

Max 5 bounces per chain to prevent runaway sessions. Bounce count is tracked in the wake dispatch payload.

For Harold (single agent, simple tasks), bounces should be rare — most wakes finish in 10-30 seconds. But the mechanism is a safety net and an educational demonstration of the pattern.

## Identity & Auth

No login required. Each visitor gets a random ID generated on first visit, stored in both localStorage and a cookie (belt and suspenders). This visitor ID is the partition key for all data — messages, runs, memory.

A future login system could map authenticated users to existing visitor IDs, preserving conversation history and memory across devices.

### Clear / Reset

Phase 1 exposes this as "New Chat": the UI generates a fresh visitor ID, writes it to localStorage and the cookie, and reloads or refetches an empty thread. Old rows remain in the database under the previous visitor ID.

A future destructive Clear / Reset can keep the current visitor ID and delete all data for it: messages, runs, and memory. Harold forgets you entirely while the same device keeps the same identity.

## Data Model

### Storage

- **Neon Postgres** — primary storage for messages, runs, memory, reactions, state, and durable events. Accessed via Drizzle ORM.
- **Redis via `ioredis`** — pub/sub channel for real-time SSE delivery. One channel per visitor, using a TCP `REDIS_URL`.
- **QStash** — async wake dispatch. Breaks Vercel's request chain tracking, avoids 508 infinite loop errors on bounce refresh, provides retries.

Phase 1 created only the `messages` table because Harold had no agent loop yet. Phase 2 adds `runs`, `memory`, `harold_state`, `message_reactions`, and `harold_events`.

### Schema

```
messages
  id            text, primary key
  visitor_id    text, indexed
  role          text ("user" | "harold")
  content       text
  reply_to_id   text, nullable (references messages.id)
  created_at    timestamp

runs
  id            text, primary key
  visitor_id    text, indexed
  turn_messages jsonb (the LLM conversation for this wake)
  status        text ("running" | "completed" | "failed")
  model         text
  bounce_count  integer
  error         text
  created_at    timestamp
  completed_at  timestamp, nullable

memory
  id            text, primary key
  visitor_id    text, unique
  content       text (free-form memo)
  updated_at    timestamp

harold_state
  visitor_id          text, primary key
  status              text ("sleeping" | "working")
  active_run_id       text, nullable
  last_processed_at   timestamp, nullable (part of inbox watermark)
  last_processed_message_id text, nullable (part of inbox watermark)
  pending_wake_requested_at timestamp, nullable
  updated_at          timestamp

message_reactions
  id            text, primary key
  visitor_id    text, indexed
  message_id    text, references messages.id
  actor         text ("harold" | "user")
  emoji         text
  created_at    timestamp

harold_events
  id            serial, primary key
  visitor_id    text, indexed
  event_type    text
  payload       jsonb
  run_id        text, nullable
  message_id    text, nullable
  created_at    timestamp
```

`visitor_id` is the partition key for everything. One visitor = one conversation = one Harold instance. SSE and debug APIs derive identity from the visitor cookie only, not from query parameters.

`harold_state` tracks whether Harold is currently working, his active run, pending wake timestamp, and inbox watermark. This is analogous to Not Really's instance lock but reduced to a single agent per visitor.

## Agent Loop

The agent loop is a simplified extraction of Not Really's `loop.ts`. Key differences:

- **Single agent.** No CAS locks needed for multi-agent contention. Simple status check: if Harold is already "working," skip the wake. The `harold_state` row is the lock.
- **No multi-agent coordination.** No `send_message` between agents, no specialist delegation, no pending run queuing.
- **No hatsets, skills, or team sections.** One system prompt, one agent.
- **Simplified tool set.** Four tools (plus Anthropic's built-in web search).
- **Bounce refresh deferred.** Phase 2 keeps the run lock and pending-wake drain; timeout-aware continuation moves to Robustness & Polish.

### Loop Pseudocode

```
function runHaroldLoop(visitorId, runId):
  set harold_state.status = "working"
  reconstruct previousMessages from completed runs (sliding window)
  pre-execute check_inbox, inject as synthetic tool_use/tool_result

  while (elapsed < 270s):
    call Claude with system prompt + history + tools
    process response blocks (text, tool_use)

    if tool_use:
      execute tools (send_message, update_memory, react_to)
      push tool results to messages
      inject pending inbox only if it has messages
      continue

    if end_turn:
      run and record final check_inbox
      decideSleepAction → continue / sleep
      break if sleep

  advance durable inbox watermark if the wake succeeded
  persist turnMessages to runs table
  set harold_state.status = "sleeping"
```

### Pre-Executed Inbox

Like Not Really, `check_inbox` is pre-executed before the first Claude call and injected as a synthetic assistant `tool_use` + user `tool_result` pair. After tool-use turns, pending inbox checks are only logged and injected when they return messages, so stale wake signals do not create empty debug events or extra model turns. Before sleep, the final `check_inbox` result is always recorded in run history; if it has messages, Harold keeps going instead of sleeping.

### Stale Recovery

If a Vercel function crashes and Harold's status stays "working," a simple stale check on the next wake attempt detects it: if `harold_state.updated_at` is older than 90 seconds while status is "working," force-reset to "sleeping" and proceed.

## Tools

### check_inbox

Reads all messages from the `messages` table after the composite durable watermark and `role = 'user'`. Returns them as a structured array. The run records the newest seen inbox message immediately, but advances the durable watermark only after the wake completes successfully.

The tool remains visible to Harold, but the engine auto-runs and injects it at the important lifecycle points. Harold usually should not call it manually.

### send_message

Sends one message to the user. Harold calls this multiple times to send multiple short messages (like a real person texting). Each call:

1. Inserts a row in `messages` with `role = 'harold'`.
2. Publishes an SSE event via Redis pub/sub (the UI renders the message immediately).

Parameters:
- `text` (string, required) — the message content.
- `reply_to_id` (string, optional) — ID of a message this is replying to. The UI renders this as a reply bubble (like iMessage reply).

### react_to

Reacts to a specific message with an emoji (like iMessage tapback reactions).

Parameters:
- `message_id` (string, required) — the message to react to.
- `emoji` (string, required) — the reaction emoji.

Stored as metadata on the message. Published as an SSE event so the UI updates in real time.

### update_memory

Updates Harold's persistent notes about the user. The entire memo is replaced (not appended). Harold decides what to keep, what to add, and what to remove.

Parameters:
- `content` (string, required) — the full updated memo.

Harold sees his current memory in the system prompt, so he has full context when deciding what to write.

### web_search (Anthropic built-in)

Anthropic's server-side web search tool. Zero implementation needed — enabled in the Claude API call via `tools` configuration. Harold uses it transparently when he needs to look something up.

Invisible to the user. No "Harold is searching..." indicator. He just knows things (or goes and finds out silently).

## Real-Time Delivery (SSE)

Server-Sent Events stream Harold's activity to the client via Redis pub/sub.

### Event Types

```typescript
type HaroldSSEEvent =
  | { type: "message"; message: Message }          // Harold sent a message
  | { type: "reaction"; messageId: string; emoji: string }  // Harold reacted
  | { type: "run_start"; runId: string; model: string }      // Harold woke up
  | { type: "run_end"; runId: string; status: string }       // Harold slept/failed
  | { type: "tool_start"; name: string }           // Harold started a tool
  | { type: "tool_complete"; name: string }        // Harold finished a tool
  | { type: "memory_updated" }                     // Memory changed (debug panel)
  | { type: "error"; message: string }             // Something went wrong
```

### Channel

One Redis pub/sub channel per visitor: `harold:{visitorId}:events`.

### SSE Endpoint

`GET /api/events` — long-lived cookie-scoped SSE connection. Subscribes to the visitor's Redis channel, replays missed durable events after a cursor, emits native SSE `id:` fields for reconnects, and uses `maxDuration = 300` for Fluid Compute.

### No Token Streaming

Harold's messages arrive as complete bubbles, not streamed token-by-token. This is a deliberate choice: streaming feels like an LLM, complete messages feel like a person texting. The `send_message` tool writes the full message at once.

The natural delay between multiple `send_message` calls (Claude thinking between tool uses) provides the human-like pacing. Harold sends "hey so i looked into that" → pause → "turns out it was deprecated" → pause → "use the v3 endpoint instead."

## Wake Mechanism

### Client-Side Debounce

The client manages a 3-second debounce timer:

1. User sends a message → POST `/api/message` (immediate, message stored) → start/reset 3s timer.
2. User sends another message within 3s → timer resets.
3. Timer fires → POST `/api/wake`.

This batches rapid-fire messages so Harold sees them all at once, like reading multiple unread texts.

### Server-Side Wake Dispatch

`POST /api/wake` receives the visitor ID from the cookie and dispatches a meaning-free wake to QStash. Public callers cannot choose the model.

- **Production (Vercel):** QStash publishes to `/api/wake/run` with retry. This breaks Vercel's request chain tracking and enables bounce refresh.
- **Local dev:** Direct fetch to `/api/wake/run` (QStash can't reach localhost).

### Wake Endpoint

`POST /api/wake/run` receives the QStash delivery, verifies Harold isn't already working (simple status check), and runs the agent loop via `waitUntil()`. The HTTP response returns immediately; the loop runs in the background.

### Guard Against Duplicate Wakes

Harold's status in `harold_state` is the lock:

1. Wake arrives → check `harold_state.status`.
2. If "sleeping" → set to "working," proceed.
3. If "working" → skip. Harold will see new messages on his next `check_inbox`.

No CAS lock needed (single agent, no contention). A simple conditional UPDATE suffices:

```sql
UPDATE harold_state SET status = 'working', active_run_id = $runId
WHERE visitor_id = $visitorId AND status = 'sleeping'
RETURNING visitor_id;
```

If 0 rows returned, Harold is already working. Skip.

## UI Design

### Layout

Mobile-first, full-screen iMessage clone.

- **Mobile:** Full viewport. Top bar with "Harold" title + debug button. Scrolling message area. Bottom text input bar with send button.
- **Desktop:** Centered container (max-width ~430px, phone-width), full height. Same layout as mobile.

### Message Bubbles

- User messages: right-aligned, blue background.
- Harold messages: left-aligned, gray background.
- Reply bubbles: show the referenced message above the reply (iMessage-style).
- Reactions: small emoji badge on the message bubble.
- Timestamps: subtle, grouped by time gaps.

### Typing Indicator

"Harold is typing..." appears while Harold is awake, derived from `run_start` and cleared by `run_end` or `error`. Typing/status are UI state, not durable debug events.

Rendered as a standard iMessage typing indicator (three animated dots) in Harold's message position.

### Debug Panel

Accessible via a button in the top bar. Slides in as a drawer or overlay. Shows:

- **Timeline:** chronological list of events — wakes, inbox reads, tool calls, messages sent. A simplified version of Not Really's timeline view.
- **Memory:** Harold's current "about you" memo (read-only in the debug panel).
- **Status:** Harold's current state (sleeping/working), last wake time, run count.

The debug panel is the educational window into the non-turn-based primitives. It shows the machinery behind the texting interface.

### Clear / Reset

Phase 1 uses a top-bar "New Chat" button instead: rotate the visitor ID and show an empty thread, leaving old rows orphaned in the database.

Later, a debug panel or settings button can provide destructive Clear / Reset: delete all messages, runs, and memory for the current visitor so Harold starts fresh with no history and no memory of you.

## Model & System Prompt

### Model

Claude Sonnet. The ~3-8s response time is a feature, not a bug — it feels like Harold is reading your messages and thinking about what to say, which is exactly what's happening.

### System Prompt Structure

```
Block 0 — Harold's identity + rules + tools context (cached)
  - Who Harold is (personality, communication style)
  - How the inbox system works
  - Tool usage instructions
  - Behavioral guidelines

Block 1 — Memory (uncached, changes between wakes)
  - "Your notes about this person: ..."
  - Empty on first encounter

Block 2 — Current state (uncached)
  - Visitor ID, current time, run count
```

### Harold's Personality

Harold is not an assistant. He's a guy you're texting. Key traits:

- **Texts in short bursts.** Multiple `send_message` calls, not one paragraph. "hey" → "so about that thing" → "i think you should..."
- **Casual register.** Lowercase, minimal punctuation, no bullet points, no markdown formatting, no headers.
- **Has opinions.** Doesn't hedge with "it depends" on everything. Takes a position, explains why.
- **Remembers things.** References past conversations naturally. "didn't you say you were working on X?"
- **Doesn't announce his tools.** Never says "Let me search that for you." He just knows things or goes and finds out. If he searched, the answer just appears.
- **Slightly awkward.** Sometimes over-explains. Sometimes circles back to a topic from three messages ago. Classic Harold.
- **One thing at a time.** Even if the user brings up topics A and B, Harold addresses A first, finishes, then moves to B. Like a real person who doesn't context-switch mid-thought.

### First Encounter

The chat starts blank. The user talks first. Harold has no memory and no history. His first response sets the tone for the entire relationship.

## Comparison with Not Really

| Aspect | Not Really | Harold |
|--------|-----------|--------|
| Agents | Multi-agent (master + specialists) | Single agent |
| World | Interactive canvas with widgets | Text chat thread |
| Wake mechanism | QStash fan-out to multiple agents | QStash to one agent |
| Concurrency control | CAS lock per agent instance | Simple status check per visitor |
| Event types | 12+ (comment, upload, reaction, scribble, etc.) | 1 (user message) + reactions (future) |
| Tools | 18+ per agent | 4 + web search |
| Memory | Shared whiteboard + private per-agent | Single memo per visitor |
| Context window | Per-agent token budget (15K-40K) | Single budget (~30K) |
| Hatsets / Skills | YAML team blueprints + markdown skills | None — one hardcoded personality |
| Bounce refresh | Yes (up to 5 bounces) | Yes (same mechanism, rarely triggers) |
| SSE events | Widget CRUD, media status, agent status, etc. | Messages, reactions, typing, status |
| Auth | Clerk (required for creation) | Anonymous visitor ID |
| UI | Canvas with drag/drop widgets | iMessage-style chat |
