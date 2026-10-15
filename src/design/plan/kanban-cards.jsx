/* plan/kanban-cards.jsx — kanban column + task card used by the full-screen board. */

const { Icon, TOOL_META } = window;

// ── Kanban column ─────────────────────────────────────────────────────
function KanbanCol({ col, idx, mode, filter, search }) {
  const colDone  = col.tasks.filter(t => t.status === "done").length;
  const colTotal = col.tasks.length;
  const colPercent = colTotal ? Math.round((colDone / colTotal) * 100) : 0;

  // Filter tasks
  const q = search.trim().toLowerCase();
  const visibleTasks = col.tasks.filter(t => {
    // Status filter
    if (filter === "live"    && t.status !== "in_progress") return false;
    if (filter === "pending" && t.status !== "pending") return false;
    if (filter === "done"    && t.status !== "done") return false;

    // Search query
    if (q) {
      const matchText = t.text?.toLowerCase().includes(q);
      const matchFile = t.file?.toLowerCase().includes(q);
      const matchTool = t.tool?.toLowerCase().includes(q);
      const matchWhy  = t.reason?.toLowerCase().includes(q);
      return matchText || matchFile || matchTool || matchWhy;
    }
    return true;
  });

  return (
    <div className="kanban-col" data-tone={col.tone || "accent"}>
      <div className="kanban-col-head">
        <span className="kanban-col-phase-badge">PH-0{idx + 1}</span>
        <span className="kanban-col-mark" style={{ background: `var(--${col.tone})`, color: `var(--${col.tone})` }} />
        <Icon name={col.icon} size={12} color={`var(--${col.tone})`} />
        <span style={{ color: "var(--fg)", fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {col.title}
        </span>
        <span className="chip muted mono" style={{ fontSize: 10, padding: "1px 5px" }}>
          {colDone}/{colTotal}{colTotal > 0 ? ` · ${colPercent}%` : ""}
        </span>
      </div>

      {visibleTasks.map((t, i) => (
        <KanbanCard key={t.id} task={t} idx={idx * 8 + i} mode={mode} />
      ))}

      {visibleTasks.length === 0 && col.tasks.length > 0 && (
        <div style={{ padding: "14px 8px", color: "var(--fg-4)", fontSize: "var(--d-text-xs)", textAlign: "center", fontStyle: "italic" }}>
          —
        </div>
      )}
    </div>
  );
}

// ── Kanban card (Cyber Card with Rich Micro-Animations) ───────────────
function KanbanCard({ task, idx, mode }) {
  const [open, setOpen]     = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const tone  = task.status === "done" ? "ok" : task.status === "in_progress" ? "live" : "pending";
  const tmeta = TOOL_META[task.tool] || { color: "var(--fg-3)", icon: "circle", label: task.tool };
  const effortColor = task.effort === "L" ? "var(--rose)" : task.effort === "M" ? "var(--amber)" : "var(--cyan)";

  const handleCopyFile = (e) => {
    e.stopPropagation();
    if (!task.file) return;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(task.file);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };

  return (
    <div
      className={`kcard ${tone} fade-up ${open ? "open" : ""}`}
      style={{ animationDelay: `${idx * 25}ms` }}
      onClick={() => setOpen(v => !v)}
    >
      {/* Card Header & Status Mark */}
      <div className="kcard-head">
        {task.status === "done" && (
          <span className="kcard-mark ok" title="Completed">
            <Icon name="check" size={11} />
          </span>
        )}
        {task.status === "in_progress" && (
          <span className="kcard-mark live" title="Executing">
            <span className="pulse-dot" style={{ width: 6, height: 6 }} />
          </span>
        )}
        {task.status === "pending" && (
          <span className="kcard-mark pending" title="Queued">
            ○
          </span>
        )}
        <span className="kcard-text selectable">{task.text}</span>
      </div>

      {/* Card Metadata Tags */}
      <div className="kcard-tags">
        {/* Tool Badge */}
        <span className="chip mono" style={{
          color: tmeta.color,
          borderColor: `color-mix(in oklab, ${tmeta.color} 35%, var(--line))`,
          background:  `color-mix(in oklab, ${tmeta.color} 10%, transparent)`,
        }}>
          <Icon name={tmeta.icon} size={9} color={tmeta.color} /> {tmeta.label}
        </span>

        {/* Complexity / Effort */}
        {task.effort && (
          <span className="chip mono" style={{
            color: effortColor,
            borderColor: `color-mix(in oklab, ${effortColor} 30%, var(--line))`,
            background:  `color-mix(in oklab, ${effortColor} 8%, transparent)`,
          }}>
            {task.effort}
          </span>
        )}

        {/* Target File Chip (with click-to-copy feedback) */}
        {task.file && (
          <span
            className="chip mono muted kcard-file-tag"
            onClick={handleCopyFile}
            title={copied
              ? (window.t ? window.t("plan.copied", null, "Copied!") : "Copied!")
              : (window.t ? window.t("plan.copyPath", null, "Copy file path") : "Copy file path")}
          >
            <Icon name={copied ? "check" : "file"} size={9} color={copied ? "var(--accent)" : "var(--fg-4)"} />
            <span>{task.file}</span>
            {copied && <span style={{ color: "var(--accent)", marginLeft: 2 }}>✓</span>}
          </span>
        )}
      </div>

      {/* Expanded Rationale & Notes */}
      {open && task.reason && (
        <div className="kcard-why selectable">
          <span className="mono" style={{ color: "var(--lilac)" }}>// {window.t ? window.t("plan.rationale", null, "Rationale") : "Rationale"}: &nbsp;</span>
          <span style={{ color: "var(--fg-2)" }}>{task.reason}</span>
        </div>
      )}

      {/* Active Agent Equalizer Telemetry */}
      {mode === "running" && task.status === "in_progress" && (
        <div className="kcard-live mono">
          <span className="cyber-equalizer">
            <span />
            <span />
            <span />
          </span>
          <span style={{ color: "var(--cyan)", fontWeight: 500 }}>
            {window.t ? window.t("plan.agentExecuting", null, "Agent executing…") : "Agent executing…"}
          </span>
          <span className="shimmer-text" style={{ marginLeft: "auto", fontSize: 11 }}>
            writing patch…
          </span>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { KanbanCol, KanbanCard });
