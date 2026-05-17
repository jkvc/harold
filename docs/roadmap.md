# Harold — Implementation Roadmap

Each phase ends with a verifiable milestone you can see and interact with. No phase depends on future work — each one is shippable on its own.

## Phase 1: Chat Shell

**Milestone:** You can send messages, see them persist, refresh and they're still there. A "New Chat" button gives you a fresh visitor ID (old data stays in DB, just orphaned). No Harold responses yet — just your messages in an iMessage-style UI.

### Infrastructure
- [ ] Install dependencies: `drizzle-orm`, `@neondatabase/serverless`, `@vercel/functions`
- [ ] Environment variables (`.env.local`): `DATABASE_URL`
- [ ] Drizzle config (`drizzle.config.ts`) pointing at Neon
- [ ] DB schema (`app/lib/db/schema.ts`): messages, runs, memory, harold_state tables
- [ ] Write and apply initial migration
- [ ] DB client (`app/lib/db/index.ts`) using Neon serverless driver
- [ ] Base URL helper (`app/lib/base-url.ts`)

### Visitor Identity
- [ ] Visitor ID utility (`app/lib/visitor.ts`): generate random ID, read/write localStorage + cookie
- [ ] Client-side hook (`app/hooks/use-visitor.ts`): read from localStorage, generate if missing
- [ ] API helper to read visitor ID from cookie on server-side requests

### Message API
- [ ] `POST /api/message` — store a user message, return the message object
- [ ] `GET /api/messages` — fetch all messages for a visitor ID

### Chat UI
- [ ] Message bubble component: user messages right-aligned, blue. Harold messages left-aligned, gray (not yet used but component ready)
- [ ] Message input bar: text input + send button, fixed at bottom
- [ ] Auto-scroll to bottom on new messages
- [ ] Mobile-first layout: full viewport on mobile, centered max-w-[430px] on desktop
- [ ] Top bar: "Harold" title
- [ ] "New Chat" button: generates fresh visitor ID in localStorage, reloads. No backend deletion.
- [ ] On page load: fetch messages for current visitor ID, render in chat

## Phase 2: Harold Responds

**Milestone:** You send a message, Harold wakes up, reads your messages, and responds. Full round-trip works: message → debounce → wake → agent loop → SSE → message appears. You can have a basic conversation. Harold uses `send_message` (one at a time), `check_inbox`, and `update_memory`.

### Real-Time Delivery (SSE + Redis)
- [ ] Install dependencies: `@upstash/redis`
- [ ] Environment variable: `REDIS_URL`
- [ ] Redis client (`app/lib/redis.ts`) using Upstash
- [ ] Event bus (`app/lib/event-bus.ts`): `publishEvent(visitorId, event)` → Redis publish
- [ ] SSE endpoint (`GET /api/events`): subscribe to Redis channel, stream events to client, `maxDuration = 300`
- [ ] Client-side SSE hook (`app/hooks/use-harold-events.ts`): EventSource connection, reconnect on drop, merge events into message state

