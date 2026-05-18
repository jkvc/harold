# Tech Debt

Consciously taken shortcuts and known issues. **All tech debt taken on must be recorded here.** Each entry must include what was skipped, why, and what to do about it. **Delete entries once resolved** — this file should shrink over time. Do not number entries; order doesn't matter and indices go stale.

---

- **Deferred agent tables** — Phase 1 creates only `messages`, even though the full design needs `runs`, `memory`, and `harold_state`. This keeps the first milestone small while there is no Harold agent loop. Add the remaining tables in the Phase 2 migration before implementing wake/run state, memory, or context reconstruction.
- **No message rate or volume limits** — Phase 1 rejects empty messages but does not cap per-visitor write volume or message length. This is acceptable for local/private development but not abuse-hardened. Add rate limiting and payload bounds before treating the public chat endpoint as production-safe.
