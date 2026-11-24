# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.5.0] - 2026-11-24

### Added

- **Mermaid diagrams render in chat**: a top-level ` ```mermaid ` fence (e.g. `flowchart LR` with subgraphs, CJK labels, `<br/>`) now becomes a diagram card with *View source*, *Copy source* and *Expand* (lightbox) actions in its own header row. `MarkdownContent` splits such messages via `marked.lexer` (`src/app/markdown-segments.js`) into HTML segments + `MermaidCard`s; messages without a mermaid fence keep the old single `marked.parse` path. A fence that is still streaming stays plain source until it closes (or the turn ends). Mermaid 11.17.2 is vendored as `src/mermaid.min.js` (single-file UMD, no CDN) and lazy-loaded on the first diagram. Renders are serialised, cached per theme + accent, get unique SVG ids (identical diagrams never clash), use `securityLevel: 'strict'` with `maxTextSize`/`maxEdges` caps, and never leak error SVGs into the page; syntax errors fall back to the source with a notice. All four themes are mapped to static hex palettes (`src/app/mermaid-theme.js`); `applyAppearance` now dispatches `appearanceapplied` so cards restyle after a theme/accent change. Wide diagrams keep their natural width and scroll horizontally; the chat re-pins to the bottom when a diagram finishes rendering. Mermaid inside lists/quotes, plan mode and the Quick Bar still show as a normal code block.
- **Save Mermaid diagrams as PNG**: diagram cards (and the expanded view) get a *Save PNG* button that rasterises the diagram at 2x with padding and the theme's background colour, then writes it through the native save dialog (new `save_image_to_disk` command in `src-tauri/src/image_export.rs`: parented to the main window, validates PNG payload, never alters the path you pick). `src/app/mermaid-export.js` normalises Mermaid's HTML-serialised SVG (`&nbsp;`, `<br>`) for strict XML and uses a UTF-8 data URL so CJK labels work. WebKit (macOS) taints canvases on `<foreignObject>`, so there the export re-renders through the same serial queue (`MermaidRender.renderForExport`, plain SVG labels, uncached); on Chromium it tries the card's SVG first and falls back on any failure. Cancelling the dialog is silent; failures show a toast.
- **`/export` can save a Markdown transcript**: `/export` now asks for the format first (Markdown or HTML), then opens a native save dialog with a single filter — the dialog itself cannot offer a reliable format dropdown on macOS/Linux. Markdown contains only your messages and the assistant's replies of the active branch (no thinking, tool calls or metadata; image-only messages become `[Image]`, consecutive assistant turns are merged, plan-mode framing is stripped), built from `get_entries` by `src/app/export-markdown.js`. An empty session says so without opening the dialog. HTML export is unchanged. New `save_markdown_export` / `save_html_export` commands (`src-tauri/src/session_export.rs`) show the dialog and write the file themselves, so the page never supplies a destination; `export-bridge.js` orchestrates, ignores overlapping exports, and keeps notices in the tab they started in. The `/export` command hint is now localised, and its notices and dialog titles are translated.
- **Copy as plain text on assistant messages**: a second copy button next to *copy as markdown* strips Markdown syntax (bold/italics/code ticks, headings, quote markers, fences) while keeping list structure, task state (`[x]`/`[ ]`), link URLs (`text (url)`) and tables (tab-separated cells). Backed by the pure `src/app/markdown-plain.js` (walks `marked.lexer` tokens, no DOM, same on WebView2 and WKWebView). The two copy buttons live in `chat/message-copy-actions.jsx`, share one check-mark state, and are hidden when a message has no text. The user bubble's copy tooltip is now plain "copy" (`action.copy`, with new `action.copyMarkdown` / `action.copyPlain` / `action.copied`, all localised).
- **Cost-cap errors have their own title**: omp 19 reports `prompt_result.error.code === "cost_cap"` when the session's `--max-cost` is reached. The error card now says "Cost cap reached" / "已达费用上限" instead of "Provider Error" (`chat.error.costCap`).
- **Compactions started outside PiDesk show a card**: omp 19's `manual_compaction_start`/`manual_compaction_end` events (extension `ctx.compact()`, `/compact`) now create and resolve a compact card, refresh the context gauge and back-fill `tokensAfter`. Cards for the Compact button are still resolved only by the RPC response. Pure reducers in `src/app/compaction-events.js`.

### Changed

- **OAuth provider list in Manage Models covers omp 19**: the hard-coded set moved to `src/app/oauth-providers.js` and now includes the omp 19 OAuth providers (`antigravity-cli`, `kiro`, `mistral`, `snowflake`, …). It stays a static, exact list: omp's `get_login_providers` is not used because it also lists ~70 API-key providers (`deepseek`, `ollama`, …) and reports `authenticated` for keys that merely come from `models.yml` or an env var.
- **Plan prompts name the real tool**: the plan-mode prompts told the model to use `todo_write`; omp's tool is `todo`. Plans already saved with the old wording still get their framing stripped for session titles and Undo.

- **Tool card titles keep their `intent` text on omp 19**: omp 19.0.0 turned tool-call intent tracing off for RPC hosts, so cards fell back to `tool · target`. PiDesk now starts omp with `PI_INTENT_TRACING=1` (slightly more tool-argument tokens). A non-empty `PI_INTENT_TRACING` already set in your environment (e.g. `0` to turn it off) is left untouched; an empty value is treated as unset. In omp's settings registry the env var outranks `tools.intentTracing` in `settings.json` (only a runtime override beats it), so a `false` there no longer takes effect under PiDesk — set `PI_INTENT_TRACING=0` in your environment to turn tracing off.

### Fixed

- **HTML export no longer litters or destroys the file**: cancelling the save dialog left omp's generated `.html` in the project directory, and saving onto that same path copied the file over itself and then deleted it. Cancel now removes the generated file, saving in place keeps it, and the dialog is parented to the main window with file I/O off the async worker.
- **Streaming tool output boxes stay pinned to the bottom**: the bash output, eval code/output and sub-agent output boxes now follow new lines while the tool is running, and pause as soon as you scroll up (resuming when you scroll back down). Previously only sub-agent boxes auto-scrolled, and they yanked you back down while reading. Bash output moved into its own `BashOutput` component so re-expanding a running card re-pins it; scroll decisions are pure logic in `src/app/stick-scroll.js` behind the `useStickScroll` hook.
- **Forced tab renames keep the `(n)` suffix**: `session_info_update` / `sessionName` renames could turn an unstarted `omp-desktop (2)` tab back into `omp-desktop` when omp's session name equalled the folder name. The bare-folder-name guard now also applies to forced renames of unstarted folder-named tabs; tabs you already renamed can still be reset.
- **File tree error toasts look like errors**: failures to load, rename, delete or open in the external editor used the same green check as success toasts. They now show a warning icon with an error border and stay a little longer; long messages wrap instead of overflowing, and the toast timer is cleared when the panel unmounts. The toast lives in `src/design/file-tree-toast.jsx`.
- **Bold/italic next to CJK text now renders**: marked follows CommonMark's flanking rules, so `**` / `*` touching punctuation on one side and a CJK character on the other (e.g. `一个**"…"的教程**`, `GPT4**（最新）**`) stayed literal, and `**教程（一）**和**二**` even mis-nested into `<strong>…<strong>…</strong>…</strong>`. `src/app/marked-cjk.js` takes over `*`-delimited emphasis when the text contains CJK, with CJK-aware flanking (scanning marked's masked source, so code spans, links and `\*` stay opaque); CJK-free text and `_` delimiters use stock marked. Applies to chat, plans and the Quick Bar.
- **Pending compact cards no longer stick forever**: the abort/process-exit cleanup looked for a `pending` flag that compact cards never had (they use `status: "pending"`), so a compaction interrupted by an abort or an omp crash stayed "compacting…" and blocked Undo. Such cards now end as aborted; a normal turn end leaves them alone.
- **No more blank assistant bubbles**: a turn where the model only calls tools (no text, thinking or plan) left a header-only assistant row (sparkle rail, model name, time) in the timeline. The placeholder is now dropped when the message ends, or when an interrupted turn is settled; failed turns are kept and show the provider `errorMessage`. `message_end` frames for user/toolResult messages no longer close the in-flight assistant bubble. Pure predicate in `src/app/empty-bubble.js`. Known trade-off: the placeholder still flashes while the tool call streams in.

- **`ask` tool works with both omp 18.4.3 and 19.0.1**: omp 19 no longer accepts a non-offered text as a `select` answer (it aborted the whole turn), asks "Other" follow-ups as `input` instead of `editor`, and re-sends every multi-select round with `checkedIndices`. PiDesk now detects all of this from the frame itself (no version checks):
  - Free text goes through a two-step handshake: the "Other (type your own)" row is sent first and the typed text answers the follow-up `input`/`editor` request. The free-text box only appears when the server offered an Other row. The handshake is dropped on any new `select`, `cancel`, when the ask ends, on abort/exit and on tab switch, so a stale answer can never fill the next form field.
  - `editor` requests are no longer auto-cancelled and `input` requests no longer block on `window.prompt`: both render as inline bubbles (single-line or multi-line with Ctrl/Cmd+Enter, password masking for `secret`, empty submit to skip an optional field, Cancel). OAuth/login prompts keep using `window.prompt` (tracked per session).
  - Multi-select: each click is sent at once and the same bubble is reopened for the next round (no more duplicate or hung bubbles), with checked state, a Done button that replays the server's original row, and an "Other" chip with Clear. Round-title matching handles 18.x and 19.x `(N selected)` decorations.
  - Ask bubbles are shown as soon as the request arrives instead of waiting for `tool_execution_start` (which hung every round after the first); the ask tool card is moved ahead of them. Unanswered bubbles are marked cancelled when the ask ends or the turn is aborted (18.x sends no `cancel` on timeout).
  - Review hardening: the "Done selecting" row is matched strictly (anchored, any glyph — the real 18.4.3 one is U+F00C, not `✔` — never an option that merely contains the words, honouring `selectionMarker`/`markableCount` and taking the last match); an abort, process exit or errored ask now cancels a bubble whose click was still in flight instead of marking it answered; an idle `get_state` settles stale open asks (e.g. after switching tabs); a custom answer is refused while "Other" is already ticked (it would arm a stale handshake); the 18.x first-click seeding only applies to real option clicks; the Done button is hidden once the ask is settled; login-prompt tracking uses per-login tokens cleared on agent exit and tab close.
  - Pure logic in `src/app/ask-model.js` and `src/app/ask-answer.js`; ask styles moved to `src/design/layout/ask.css`; new strings are `ask.*` in `src/i18n.js`.
  - Tests replay **real omp 18.4.3 sessions** recorded with `node test/tools/capture-ask.mjs --scenario idea|single|multi|other|multi-other` (`test/fixtures/captured/*.jsonl`, replayed by `test/ask-captured.test.mjs`; `node test/tools/dump-capture.mjs <file>` prints one). Real **omp 19.0.1** sessions are recorded too (`ask-19.0.1-{idea,single,multi,other,multi-other}.jsonl`) and replayed by the same test: they confirm `tool_execution_start` arrives before the first `select`, "Other" follow-ups come as `input`, multi-select rounds carry `checkedIndices`/`markableCount` (the "Done selecting" row uses the same U+F00C glyph as 18.x) and a form's optional text field arrives as a standalone `editor` with `prefill`. The source-derived `test/fixtures/ask-frames-19.json` stays as a supplement for branches no model run reaches (omp 19 needs Bun ≥ 1.4.4).
  - Known limitation (omp, confirmed by capture on 18.4.3): in an ask with several questions, omp 18 sends multi-select questions without a "Done selecting" row, so they cannot be finished from RPC except by typing a custom answer through "Other"; PiDesk shows each toggle round (a `(N selected)` title now marks the question as multi-select, so ticks are visible even without a Done row) but has no row to send for "done".

## [0.4.11] - 2026-11-17

### Added

- **Restart the agent after editing models**: omp only reads `models.yml` at startup and has no RPC to reload it, so an edited or renamed model could not be selected in the tab that was already open (only in a new tab). After saving a changed configuration in Manage Models, a confirmation now offers to respawn the current tab's agent with `--resume` on the same session file, keeping the conversation. It refuses while a turn or background task is running, and for a conversation with no session file (history would be lost). New `OMP_BRIDGE.restartActiveSession()`, pure decision in `src/app/session-restart.js`, dialog in `src/design/model-restart-modal.jsx`, config comparison via `YamlUtil.modelsFingerprint`. A restart with `--resume` leaves the model to omp (it restores the session's own model and thinking level); a still-empty tab restarts as a brand-new session, so the saved model/thinking preference is applied to it. A just-resumed tab can be restarted before its first `get_state` (falls back to the registry `sessionPath`).

### Changed

- **Switch-model list is grouped by provider and collapsible**: the command palette's model list (and its search results) now shows one collapsible group per provider instead of a flat list. Searching also matches the provider name; every search starts with the matching groups expanded and they can be collapsed too. Arrow keys skip collapsed groups, clicking a group header keeps focus in the search box, and collapsing a group no longer scrolls the list back to the top. A collapsed group that contains the current model shows a check mark; the current model is now identified by id **and** provider (the same id under two providers no longer shows two active rows), and rows no longer repeat the provider already shown in the group header. Pure logic in `src/app/model-groups.js`.

### Fixed

- **A string field written as a number no longer disables every custom model**: omp validates `models.yml` against a schema at startup and, on any error (e.g. `apiKey: 123`, a number instead of a string), silently drops *all* custom providers — so even after a restart `arkcode/deepseek-v4.1-flash` was "Model not found", while PiDesk kept listing it because it reads the file itself. Fixes: (1) `YamlUtil` now keeps number/boolean/null-looking strings quoted when re-dumping (`"123"` no longer round-trips to `123`; also `True`, `yes`, `1e5`, `0x1F`, `+1`… for the string-only fields, and a model `id`/`name` of `0`/`false` is no longer dropped) and always writes `baseUrl`/`apiKey`/`api`/`auth` and model `id`/`name` as strings, so an existing unquoted value is healed on the next form save; (2) saving from the YAML tab is refused with the offending path when such a field is not a string (`src/design/models-schema-check.js`); (3) when custom models declared in `models.yml` are missing from omp's model list, PiDesk runs `omp models` (new `check_models_config` command, `src-tauri/src/models_diagnostics.rs`; RPC mode prints nothing) and shows omp's schema error in a warning banner (`ModelsConfigWarning`, pure detection in `src/app/models-config-check.js`). The command is `async` + `spawn_blocking` so the window never freezes while `omp models` runs, and a stale result (models.yml saved while a check was in flight) can no longer bring the banner back (`ModelsConfigCheck.createRunner`).
- **Saved model preference no longer skipped across providers**: restoring the last-used model compared only the model id, so the same id under a different provider (e.g. direct vs. proxy) was treated as already selected. The provider is now compared too (a model omp reports without a provider is still matched by id alone).
- **Renaming or deleting a model no longer causes a permanent "Model not found"**: the last-used model saved in `pidesk:prefs` was re-pushed to omp by every new session, so a custom model renamed in Manage Models (e.g. `deepseek-v4-flash` → `deepseek-v4.1-flash`) failed on every start, even after restarting. A failed automatic restore is now silent: it forgets the saved model (keeping the thinking level), falls back to the model omp is running and re-applies the thinking level. Saving models.yml also drops a saved model it no longer lists (`src/app/model-prefs.js`). Failed user-initiated switches still show the notice; `set_model` origins are tracked in order so the two never get mixed up.

## [0.4.10] - 2026-11-09

### Fixed

- **Markdown links no longer navigate the app**: clicking a link in chat (e.g. `[路由配置说明.md](路由配置说明.md)`) used to load the WebView's own URL and reset the window to a fresh conversation. A capture-phase handler (`src/app/link-handler.js` + pure `link-target.js`, also loaded by the Quick Bar; covers left and middle click) now routes links: `http`/`https`/`mailto` open in the system browser; `file://`, absolute and project-relative paths go to the new `open_link_path` command (`src-tauri/src/link_open.rs`). Documents and media (`.md`, `.pdf`, images, …) open with the OS default app; code, scripts, executables and unknown types open in the configured external editor, or are revealed in the file manager when none is set, so a link can never run a file. `open_url_external` now only accepts `http`, `https` and `mailto`. When an external editor is configured, text/markup/config links (`.toml`, `.json`, `.yaml`, `.html`, `.md`, `.txt`, …) open in it too (PDF, images, audio/video and Office files still use the OS default app); if the default app fails to launch the link falls back to the editor or the file manager. A missing file or failed open now shows a short toast (`link.fail.*`, `src/app/link-toast.js`) instead of doing nothing.

## [0.4.9] - 2026-11-03

### Added

- **External editor setting**: Tweaks → General gains an "External editor" field (command line, e.g. `code -g`, with Browse… and Clear). When set, the file tree right-click menu shows "Open with External Editor" for files. Leave it empty to hide the item. Backed by new `open_with_editor` / `pick_editor_executable` commands (`src-tauri/src/external_editor/`); paths with spaces are auto-quoted on Browse, and Windows `.cmd` shims such as `code` are resolved from PATH.

### Changed

- File tree context menu and delete confirmation moved out of `file-tree-panel.jsx` into `file-tree-menu.jsx` / `file-tree-delete-modal.jsx`; the menu's viewport clamp height is now 275px to fit the extra item.

## [0.4.8] - 2026-10-21

### Added

- **Open same project in multiple tabs & tab bar creation refinement**:
  - Removed project deduplication check when opening projects from the tab bar `+` dropdown menu ("Recent Projects"), allowing users to open multiple independent conversation tabs for the same workspace directory without auto-switching to an existing tab.
  - Added pure `nextInitialName` and `normalizePath` helpers in `src/app/session-title.js`, auto-numbering initial project tabs (`<folder>`, `<folder> (2)`, `<folder> (3)`) without bloating `src/live.js` while recycling freed indices upon closing tabs.
  - Enhanced `SessionTitle.isInitialSessionName` and `nextTitle` to recognize numbered project initial titles and gracefully preserve sequence numbers if the first prompt equals the folder name.
  - *Note on concurrent agents*: multiple active sessions sharing a project directory operate on the same filesystem; workspace-level features (such as Code Review and File Tree) reflect live state across all sessions in that directory.
- **Session tab title truncation, native tooltips, and project-aware title formatting**:
  - Automatically format session tab titles upon starting a conversation: standalone sessions use the sanitized first prompt, while project-bound sessions use `<folderName>: <prompt>` format so multi-session project tabs are distinguishable.
  - Added pure `SessionTitle` module (`src/app/session-title.js`) that strips Plan mode framing (`INTENT_FRAMING`), removes Markdown header markers, normalizes newlines/whitespace, clamps character length safely across surrogate pairs (emojis/CJK), and provides unified `folderName` path parsing.
  - Implemented elastic tab layout in CSS (`flex: 0 1 auto; min-width: 100px; max-width: 200px;`) with single-line ellipsis (`text-overflow: ellipsis`), allowing short titles to fit naturally without forcing 200px width while keeping `.tabs` `overflow: visible` to prevent clipping the `+` dropdown menu.
  - Added native `title` tooltips to tabs and window chrome, showing full conversation titles and directory paths on hover.
  - Hardened title formatting and event dispatch: factored out `SessionTitle.nextTitle` pure logic, ignored slash commands (`/plan`, `/compact`, `/review`) and file-only mentions so they never lock titles prematurely, verified and matched `session_info_update` by `savedSessionId` from omp RPC, and guarded established titles (`titleLocked: true`) against subsequent prompt overwrites.
  - Improved standalone tab numbering to recycle unassigned `PiDesk` slots when existing tabs are custom-titled.
  - Updated File Tree panel header (`displayName`) via `SessionTitle.resolveFolderTitle` to prioritize folder name over generic project labels (standalone sessions display `workspace`).
  - Cleaned up duplicate `.tabs-right` CSS rules, consolidating `flex-shrink: 0` into the main rule.

### Documentation

- **Redesigned README showcase and screenshot assets**: overhaul feature matrix in `README.md` and `README.zh-CN.md` with an 8-pillar visual architecture (Activity Bar workspace, context-aware `@` chips & Undo, `/review` drawer, Plan Mode & Kanban, Quick Bar overlay, screenshot annotation suite with mosaic blur, Model Manager thinking depth, and command palette / themes). Replaced legacy stacked screenshots with 8 high-DPI feature screenshots and removed deprecated image assets.

## [0.4.7] - 2026-10-19

### Fixed

- **"omp not found" after an in-app update, and Retry never recovering (Windows)**: the real cause was not timing. The MSI updater relaunches the app from a Windows Installer custom action, so the new process can start with an environment that is not the logged-in user's: no user `PATH` entries (e.g. `~\.bun\bin` where omp lives) and possibly another profile's `USERPROFILE` / `LOCALAPPDATA`. It could never find `omp.exe` — retrying or waiting in that process was pointless, while closing and reopening the app from Explorer worked. On startup PiDesk now asks Windows for the user's own environment block (`CreateEnvironmentBlock`: machine + user + volatile variables, already expanded, no code-page issues) and applies it: missing variables (including user-defined ones such as API keys) are added, the user `PATH` entries are appended (existing entries keep priority), and if the process carries a different profile, the profile variables (`USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TEMP`, …) are corrected so omp doesn't use the wrong `~/.omp`. A clean environment is left untouched. The usual install locations (`~\.bun\bin`, `%BUN_INSTALL%\bin`, `%LOCALAPPDATA%\omp`, `~\.cargo\bin`, `~\.local\bin`) are also probed as absolute paths when the bare `omp.exe` lookup fails. When a repair happens, the before/after values are logged to stderr.

## [0.4.6] - 2026-10-19

### Changed

- **"No project" sessions now use a dedicated workspace**: instead of the running executable's directory (which could sit inside a repo under `cargo run`, be read-only under `Program Files`, and moves between versions), project-less sessions (default tab, New Standalone, Quick Bar) start in `<app local data>/workspace` (e.g. `%LOCALAPPDATA%\com.raiderwang.pidesk\workspace`), which normally stays empty so no project files influence the agent. The directory is created on demand and falls back to the executable's directory if it can't be created. Sessions saved by older builds are still recognised as project-less and resume into the new workspace. Project-less saved sessions are listed as `Default` (not the internal folder name), listing them no longer touches the disk, and exporting such a session to HTML still finds the file omp wrote into the workspace.

### Fixed

- **"omp not found" error right after an in-app update**: omp is often still unavailable for a few seconds after the update restarts the app, so the first start used to fail once and show the error banner until you clicked Retry. The first launch after an update now keeps retrying the default session in the background for up to 30 seconds and shows "Starting agent…" in the status bar instead of an error; only a failure that outlasts that grace period is reported (with the real spawn error, never a generic "not running" caused by a status race). Messages and model changes made while it starts are queued and delivered once omp is up instead of being dropped, and changing models during that time no longer cancels the retry. Closing the tab or quitting during the grace period no longer leaves a retry thread that can still spawn omp. If you click "Later" on the update banner and restart more than 10 minutes later, the grace period still applies. Regular launches are unchanged. The `rpc-ui` capability probe (`omp --help`) is also no longer cached when omp couldn't be run or `--help` failed, so a briefly missing or half-installed omp no longer pins the app to plain `rpc` mode for the rest of the session.
- **Empty ghost bubble after omp fails to start**: when omp wasn't up yet at launch or after an update restart, a blank assistant bubble (avatar, `–`, timestamp, no body) was left in the chat next to the error banner. The banner now owns the error (no duplicate chat bubble that goes stale after Retry), and the "model switch failed" / "restarted after model config" notices render properly through a shared `NoticeBubble` helper. The "model switch failed" text is now localised. Also fixes a `ReferenceError` when Retry itself failed to spawn omp. Client-side notice bubbles are now tagged (`notice: true`) so they no longer get dropped by the `get_messages` merge, break "branch from here" for earlier messages, or get picked as the annotatable plan reply, the undo count, the provider-error target or the Quick Bar reply. Restarting a stopped session after saving models now also clears or updates the error banner.

## [0.4.5] - 2026-10-17

### Added

- **Reference a file from the Files panel**: right-click a file → "Reference File" attaches it to the composer as an `@path` chip (folders don't show the item). The chip row sits above the input; on send the references are prefixed to the prompt as `@relative/path`, which omp auto-reads, and they render as chips in the sent message bubble. Picking a file in the command palette's `@` mode now attaches a chip too.
- **`@` file autocomplete in the composer**: typing `@` (after whitespace or at line start) opens a fuzzy-filtered list of project files; ↑/↓ select, Enter/Tab attach it as a chip, Esc dismisses. Only available when a project is open.
- **Clarity light theme**: a modern light theme with a crisp neutral-cool light gray background (`#F0F2F5`), airy off-white canvas (`#F8F9FA`), pure white surfaces with a faint cool-gray elevated layer, high-contrast slate text hierarchy, and an electric cobalt blue (`#2563EB`) default accent with refined ambient shadows. Selectable via Settings (Tweaks) → Look → "clarity (modern light)" / "澄澈白 (现代灰)".

### Fixed

- **`@` file reference polish**: Esc now closes the `@` popup even while it only shows the "indexing" notice, and no longer aborts a streaming reply; the notice no longer reappears during background re-indexing when the cached list simply has no match; Esc followed by more typing re-opens the popup, while undo-restoring a message ending in `@path` no longer pops it open. Files without a recognisable extension (`Dockerfile`, `LICENSE`) are sent as `@"name"` so they render as chips, dotfiles such as `.editorconfig` / `.clang-format` and backslash paths render correctly, completing inside brackets (`(@src)`) keeps the closing `)`, and completing at the start of the text leaves no leading space. While streaming, a chip-only draft now shows the steer button, and `/review` carries attached chips into the review focus instead of dropping them.
- **Curated high-contrast accent palette for Clarity light theme**: replaced the bright pastel/neon accent options under the Clarity theme with 8 darker, high-contrast tones (`#2563EB`, `#0E7490`, `#047857`, `#7C3AED`, `#A21CAF`, `#BE123C`, `#B45309`, `#475569`) that all exceed WCAG AA contrast requirements (>= 4.5:1) against white surfaces, improving text and icon readability; dynamically computes `--accent-deep` hover states via `color-mix`; auto-normalizes previously saved bright accents in Clarity to matching dark tones.
- **Tweaks theme dropdown arrow invisible on light themes**: with four themes the theme picker falls back to a `<select>`, whose arrow was drawn white-on-white under `daylight` / `clarity`; it now uses a neutral gray that is visible on every theme. English theme names now consistently carry a descriptor (`aurora (dark)`, `phosphor (dark)`, `daylight (light)`, `clarity (modern light)`).

### Removed

- **Dummy autosave toggle**: removed the vestigial "autosave" toggle from Settings (Tweaks) and its unused warning indicator in the status bar. omp sessions are always saved incrementally to disk by the background agent process, so the front-end setting had no real effect.

## [0.4.4] - 2026-10-16

### Added

- **In-app updates**: PiDesk checks GitHub Releases 5 s after launch and every 24 h (toggle: Settings → "check for updates automatically"), and shows a banner with the release notes. "Update now" downloads, verifies the signature and installs in the app, then offers "Restart to finish"; "Later" and "Skip this version" dismiss it. Settings also has a version row with a manual "Check for updates" button. Built on `tauri-plugin-updater` (`src-tauri/src/update.rs`: `check_update` / `install_update` / `restart_app`); on installs that cannot self-update (e.g. `.deb`) the banner offers "Download manually". **Maintainers:** releases now require the `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repo secrets (the matching public key is already in `plugins.updater.pubkey`); on Windows the omp child processes are stopped just before the installer launches, and the plugin's IPC is not exposed to the webview — see `MANUAL.md` → "In-app updates". Versions before the first updater-enabled release must be upgraded manually once.

## [0.4.3] - 2026-10-15

### Added

- **Welcome card on empty tabs**: a tab with no messages now shows a short intro (how to ask, `/` and `@`, project folders, Plan mode) and the full keyboard shortcut list, including the configurable Quick Bar and screenshot shortcuts. It disappears once the first message arrives. Lives in `design/chat/welcome-card.jsx` and reuses the shortcut registry, so new shortcuts show up automatically.

- **Undo a sent message**: every user bubble has an undo button (bottom-right, disabled while the agent runs, compacts, or has background tasks pending — `branch` would cancel them). After a confirmation the conversation is rolled back to just before that message via omp's native `branch` RPC — the message text (and images) return to the composer for editing and resending, and everything after it is cleared. The original conversation stays in History as a backup; file changes the agent already made on disk are **not** rolled back (the dialog says so). Plan-mode framing is stripped from the restored text; an existing composer draft is kept (the message is appended). Logic lives in `app/undo-message.js` (tail-aligned entry lookup with text verification — never guesses), `undo-bridge.js` and `design/composer-restore.jsx`. Known limitation: a message that omp rewrote before saving (expanded slash command / prompt template / `@model` mention) cannot be matched to the saved session, so it — and anything before it — reports "couldn't match" and is left untouched.

### Changed

- **Taller initial main window**: the default window height is now 960 (was 900) logical px, set in `src-tauri/tauri.conf.json`.

- **Quick Bar look**: rounder card with a hairline border, roomier input row (larger text, more padding), a tinted hint bar with keycap-style shortcuts, and softer spacing in the result area and screenshot thumbnail strip.

- **Quick Bar reply follows the stream**: the reply area now stays pinned to the bottom while text streams in, so new content is always visible. Scrolling up pauses it (to read earlier text) and it resumes when you scroll back to the bottom or send a new message (`quick-bar/use-stick-bottom.jsx`). The `Esc` entry was dropped from the shortcut hint bar (Esc still closes the bar / aborts a running reply) and its `quickbar.hint.close` i18n key removed.

### Fixed

- **Quick Bar edges on macOS**: the transparent window no longer shows a grey rectangular edge / broken rounded corners. The native window shadow (which macOS draws from stale window alpha) is off on all platforms; the card now sits in a 24 px transparent gutter and draws its own shadow with CSS. The window height is measured from the card only (`use-auto-height.jsx`), and re-measured on every show.
- **Single-file session deletion**: `delete_saved_session` now removes only the target `.jsonl` session file (and removes the directory only if it becomes empty). Previously, it wiped the entire parent folder, which accidentally deleted all other sessions for the same project in omp 18.x's shared session directory layout (`~/.omp/agent/sessions/<project-dir>/`).
- **Session branching accuracy & source resolution**: "Branch from here" now forks the session file omp is actually writing (matched by path, then session id) instead of comparing a session id with a file path, which always fell back to the newest session of the project. A branch from a specific message is cut at a stable entry id (`app/branch-session.js`, tail-aligned and strictly verified) rather than a message count, so it no longer drifts after the UI list is head-trimmed or when the session holds tool results; the cut keeps the tool results of the chosen turn so the fork has no dangling tool calls. If the message cannot be matched safely the branch is refused with a warning (new `branch.fail.*` strings, EN/ZH) instead of silently copying the whole session; an unknown entry id is an error in `copy_session_file` (now in `src-tauri/src/session_copy.rs`).
- **Message list reconciliation on tab switch/ready**: `get_messages` is now merged by exact tail alignment (`app/message-merge.js`) instead of pairing the Nth local bubble with the Nth persisted turn. This prevents mis-mapped content and re-appended old turns once the UI list is head-trimmed (169 cap), keeps older local bubbles when omp compaction dropped them from the persisted list, ignores the empty bubbles of tool-only turns, and no longer re-hashes every message on each comparison.
- Undo no longer loses the message or shows its error in the wrong tab when you switch tabs mid-undo: the switch now waits for the in-flight undo, so the text lands in the composer of the tab it came from and any failure warning stays in that tab. Previously the switch dropped the response listener, the undo hung for 30 s, and the warning appeared in the tab you had switched to.
- The undo button's busy guard is now a single check shared by the button and the bridge. It covers a manual `/compact` (pending card) and automatic compaction, and disables undo while background async work is pending, with its own tooltip. Undo also keeps tool logs of earlier turns instead of wiping them all.
- A tab now re-binds to omp's current session file whenever it changes (undo, `/new`, switch). Previously History's "already open" check and resume de-duplication kept pointing at the old file, so the new one could be opened a second time.

## [0.4.2] - 2026-10-15

### Added

- **Activity Bar + Dock panel**: a 44 px icon strip on the left is now the single entry point for Files, Plan, Code review, Overview, History, Models and Appearance settings (tooltips show shortcuts). The right-hand panel became a resizable dock with `Overview` (former ambient rail) and `Plan` tabs. Stage columns are generated by `app/dock-layout.js`; below 900 px the file tree and dock auto-hide. Dock/file-tree state persists in `pidesk:dock-state` (legacy `pidesk:files-panel-*` keys are migrated).
- **Plan in the dock**: compact vertical Plan view (phase, progress, ask, tasks grouped by status, abort) with a "board" button that expands to the full kanban modal. A pulsing dot on the Plan icon replaces the flashing tab/status buttons.
- **Command palette (`Ctrl+K`)**: fuzzy search with match highlighting across commands, app actions, open tabs and saved sessions; prefixes `/` commands, `#` sessions, `@` project files (inserts `@path` into the composer), `?` shortcuts. Rows show their keyboard shortcut.
- **Keyboard shortcut cheat sheet** (`Ctrl+/`, or `?` in the palette) driven by a single shortcut registry that also includes the Quick Bar and screenshot shortcuts.
- **Tool-call folding**: runs of 3+ finished tool calls collapse into one summary row (coloured per-tool counts, failures, total time); minimap clicks expand the group first. Toggle with Tweaks → `groupTools`.
- **Unified `Modal` shell** (`design/ui/modal.jsx` + `app/modal-stack.js`): portal, focus trap/restore, nested layers, Escape only closes the topmost modal.

### Changed

- **Status bar slimmed**: connection is a dot (text only on error), thinking level removed (it lives in the composer), cost and t/s merged into one usage cell (t/s while streaming or on click), autosave moved to Tweaks (status bar only warns when off), Tweaks gear moved to the Activity Bar.
- `/todo`, `/kanban`, `Ctrl+J` and the status-bar todo cell now open the dock's Plan tab instead of the full-screen board. History / Models / Kanban buttons were removed from the tab bar and the Files button from the title bar (use the Activity Bar).
- Internal: `chrome.jsx` split into `design/chrome/*`, `panels.jsx` into `design/plan/*`, `CommandBridge` moved to `design/palette/`; global shortcuts no longer use stale closures.

### Fixed

- **Shortcuts leaking through dialogs**: while a modal is open only `Ctrl+K` / `Ctrl+/` stay active (and never stack on top of another dialog), so `Ctrl+H/M/B/J/O/T` no longer act behind it; History no longer resumes a session when `Enter` was consumed by a dialog above it.
- **Tweaks panel position**: it now opens at the bottom-left next to the Activity Bar gear (instead of the bottom-right corner) and still drags freely. Clicking anywhere outside the panel closes it (clicking the gear again toggles it shut).
- Plan board modal now uses the shared modal layering (it could render below other dialogs); tool-call group headers follow language switches; Tweaks → layout shows `focus` when the dock is closed so `rail` can reopen it; the `@` file index discards results from a project you already left; removed a duplicate `Ctrl+K` handler in the composer; plan "ask" label and rail "session"/"minimap" titles are translated.

## [0.4.1] - 2026-10-14

### Fixed

- **macOS Dock icon after closing the main window**: closing the window to the tray now also hides the Dock icon (it was lingering but unresponsive), and the icon is restored when the window is shown again from the tray / single-instance relaunch. Clicking the Dock icon (`RunEvent::Reopen`) now brings the main window back. Logic lives in `src-tauri/src/main_window.rs`.

## [0.4.0] - 2026-10-13

### Added

- **Recent Projects List in New Session Menu**:
  - Added a divider line and a list of the 10 most recently opened projects below "Open Project Folder..." and "New Session (No Project)" in the TabBar `+` dropdown menu.
  - Displays project folder icon, project directory name, and truncated path with full path on hover tooltip.
  - Clicking a recent project switches directly to its existing tab if already opened, or opens a new session tab for that folder if not currently open.
  - Real-time project tracking: automatically saves project folders opened via the folder picker dialog or `openSession(cwd)`.
  - Asynchronous background synchronization: merges and backfills historical project directories discovered in saved sessions on disk (`~/.omp/agent/sessions/`).
  - Standalone session filtering & auto-purge: filters out "no project" sessions so internal dev build directories (e.g. `target/debug`, `target/release`) and installation roots (e.g. `Program Files/PiDesk`) are never listed as projects, and automatically purges any stale entries from local storage.
  - Backend `get_default_cwd` command and `SavedSession.is_standalone` tagging in Rust for cross-layer detection.
  - Modular frontend architecture in `src/app/recent-projects.js` with path normalization across platforms, persistent caching, and unit tests in `test/recent-projects.test.mjs`.
  - Full bilingual i18n support in English and Simplified Chinese (`chrome.tabs.recentProjects`, `chrome.tabs.noRecentProjects`).

- **Review Drawer Full-Width Toggle**:
  - Added an expand/collapse icon button at the top-left corner of the Code Review drawer header.
  - Clicking the button smoothly expands the drawer leftwards to full width (`100%`) for spacious split-diff viewing.
  - Clicking again smoothly collapses the drawer back to its initial default position (`580px`).
  - Graceful drag interaction: dragging the resize handle while in expanded state smoothly transitions into standard width resizing.
  - Bilingual tooltips and aria-labels in English and Simplified Chinese (`review.expand`, `review.collapse`).

- **Interactive Code Review Drawer (`/review`)**:
  - Right-side resizable drawer for inspecting code diffs and conducting human-in-the-loop reviews alongside the active session chat.
  - Drag-to-resize handle with boundary clamping (400px to 85vw) and automatic width persistence in `localStorage`.
  - Multi-target diff switching:
    - **Uncommitted Changes**: Staged + unstaged modifications combined with untracked files.
    - **Branch Comparison**: PR-style base branch comparison using `git merge-base`.
    - **Specific Commit**: Review individual commits from recent repository history.
  - Full-featured diff inspection with file tree sidebar, additions/deletions badges (`+x -y`), unified and split view toggle, and automatic exclusion of lockfiles, vendor bundles, and build outputs.
  - Inline line-level annotations: click `+` on any code line to attach reviewer comments, questions, or modification requirements.
  - Direct actions:
    - **Send to Current Session**: Formats a structured review prompt incorporating diff snippets, user focus directives, and line-level annotations directly into the active session.
    - **Insert into Input**: Pastes the formatted review markdown into the composer textarea for manual edits before sending.
  - Full environment detection with friendly fallback cards when Git CLI is missing or the current project is not a Git repository.
  - Dual triggers: input interception for `/review` without external URL parameters, and direct access via the `⌘K` command bridge.
  - Dynamic loading state: replaced static text with an animated motion experience featuring an orbital diff radar scanner, shimmering typography with bouncing pulse dots, and an animated code diff skeleton preview during environment detection and diff fetching.
  - Complete bilingual i18n support in English and Simplified Chinese.
  - Annotation correctness: notes are keyed per side (`old:<n>` / `new:<n>`), so a removed line and an added line with the same number no longer share a note; the review prompt quotes the annotated code line and labels removed lines. The annotation "Edit" button now actually reopens the editor.
  - Lockfiles / vendor / build output excluded from the sidebar are no longer inlined into the prompt (the prompt is rebuilt from the displayed files only); SVG diffs are reviewable again; diffs containing Markdown code fences no longer break the prompt block.
  - Robust diff parsing: file names containing spaces, renames, octal-escaped UTF-8 paths, and removed lines that look like `--- ` headers are handled correctly.
  - Git hardening: git runs off the UI thread with a hard 8 MiB read cap, never colours output or runs repo-configured external diff/textconv programs, ignores `diff.noprefix` / `mnemonicPrefix`, diffs from the repo root even when the project is a sub-directory, and supports repositories with no commits yet. Truncated diffs (including skipped untracked files) now show a warning and are flagged in the prompt.
  - Reliability: superseded diff requests are discarded (no stale diff after quickly switching targets), the drawer reloads when you switch tabs, Esc inside an annotation only cancels the edit, and "Insert into Input" now really updates the composer (and keeps the drawer open if the composer is unavailable).
  - `/review <focus text>` pre-fills the review focus field; "Send to Current Session" steers the running turn instead of failing while the agent is busy.
  - Drawer width is clamped to 85% of the viewport on load and resize; collapsing restores your previous width; annotation storage is bounded (LRU of 40 diffs) and hashes the whole diff.

### Fixed

- **Resuming "no project" history sessions**: Saved sessions recorded with the executable directory (e.g. `target/debug`) as cwd are now resumed as standalone tabs (no project folder / file tree / git watch) and the backend pins the current default cwd, instead of being reopened as a project pointing at the debug directory.

### Changed

- **Compact Tool Card Typography**:
  - Scaled down the font hierarchy of in-session tool invocation cards by one notch for better visual hierarchy and readability.
  - Primary tool content (header text, title, bash command output, search preview rows, eval code/output, diff bodies, compact summary bodies, footers) scaled from `--d-text-sm` (~13px) to `--d-text-xs` (~12px).
  - Secondary metadata & badges (tool type tags, status/duration chips, diff line-number gutters, diff headers, scrub bar trackers, eval language headers, subagent task agent tags, stream lines) scaled from `--d-text-xs` (~12px) to a newly defined `--d-text-xxs` (~11px) scale.
  - Added `--d-text-xxs` support across all UI density modes (`cozy`, `compact`, and `dense`) in `src/design/styles.css`.

## [0.3.3] - 2026-10-09

### Added

- **Dynamic Thinking Levels & Model Reasoning Configuration**:
  - Support configuring custom thinking effort level sequences per model in `models.yml` (e.g. OpenAI 3 levels, Claude 6 levels, DeepSeek dual levels `low, high`, or arbitrary sequences).
  - Recommended presets in Model Manager modal for rapid configuration (OpenAI, Claude, DeepSeek) alongside default thinking level selection.
  - Model card chip indicators in Model Manager showing configured thinking effort counts and details.
  - Dynamic runtime thinking level cycling based on the current model's supported levels queried via `get_available_thinking_levels` RPC or `models.yml` configuration.
  - Automatic isolation and fallback: switching to non-reasoning models automatically resets thinking mode to `off` preventing cross-model pollution; unsupported models render the thinking pill disabled with descriptive tooltip.
  - Real-time synchronization with upstream `thinking_level_changed` backend RPC events.
  - Complete bilingual i18n support in English and Chinese across all model configuration controls and tooltips.

### Fixed

- **Instant Hot-Reload for Custom Model Thinking Levels**: Fixed an issue where editing a model's thinking effort sequence in Model Manager (e.g. from default to `low, medium, high`) did not take effect immediately and still cycled through stale levels (such as `xhigh`) until app restart. Thinking level cycling is now determined client-side based on the active model's configured efforts, with automatic sanitization of backend events and instantaneous model parameter synchronization upon saving.

## [0.3.2] - 2026-10-08

### Added

- **Manual Screenshot Annotation & Multi-Channel Export**:
  - Two-stage region capture workflow: drag to select an area, fine-tune with 8-direction resize handles or move the selection box, and annotate via a floating dark-mode glassmorphism toolbar.
  - Comprehensive annotation toolset:
    - Rectangle and circle/ellipse vector bounding boxes
    - Streamlined swallowtail arrow with inward notched wings, natural shaft termination, and adaptive head sizing for clean, distortion-free pointers
    - Smooth freehand pen / brush sketching
    - Mosaic privacy blurring with local pixel-averaging to mask sensitive credentials, tokens, or personal information
    - In-place text typing with color matching, multi-line support, and system font integration
    - Palette of 6 high-contrast preset colors and 3 stroke widths (thin, medium, thick)
    - Full undo/redo history stack with `Ctrl+Z` / `Ctrl+Y` keyboard shortcuts
  - Multi-channel export actions:
    - Send directly into the active conversation composer (Enter / Done button)
    - Copy annotated image directly to system clipboard (Ctrl+C / Copy button) with toast notification, keeping the overlay active for continued editing
    - Save to disk via native cross-platform file save dialog (Ctrl+S / Save button) with automatic window unpinning and parent attachment
  - Preserved Quick Bar behavior: auto-screenshot mode continues to capture full screen directly in the background without launching the annotation overlay.
  - Full bilingual i18n support in English and Chinese across all tools, shortcuts, and toast messages.


## [0.3.1] - 2026-09-30

### Added

- **omp 18.4+ Protocol Compatibility & Incremental Optimizations**:
  - Structured prompt error presentation: intercept and parse structured `error` payloads from `prompt_result` (provider, HTTP status, message, and `retryable` indicator) directly rendered in assistant bubbles
  - Background async work & settlement lifecycle: integrate `hasPendingAsyncWork` and `session_settled` events, showing background work activity in Agent Hub and smoothly transitioning to idle only when all async work settles
  - Full backward compatibility: built on progressive enhancement and safe fallbacks, ensuring 100% compatibility when running against older omp versions (such as 18.0.x)
  - Bilingual i18n support in English and Chinese for all new status indicators and error tags
  - Dual-compatibility test suite (`test/live-omp-compat.test.mjs`) verifying legacy and modern RPC behaviors
- **Distribution & Installation Improvements**:
  - Official macOS Homebrew Cask distribution via `raiderwang/tap/pidesk` with automated `postflight` quarantine bypass
  - Automated release workflow step (`update-cask`) in `release.yml` syncing SHA256 hashes and version bumps directly to `homebrew-tap`
  - Comprehensive macOS installation guides in English and Chinese documentation covering Homebrew and manual DMG Gatekeeper resolution

## [0.3.0] - 2026-09-29

### Added

- **Project Files & Folder Tree Explorer**:
  - Integrated collapsible files panel in the left sidebar with real-time directory tree visualization and syntax-aware icons
  - Interactive context menu: Open with Default App, Reveal in File Explorer / Finder, Copy Path (relative & absolute), and Delete
  - Keyboard and mouse productivity: double-click to open files in default applications, `Delete` key shortcut with confirmation dialog
  - Cross-platform backend file watcher (`notify`) automatically keeping file tree in sync with disk modifications
- **Agent Tool Execution & Thought Observability**:
  - Detailed Tool Log modal to inspect stdout/stderr stream outputs, command parameters, and execution timing
  - Assistant thinking/reasoning process container with collapsible view, elapsed time counter, and token usage badge
  - Polished ephemeral tool execution cards with concurrent tracking and automatic cleanup on turn end
- **Session Management & Peer Session Enhancements**:
  - Support branching new sessions directly from assistant messages
  - Resilient session resume with duplicate tab suppression and auto-focus

## [0.2.8] - 2026-09-25

### Added

- **Cross-platform tray click debounce and double-click handling**:
  - Implemented `TrayClickHandler` state machine with unified single/double click debounce across platforms
  - Reliably distinguishes single clicks (toggle Quick Bar) from double clicks (focus main window), handling native Windows double-click event ordering and suppressing trailing clicks
- **Agent diagnostics & auto-recovery**:
  - Process exit inspection: capture and surface agent process exit reasons (including stderr lines or non-zero exit statuses) with clear diagnostic messaging and bilingual localization
  - Startup failure advice: detect missing model configuration errors and display actionable hints guiding the user to configure models
  - Auto-restart after model configuration: automatically start/restart the active session after saving custom models without needing to recreate the tab
  - Query `is_session_running` Tauri IPC command to verify agent process liveness

### Fixed

- **macOS region screenshot overlay**:
  - Position and size the overlay window explicitly using primary monitor physical bounds instead of `set_fullscreen`, avoiding macOS space animation glitches and window freeze issues
  - Safely restore focus to previous active window (main window or Quick Bar) if screen capture encounters an error
  - Prevent overlay hint bubble from flashing before background capture is drawn
- **Composer thinking level display**:
  - Provide fallback to "off" when thinking level is unset or falsy

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