### Wake System
- [ ] Install dependencies: `@upstash/qstash`, `@anthropic-ai/sdk`
- [ ] Environment variables: `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, `CLAUDE_API_KEY`, `VERCEL_AUTOMATION_BYPASS_SECRET`
- [ ] QStash client (`app/lib/qstash.ts`) with local dev fallback (direct fetch)
- [ ] `POST /api/wake` — check if Harold is already working, dispatch via QStash
- [ ] `POST /api/wake/run` — receive QStash delivery, run agent loop via `waitUntil()`, `maxDuration = 300`
- [ ] QStash signature verification on wake/run endpoint
- [ ] Client-side 3s debounce: store message immediately, debounce wake call

### Agent Loop
- [ ] Harold's system prompt (`app/lib/harold/system-prompt.ts`) — initial version, personality + inbox model + tool instructions
- [ ] `check_inbox` tool: query messages since `last_processed_at`, advance watermark
- [ ] `send_message` tool: insert message with `role=harold`, publish SSE event
- [ ] `react_to` tool: store reaction on message, publish SSE event
- [ ] `update_memory` tool: upsert memory row for visitor
- [ ] Agent loop (`app/lib/harold/loop.ts`): pre-execute check_inbox, while loop with 270s time guard, Claude API call, tool execution, final inbox check, `decideSleepAction`
- [ ] Context reconstruction (`app/lib/harold/reconstruct.ts`): load recent runs, token budget (~30K), compact chatty tool results, sanitize message alternation
- [ ] `decideSleepAction` pure function
- [ ] Stale recovery: detect stuck "working" for >90s, force-reset
- [ ] Bounce refresh: self-dispatch via QStash on timeout with events pending

### Chat UI Additions
- [ ] Typing indicator: animated dots when Harold is "working" (via SSE status event)
- [ ] Harold's messages rendered from SSE events (not just page load fetch)
- [ ] Reply bubble rendering (if `reply_to_id` is set)
- [ ] Reaction badge rendering (emoji on message bubble)

## Phase 3: Debug Panel

**Milestone:** A debug drawer shows the machinery behind the chat — timeline of events (wakes, inbox reads, tool calls, messages), Harold's memory contents, and his current status. Updates live via SSE.

- [ ] Debug drawer component (toggle via button in top bar)
- [ ] Timeline view: chronological event list
  - Data source: runs + tool calls for the visitor
  - Each entry: timestamp, event type, brief detail (e.g. "check_inbox: 3 messages", "send_message: 'hey'", "update_memory")
- [ ] Memory viewer: Harold's current "about you" memo (read-only display)
- [ ] Status display: sleeping/working, last wake time, run count
- [ ] SSE event for memory updates (`memory_updated`) so debug panel updates live
- [ ] API endpoint to fetch debug data (`GET /api/debug`)

## Phase 4: Smarts

**Milestone:** Harold feels smart. He searches the web silently, remembers things about you across conversations, handles multi-topic messages gracefully, and texts like a real person with personality.

### Web Search
- [ ] Enable Anthropic's server-side web search tool in the Claude API call
- [ ] No UI indication — Harold just knows things

### System Prompt Refinement
- [ ] Refine Harold's personality (texting style, tone, awkwardness calibration)
- [ ] Refine inbox handling instructions (multi-message batches, topic prioritization)
- [ ] Refine memory update heuristics (what to remember, what to forget, how to phrase)
- [ ] Refine tool usage patterns (when to react vs reply, reply_to usage)
- [ ] Test and iterate on edge cases: rapid-fire messages, long silence then return, empty messages, very long messages

### Memory Improvements
- [ ] Tune memory size limits and update frequency
- [ ] Test memory across many conversations — does Harold build up useful context?

## Phase 5: Polish

**Milestone:** Harold feels finished. The UI is tight, edge cases are handled, and the demo is presentable.

- [ ] Error handling: graceful failure when Claude API errors (retry or system message)
- [ ] Rate limiting on message and wake endpoints
- [ ] Loading states: initial message fetch spinner, SSE reconnecting indicator
- [ ] Timestamp grouping in chat (time dividers between message clusters)
- [ ] Keyboard: Enter to send, Shift+Enter for newline
- [ ] Viewport: mobile keyboard push-up, safe areas, scroll behavior
- [ ] Favicon and metadata
- [ ] README with setup instructions for someone cloning the repo
- [ ] Final system prompt pass

## Phase 6: Publication

**Milestone:** Harold is live and publicly accessible without blowing up your API bill. Visitors land on an intro page explaining what Harold is and why he exists, can read the design decisions, then start chatting. Usage is gated so costs stay bounded.

### Charge System
- [ ] Port next-charge token-bucket system from jkvc (rate-limits model calls per visitor)
- [ ] Configure charge budget per visitor (free tier, no login required)
- [ ] Charge exhaustion UX: Harold tells you he's out of energy, shows reset time or gentle nudge
- [ ] Admin bypass for dev/testing

### Intro / Landing Page
- [ ] Landing page before the chat: what Harold is, the non-turn-based thesis, link to blog post
- [ ] "Start chatting" CTA that drops you into the chat UI
- [ ] Keep it minimal — a few paragraphs, not a marketing site

### About / Design Page
- [ ] Public-facing page explaining the architecture and design decisions (adapted from `docs/design.md`)
- [ ] Roadmap page showing what's built and what's planned
- [ ] Link to GitHub repo (if open-sourced)

### Deployment Hardening
- [ ] Vercel environment variables configured for production
- [ ] Domain setup (`harold.jkvc.ai`)
- [ ] OG image and social metadata for sharing
- [ ] Error monitoring (basic — console logs or a lightweight service)
- [ ] Cost monitoring: track Claude API usage per visitor, alert on anomalies

## Future (Not in v1)

- [ ] User reactions (tapback on Harold's messages → inbox event for Harold on next wake)
- [ ] Turn budget (visible in system prompt, winds down gracefully)
- [ ] Login system (map authenticated user to visitor ID, cross-device memory)
- [ ] Multiple conversations per user
- [ ] Forkability extraction (configurable personality, tools, model)
