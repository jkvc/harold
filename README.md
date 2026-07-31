# Harold

TBD.

## Stack

- Next.js 16 (App Router, Turbopack)
- Tailwind CSS v4
- TypeScript
- Drizzle ORM + Neon Postgres
- pnpm

## Environment

Create `.env.local` with a Neon Postgres connection string and the Phase 2 runtime services:

```bash
DATABASE_URL="postgresql://..."
REDIS_URL="redis://..."
OPENROUTER_API_KEY="..."
CLAUDE_API_KEY="..."
QSTASH_TOKEN="..."
QSTASH_CURRENT_SIGNING_KEY="..."
QSTASH_NEXT_SIGNING_KEY="..."
VERCEL_AUTOMATION_BYPASS_SECRET="..."
SITE_URL="http://localhost:3000"
```

The default model is `openai/gpt-5.6-luna` via OpenRouter (`OPENROUTER_API_KEY`). `CLAUDE_API_KEY` (or `ANTHROPIC_API_KEY`) is still required for `claude-*` model overrides, including the Haiku integration suite. The app uses the Neon serverless HTTP driver from route handlers running on the Node.js runtime. `REDIS_URL` must be a TCP Redis URL for `ioredis`, not an Upstash REST URL. `SITE_URL` is optional locally; when absent the app self-calls `http://localhost:3000`, and on Vercel it falls back to `VERCEL_URL`.

## Getting Started

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000.

## Project Structure

```
app/
  layout.tsx          # Root layout, metadata, fonts
  page.tsx            # Chat shell
  globals.css         # Tailwind + Font Awesome imports
  api/                # Route handlers
  hooks/              # Client hooks
  lib/                # Shared app utilities and database code
  __tests__/          # Vitest tests
docs/                 # Developer documentation
drizzle/              # SQL migrations
notes/                # Design notes and scratch
scripts/              # Local debugging and inspection utilities
```

## Database

Generate migrations from the Drizzle schema:

```bash
pnpm exec drizzle-kit generate
```

Apply migrations when `DATABASE_URL` is configured. Agents must ask before applying new migrations locally.

```bash
set -a; [ -f .env.local ] && . ./.env.local; set +a; pnpm exec drizzle-kit migrate
```

## Build

```bash
# Safe build that won't conflict with a running dev server
CHECK_BUILD=1 pnpm run build
```

## Verification

```bash
pnpm run type-check   # TypeScript
pnpm run lint          # ESLint
pnpm test              # Vitest
pnpm test:integration  # Expensive live Claude smoke test; run only when explicitly requested
```

Pre-push hook runs all three in parallel, then build sequentially.

## Debugging

Dump database state for a visitor:

```bash
./scripts/inspect-harold.sh <visitorId> [all|messages|visitor-tables|schema|db|migrations|events|phase2]
```

The default `all` command prints database metadata, schema, applied migrations, every visitor-scoped table, current messages, durable Harold events, and Phase 2 tables when they exist.

## Conventions

See `CLAUDE.md` for agent rules (build commands, commit policy, package manager). See `STYLE.md` for design system.
