# CLAUDE.md

## Important Rules

### 1. Build Commands Must Use Separate Directory
If you need to run `pnpm run build` for any reason (only when it is appropriate for complex changes), you **must** use the separate build directory to avoid conflicts with a running dev server:

```bash
CHECK_BUILD=1 pnpm run build
```

This uses `.next-check` as the output directory instead of `.next`. See `next.config.ts` for implementation.

### 2. Never Commit or Push Without Explicit Permission
You are **never allowed** to commit or push any code unless the user explicitly tells you to do so in a **separate user message**. Do not proactively commit or push changes, even if they appear complete.

### 3. Keep CLAUDE.md Stable
Do **not** add frequently-changing content to this file such as:
- Lists of demos or features
- Specific environment variable names
- Configuration details that evolve with code

This file is for stable rules and conventions. Use code comments or README for implementation details.

### 4. Package Manager
This project uses **pnpm**. Never use `npm` or `yarn` commands.

### 5. Icons
Use **Font Awesome 7** (`@fortawesome/fontawesome-free`) for all icons. Do **not** hand-draw inline SVG paths unless an absolutely custom icon is needed that Font Awesome does not provide. The CSS is imported globally in `app/globals.css`.

### 6. Style Guide
All visual design decisions (palette, typography, border radii, button patterns, layout conventions) are documented in `STYLE.md` at the project root. Read and follow it when creating or modifying UI.

Use the reusable Harold design tokens and component classes in `app/globals.css` for shared visual treatments. Prefer composing those classes with Tailwind layout utilities instead of repeating literal gradients, shadows, and colors in components.

### 7. Prose Line Wrapping
Do **not** hard-wrap paragraphs in Markdown / MDX content. Write each paragraph, list item, and block-level element as a single unwrapped line. Editor word wrap is on — mid-paragraph line breaks make editing awkward and produce noisy diffs. Blank lines still separate blocks as usual.

### 8. Track Tech Debt
Known shortcuts and deferred work go in [`TECH_DEBT.md`](TECH_DEBT.md). **All tech debt taken on must be recorded** — if you make a conscious shortcut, add an entry. Delete entries once resolved.

### 9. Testing
Tests live in `app/__tests__/`. Run with `pnpm test` (vitest). Pre-push hook runs type-check, lint, test, then build in sequence. Practice TDD for non-trivial logic.
