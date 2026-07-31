# Tech Debt

Consciously taken shortcuts and known issues. **All tech debt taken on must be recorded here.** Each entry must include what was skipped, why, and what to do about it. **Delete entries once resolved** — this file should shrink over time. Do not number entries; order doesn't matter and indices go stale.

---

- **OpenRouter web_search result events are not mirrored into the debug timeline** — Luna uses `openrouter:web_search` server-side; Anthropic's `publishServerToolEvents` still only understands Anthropic `server_tool_use` / `web_search_tool_result` blocks. Search still works for the model; the debug panel may not show search start/complete for OpenRouter. Extend event publishing when OpenRouter exposes searchable server-tool traces on the chat-completions response.
- **No message rate or volume limits** — Phase 1 rejects empty messages but does not cap per-visitor write volume or message length. This is acceptable for local/private development but not abuse-hardened. Add rate limiting and payload bounds before treating the public chat endpoint as production-safe.
- **Debug panel is timeline-only** — Phase 2 ships the durable event timeline but not the Phase 3 memory/status cards. This keeps the debug surface focused while the runtime stabilizes. Add read-only memory and state cards when Phase 3 expands the debug panel.
- **Bounce refresh is deferred** — Phase 2 injects `check_inbox` automatically but omits timeout-aware continuation wakes so the first live Harold loop stays easier to reason about. In Robustness & Polish, add bounce refresh before serverless timeout.
- **Wake loop uses a fixed iteration cap** — Harold currently uses `MAX_ITERATIONS` instead of Not Really's time-budget loop. This is acceptable for Phase 2, but bounce refresh should replace it with elapsed-time decisions so inbox work discovered near the cap cannot be stranded.
- **Duplicate wake cleanup is deferred to CAS/bounce work** — Harold can mark contending wakes as pending, but the run lifecycle is still simpler than Not Really's CAS + pending-run drain model. Rework wake acquisition and duplicate run handling when implementing bounce refresh.
