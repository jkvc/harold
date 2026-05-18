# STYLE.md

Harold uses a muted classic message-app design language: soft blue-gray chrome, glossy beveled controls, pill-like inputs, and simple rounded chat bubbles. The goal is nostalgic and tactile without tying the implementation to any platform brand.

## Palette

Use shared tokens in `app/globals.css` before introducing new literal colors in components.

| Token | Value | Usage |
|-------|-------|-------|
| `--harold-page-bg` | `#d6e0e8` | Outer page background |
| `--harold-phone-bg` | `#dce8f1` | Phone shell background |
| `--harold-chat-bg` | `#dbe8f0` | Solid transcript surface |
| `--harold-chrome-top` / `--harold-chrome-mid` / `--harold-chrome-bottom` | muted blue gradient stops | Status/nav chrome |
| `--harold-blue-top` / `--harold-blue-mid` / `--harold-blue-bottom` | glossy blue gradient stops | User message bubbles |
| `--harold-input-border` | `#9fa6aa` | Textbox border |
| `--harold-input-bar-border` | `#9ca9b3` | Composer top border |

## Typography

- **Sans body** — Geist Sans (default)
- **Mono** — Geist Mono
- **Chrome labels** — bold, compact, slight shadow; keep nav/status text crisp and centered
- **Messages** — readable `16px` body text, no markdown styling inside chat bubbles

## Layout

- Chat shell is phone-width: `max-w-[430px]`, centered, full viewport height.
- Status bar, nav bar, and composer are fixed-height chrome regions around a single scrollable transcript.
- Transcript background is solid muted blue, not textured or gridded.
- Hide native scrollbars in the transcript and multiline composer with `.scrollbar-none`, but preserve normal scrolling behavior.

## Reusable Classes

Shared visual treatments live in `app/globals.css`. Prefer composing these classes with Tailwind layout utilities instead of repeating gradient and shadow strings.

| Class | Use |
|-------|-----|
| `.harold-page` | Outer page background and text color |
| `.harold-phone` | Centered phone shell surface |
| `.harold-status-bar` | Top status bar chrome |
| `.harold-nav-bar` | Main navigation chrome |
| `.harold-nav-button` | Beveled blue nav button |
| `.harold-chat-surface` | Transcript background |
| `.harold-composer-bar` | Bottom input bar |
| `.harold-textbox` | Pill multiline message input |
| `.harold-send-button` | Blue pill send button |
| `.harold-bubble`, `.harold-bubble-user`, `.harold-bubble-harold` | Chat bubble base and role variants |

## Icons

Font Awesome 7 (`@fortawesome/fontawesome-free`). No hand-drawn inline SVGs unless truly custom.

## Principles

- Prefer reusable CSS tokens/classes for visual style; keep Tailwind utilities for layout, sizing, and spacing.
- Use gradients, inset highlights, and small shadows for tactile Harold controls.
- Keep colors muted. Avoid bright modern blues unless the element is an active send action or user bubble.
- Use rounded rectangles and pills. Avoid sharp bubble tails unless they can be implemented cleanly.
- Keep the chat UI bright-theme only.
