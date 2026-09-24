# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.7] - 2026-09-24

### Added

- **Single-instance application**: ensure only a single instance of PiDesk runs at a time using `tauri-plugin-single-instance`; subsequent launches automatically bring the existing instance's main window to the front and focus it
- **Composer image menu & main window region capture**:
  - Image button in main window composer now opens an action popover with two options: **Upload image…** (opens system file dialog) and **Capture screen** (triggers interactive region screenshot)
  - Region capture triggered while the main window is open automatically hides the main window during capture to prevent window obscuration, restores the main window upon completion or cancellation, and inserts the cropped screenshot thumbnail directly into the main composer attachments without opening the Quick Bar
  - Context-aware global screenshot routing: pressing `Alt+S` while the main window is visible sends the capture to the main window; while Quick Bar is visible or when in the background, it routes to Quick Bar
- **Configurable global shortcuts in Tweaks panel**:
  - Customize both the **Quick Bar hotkey** (default `CmdOrCtrl+Shift+Space`) and **Region Screenshot hotkey** (default `Alt+S`) directly from the Tweaks panel
  - Interactive key combination recorder with conflict handling, Esc to cancel, and one-click reset to defaults
  - Dynamic runtime re-registration with rollback on failure; persisted to `quick-bar-shortcut.json` in app config
  - Quick Bar overlay and hints dynamically update to reflect the configured screenshot shortcut in real time
- **Quick Bar screen capture**: ask questions based on screen context; supports two modes:
  - **Auto screen capture**: click the camera toggle button to enable; on message send, PiDesk automatically captures the full screen, downscales to standard resolution (max width 1920px), compresses to JPEG, and attaches it with the prompt
  - **Manual region capture**: press `Alt+S` in the Quick Bar to freeze the screen with a fullscreen overlay, drag mouse to draw a selection rectangle, and attach the cropped screenshot thumbnail to the input box before sending; pressing `Alt+S` while auto-screenshot mode is active disables auto-screenshot

### Fixed

- **Duplicate screenshot thumbnail in composer**: fixed race condition where `main://screenshot-result` event listener was re-registered on re-renders without cleaning up the pending unlisten promise; listener is now mounted once with cancelled-closure cleanup, shortcut prop is passed from root tweaks state, and screenshot attachments are deduplicated by image payload
- **Screenshot overlay cold-start black screen**: pre-warm the screenshot overlay window during app startup (`screenshot::warm_up`) and add a proactive pull fallback (`get_screenshot_background`) on overlay mount to eliminate the race condition where `screenshot://background` was emitted before the WebView2 controller attached and loaded `overlay.js`

### Changed

- **Image upload no longer blocked by model vision check**: when the current model does not natively support images, the composer now shows an informational warning ("omp will use tools to read them") but no longer prevents the user from attaching or sending images; the "upload anyway" button has been removed since it is no longer necessary

## [0.2.6] - 2026-09-23

### Added

- **Quick Bar copy**: AI reply result pane now has a copy button (top-right corner of the result area) that copies the response as raw Markdown to the clipboard; button shows a check mark on success and disappears when there is no content to copy
- **Tray double-click**: left-click (single) on the system tray icon toggles the Quick Bar as before; a new left-click double-click action opens (or focuses) the main PiDesk window — debounced via a generation counter so the single-click action is cleanly cancelled when a double-click is detected

### Fixed

- **Quick Bar theme**: the Quick Bar overlay now follows the main window's theme (aurora / phosphor / daylight), density, accent colour, and font-size settings instead of always rendering in the default daylight theme; appearance is synced on first load (from `localStorage`), on every Quick Bar open, and in real time via Tauri events when the user changes tweaks

### Added

