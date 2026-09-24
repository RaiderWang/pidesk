# PiDesk Technical Manual

This document holds technical details trimmed from the [README](README.md) for developers, power users, and contributors.

---

## Table of Contents

1. [Model Management (Detailed)](#model-management-detailed)
2. [Architecture Overview](#architecture-overview)
3. [Tauri IPC Commands](#tauri-ipc-commands)
4. [RPC Protocol](#rpc-protocol)
5. [Frontend State Flow](#frontend-state-flow)
6. [Key Design Decisions](#key-design-decisions)
7. [Development Notes](#development-notes)

---

## Model Management (Detailed)

PiDesk model management has two tiers: **OAuth login models** (managed by `omp` internal auth) and **custom models** (stored in `~/.omp/agent/models.yml`).

### 1. OAuth Login Models (`omp login <provider>`)

When you log in to providers such as **Cursor**, **Anthropic**, **OpenAI Codex**, or **GitHub Copilot** using `omp login <provider>` in your terminal:

- **Credential storage**: Session credentials and refresh tokens are stored securely in SQLite at `~/.omp/agent/agent.db`.
- **Model catalogue**: The agent exposes its full catalogue of models (e.g. 100+ Cursor models, Claude 3.5/3.7 Sonnet, GPT-4o) dynamically through RPC.
- **Where to access**: All authenticated OAuth models appear directly in PiDesk’s **Switch Model** picker (click the model name in the bottom status bar, or press `Ctrl+K` / `⌘K` and select *switch model*).
- **Why they are not in `models.yml`**: OAuth models are managed by `omp`’s internal auth storage and are **not** written to `models.yml`. This keeps your custom configuration file clean and avoids upstream version drift.

### 2. Custom Models (`models.yml` / `Ctrl+M`)

PiDesk’s visual **Model Manager** (`Ctrl+M`, `/models`, or click **manage** in the model picker) is fully generic and supports **any third-party compatible model**:

- **Config path**: Reads and writes `~/.omp/agent/models.yml` (automatically backed up to `models.yml.bak` on save).
- **Dual editing**: Structured visual form view and direct raw YAML editing with syntax validation.
- **Protocols supported**: Compatible with `openai-completions` (OpenAI format), `anthropic-messages`, and `gemini` endpoints.
- **Preserved schema**: Preserves complex nested structures such as `compat`, `headers`, and `modelOverrides`.

**Example model sources:**

| Type | Examples |
|------|----------|
| Commercial APIs | DeepSeek, OpenRouter, SiliconFlow, Groq, Together |
| Self-hosted runtimes | Ollama, vLLM, LM Studio, LocalAI |
| Custom reverse proxies | Any local or remote compatible gateway |

### 3. Authentication Modes & Credential Precedence

When configuring a provider in the Model Manager, choose the appropriate **Auth Mode**:

| Auth Mode | Use Case | Key Behavior |
|-----------|----------|--------------|
| **`apiKey` (Standard)** | Commercial APIs, gateways & authenticated proxies (e.g. DeepSeek, OpenRouter) | Sends `Authorization: Bearer <key>`. Required for standard API keys. |
| **`oauth` (Login Credentials)** | Extending an OAuth provider | Reuses tokens from `~/.omp/agent/agent.db`. Suppresses `apiKey` so your login token is preserved. |
| **`none` (Keyless)** | Keyless local runtimes or open endpoints (e.g. local Ollama, vLLM, local proxies) | No authentication headers sent. |

> [!WARNING]
> **Credential shadowing precedence in `omp`**:  
> In `omp`, an explicit `apiKey` in `models.yml` takes precedence over stored OAuth tokens in `agent.db`. If you configure an OAuth provider (like `cursor` or `anthropic`) with an API key, it will shadow and override your OAuth login session. To use your login credentials, always select **`OAuth`** mode.

### 4. Base URL Configuration

- **OAuth providers (e.g. `cursor`)**: Leave **API Base URL blank** to automatically use the official endpoint (e.g. `https://api2.cursor.sh` for Cursor). Only specify a custom `baseUrl` if you are routing traffic through a dedicated local HTTP/2 proxy.
- **Third-party & compatible providers**: Specify the endpoint URL for any compatible provider or reverse proxy, for example:
  - Commercial / aggregator APIs: `https://api.deepseek.com/v1`, `https://openrouter.ai/api/v1`
  - Self-hosted / local runtimes: `http://localhost:11434/v1` (Ollama), `http://localhost:8000/v1` (vLLM)
  - Custom reverse proxies / gateways: `http://localhost:20128/v1`

### 5. Runtime Model Reloading

`omp` agent sessions load and cache model configurations upon startup:

- Newly added or modified models in `models.yml` take effect when opening a **new tab** or restarting the session.
- If an active session cannot switch to a newly added model, PiDesk provides in-chat guidance prompting you to open a new tab.

---

## Architecture Overview

Three layers:

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
│    kill   on drop / stop_session / hot-reload       │
└────────────────────────┬────────────────────────────┘
                         │  stdin / stdout pipes
┌────────────────────────▼────────────────────────────┐
│  omp  (oh-my-pi coding agent)                       │
│    JSON-line RPC protocol                           │
│    streams AgentSessionEvents to stdout             │
└─────────────────────────────────────────────────────┘
```

**Layer responsibilities:**

- **Rust (`src-tauri/src/`)** — `agent/` module: `mod.rs` (`AgentBridge` public API), `inner.rs` (`BridgeInner` per-session state), `spawn.rs` (candidate resolution + Win `CREATE_NO_WINDOW`), `reader.rs` (stdout/stderr threads + bounded `read_until_capped`, 16 MiB cap).
- **Bridge (`src/live.js`)** — Listens to `agent://line/{id}` for the active session; holds per-session live state and `sessionRegistry` (tabs). Exposes `window.OMP_BRIDGE` (commands + `onUpdate`) and legacy `window.OMP_DATA`.
- **React (`src/app-live.jsx` + `src/app/` + `src/design/*/`)** — Sole React root. Uses `useBridgeSnapshot` to mirror `OMP_BRIDGE.onUpdate` into hooks.

---

## Tauri IPC Commands

The frontend calls these Rust commands via `invoke()`:

| Command | Signature | Description |
|---------|-----------|-------------|
| `start_session` | `(sessionId: String, cwd: String) → Result<()>` | Spawn omp for a new tab session (`cwd: ""` = omp default) |
| `stop_session` | `(sessionId: String) → ()` | Kill that tab’s omp process and reap it off-thread |
| `send_command` | `(sessionId: String, json: String) → Result<()>` | Write a JSON line to that session’s omp stdin |
| `session_status` | `(sessionId: String) → Option<String>` | Returns cached startup error if the last `start_session` failed |
| `open_project` | `() → Result<Option<String>>` | Native folder picker dialog |

---

## RPC Protocol

The frontend communicates with `omp` exclusively through the Tauri IPC bridge. `live.js` sends JSON commands via `invoke("send_command", { sessionId, json })`; the Rust stdout reader emits `agent://line` events.

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

## Key Design Decisions

### `omp --mode rpc` not `omp --rpc`

`--rpc` is not a valid flag; `omp` falls through to interactive TUI mode and outputs ANSI escape codes instead of JSON, which breaks frontend parsing entirely. Confirmed from source — the launch command must be `omp --mode rpc`.

### Blank line = skip, not EOF

The Rust stdout reader originally used `_ => break` for both empty lines and IO errors; one blank line from `omp` killed the reader thread silently.  
Fix: `Ok("") => continue`, `Err(_) => break`. Do not revert to `reader.lines()` with a blanket `_ => break`.

### `AgentBridge` kills child on drop

Stores `Child` alongside stdin. `drop`, `stop_inner`, and the beginning of `start` all call `child.kill() + child.wait()` so hot-reloads and tab closes leave no orphaned `omp` processes.

### Event delegation for window controls

`WindowChrome` is painted by React after `DOMContentLoaded`. `querySelector` at that point finds nothing. All window control clicks are caught by a single delegated listener on `document`.

### `set_model` response must be handled

Without it, `state.model` stays stale. The next `turn_start` calls `notify()` which pushes the old model back to React, reverting the display mid-turn. The response is handled and calls `notify()` immediately.

### Model list above commands in ⌘K bridge

With 8 command rows, the model section was below `max-height: 60vh` and invisible without scrolling. Models now render first.

### Client-side thinking-level cycle

omp 18.x `get_state` does not include `thinkingLevel`; `cycle_thinking_level` returns null. PiDesk cycles client-side through `off → low → medium → high` and pushes the choice to omp via `set_thinking_level`. **Never use `"auto"`** — it is not a valid RPC level; omp silently ignores it.

### Compact response token backfill

The omp compact response contains `tokensBefore` (may be 0 in some versions) but **not** `tokensAfter`. PiDesk snapshots pre-compact tokens from `contextUsage` at send time, then back-fills `tokensAfter` from the next `get_state` via `_compactBackfillId` in `live.js`.

### Single instance lifecycle

PiDesk enforces single-instance execution via `tauri-plugin-single-instance`. When a secondary process is launched, it detects the running primary instance, notifies it, and terminates immediately. The primary instance's callback locates the `"main"` window, unminimizes it if minimized, makes it visible if hidden, and brings it to the foreground (`set_focus()`).

---

## Development Notes

### Debugging the RPC protocol

**`test-rpc.mjs`** — Standalone Bun/Node script that spawns `omp --mode rpc` directly and exercises the protocol without the full UI.

```bash
node test-rpc.mjs
```

### Frontend load order

Script order in `src/index.html` **is** the dependency graph — Babel has no module resolver:

1. Vendored libs: React, ReactDOM, Babel, `marked.min.js`, `highlight.min.js`
2. Tweaks: `tweaks/style.js`, `tweaks/use-tweaks.js` → `tweaks/panel.jsx`, `tweaks/controls.jsx`
3. UI primitives: `ui/icons.jsx` → `ui/sparks.jsx` → `ui/markdown.jsx` → `ui/plan-annotations.jsx`
4. Chat: `chat/user-bubble.jsx` → `chat/eval-cell.jsx` → `chat/assistant-bubble.jsx` → `chat/tool-card.jsx` → `chat/chat-view.jsx`
5. `design/composer.jsx`, `design/chrome.jsx`, `design/panels.jsx`
6. Live data: `model-names.js` → `adapter.js` → `live.js`
7. App helpers: `app/constants.js` → `app/use-bridge-snapshot.jsx`
8. `app-live.jsx` (last)

When adding a file, insert it at the correct point — wrong order does not fail at build time; it causes runtime reference errors.

### IIFE rule

Plain `<script>` tags share document top-level scope. Every plain script declaring top-level `const` / `function` / `class` **must** be wrapped in an IIFE and exported via `window.X`:

```js
(function () {
  const FOO = 42;
  window.FOO = FOO;
})();
```

Babel-transformed files (`type="text/babel"`) do not need wrapping.

### Design prototype vs `src/design/`

`src/design/` is the live, bridge-wired copy committed to the repo. Root-level `design/` is a read-only prototype reference excluded by `.gitignore`. **Do not** regenerate `src/design/` from `design/` — that overwrites bridge wiring.

### Platform notes

- **WebView2 version**: Uses `color-mix(in oklab, …)` — requires WebView2 ≥ 101 (Windows 11 default).
- **Frameless window**: `decorations: false` relies on DWM for corner rounding.
- **Strict CSP**: `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; …`. Asset protocol disabled; do not add CDN tags or use `convertFileSrc()` without revisiting CSP.

### Rust development

```bash
# Format
cd src-tauri && cargo fmt

# Lint (must stay clean)
cd src-tauri && cargo +nightly clippy --all-targets --all-features -- -W clippy::pedantic -W clippy::nursery -D warnings

# Tests
cd src-tauri && cargo test
```

Module-level `#![allow(clippy::needless_pass_by_value)]` in `lib.rs` is intentional — Tauri `#[command]` requires owned types.
