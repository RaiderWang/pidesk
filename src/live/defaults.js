/* live/defaults.js — safe defaults so design components never crash on missing
   fields. Pure data; live.js clones it for window.OMP_DATA and per-session resets. */
(function () {
  "use strict";
  const DEFAULT_DATA = {
    projects: [],
    messages: [],
    kanban: [],
    planMeta: { ask: "", strategy: "", touches: [], branch: "main", risks: [], estimate: { tokens: "—", cost: "—", wall: "—" } },
    commands: [
      { name: "plan",     hint: "draft a plan before writing code",   icon: "◇", group: "Mode"    },
      { name: "steer",    hint: "interrupt and redirect mid-tool",    icon: "↺", group: "Mode"    },
      { name: "compact",  hint: "compact context window",             icon: "▤", group: "Session" },
      { name: "new",      hint: "start a fresh session (history kept on disk)", icon: "↺", group: "Session" },
      { name: "history",  hint: "browse and resume saved sessions",   icon: "clock", group: "Session" },
      { name: "model",    hint: "switch model",                       icon: "◉", group: "Agent"   },
      { name: "models",   hint: "manage custom models (models.yml)",  icon: "cpu", group: "Agent" },
      { name: "thinking", hint: "cycle thinking level",               icon: "✶", group: "Agent"   },
      { name: "login",    hint: "authenticate with a model provider",   icon: "⊙", group: "Agent"   },
      { name: "todo",     hint: "open the kanban surface",            icon: "▦", group: "View"    },
      { name: "review",   hint: "inspect code diff & launch review",  icon: "diff2", group: "Code" },
      { name: "export",   hint: "export this session as Markdown or HTML", icon: "⇪", group: "View"    },
    ],
    models: [],
    activity: [],
    ctx: { used: 0, total: 200000, pct: 0, label: "0 / 200k", cost: "$0.00", tokensPerSec: 0 },
    peer: null,
    microcopy: {
      empty:        "Hand me a project. I'll set the table.",
      streamingTip: "Press ⎋ to interrupt — your cursor is in the room.",
      paletteTip:   "type / to give orders · ⌘K opens the bridge",
      planTip:      "describe what to build, or give feedback on the plan…",
      todoEmpty:    "no plan yet. think out loud below.",
      radarHint:    "agent has been busy — last 60 seconds",
    },
  };

  window._Live = window._Live || {};
  window._Live.Defaults = DEFAULT_DATA;
})();
