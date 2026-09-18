// src/i18n.js — Internationalization (i18n) dictionary and reactive utilities.
// Supports English ('en') and Simplified Chinese ('zh-CN').

(function () {
  const STORAGE_KEY = "pidesk:tweaks";
  const LEGACY_STORAGE_KEY = "omp-desktop:tweaks";

  const DICTIONARY = {
    "en": {
      // Tweaks panel
      "tweaks.title": "Tweaks",
      "tweaks.section.general": "General",
      "tweaks.language": "Language",
      "tweaks.section.look": "Look",
      "tweaks.theme": "theme",
      "tweaks.theme.aurora": "aurora",
      "tweaks.theme.phosphor": "phosphor",
      "tweaks.theme.daylight": "daylight",
      "tweaks.density": "density",
      "tweaks.density.cozy": "cozy",
      "tweaks.density.compact": "compact",
      "tweaks.density.dense": "dense",
      "tweaks.accent": "accent",
      "tweaks.monoChat": "mono chat font",
      "tweaks.fontSize": "font size",
      "tweaks.section.layout": "Layout",
      "tweaks.layout": "layout",
      "tweaks.layout.rail": "rail",
      "tweaks.layout.split": "split",
      "tweaks.layout.focus": "focus",
      "tweaks.close": "Close tweaks",

      // Chrome & Tabs
      "chrome.bridge": "bridge",
      "chrome.tabs.new": "New session / Open project",
      "chrome.tabs.openFolder": "Open Project Folder...",
      "chrome.tabs.newSession": "New Session (No Project)",
      "chrome.tabs.history": "conversation history (Ctrl+H)",
      "chrome.tabs.models": "manage models (Ctrl+M)",
      "chrome.status.connected": "connected",
      "chrome.status.disconnected": "disconnected",
      "chrome.status.thinking": "thinking",
      "chrome.status.thinking.off": "off",
      "chrome.status.thinking.minimal": "min",
      "chrome.status.thinking.low": "low",
      "chrome.status.thinking.medium": "med",
      "chrome.status.thinking.high": "high",
      "chrome.status.thinking.xhigh": "max",
      "chrome.status.cost": "cost",
      "chrome.status.todo": "todo",
      "chrome.status.autosave": "autosave",
      "chrome.status.autosaveOn": "on",
      "chrome.status.autosaveOff": "off",
      "chrome.status.toggleAutosave": "toggle autosave",
      "chrome.status.tweaks": "Appearance & layout tweaks",
      "chrome.rail.ambient": "ambient",
      "chrome.rail.hide": "hide rail",
      "chrome.rail.throughput": "throughput",
      "chrome.rail.radar": "agent radar",
      "chrome.rail.last60s": "last 60s",
      "chrome.rail.peer": "peer session",
      "chrome.rail.peerLive": "live",
      "chrome.rail.peerPinned": "pinned",
      "chrome.rail.peerEmpty": "Open a second tab to monitor it here.",
      "chrome.rail.peerHint": "Pin a session to monitor here",
      "chrome.rail.unpin": "unpin peer",
      "chrome.rail.focus": "focus →",
      "split.waiting": "waiting for tool activity…",
      "split.idle": "session idle",
      "split.running": "running…",
      "chrome.rail.you": "you",
      "chrome.rail.tool": "tool",
      "chrome.rail.assistant": "assistant",

      // Composer
      "composer.placeholder.default": "what should we ship?  ·  / for commands  ·  ⌘K for the bridge",
      "composer.placeholder.plan": "describe what to build, or give feedback on the plan…",
      "composer.placeholder.streaming": "Press ⎋ to interrupt — your cursor is in the room.",
      "composer.placeholder.empty": "Hand me a project. I'll set the table.",
      "composer.steer": "steer",
      "composer.abort": "abort",
      "composer.approve": "approve",
      "composer.send": "send",
      "composer.sendFeedback": "send feedback",
      "composer.comments": "{count} comments",
      "composer.comment": "1 comment",
      "composer.planMode": "plan mode",
      "composer.thinking": "thinking · {level}",
      "composer.attach": "attach image (paste screenshot or drag & drop)",
      "composer.unsupportedVision": 'Current model "{model}" does not support images (click to switch)',
      "composer.dictate": "dictate",
      "composer.bridgeKbd": "open command bridge (⌘K)",
      "composer.hints.normal": "↵ send · ⇧↵ newline · ⎋ abort",
      "composer.hints.steer": "↵ steer · ⎋ abort",
      "composer.warn.vision": 'Current model "{model}" does not support image input. Consider switching models.',
      "composer.warn.switchModel": "switch model",
      "composer.warn.uploadAnyway": "upload anyway",
      "composer.warn.dismiss": "dismiss",
      "composer.bridge.searchPlaceholder": "type a command or search…",
      "composer.bridge.allCommands": "Commands",
      "composer.bridge.models": "Models",
      "composer.bridge.filterModels": "filter models…",
      "composer.bridge.logins": "Login Providers",

      // History Modal
      "history.title": "Saved Sessions",
      "history.search": "Search sessions...",
      "history.scope.all": "All Projects",
      "history.scope.current": "Current Project",
      "history.time.justNow": "just now",
      "history.time.minutesAgo": "{n}m ago",
      "history.time.hoursAgo": "{n}h ago",
      "history.time.daysAgo": "{n}d ago",
      "history.resume": "Resume",
      "history.delete": "Delete session",
      "history.delete.confirm": "Delete?",
      "history.delete.confirmTitle": "Confirm delete",
      "history.empty": "No saved sessions found",
      "history.loading": "Loading sessions...",
      "history.close": "close (esc)",

      // Model Manager Modal
      "models.title": "Manage Models",
      "models.tab.form": "Form",
      "models.tab.yaml": "YAML",
      "models.search": "Search models...",
      "models.addModel": "Add Model",
      "models.addProvider": "Add Provider",
      "models.save": "Save",
      "models.saving": "Saving...",
      "models.cancel": "Cancel",
      "models.delete": "Delete",
      "models.edit": "Edit",
      "models.provider": "Provider",
      "models.modelId": "Model ID",
      "models.name": "Display Name",
      "models.baseUrl": "Base URL",
      "models.apiKey": "API Key",
      "models.thinking": "Thinking Support",
      "models.saveSuccess": "Models configuration saved successfully!",
      "models.saveError": "Failed to save models config: ",
      "models.loadError": "Failed to load models config: ",
      "models.confirmDelete": "Are you sure you want to delete this model?",
      "models.openFolder": "Open Folder",
      "models.openFile": "Open File",

      // Plan Kanban
      "plan.title": "Plan",
      "plan.complete": "plan complete",
      "plan.executing": "executing plan",
      "plan.phase.running": "running",
      "plan.phase.done": "done",
      "plan.close": "close (esc)",
      "plan.empty": "no plan yet. think out loud below.",
      "plan.intentFraming": "Please draft a plan for the following task. Write it in Markdown with clear sections: overview, approach, key steps, and risks. Do not start implementing yet — draft only for my review.\n\n---\n\n{intent}",
      "plan.approvalPrompt": "Plan approved. Please proceed to execute it. Use your todo_write tool to track tasks as you go.",

      // Chat
      "chat.ask": "Ask",
      "chat.answered": "answered",
      "chat.cancelled": "cancelled",
      "chat.running": "running",
      "chat.compact": "compact",
      "chat.compacting": "compacting context…",
      "chat.compactFailed": "compaction failed",
      "chat.compacted": "context compacted",
      "chat.before": "{tok} before",
      "chat.compactRange": "{before} → {after}",
      "chat.scrub": "scrub",
      "chat.hits": "{count} hits",

      // Agent Activity
      "agent.status": "agent status",
      "agent.idle": "idle",
      "agent.thinking": "thinking…",
      "agent.recent": "recent",
    },

    "zh-CN": {
      // Tweaks panel
      "tweaks.title": "外观与设置",
      "tweaks.section.general": "通用",
      "tweaks.language": "界面语言",
      "tweaks.section.look": "外观风格",
      "tweaks.theme": "主题配色",
      "tweaks.theme.aurora": "极光 (暗色)",
      "tweaks.theme.phosphor": "荧光绿 (暗色)",
      "tweaks.theme.daylight": "日光 (亮色)",
      "tweaks.density": "显示紧凑度",
      "tweaks.density.cozy": "舒适",
      "tweaks.density.compact": "紧凑",
      "tweaks.density.dense": "紧密",
      "tweaks.accent": "强调色",
      "tweaks.monoChat": "等宽聊天字体",
      "tweaks.fontSize": "界面字号",
      "tweaks.section.layout": "布局结构",
      "tweaks.layout": "布局模式",
      "tweaks.layout.rail": "导轨侧栏",
      "tweaks.layout.split": "分栏对比",
      "tweaks.layout.focus": "纯净聚焦",
      "tweaks.close": "关闭设置",

      // Chrome & Tabs
      "chrome.bridge": "指令桥",
      "chrome.tabs.new": "新建会话 / 打开项目",
      "chrome.tabs.openFolder": "打开项目文件夹...",
      "chrome.tabs.newSession": "新建独立会话 (无项目)",
      "chrome.tabs.history": "会话历史 (Ctrl+H)",
      "chrome.tabs.models": "管理模型配置 (Ctrl+M)",
      "chrome.status.connected": "已连接",
      "chrome.status.disconnected": "未连接",
      "chrome.status.thinking": "思考深度",
      "chrome.status.thinking.off": "关闭",
      "chrome.status.thinking.minimal": "极低",
      "chrome.status.thinking.low": "低",
      "chrome.status.thinking.medium": "中",
      "chrome.status.thinking.high": "高",
      "chrome.status.thinking.xhigh": "极大",
      "chrome.status.cost": "开销",
      "chrome.status.todo": "待办",
      "chrome.status.autosave": "自动保存",
      "chrome.status.autosaveOn": "开",
      "chrome.status.autosaveOff": "关",
      "chrome.status.toggleAutosave": "切换自动保存",
      "chrome.status.tweaks": "外观与布局调整",
      "chrome.rail.ambient": "环境监控",
      "chrome.rail.hide": "隐藏导轨",
      "chrome.rail.throughput": "吞吐速率",
      "chrome.rail.radar": "智能体雷达",
      "chrome.rail.last60s": "最近 60 秒",
      "chrome.rail.peer": "并行会话",
      "chrome.rail.peerLive": "运行中",
      "chrome.rail.peerPinned": "已固定",
      "chrome.rail.peerEmpty": "打开第二个标签页后可在此监视。",
      "chrome.rail.peerHint": "固定一个会话到此处监视",
      "chrome.rail.unpin": "取消固定",
      "chrome.rail.focus": "聚焦 →",
      "split.waiting": "等待工具调用…",
      "split.idle": "会话空闲",
      "split.running": "执行中…",
      "chrome.rail.you": "用户",
      "chrome.rail.tool": "工具",
      "chrome.rail.assistant": "智能助手",

      // Composer
      "composer.placeholder.default": "需要执行什么任务？ · 输入 / 查看指令 · ⌘K/Ctrl+K 打开指令桥",
      "composer.placeholder.plan": "描述需要构建的内容，或对当前规划提出反馈意见…",
      "composer.placeholder.streaming": "按 ⎋ 中断当前输出 — 光标随时待命。",
      "composer.placeholder.empty": "选择或打开一个项目，我们立即开始。",
      "composer.steer": "引导",
      "composer.abort": "中止",
      "composer.approve": "批准执行",
      "composer.send": "发送",
      "composer.sendFeedback": "发送反馈",
      "composer.comments": "{count} 条批注",
      "composer.comment": "1 条批注",
      "composer.planMode": "规划模式",
      "composer.thinking": "思考模式 · {level}",
      "composer.attach": "添加图片 (支持截图粘贴或拖拽)",
      "composer.unsupportedVision": '当前模型 "{model}" 不支持图片输入 (点击切换)',
      "composer.dictate": "语音输入",
      "composer.bridgeKbd": "打开指令桥 (Ctrl+K)",
      "composer.hints.normal": "↵ 发送 · ⇧↵ 换行 · ⎋ 中止",
      "composer.hints.steer": "↵ 引导 · ⎋ 中止",
      "composer.warn.vision": '当前模型 "{model}" 不支持图片输入，请考虑切换为支持多模态的模型。',
      "composer.warn.switchModel": "切换模型",
      "composer.warn.uploadAnyway": "依然上传",
      "composer.warn.dismiss": "忽略",
      "composer.bridge.searchPlaceholder": "输入指令或搜索…",
      "composer.bridge.allCommands": "指令列表",
      "composer.bridge.models": "切换模型",
      "composer.bridge.filterModels": "过滤模型…",
      "composer.bridge.logins": "登录提供商",

      // History Modal
      "history.title": "历史会话",
      "history.search": "搜索历史会话...",
      "history.scope.all": "全部项目",
      "history.scope.current": "当前项目",
      "history.time.justNow": "刚刚",
      "history.time.minutesAgo": "{n}分钟前",
      "history.time.hoursAgo": "{n}小时前",
      "history.time.daysAgo": "{n}天前",
      "history.resume": "恢复会话",
      "history.delete": "删除会话",
      "history.delete.confirm": "确认删除?",
      "history.delete.confirmTitle": "确认删除",
      "history.empty": "未找到历史会话记录",
      "history.loading": "正在加载历史会话...",
      "history.close": "关闭 (Esc)",

      // Model Manager Modal
      "models.title": "模型配置管理",
      "models.tab.form": "表单视图",
      "models.tab.yaml": "YAML 配置",
      "models.search": "搜索模型...",
      "models.addModel": "添加模型",
      "models.addProvider": "添加提供商",
      "models.save": "保存配置",
      "models.saving": "正在保存...",
      "models.cancel": "取消",
      "models.delete": "删除",
      "models.edit": "编辑",
      "models.provider": "提供商 (Provider)",
      "models.modelId": "模型标识 (Model ID)",
      "models.name": "显示名称",
      "models.baseUrl": "接口地址 (Base URL)",
      "models.apiKey": "密钥 (API Key)",
      "models.thinking": "支持思考推理",
      "models.saveSuccess": "模型配置已成功保存！",
      "models.saveError": "保存模型配置失败：",
      "models.loadError": "加载模型配置失败：",
      "models.confirmDelete": "确定要删除该模型配置吗？",
      "models.openFolder": "打开配置目录",
      "models.openFile": "打开文件",

      // Plan Kanban
      "plan.title": "任务规划",
      "plan.complete": "规划已完成",
      "plan.executing": "正在执行规划",
      "plan.phase.running": "执行中",
      "plan.phase.done": "已完成",
      "plan.close": "关闭 (Esc)",
      "plan.empty": "暂无规划任务，可在下方输入需求。",
      "plan.intentFraming": "请为以下任务起草一份规划。使用 Markdown 编写，包含以下部分：概述、实现方案、关键步骤和风险点。暂不开始实施——仅供我审阅。\n\n---\n\n{intent}",
      "plan.approvalPrompt": "规划已批准，请开始执行。执行过程中请使用 todo_write 工具跟踪任务进度。",

      // Chat
      "chat.ask": "提问",
      "chat.answered": "已回复",
      "chat.cancelled": "已取消",
      "chat.running": "运行中",
      "chat.compact": "上下文压缩",
      "chat.compacting": "正在压缩上下文…",
      "chat.compactFailed": "上下文压缩失败",
      "chat.compacted": "上下文已压缩",
      "chat.before": "压缩前 {tok}",
      "chat.compactRange": "{before} → {after}",
      "chat.scrub": "拖动比对",
      "chat.hits": "{count} 处匹配",

      // Agent Activity
      "agent.status": "智能体状态",
      "agent.idle": "空闲",
      "agent.thinking": "思考中…",
      "agent.recent": "近期动作",
    }
  };

  // Determine initial locale from localStorage or system language
  function _getSavedLocale() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.locale && DICTIONARY[parsed.locale]) return parsed.locale;
      }
    } catch {}
    return "en";
  }

  let _currentLocale = _getSavedLocale();

  function getLocale() {
    return _currentLocale;
  }

  function setLocale(loc) {
    if (!DICTIONARY[loc]) return;
    if (_currentLocale !== loc) {
      _currentLocale = loc;
      if (typeof window !== "undefined" && window.dispatchEvent && typeof CustomEvent !== "undefined") {
        window.dispatchEvent(new CustomEvent("i18nchange", { detail: { locale: loc } }));
      }
    }
  }

  function t(key, params, fallback, overrideLocale) {
    const loc = overrideLocale || _currentLocale;
    const dict = DICTIONARY[loc] || DICTIONARY["en"] || {};
    let text = dict[key];

    if (text === undefined) {
      // Fallback to English if missing in current locale
      text = DICTIONARY["en"]?.[key];
    }
    if (text === undefined) {
      text = fallback !== undefined ? fallback : key;
    }

    if (params && typeof params === "object") {
      Object.keys(params).forEach(k => {
        text = text.replace(new RegExp(`\\{${k}\\}`, "g"), params[k]);
      });
    }

    return text;
  }

  // Listen to tweak changes to stay in sync
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("tweakchange", (e) => {
      if (e.detail && e.detail.locale) {
        setLocale(e.detail.locale);
      }
    });
  }

  const I18N = {
    DICTIONARY,
    getLocale,
    setLocale,
    t,
  };

  window.I18N = I18N;
  window.t = t;
})();
