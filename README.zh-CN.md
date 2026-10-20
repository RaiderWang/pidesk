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

![PiDesk 工作区全景](screenshots/hero-workspace.png)

---

## 功能介绍

### 🖥️ 现代多面板工作区 (Modern Multi-Panel Workspace)
PiDesk 专为 AI 辅助编程打造了精致且沉浸的类 IDE 级工作区布局：
- **左侧 Activity Bar 导轨**：44px 独立窄导轨，一键切换文件树（`Ctrl+B` / `⌘B`）、规划任务（`Ctrl+J` / `⌘J`）、代码审查、概览信息、历史会话（`Ctrl+H` / `⌘H`）及模型管理器（`Ctrl+M` / `⌘M`）。
- **交互式项目文件树**：完整目录树视图，自动同步文件监视器变更，配备代码语法图标，并支持右键“引用该文件”快捷接入。
- **可折叠右侧 Dock 抽屉**：双标签支持实时会话「概览」（包含 Agent Hub 监控、同级子会话、Token 小地图）与激活中的「规划」看板。双击边缘可快速重置面板宽度。
- **最近项目快速直达**：标签栏 `+` 下拉菜单自动记录最近访问的 10 个项目仓库，单次点击即刻完成工作区无缝切转。
- **完全隔离的多标签会话**：每个标签页独立运行专享的 `omp --mode rpc` 后台进程，各会话状态与流式响应互不干扰且完整保留。

![PiDesk 工作区全貌](screenshots/hero-workspace.png)

---

### 💬 上下文感知对话与精准掌控 (Context-Aware Chat & Precision Control)
以空前的精确度与掌控感与编码智能体协作：
- **`@` 文件模糊补全与标签化引用**：在输入框任意位置键入 `@` 即可模糊检索项目文件，自动转换为轻量高效的 token 文件引用芯片（Chip）。
- **无损消息撤回 (Undo)**：手误输入或智能体偏离预期？点击任意用户气泡右下角的 **Undo** 按钮，通过原生 branch RPC 快速回滚执行状态，并将原始提示词完整退回输入框以便修改重试。
- **智能工具调用折叠**：连续 3 个及以上的工具调用自动聚合成精简摘要条，清晰呈现耗时、工具名称与状态统计，避免长篇刷屏。
- **分支会话 (Branch From Here)**：支持从助手（Assistant）回复气泡一键派生独立的新会话标签页，探索不同技术分支。
- **折叠式思考链容器**：为推理模型的思考过程提供专属折叠区域，展示实时流式耗时计时器与 token 指标。
- **Token 热力图小地图**：右侧高密度网格鸟瞰 200+ 轮历史对话，助手单元格亮度按所耗 token 对数渐变，支持悬停聚焦与点击平滑定位。

![上下文感知与消息撤回](screenshots/chat-context-undo.png)

---

### 🔍 交互式代码审查抽屉 (`/review`)
无需切换到独立的 Git GUI 客户端，即可在 PiDesk 内与智能体并肩审查代码：
- **全场景对比目标选择**：灵活检查未提交的工作区变更（Working Tree）、基准分支合并对比（PR 风格）或特定历史提交 Diff。
- **左右分栏与统一视图 (Split & Unified Views)**：一键在左右双栏对比与单栏统一视图间切换；支持右上角全屏扩展以获最大审查视野。
- **行级行内批注 (+)**：悬停点击任意代码行旁的 `+` 即可就地添加批注、修改建议或疑问备注。
- **一键反馈给智能体**：点击底部的「Send to Session」按钮，即可将所有行内批注与代码上下文结构化组装，作为精准指导指令发回会话。

![交互式代码审查抽屉](screenshots/code-review.png)

---

### 📋 规划模式与动态任务看板 (Plan Mode & Dynamic Kanban Board)
针对复杂工程任务严格践行「**先起草方案，再动工编写**」的高效工作流：
- **起草与迭代**：开启规划模式后，首条需求会自动包裹意图框架提示，引导智能体先输出整体架构与实施步骤，暂不修改本地文件。
- **段落级行内批注**：直接在智能体生成的方案段落上点击，即可添加针对具体步骤的修改建议。
- **一键批准执行**：确认方案无误后点击「Approve」，自动将所有批注合并递交智能体，无缝切入代码编写阶段。
- **实时任务看板联动**：智能体执行时通过 `todo_write` 动态拆解并推进任务，在 Backlog、进行中与已完成看板中实时更新状态。

![规划模式与任务看板](screenshots/plan-kanban.png)

---

### ⚡ 全局 Quick Bar 悬浮窗与系统托盘
不中断当前编码专注，随时随地就地求助 AI：
- **全局快捷键呼出 (`Ctrl+Shift+Space` / `⌘⇧Space`)**：Spotlight 风格悬浮卡片，带有优雅毛玻璃背景遮罩，随用随隐。
- **流式底端吸附 (Sticky-Bottom Streaming)**：AI 回复实时流式渲染并自动钉在可视底端；向上滚动浏览时智能暂停吸附。
- **免切屏屏幕感知截图**：点击相机按钮即可在提问时一并捕获当前屏幕画面，免去反复切屏截图的繁琐步骤。
- **灵活会话路由**：按 `Enter` 直接将问题发往当前活跃标签页会话（保持上下文连续追问）；按 `Shift+Enter` 快速开启独立临时会话。
- **原生 Markdown 复制**：右上角一键复制纯文本 Markdown，代码块与排版原汁原味。

