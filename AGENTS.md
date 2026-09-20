## Learned User Preferences

- Wire every new user-visible string through `window.t()` and add matching English and Chinese keys in `src/i18n.js`; do not ship hardcoded UI copy (user corrected missing i18n on history delete confirmation).
- Match the user's language in replies when they write in Chinese.
- Session branch UX: allow branching only from assistant/agent messages, not user messages; prefer per-message actions over duplicating the same flow in the bridge command menu.
- Message actions (copy as Markdown, branch) should sit at the bottom-right of bubbles and use accent styling so they stay visible.

## Learned Workspace Facts

- PiDesk i18n lives in `src/i18n.js` (`window.t`); it loads before Babel design scripts per `src/index.html` script order.
- Saved omp sessions on disk are under `~/.omp/agent/sessions/<session_dir>/` with a `.jsonl` file; `delete_saved_session` removes that session's parent directory after canonicalizing paths under the sessions root.
- Agent liveness in the ambient rail uses `src/design/agent-activity.jsx`, fed by `live.js` fields `runningTools`, `recentTools` (rolling last three completed tools), and `turnStartMs`, wired through `use-bridge-snapshot.jsx` and `app-live.jsx`.
- omp 18.x `get_state` does NOT include `thinkingLevel`; `cycle_thinking_level` returns null. PiDesk cycles client-side through `off → low → medium → high` and pushes the choice to omp via `set_thinking_level`. Never default to `"auto"` — it is not a valid RPC level.
- omp compact response contains `tokensBefore` (may be 0 in some versions) but NOT `tokensAfter`. PiDesk snapshots pre-compact tokens from `contextUsage` at send time, then back-fills `tokensAfter` from the next `get_state` via `_compactBackfillId` in `live.js`.
