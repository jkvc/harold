# Harold

TBD.

## Stack

- Next.js 16 (App Router, Turbopack)
- Tailwind CSS v4
- TypeScript
- pnpm

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
  page.tsx            # Home page
  globals.css         # Tailwind + Font Awesome imports
  __tests__/          # Vitest tests
docs/                 # Developer documentation
notes/                # Design notes and scratch
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
