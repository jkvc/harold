# Harold

TBD.

## Stack

- Next.js 16 (App Router, Turbopack)
- Tailwind CSS v4
- TypeScript
- Drizzle ORM + Neon Postgres
- pnpm

## Environment

Create `.env.local` with a Neon Postgres connection string:

```bash
DATABASE_URL="postgresql://..."
```

The app uses the Neon serverless HTTP driver from route handlers running on the Node.js runtime. Local development and builds can run without applying migrations, but message APIs need `DATABASE_URL` at request time.

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
```

## Database

Generate migrations from the Drizzle schema:

```bash
pnpm exec drizzle-kit generate
```

Apply migrations when `DATABASE_URL` is configured:

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
```

Pre-push hook runs all three in parallel, then build sequentially.

## Conventions

See `CLAUDE.md` for agent rules (build commands, commit policy, package manager). See `STYLE.md` for design system.
