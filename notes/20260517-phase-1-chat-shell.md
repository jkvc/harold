# Phase 1 Chat Shell

**Date:** 2026-05-17

## Summary

Phase 1 shipped the non-agent chat foundation for Harold: anonymous visitor identity, persistent user messages, a message API, a mobile-first chat UI, database migrations, and a reusable Harold visual system. Harold still does not respond in this phase; the milestone is that a visitor can send messages, refresh, and see the same thread preserved.

The work landed in two commits: `f6e8e11 implement phase 1 chat shell` for the main feature and `6dfdfb8 fix mobile keyboard chat layout` for mobile browser keyboard behavior.

## Scope

The original roadmap listed some future agent infrastructure in Phase 1, but the implementation intentionally kept the first shippable slice smaller. Phase 1 creates only the `messages` table and defers `runs`, `memory`, `harold_state`, QStash, Redis, SSE, and Claude calls to Phase 2. This keeps the first milestone independent: it is a real persisted chat shell without any pretend agent behavior.

The Phase 1 roadmap and design docs were updated to reflect this narrower scope. The key rule is: messages are durable now; Harold wakes and responds later.

## Database

The database stack is Drizzle ORM plus Neon serverless Postgres. `drizzle.config.ts` points at `app/lib/db/schema.ts`, migrations live under `drizzle/`, and `app/lib/db/index.ts` lazily creates the Neon HTTP driver client so builds do not fail before request-time DB access.

The `messages` schema stores `id`, `visitor_id`, `role`, `content`, nullable `reply_to_id`, and `created_at`. Two migrations were created and applied locally: `0000_melodic_thunderball.sql` creates the table and base visitor/time index, and `0001_fair_tarantula.sql` adds a role check constraint, a self-reference FK for `reply_to_id`, and a `(visitor_id, created_at, id)` index for stable pagination.

The role field is typed as `"user" | "harold"` in Drizzle even though Phase 1 only writes user messages. Keeping `harold` in the schema now prevents a needless API/schema churn when Phase 2 starts inserting Harold messages.

## Visitor Identity

Visitor identity uses both localStorage and a cookie. `app/lib/visitor.ts` owns generation, validation, localStorage reads/writes, cookie writes, and cookie parsing. `app/hooks/use-visitor.ts` uses `useSyncExternalStore` so the client can initialize visitor identity without the React lint issue caused by synchronous state updates in effects.

API routes trust only the cookie. The client hook is responsible for syncing localStorage to the cookie before message data loads. New Chat generates a fresh visitor ID, writes both stores, clears local UI state, and refetches an empty thread. It does not delete old database rows; old rows become orphaned under the previous visitor ID by design.

Cookie parsing is defensive: malformed percent-encoded cookie values are treated as missing rather than throwing during client initialization.

## Message API

`POST /api/message` reads the visitor cookie, validates JSON, rejects empty or whitespace-only messages, inserts a `role = "user"` row, and returns the stored message. `GET /api/messages` reads the visitor cookie and returns the newest page of messages in chronological order for display.

Responses use the project API shape `{ success: true, data }` and `{ success: false, error, code? }`. That contract was chosen because it keeps the client branch predictable and matches local project conventions.

Pagination uses `limit`, `beforeCreatedAt`, and `beforeId`. The API orders by `created_at desc, id desc`, fetches `limit + 1`, reverses the page for chronological rendering, and returns `hasMore`. The timestamp-plus-id cursor matters because timestamp-only pagination can skip rows when multiple messages share the same `created_at` boundary.

## Chat UI

The page at `app/page.tsx` is a client chat shell. It loads the latest message page after visitor identity is ready, jumps immediately to the bottom on initial load, sends messages optimistically, reconciles the optimistic row with the server row, and marks failed sends in place.

Messages render in normal chronological column order rather than reverse-column order. That makes top-of-scroll pagination straightforward: when the user scrolls near the top, the UI fetches older messages, prepends them, and preserves the current viewport by restoring `scrollTop` relative to the previous `scrollHeight`.

