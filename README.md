# PiDesk

**Languages:** [English](README.md) · [简体中文](README.zh-CN.md)

A fast, lightweight Tauri 2 desktop shell for [oh-my-pi](https://github.com/can1357/oh-my-pi) (`omp`).
Wraps the `omp --mode rpc` coding agent as a managed child process and serves the
React UI as a connected, live interface — no browser, no Electron, ~8 MB binary.

> **Note**: PiDesk is an independent project evolved from [apoc/omp-desktop](https://github.com/apoc/omp-desktop).

## Features

**Chat & sessions**
- Per-tab session isolation — each tab owns its own `omp --mode rpc` process
- Full session snapshots: switch tabs, state is preserved including in-flight streams
- `/new` command starts a fresh session (history kept on disk)
- Conversation history panel (`Ctrl+H` / `⌘H` / `/history`) to browse, search, and resume past sessions in new tabs
- Model picker with two-view command bridge; cycle or pick directly from the status bar
- Custom model manager (`Ctrl+M` / `/models`): Add, edit, or configure providers in `models.yml` with visual form and raw YAML views, supporting API key, OAuth credential reuse, and local keyless endpoints
- Thinking-level control: cycle through `off / minimal / low / medium / high / xhigh` (per-model — omp picks the supported subset)
- Streaming token display with tokens/sec sparkline and context-window gauge

**Plan mode**
- Activates a draft-before-write workflow entirely in the chat window
- First message is wrapped in an intent framing prompt; subsequent sends steer the plan
- Inline plan annotations: click any paragraph to leave a comment before approving
- Approve button sends all annotations as a single feedback prompt and opens the kanban
- Kanban panel auto-populates from the agent's `todo_write` tool calls (running / done)

**Tool cards**
- Live streaming output for `eval` (JS/Python kernel) and `bash` tool calls
- Syntax-highlighted code blocks (highlight.js, atom-one-dark) once a cell completes
- Scrubbable unified diff viewer for `edit` calls with animated line reveal
- Search preview, read summary, task board for the respective tools
- Distinct icon + color per tool type: read, search, edit, bash, eval, task, debug, ask

**Minimap**
- Dense cell grid (one cell per message) replacing the old bar stack — fits 200+ messages
- Token heatmap: assistant cells brightness log-scaled by tokens used
- Hover a cell → corresponding chat bubble highlights with an accent ring
- Click a cell → chat scrolls smoothly to that message
- Tooltip shows role, token count (in/out), tool name, duration, or message preview

**Agent Hub** *(ambient right-rail card)*
- Three auto-switching modes driven by live session state
  - **Compact** (default): heartbeat indicator, current phase label, running tools with ticking elapsed timers, rolling trail of the last 8 completed actions, and a mini colour-coded tool-distribution bar — replaces the old 60-cell radar
  - **Tree**: activates automatically when a `task` (subagent fan-out) tool starts — shows live worker nodes with status dot, token count, duration, task description, and an expandable log stream per worker
  - **Summary**: shown on task completion with per-worker result rows and totals; auto-collapses back to Compact after 5 s of no interaction
- Hub state (`hubMode`, `hubAgents`, `hubHistory`) is fully preserved in session snapshots so the view survives tab switches

**Native shell**
- Tauri 2, Rust backend, no Electron, no CDN dependencies
- Frameless window with custom traffic-light / drag region on Windows and macOS
- Native folder picker for opening projects
- Strict CSP; asset protocol disabled; no shell plugin surface

![Chat](screenshots/1.jpg)
![Tools](screenshots/2.jpg)
![Minimap](screenshots/3.jpg)

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Tauri WebView  (src/)                              │
│                                                     │
│  app-live.jsx ──► OMP_BRIDGE ──► live.js            │
│       │                │                            │
│  React state    RPC event handlers                  │
│  (messages,     (turn, message, tool,               │
│   model, ctx,    extension_ui, sparkline)           │
│   kanban…)             │                            │
│                  adapter.js (pure transforms)       │
└────────────────────────┬────────────────────────────┘
                         │  Tauri IPC (invoke / events)
┌────────────────────────▼────────────────────────────┐
│  Rust  (src-tauri/src/)                             │
│                                                     │
│  AgentBridge                                        │
│    spawn  omp --mode rpc                            │
│    stdin  ◄── send_command (JSON lines)             │
│    stdout ──► agent://line events (JSON lines)      │
│    kill   on drop / stop_session / hot-reload         │
└────────────────────────┬────────────────────────────┘
                         │  stdin / stdout pipes
┌────────────────────────▼────────────────────────────┐
│  omp  (oh-my-pi coding agent)                       │
│    JSON-line RPC protocol                           │
│    streams AgentSessionEvents to stdout             │
└─────────────────────────────────────────────────────┘
```

---

## Requirements

| Tool | Version |
|------|---------|
| [Rust](https://rustup.rs/) | stable (1.77+) |
| [Node.js](https://nodejs.org/) | 18+ |
| [Tauri CLI](https://tauri.app/start/prerequisites/) | 2.x (`npm install`) |
| [oh-my-pi](https://github.com/can1357/oh-my-pi) | 14.8+ (`omp` in PATH) |

`omp` must be reachable as `omp` on your `PATH`. On Windows it is typically
installed at `%LOCALAPPDATA%\omp\omp.exe` and added to PATH by the installer.

---

## Getting Started

```bash
# Clone
git clone https://github.com/RaiderWang/pidesk.git
cd pidesk

# Install Tauri CLI (dev dependency only)
npm install

# Dev mode — hot-reloads frontend, rebuilds Rust on backend changes
npm run dev

# Production build
npm run build
```

Dev mode auto-opens the WebView DevTools in debug builds.

---

## Model Management: OAuth & Custom Models

PiDesk provides a unified, two-tier model management system that integrates **built-in / OAuth login providers** with **user-defined custom models**.

### 1. Built-in & OAuth Login Models (`omp login <provider>`)

When you log in to providers such as **Cursor**, **Anthropic**, **OpenAI Codex**, or **GitHub Copilot** using `omp login <provider>` in your terminal:
- **Credential Storage**: Session credentials and refresh tokens are stored securely in SQLite at `~/.omp/agent/agent.db`.
- **Model Catalogue**: The agent exposes its full catalogue of models (e.g. 100+ Cursor models, Claude 3.5/3.7 Sonnet, GPT-4o) dynamically through RPC.
- **Where to Access**: All authenticated OAuth models appear directly in the **Switch Model** picker in PiDesk (click the model name in the bottom status bar, or press `Ctrl+K` / `⌘K` and select *switch model*).
- **Why they are not in `models.yml`**: OAuth models are managed by `omp`'s internal auth storage and are **not** written to `models.yml`. This keeps your custom configuration file clean and avoids upstream version drift.

### 2. Custom Models (`models.yml` / `Ctrl+M`)

PiDesk's visual **Model Manager** (`Ctrl+M`, `/models`, or click **manage** in the model picker) is fully generic and supports **any third-party compatible model** — including commercial API providers (DeepSeek, OpenRouter, SiliconFlow, Groq, Together), self-hosted runtimes (Ollama, vLLM, LM Studio, LocalAI), or custom reverse proxies:
- **Config Path**: Reads and writes `~/.omp/agent/models.yml` (automatically backed up to `models.yml.bak` on save).
- **Dual Editing**: Supports both a structured visual form view and direct raw YAML editing with syntax validation.
- **Protocols Supported**: Compatible with `openai-completions` (OpenAI format), `anthropic-messages`, and `gemini` endpoints.
- **Preserved Schema**: Preserves complex nested structures such as `compat`, `headers`, and `modelOverrides`.

### 3. Authentication Modes & Credential Precedence

When configuring a provider in the Model Manager, choose the appropriate **Auth Mode**:

| Auth Mode | Use Case | Key Behavior |
|-----------|----------|--------------|
| **`apiKey` (Standard)** | Commercial APIs, gateways & authenticated proxies (e.g. DeepSeek, OpenRouter) | Sends `Authorization: Bearer <key>`. Required for standard API keys. |
| **`oauth` (Login Credentials)** | Extending an OAuth provider | Reuses tokens from `~/.omp/agent/agent.db`. Suppresses `apiKey` so your login token is preserved. |
| **`none` (Keyless)** | Keyless local runtimes or open endpoints (e.g. local Ollama, vLLM, local proxies) | No authentication headers sent. |

> [!WARNING]
> **Credential Shadowing Precedence in `omp`**:  
> In `omp`, an explicit `apiKey` in `models.yml` takes precedence over stored OAuth tokens in `agent.db`. If you configure an OAuth provider (like `cursor` or `anthropic`) with an API key, it will shadow and override your OAuth login session. To use your login credentials, always select **`OAuth`** mode.

### 4. Base URL Configuration

- **OAuth Providers (e.g., `cursor`)**: Leave **API Base URL blank** to automatically use the official endpoint (e.g. `https://api2.cursor.sh` for Cursor). Only specify a custom `baseUrl` if you are routing traffic through a dedicated local HTTP/2 proxy.
- **Third-Party & Compatible Providers**: Specify the endpoint URL for any compatible provider or reverse proxy, for example:
  - Commercial / Aggregator APIs: `https://api.deepseek.com/v1`, `https://openrouter.ai/api/v1`
  - Self-hosted / Local runtimes: `http://localhost:11434/v1` (Ollama), `http://localhost:8000/v1` (vLLM)
  - Custom reverse proxies / Gateways: `http://localhost:20128/v1`

### 5. Runtime Model Reloading

`omp` agent sessions load and cache model configurations upon startup:
- Newly added or modified models in `models.yml` take effect when opening a **new tab** or restarting the session.
- If an active session cannot switch to a newly added model, PiDesk provides in-chat guidance prompting you to open a new tab.

---

## RPC Protocol

The frontend communicates with `omp` exclusively through the Tauri IPC bridge.
`live.js` sends JSON commands via `invoke("send_command", { sessionId, json })` and
`agent://line` events emitted by the Rust stdout reader.

### Commands sent (stdin → omp)

| Command | When |
|---------|------|
| `get_state` | On `ready`, after each `turn_end` |
| `get_messages` | On `ready` |
| `get_available_models` | On `ready` |
| `prompt` | User sends a message |
| `abort` | User clicks abort |
| `set_model` | User picks a model in ⌘K bridge |
| `cycle_model` | User clicks `/model` command |
| `cycle_thinking_level` | User cycles thinking in composer / `/thinking` |
| `compact` | User runs `/compact` |
| `export_html` | User runs `/export` |
| `get_session_stats` | After each `turn_end` |
| `extension_ui_response` | Auto-cancel for interactive UI requests |

### Events received (stdout → frontend)

| Event | Handler |
|-------|---------|
| `ready` | Bootstraps initial data fetches |
| `turn_start` / `turn_end` | Streaming state, TPS calculation, cost accumulation |
| `message_start` | Creates user/assistant bubbles; stamps model name |
| `message_update` | Updates streaming bubble from accumulated content |
| `message_end` | Finalises bubble (`streaming: false`) |
| `tool_execution_start` | Creates running tool card |
| `tool_execution_end` | Finalises tool card with result/diff/output |
| `extension_ui_request` | Interactive types auto-cancelled; others ignored |
| `agent_start` / `agent_end` | Re-fetches session state |

---

## Key Design Decisions

**`omp --mode rpc` not `omp --rpc`** — `--rpc` is not a valid flag; omp falls through to
interactive TUI mode and outputs ANSI escape codes instead of JSON. Confirmed from source.

**Blank line = skip, not EOF** — The Rust stdout reader originally used `_ => break` for
both empty lines and IO errors; one blank line from omp killed the reader thread silently.
Now `Ok("") => continue`, `Err(_) => break`.

**`AgentBridge` kills child on drop** — Stores `Child` alongside stdin. `drop`, `stop_inner`,
and the beginning of `start` all call `child.kill() + child.wait()` so hot-reloads and
tab closes leave no orphaned `omp` processes.

**Event delegation for window controls** — `WindowChrome` is painted by React after
`DOMContentLoaded`. `querySelector` at that point finds nothing. All window control
clicks are caught by a single delegated listener on `document`.

**`set_model` response must be handled** — Without it, `state.model` stays stale. The next
`turn_start` calls `notify()` which pushes the old model back to React, reverting the
display mid-turn. The response is now handled and calls `notify()` immediately.

**Model list above commands in ⌘K bridge** — With 8 command rows, the model section was
below `max-height: 60vh` and invisible without scrolling. Models now render first.

---

## Tauri Commands

| Command | Signature | Description |
|---------|-----------|-------------|
| `start_session`   | `(sessionId: String, cwd: String) → Result<()>` | Spawn omp for a new tab session (`cwd: ""` = omp default) |
| `stop_session`    | `(sessionId: String) → ()`                       | Kill that tab's omp process and reap it off-thread |
| `send_command`    | `(sessionId: String, json: String) → Result<()>`| Write a JSON line to that session's omp stdin |
| `session_status`  | `(sessionId: String) → Option<String>`           | Returns cached startup error if the last `start_session` failed |
| `open_project`    | `() → Result<Option<String>>`                   | Native folder picker dialog |

---

## Frontend State Flow

```
omp stdout
  └─► agent://line Tauri event
        └─► handleLine(rawLine)
              ├─► _handleResponse(resp)   — RPC responses
              │     ├── get_state         → _applyRpcState() → notify()
              │     ├── get_available_models → state.models → notify()
              │     ├── set_model         → state.model + current flags → notify()
              │     └── cycle_model       → state.model + thinkingLevel → notify()
              └─► _handleEvent(ev)        — AgentSessionEvents
                    ├── turn_start/end    → isStreaming, TPS, cost
                    ├── message_*         → streamingBubble lifecycle
                    ├── tool_execution_*  → tool cards
                    └── extension_ui_request → auto-cancel interactive

notify()
  ├─► subscribers (OMP_BRIDGE.onUpdate callbacks)
  │     └─► React setState calls in app-live.jsx
  └─► window.OMP_DATA sync (for components reading globals directly)
```

---

## Tweaks

Open the Tweaks panel (via the cog icon in the bottom-right status bar) to adjust:

| Setting | Options |
|---------|---------|
| Language | English · 简体中文 (instant live switch, persisted locally) |
| Theme | aurora · phosphor · daylight |
| Density | cozy · compact · dense |
| Accent colour | 7 presets + custom |
| Mono chat font | toggle |
| Font size | 75% – 150% slider |
| Layout | rail · split · focus |

---

## Development Notes

**`test-rpc.mjs`** — Standalone Bun/Node script that spawns `omp --mode rpc` directly
and exercises the protocol. Useful for verifying RPC behaviour without the full UI.

**No CDN dependencies** — React 18, ReactDOM, and Babel standalone are bundled locally
under `src/`. The app works fully offline.

**`src/design/`** — Modified copy of the original `design/` prototype. The original
`design/` directory is excluded from the repo (`.gitignore`); `src/design/` is committed
and is the authoritative source. Do not regenerate from `design/` — that would overwrite
the live-wiring changes.

**Windows 11 target** — Uses `color-mix(in oklab, …)` which requires WebView2 ≥ 101
(Windows 11 default). The frameless window (`decorations: false`) relies on DWM for
corner rounding.

---

## License & Attribution

PiDesk is open source under the [MIT License](LICENSE).  
Original work Copyright (c) 2026 Miroslav Drbal ([apoc/omp-desktop](https://github.com/apoc/omp-desktop)).  
Modifications and enhancements Copyright (c) 2026 Rick Wang.
