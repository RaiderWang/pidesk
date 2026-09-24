## Learned User Preferences

- Wire every new user-visible string through `window.t()` and add matching English and Chinese keys in `src/i18n.js`; do not ship hardcoded UI copy (user corrected missing i18n on history delete confirmation).
- Match the user's language in replies when they write in Chinese.
- Session branch UX: allow branching only from assistant/agent messages, not user messages; prefer per-message actions over duplicating the same flow in the bridge command menu.
- Message actions (copy as Markdown, branch) should sit at the bottom-right of bubbles and use accent styling so they stay visible.
- Quick Bar UX: support multi-turn and choosing send-to-current vs new session; keep the overlay result pane on the current turn only (never flash older active-session history); keep "no project" default cwd aligned with the main window.
- Image upload for non-vision models: warn only, never block send or file picker — omp reads images via external tools even without native vision; do not reintroduce `composer.warn.uploadAnyway`.

## Learned Workspace Facts

- PiDesk i18n lives in `src/i18n.js` (`window.t`); it loads before Babel design scripts per `src/index.html` script order.
- Saved omp sessions on disk are under `~/.omp/agent/sessions/<session_dir>/` with a `.jsonl` file; `delete_saved_session` removes that session's parent directory after canonicalizing paths under the sessions root.
- Agent Hub (`src/design/hub/`) replaced the old Agent Activity card and 60-cell radar in the ambient rail; three auto-switching modes (Compact/Tree/Summary) driven by `hubMode`, `hubAgents`, `hubTaskId`, `hubHistory` in `live.js` state, piped through `use-bridge-snapshot.jsx` and `app-live.jsx`.
- Peer session bridge lives in `src/peer-session.js` (exposed as `window.PeerSessionBridge`, **not** `window.PeerSession` — that name is taken by the React component in `chrome.jsx`). Injected via `PeerSessionBridge.init({ notify, sessionRegistry })` from `live.js`.
- Quick Bar is a separate Tauri webview (`src/quick-bar.html`) that does **not** load `live.js`; it communicates with the main window via Tauri `emitTo` events (`quickbar://submit`, `quickbar://delta`, `quickbar://done`). Host-side relay is `src/app/quickbar-host.js` (Markdown HTML for the overlay is rendered there with the main window's `marked`/hljs pipeline, then styled in Quick Bar via `md-content`). System tray and global shortcut (`CmdOrCtrl+Shift+Space` default, persisted to `quick-bar-shortcut.json` in app config dir) are in `src-tauri/src/tray.rs` and `src-tauri/src/shortcut.rs`; the Quick Bar window is pre-created hidden at startup via `quick_bar::warm_up` so the first tray/hotkey click does not race WebView2 attach.
- "No project" omp sessions (main default tab, New Standalone, Quick Bar new session) pin cwd with `agent::spawn::default_cwd()` to the running executable's directory — never inherit ambient process CWD (fragile across `cargo run` / install / terminal launch).
- omp 18.x `get_state` does NOT include `thinkingLevel`; `cycle_thinking_level` returns null. PiDesk cycles client-side through `off → low → medium → high` and pushes the choice to omp via `set_thinking_level`. Never default to `"auto"` — it is not a valid RPC level.
- omp compact response contains `tokensBefore` (may be 0 in some versions) but NOT `tokensAfter`. PiDesk snapshots pre-compact tokens from `contextUsage` at send time, then back-fills `tokensAfter` from the next `get_state` via `_compactBackfillId` in `live.js`.
- Developer technical reference lives in project-root `manual.md` (English only: architecture, RPC, Tauri commands, frontend state flow, design decisions); `README.md` and `README.zh-CN.md` link to it (and `CLAUDE.md`) instead of inlining that material.
- Frontend unit tests live under `test/` using Node 20 built-in `node:test` (zero npm test deps); `test/helpers/shim.mjs` loads IIFE scripts via `new Function(code)()` with `globalThis.window = globalThis`; run with `npm run test:js`.