The composer supports Enter to send and Shift+Enter for multiline input. The textarea auto-grows up to three visible lines, then scrolls internally with the scrollbar hidden. The Send button stays bottom-aligned as the composer grows.

## Mobile Keyboard Behavior

Mobile browser keyboard behavior needed a second pass. When the textarea focused on mobile, the browser scrolled the page itself, which made the app bars disappear and left the composer floating above the keyboard.

The current fix locks the app shell to the browser `visualViewport`: `app/page.tsx` writes `--harold-viewport-height` and `--harold-viewport-offset-top` from `window.visualViewport`, sets body overflow to hidden while the chat is mounted, and sizes the shell with `fixed`, `top: var(--harold-viewport-offset-top)`, and `height: var(--harold-viewport-height)`. On textarea focus, the message transcript scrolls to bottom immediately and repeats after short delays so it lands correctly after the keyboard resize settles.

The laptop browser view should stay unchanged because the same shell remains centered at `max-w-[430px]` and fills the normal viewport when `visualViewport` equals `window.innerHeight`.

## Visual Design System

The visual language is documented in `STYLE.md` and implemented in `app/globals.css`. The design is a muted classic message-app style: soft blue-gray chrome, glossy beveled controls, pill-like inputs, bright-theme-only surfaces, and rounded bubbles without tails.

Reusable tokens use the `--harold-*` prefix. Reusable classes include `.harold-page`, `.harold-phone`, `.harold-status-bar`, `.harold-nav-bar`, `.harold-nav-button`, `.harold-chat-surface`, `.harold-composer-bar`, `.harold-textbox`, `.harold-send-button`, `.harold-bubble`, `.harold-bubble-user`, and `.harold-bubble-harold`.

One important implementation note: Tailwind v4 dropped custom component classes until they were wrapped in explicit layers. `:root` tokens now live in `@layer base`, and reusable Harold classes live in `@layer components`. If future styling seems to disappear in dev, check that new shared selectors are placed in the right layer.

The visual classes intentionally use Harold naming rather than platform-branded names. The design can be inspired by classic mobile messaging without coupling code/docs to any vendor or platform label.

## Documentation And Rules

`README.md` now documents the stack, `DATABASE_URL`, migration generation/application, project structure, and verification commands. `STYLE.md` documents the visual system. `CLAUDE.md` now tells future agents to follow `STYLE.md` and use shared classes/tokens instead of repeating gradients and shadows inline.

`TECH_DEBT.md` tracks the conscious deferrals: only the `messages` table exists for now, and message write rate/volume limits are not implemented yet. The earlier styling tech debt was removed after the shared style system landed.

## Tests And Verification

Focused Vitest coverage was added for pure helpers: visitor ID generation/cookie parsing and message serialization. DB integration tests were not added because Phase 1 kept route behavior simple and there is not yet a mockable DB test boundary.

The full verification pipeline was run repeatedly during implementation: `pnpm run type-check`, `pnpm run lint`, `pnpm test`, and `CHECK_BUILD=1 pnpm run build`. The pre-push hook also passed type-check, lint, tests, and build before both commits were pushed.

## Decisions To Remember For Phase 2

Phase 2 should add `runs`, `memory`, and `harold_state` in a new migration rather than altering the Phase 1 migration history. The `messages` table is already prepared for Harold rows and reply references.

SSE should merge Harold/status events into the existing message state without breaking optimistic user sends. If SSE ever includes user messages too, de-dupe by message ID.

Wake signals should remain meaning-free. The message API stores content in Postgres first; the wake system should only tell Harold to check the database.

Rate limiting is still deferred. Before public release, protect `POST /api/message` and future wake/model routes from cheap anonymous write/model-call abuse.

The UI should continue using Harold style classes from `app/globals.css`. Avoid reintroducing platform-branded class names, fake inactive affordances, or one-off color/shadow strings in components.