- **System tray**: PiDesk now lives in the system notification area with a tray icon; left-click toggles the Quick Bar, right-click menu offers Show PiDesk / Quick Bar / Quit; tooltip reflects agent streaming state
- **Quick Bar**: a floating Spotlight-style input panel invoked by a global hotkey (default `Ctrl+Shift+Space`); supports two modes — inject into the active session (Enter) or open an ephemeral quick-answer session (Shift+Enter to toggle); results stream in-place; `Ctrl+Enter` escalates to the full PiDesk window; `Esc` hides
- **Global shortcut**: Quick Bar hotkey is persisted to `quick-bar-shortcut.json` in the app config directory; runtime re-registration via `set_quick_bar_shortcut` command with rollback on failure
- **Quick Bar host bridge** (`app/quickbar-host.js`): main-window relay that proxies Quick Bar events to `OMP_BRIDGE` and streams a throttled snapshot back via `emitTo`, avoiding a second `live.js` instance
- **i18n**: added `quickbar.*` and `tray.*` keys for English and Simplified Chinese

### Fixed

- **Quick Bar results rendered as plain text**: assistant replies streamed into the Quick Bar now go through the same `marked`/highlight.js pipeline as the main chat view (rendered in the main window's `quickbar-host.js` relay, styled via `platform.css` + `highlight-theme.css` loaded by `quick-bar.html`) instead of manual escaping with `<br>` line breaks
- **Quick Bar / main window "no project" sessions disagreed on default working directory**: both now pin to the running executable's own directory (`agent::spawn::default_cwd`) instead of letting the child inherit whatever ambient CWD the Tauri process happened to have, which was fragile and differed across launch sites
- **Quick Bar didn't appear on the first tray-icon click after launch**: the window is now pre-created (hidden) during app startup (`quick_bar::warm_up`) instead of lazily on first toggle, so its WebView2 controller has time to finish attaching before the first hotkey/tray click can race it

## [0.2.5] - 2026-09-20

### Added

- **Agent Hub**: adaptive right-rail card replacing Agent Activity and Agent Radar — three auto-switching modes: enhanced tool timeline with mini distribution bar (Compact), live subagent tree with expandable log streams (Tree), and task result summary with 5 s auto-collapse (Summary); `ast_edit` tool now recognized in the tool name map
- **Hub data layer**: `live.js` tracks hub state (`hubMode`, `hubAgents`, `hubTaskId`, `hubHistory`) with full session snapshot/restore and automatic mode transitions on `task` tool lifecycle events

### Removed

- Agent Radar (60-cell grid) and standalone Agent Activity card — functionality merged into Agent Hub Compact mode

## [0.2.4] - 2026-09-18

### Added

- **Persist model & thinking level across restarts**: PiDesk now saves the last-used model and thinking level to `localStorage` and restores them when reopening the app or opening a new tab — each fresh omp process receives `set_model` + `set_thinking_level` on first `get_state`, while tab-switch snapshots preserve per-tab choices independently

### Fixed

- **Plan mode prompts not localized**: the intent-framing prefix and approval prompt that PiDesk auto-prepends in plan mode are now routed through `window.t()` with `plan.intentFraming` / `plan.approvalPrompt` keys, so they render in the user's chosen language instead of always English
- **Thinking level display oscillation**: the composer's "thinking · level" pill no longer flickers between values on every turn — `get_state` responses no longer overwrite the user's chosen level; only explicit cycling updates the display
- **Thinking level cycling non-functional**: when omp doesn't report the new level in `cycle_thinking_level` response (omp ≤ 18.x), PiDesk now cycles client-side through `off → low → medium → high` and pushes the choice via `set_thinking_level`

## [0.2.3] - 2026-09-17

### Added

- **Agent activity status card**: live heartbeat indicator in the ambient rail shows whether the agent is idle, thinking, or executing tools — displays running tool names, targets, and ticking elapsed timers so long-running operations are always visible; timers turn amber after 30 s to flag potentially stuck steps; includes a rolling trail of the last 3 completed actions so brief tool calls remain visible
- **Peer Session monitoring**: pin another session to the ambient rail to watch its live activity, TPS, tool usage, and todo progress without switching tabs — interactive picker when no peer is set, auto-clear when switching to the peer tab
- **Bilingual Internationalization (i18n)**: integrated English and Simplified Chinese localization system (`src/i18n.js`) across UI controls, headers, settings, history, and toasts
- **Message Action Bar**: bottom-right action bar on message bubbles with Markdown copy and session branching from assistant turns
- Chinese README (`README.zh-CN.md`) with cross-links between English and Chinese documentation
- **Delete session**: trash icon in the history panel lets you permanently remove a saved session from disk — two-click confirmation (trash → "Delete?" → confirm) prevents accidents; the row is removed optimistically from the list immediately

### Fixed

- `/compact` now immediately refreshes the ambient context gauge instead of waiting for the next conversation turn
- Compact card displays both before and after token counts (`26.2k → 24.1k`) instead of only the pre-compact count; pre-compact count is now snapshotted from the ambient gauge at send time so it's always accurate regardless of the backend response
- Compact failure now shows the actual error reason from the backend (e.g. "Nothing to compact") instead of a generic "compaction failed"

## [0.2.2] - 2026-09-16

### Added

- Enhanced Ollama custom model compatibility, auto-detection, and round-trip YAML persistence (`~/.pi/agent/models.yml`)
- Improved model switch error feedback with actionable troubleshooting guidance directly in chat
- Suppressed native browser context menu and page reload shortcuts (`F5`, `Ctrl+R` / `Cmd+R`) for clean desktop app behavior

### Changed

- Polished Daylight theme styling with refined mint/teal/green accents and improved visual hierarchy
- Refined chat layout, bubbles, tab bar version badges, and typography across panels
- Optimized model merging logic between built-in provider configurations and custom models

## [0.2.1] - 2026-09-15

### Added

- Multi-modal image attachment support in composer (paste & file upload) with preview chips
- Dropdown menu for session creation: open project folder (`Ctrl+O`) or start standalone session (`Ctrl+T`)
- Model input capability detection and multi-modal handling

### Changed

- Rebranded project to PiDesk as an independent desktop shell for oh-my-pi
- Updated application bundle identifier to `com.raiderwang.pidesk` and package name to `pidesk`
- Automated GitHub Actions release pipeline configured to build and publish PiDesk releases

## [0.2.0] - 2026-09-14

### Added

- Conversation history panel with session search, switching, and restore support
- Model management modal panel with provider configuration and YAML persistence

### Fixed

- Tab switch drops all tool cards from chat — `get_messages` returns only text entries; tool/ask/compact cards live exclusively in live event state. Fixed by merging `get_messages` ground-truth text into the existing snapshot (preserving tool cards in-place) instead of replacing `state.messages` wholesale. `activeToolCards` indices are rebuilt after merge so in-flight `tool_execution_update` events continue landing correctly.
- Minimap cell stuck pulsating after tab switch — `streamingBubble` restored from snapshot was never cleared when `get_state` reported `isStreaming: false` (turn completed while away); `_applyRpcState` now retires the bubble and strips `streaming: true` entries from `state.messages` immediately, before `get_messages` arrives.

## [0.1.2] - 2026-05-11

### Fixed

- macOS freeze (spinning beach ball + high CPU) when opening a project folder via the + button — `blocking_pick_folder` was called from a command-handler thread, deadlocking against the main RunLoop; switched to callback-based `pick_folder` with an async command and `spawn_blocking` channel bridge

## [0.1.1] - 2026-05-10

### Added

- `/login` command with OAuth provider picker (fetches providers via `get_login_providers` RPC)
- Ask tool rendered as inline chat bubble with `rpc-ui` mode support _(requires [can1357/oh-my-pi#994](https://github.com/can1357/oh-my-pi/pull/994) to be merged)_

### Performance

- Fixed 13×13 minimap grid (169 cells); oldest row of 13 messages evicted at turn boundary once the grid is full, keeping memory and render cost bounded in long sessions
- `React.memo` on all bubble components (UserBubble, AssistantBubble, ToolCard, AskBubble, CompactRow); only the live streaming tail re-renders per token — stable history bails out
- Stable `_id` stamped on every message object in `live.js`; bubbles keyed by `_id` instead of array index, eliminating remount/fade-in blink when the oldest row is evicted
- `useCallback` on `handleAnnotate` and `handleAskAnswer` in App to stabilize function-prop refs and preserve memo bailouts for AssistantBubble and AskBubble

## [0.1.0] - 2026-05-10

### Added

- Initial Tauri 2 shell: spawns `omp --mode rpc` per tab, no bundler, JSX transpiled in-browser via `@babel/standalone`
- GitHub Actions CI (cargo check + cargo test on win/linux/mac) and release pipeline
- Per-tab omp process isolation — one process per tab, preserved across switches via session snapshots
- Model picker as a separate bridge view with on-load fetch and refresh button
- Markdown rendering with syntax highlighting (marked v12 + highlight.js) in chat
- Plan mode: full intent → drafting → review → running → done lifecycle with inline block annotations
- Slash command palette with arrow-key navigation, fuzzy filter, and Enter execution
- `/new` command to start a fresh omp session in the current tab
- Steer: send a message to the agent mid-turn without waiting for completion
- Compact tool cards: full expand/collapse card showing live progress and final result
- Task/quick_task tool cards: collapsible subagent panel with live-stream view on row click
- Eval cell tool cards: stream code and output live; syntax highlight on completion
- Auto-scroll chat to bottom as the agent streams output
- Minimap: dense grid heatmap with chat-bubble cross-highlight and per-kind tooltips
- Long paste collapse into `[paste #N +K lines]` inline tokens in the composer
- macOS-style traffic light window controls on Windows (DWM frameless)
- Autosave toggle button in the status bar
- Font size slider in the tweaks panel (75–150%, step 5)
- Git branch chip in the title bar via `gix` + `notify`
- OMP icon pack v1 as app icons across all platforms
- MIT license

### Fixed

- Black screen on startup — disable Tauri CSP hash injection, remove Google Fonts CDN link
- Git HEAD watcher — watch `.git/` directory instead of `HEAD` file to survive atomic rename on Linux/macOS
- Window drag — replaced custom handler with `data-tauri-drag-region`
- Diff block overflow — contained within chat column width
- Composer textarea: single-line default via `field-sizing: content`; focus restored after send; textarea stays enabled during streaming for steer input
- Phantom textarea scrollbar hidden at min-height
- Window control symbols: always colored red/yellow/green, no hover background bleed
- Tweaks panel: persist settings to `localStorage`; retheme to use app CSS variables
- Token and context gauge percentages truncated to one decimal place
- Stream line accumulation — handle in-place growing lines without duplication
- ToolCard: remove duplicate `return` statement; expand individual subagent rows, not the card header
- Plan annotations always reaching the prompt; `sendFeedback` working with annotations and no body text
- Plan running→done state transition
- Message history preserved across tab switches
- Tab name retained from folder path when `omp sessionName` is absent
- `_handleResponse` in `live.js` — missing closing brace caused silent IIFE syntax error
- Thinking level values aligned to valid RPC set (`off | minimal | low | medium | high | xhigh`)
- Rust agent: race-safe sessions, lock-free per-session stdin writes, no orphan child processes on hot-reload

### Changed

- Project renamed from `omp-desktop` to `Oh My Pi Desktop`
- Split large files into focused modules: `agent.rs` → `agent/`, `app.jsx` → `app-live.jsx` + `src/app/`, monolithic CSS and chat/UI/tweaks components into dedicated directories
- Plan mode moved from a dedicated side panel into the chat timeline
