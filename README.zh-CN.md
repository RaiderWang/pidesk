# PiDesk — oh-my-pi 桌面 GUI

**[oh-my-pi](https://github.com/can1357/oh-my-pi)（`omp`）的原生桌面客户端**

**语言：** [English](README.md) · [简体中文](README.zh-CN.md)

PiDesk 是一款为 `omp`（oh-my-pi）编码智能体打造的快速、轻量**桌面 GUI**——无需 Electron，无需浏览器，基于 [Tauri 2](https://tauri.app/) 构建，二进制仅约 8 MB，搭配实时 React 界面。

> **说明**：PiDesk 是从 [apoc/omp-desktop](https://github.com/apoc/omp-desktop) 演进而来的独立项目。

---

## 为什么选择 PiDesk？

| | |
|---|---|
| 🖥️ **原生体验** | 无边框窗口、自定义标题栏、系统托盘——没有浏览器 chrome |
| 🪶 **极小体积** | 约 8 MB 二进制（Tauri + Rust 后端，零 Electron 开销） |
| 📡 **离线可用** | 无 CDN 依赖，无需外部服务 |
| 🗂️ **多标签会话** | 每个标签页是独立的 `omp` 进程，状态完整保留 |
| ⚡ **Quick Bar** | 全局快捷键悬浮输入框——无需离开当前工作流即可向 AI 提问 |
| 🎨 **高度可定制** | 主题、密度、字号、强调色——均可在运行时调整 |

![Chat](screenshots/1.jpg)
![Tools](screenshots/2.jpg)
![Minimap](screenshots/3.jpg)

---

## 功能介绍

### 聊天与会话

- **按标签页隔离会话** — 每个标签页拥有独立的 `omp --mode rpc` 进程
- **完整会话快照** — 自由切换标签页，进行中的流式输出完整保留
- `/new` 命令开启新会话（历史仍保存在磁盘上）
- **对话历史面板**（`Ctrl+H` / `⌘H` / `/history`）— 浏览、搜索并在新标签页中恢复历史会话
- **模型选择器** — 在状态栏循环切换或直接选择；通过 OAuth 登录可访问 100+ 模型
- **思考级别控制** — 按模型循环切换 `off / minimal / low / medium / high / xhigh`
- 流式 token 展示，含 tokens/s 火花线与上下文窗口仪表

### 模型管理

PiDesk 内置可视化**模型管理器**（`Ctrl+M` / `/models`），统一管理 OAuth 认证提供商与任意自定义模型：

- **OAuth 登录模型**（Cursor、Anthropic、OpenAI Codex、GitHub Copilot）— 在终端执行 `omp login <provider>` 一次性认证，全部可用模型自动出现在选择器中
- **自定义模型** — 添加任意 OpenAI 兼容、Anthropic 或 Gemini 端点：商业 API（DeepSeek、OpenRouter、SiliconFlow、Groq）、自托管运行时（Ollama、vLLM、LM Studio）或你自己的反向代理
- **双模式编辑** — 结构化可视化表单 *或* 带语法校验的原始 YAML 编辑
- **认证模式**：`apiKey`（标准）、`oauth`（复用登录凭证）、`none`（本地无密钥端点）

> **提示**：OAuth 提供商（如 Cursor）的 API Base URL 留空即可——PiDesk 会自动使用正确的官方端点。

### 计划模式

在聊天窗口内启用「**先起草再写入**」工作流：

- 首条消息包裹在意图 framing 提示中；后续消息引导计划走向
- **行内批注** — 批准前点击任意段落留言
- **批准** 将所有批注合并为一条反馈提示并打开任务看板
- 看板根据智能体的 `todo_write` 工具调用自动填充（进行中 / 已完成）

### 工具卡片

- `eval`（JS/Python 内核）与 `bash` 工具调用的**实时流式输出**
- 单元格完成后语法高亮代码块（highlight.js，atom-one-dark）
- `edit` 调用的**可 scrub 统一 diff 查看器**，带动画行揭示
- 对应工具的搜索预览、读取摘要、任务看板
- 每种工具类型独立图标与配色：read、search、edit、bash、eval、task、debug、ask

### 小地图

- 密集单元格网格（每条消息一格）——一屏容纳 200+ 条消息
- **Token 热力图** — 助手单元格亮度按所用 token 对数缩放
- 悬停单元格 → 对应聊天气泡高亮并显示 accent 环
- 点击单元格 → 聊天区平滑滚动到该消息
- 工具提示显示角色、token 数（入/出）、工具名、耗时或消息预览

### Agent Hub *（右侧环境导轨卡片）*

三种模式随实时会话状态自动切换：

- **Compact（紧凑，默认）**：心跳指示器、当前阶段标签、运行中工具计时器、最近 8 条完成动作滚动追踪栏，以及按工具类型分色的迷你工具分布条
- **Tree（工作者树）**：`task`（子智能体扇出）工具启动时自动激活——展示每个 worker 的状态、token 数、耗时、任务描述及可展开的实时日志流
- **Summary（完成摘要）**：任务结束时显示每个 worker 的结果行与汇总；5 秒无交互后自动折叠回 Compact

### Quick Bar 与系统托盘

- **全局快捷键** `Ctrl+Shift+Space`（Windows/Linux）或 `⌘⇧Space`（macOS）— 再次按下隐藏
- Spotlight 风格悬浮输入条；AI 回复在条内流式显示，无需打开主窗口
- **Enter** — 发送到当前活跃标签页会话（可继续在 Quick Bar 里追问）
- **Shift+Enter** — 新建标签页会话并在那里发送
- **Ctrl+Enter** / **⌘Enter** — 显示完整 PiDesk 主窗口并隐藏 Quick Bar
- **Esc** — 隐藏 Quick Bar（若正在流式输出则中止当前回合）
- 系统托盘：左键**单击**切换 Quick Bar；左键**双击**打开主窗口；右键菜单 — **Show PiDesk**、**Quick Bar**、**Quit**
- 关闭主窗口时**仅隐藏**（托盘与 Quick Bar 仍可用）；完全退出请用托盘 **Quit**

---

## 环境要求

| 工具 | 版本 |
|------|------|
| [Rust](https://rustup.rs/) | stable（1.77+） |
| [Node.js](https://nodejs.org/) | 18+ |
| [Tauri CLI](https://tauri.app/start/prerequisites/) | 2.x（`npm install`） |
| [oh-my-pi](https://github.com/can1357/oh-my-pi) | 14.8+（`PATH` 中可用 `omp`） |

`omp` 必须在 `PATH` 中可用。Windows 上通常安装在 `%LOCALAPPDATA%\omp\omp.exe`，安装程序会将其加入 PATH。

---

## 快速开始

```bash
# 克隆
git clone https://github.com/RaiderWang/pidesk.git
cd pidesk

# 安装 Tauri CLI（仅开发依赖）
npm install

# 开发模式——前端热重载，后端变更时重建 Rust
npm run dev

# 生产构建
npm run build
```

调试构建下，开发模式会自动打开 WebView 开发者工具。

---

## UI 定制（Tweaks）

打开微调面板（右下角状态栏齿轮图标）可调整：

| 设置 | 选项 |
|------|------|
| 语言 | English · 简体中文（即时切换，本地持久化） |
| 主题 | aurora · phosphor · daylight |
| 密度 | cozy · compact · dense |
| 强调色 | 7 种预设 + 自定义 |
| 等宽聊天字体 | 开关 |
| 字号 | 75% – 150% 滑块 |
| 布局 | rail · split · focus |

---

## 开发者参考

- **`test-rpc.mjs`** — 独立 Node/Bun 脚本，无需完整 UI 即可演练 `omp --mode rpc` 协议
- **技术栈**：Tauri 2（Rust）+ React 18（浏览器内 Babel，无打包器）+ 每标签页一个 `omp --mode rpc` 子进程
- **严格 CSP**；禁用 asset 协议；无 shell 插件暴露面；无 CDN 依赖
- 架构细节、RPC 协议、Tauri 命令、前端状态流与设计决策详见 [manual.md](manual.md)（英文）
- 模块结构与贡献指南详见 [CLAUDE.md](CLAUDE.md)

---

## 许可与致谢

PiDesk 在 [MIT License](LICENSE) 下开源。  
原始作品 Copyright (c) 2026 Miroslav Drbal（[apoc/omp-desktop](https://github.com/apoc/omp-desktop)）。  
修改与增强 Copyright (c) 2026 Rick Wang。