![Quick Bar 悬浮窗](screenshots/quick-bar.png)

---

### ✂️ 屏幕截图与隐私打码标注套件
内置高 DPI 专业截屏工具，专为上报 Bug、框选局部代码与视觉提示而生：
- **两阶段精准微调选区**：按下 `Alt+S`（macOS `⌥S`）即可冻结屏幕；拖拽选区后周围生成 8 向拉伸控制手柄，支持自由位移与像素级缩放。
- **专业标注工具箱**：利落的燕尾倒钩箭头、矩形与椭圆线框、自由手绘笔刷、以及原位自适应多行文本输入。
- **马赛克打码遮盖 (Mosaic Redaction)**：可对 API Token、密码、个人敏感信息进行局部像素平均化虚化，杜绝隐私泄漏。
- **多渠道敏捷导出**：一键填入输入框（`Enter`）、快速复制到系统剪贴板（`Ctrl+C`）、保存为本地 PNG/JPG 文件（`Ctrl+S`）。

![屏幕截图与隐私标注](screenshots/screenshot-annotation.png)

---

### 🧠 模型管理器与动态思考深度调谐
全面发挥前沿推理大模型（Reasoning Models）的极致潜力：
- **OAuth 提供商一键纳管**：在终端通过 `omp login <provider>` 认证 Cursor、Anthropic、OpenAI Codex 或 GitHub Copilot，全部可用模型自动同步纳管。
- **自定义端点全覆盖**：无缝对接任意 OpenAI 兼容协议、Anthropic 或 Gemini 端点（DeepSeek、OpenRouter、SiliconFlow、Ollama、vLLM、LM Studio 等）。
- **动态思考深度调谐 (Configurable Thinking Effort)**：针对各模型自定义多档位思考深度序列（如 Claude 6 档思考、DeepSeek 双档、OpenAI 梯度序列），状态栏循环切换，配置即时热重载。

![模型管理器与思考档位调谐](screenshots/model-manager.png)

---

### 🎨 命令面板与现代美学体系
- **全局快捷命令面板 (`Ctrl+K` / `⌘K`)**：居中极速模糊搜索，覆盖斜杠命令（`/`）、历史会话（`#`）、项目文件（`@`）与快捷键手册（`?`）。
- **4 套定制主题**：深色模式（**Aurora 极光**、**Phosphor 荧光绿**）与浅色模式（**Daylight 日间**、全新冷灰风 **Clarity 澄澈白**）。
- **WCAG AA 高对比度配色**：内置 8 款对比度大于等于 4.5:1 的精选强调色，长久注视舒适护眼。

![命令面板与现代主题](screenshots/command-palette.png)

---

## 安装指南

### macOS

#### 方式一：Homebrew Cask（推荐）

通过 Homebrew 一键安装，会自动处理 Gatekeeper 隔离，无需额外命令即可直接打开：

```bash
brew install --cask raiderwang/tap/pidesk
```

后续升级：
```bash
brew upgrade --cask pidesk
```

#### 方式二：手动下载（.dmg）

1. 从 [GitHub Releases](https://github.com/RaiderWang/pidesk/releases) 下载最新的 `.dmg` 安装包（Apple Silicon 选 `aarch64`，Intel 芯片选 `x64`）。
2. 打开 DMG 磁盘镜像，将 **PiDesk.app** 拖动到 `/Applications`（应用程序）文件夹。
3. **如果 macOS 提示“PiDesk 已损坏，您应该将它移到废纸篓”**：  
   这是由于从网页下载的文件带有系统隔离标记（`com.apple.quarantine`），且未进行付费开发者证书签名所致。在终端中执行以下命令清除隔离属性即可正常打开：
   ```bash
   xattr -cr /Applications/PiDesk.app
   ```

### Windows

从 [GitHub Releases](https://github.com/RaiderWang/pidesk/releases) 下载 `.msi`（推荐）或 `.exe` 安装程序。  
*若首次启动时出现 Windows SmartScreen 弹窗拦截，点击 **“更多信息” → “仍要运行”** 即可。*

### Linux

从 [GitHub Releases](https://github.com/RaiderWang/pidesk/releases) 下载 `.AppImage` 或 `.deb` 安装包。

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

打开微调面板（左侧 Activity Bar 底部的齿轮图标或 `Ctrl+,` / `⌘,`）即可调整：

| 设置 | 选项 |
|------|------|
| 语言 | English · 简体中文（即时切换，本地持久化） |
| 主题 | aurora · phosphor · daylight · clarity |
| 密度 | cozy · compact · dense |
| 强调色 | 8 种预设 + 自定义 |
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
