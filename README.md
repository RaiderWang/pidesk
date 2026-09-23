# PiDesk — oh-my-pi Desktop GUI

**The native desktop client for [oh-my-pi](https://github.com/can1357/oh-my-pi) (`omp`)**

**Languages:** [English](README.md) · [简体中文](README.zh-CN.md)

PiDesk is a fast, lightweight **omp desktop** app that wraps the `omp` (oh-my-pi) coding agent in a polished native GUI — no Electron, no browser, just a ~8 MB [Tauri 2](https://tauri.app/) binary with a real-time React interface.

> **Note**: PiDesk is an independent project evolved from [apoc/omp-desktop](https://github.com/apoc/omp-desktop).

---

## Why PiDesk?

| | |
|---|---|
| 🖥️ **Native feel** | Frameless window, custom title bar, system tray — no browser chrome |
| 🪶 **Tiny footprint** | ~8 MB binary (Tauri + Rust backend, zero Electron overhead) |
| 📡 **Offline ready** | No CDN dependencies, no external services required |
| 🗂️ **Multi-tab sessions** | Each tab is an isolated `omp` process with full state preservation |
| ⚡ **Quick Bar** | Global hotkey overlay — ask the AI agent without leaving your workflow |
| 🎨 **Customisable UI** | Themes, density, font size, accent colours — all adjustable at runtime |

![Chat](screenshots/1.jpg)
![Tools](screenshots/2.jpg)
![Minimap](screenshots/3.jpg)

---

## Features

### Chat & Sessions

- **Per-tab session isolation** — each tab owns its own `omp --mode rpc` process
- **Full session snapshots** — switch tabs freely; in-flight streams are preserved
- `/new` command starts a fresh session (history kept on disk)
- **Conversation history** (`Ctrl+H` / `⌘H` / `/history`) — browse, search, and resume past sessions in new tabs
- **Model picker** — cycle or select directly from the status bar; supports 100+ models via OAuth login
- **Thinking-level control** — cycle `off / minimal / low / medium / high / xhigh` per model
- Streaming token display with tokens/sec sparkline and context-window gauge

### Model Management

PiDesk includes a visual **Model Manager** (`Ctrl+M` / `/models`) that unifies OAuth-authenticated providers with any custom model:

- **OAuth login models** (Cursor, Anthropic, OpenAI Codex, GitHub Copilot) — authenticate once with `omp login <provider>`, then all available models appear in the picker automatically
- **Custom models** — add any OpenAI-compatible, Anthropic, or Gemini endpoint: commercial APIs (DeepSeek, OpenRouter, SiliconFlow, Groq), self-hosted runtimes (Ollama, vLLM, LM Studio), or your own reverse proxy
- **Dual editing** — structured visual form *or* raw YAML with syntax validation
- **Auth modes**: `apiKey` (standard), `oauth` (reuse login credentials), `none` (keyless local endpoints)

> **Tip**: Leave API Base URL blank for OAuth providers (e.g. Cursor) — PiDesk uses the correct official endpoint automatically.

### Plan Mode

Activates a *draft-before-write* workflow entirely inside the chat window:

- First message is wrapped in an intent framing prompt; subsequent messages steer the plan
- **Inline annotations** — click any paragraph to leave a comment before approving
- **Approve** sends all annotations as a single feedback prompt and opens the task kanban
- Kanban auto-populates from the agent's `todo_write` tool calls (running / done)

### Tool Cards

- Live streaming output for `eval` (JS/Python kernel) and `bash` tool calls
- Syntax-highlighted code blocks (highlight.js, atom-one-dark) once a cell completes
- **Scrubbable diff viewer** for `edit` calls with animated line reveal
- Search preview, read summary, task board for the respective tools
- Distinct icon + colour per tool type: read, search, edit, bash, eval, task, debug, ask

### Minimap

- Dense cell grid (one cell per message) — fits 200+ messages at a glance
- **Token heatmap** — assistant cell brightness log-scaled by tokens used
- Hover a cell → corresponding chat bubble highlights with an accent ring
- Click a cell → chat scrolls smoothly to that message
- Tooltip shows role, token count (in/out), tool name, duration, or message preview

### Agent Hub *(right-rail ambient card)*

Three auto-switching display modes driven by live session state:

- **Compact** (default): heartbeat indicator, current phase label, running tools with elapsed timers, rolling trail of the last 8 completed actions, mini colour-coded tool-distribution bar
- **Tree**: activates automatically when a `task` (subagent fan-out) tool starts — live worker nodes with status, token count, duration, task description, and expandable log stream per worker
- **Summary**: shown on task completion with per-worker result rows and totals; auto-collapses back to Compact after 5 s

### Quick Bar & System Tray

- **Global hotkey** `Ctrl+Shift+Space` (Windows/Linux) or `⌘⇧Space` (macOS) — press again to hide
- Spotlight-style floating input overlay; AI replies stream in-place without opening the main window
- **Enter** — send to the active tab session (ask follow-up questions without reopening)
- **Shift+Enter** — create a new tab session and send there
- **Ctrl+Enter** / **⌘Enter** — show the full PiDesk window and hide the Quick Bar
- **Esc** — hide the Quick Bar (aborts an in-progress turn while streaming)
- System tray: single-click toggles Quick Bar; double-click opens the main window; right-click menu has **Show PiDesk**, **Quick Bar**, **Quit**
- Closing the main window **hides** it (tray and Quick Bar keep working); exit fully via tray **Quit**

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

## UI Customisation (Tweaks)

Open the Tweaks panel (cog icon in the bottom-right status bar) to adjust:

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

## For Developers

- **`test-rpc.mjs`** — Standalone Node/Bun script that exercises the `omp --mode rpc` protocol without the full UI
- **Stack**: Tauri 2 (Rust) + React 18 (in-browser Babel, no bundler) + `omp --mode rpc` child process per tab
- **Strict CSP**; asset protocol disabled; no shell plugin surface; no CDN dependencies
- See [manual.md](manual.md) for architecture, RPC protocol, Tauri commands, frontend state flow, and design decisions
- See [CLAUDE.md](CLAUDE.md) for module layout and contribution guidelines

---

## License & Attribution

PiDesk is open source under the [MIT License](LICENSE).  
Original work Copyright (c) 2026 Miroslav Drbal ([apoc/omp-desktop](https://github.com/apoc/omp-desktop)).  
Modifications and enhancements Copyright (c) 2026 Rick Wang.
