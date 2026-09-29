/* ═════════════════════════════════════════════════════════════════════
   panels.jsx — Kanban execution surface (Cyber HUD Plan Surface)
   Opened after plan approval; populated by agent's todo_write tool.
   ═════════════════════════════════════════════════════════════════════ */

const { Icon, TOOL_META } = window;

// ── Phase pill ────────────────────────────────────────────────────────
function PhasePill({ phase }) {
  const map = {
    running: { color: "var(--cyan)",   icon: "live",   label: window.t ? window.t("plan.phase.running", null, "running") : "running" },
    done:    { color: "var(--accent)", icon: "check",  label: window.t ? window.t("plan.phase.done", null, "done") : "done"    },
    queued:  { color: "var(--amber)",  icon: "clock",  label: window.t ? window.t("plan.phase.queued", null, "queued") : "queued"  },
    idle:    { color: "var(--fg-4)",   icon: "circle", label: window.t ? window.t("plan.phase.idle", null, "idle") : "idle"      },
  };
  const m = map[phase] ?? map.idle;
  return (
    <span className="chip" style={{
      color: m.color,
      borderColor: `color-mix(in oklab, ${m.color} 35%, var(--line))`,
      background:  `color-mix(in oklab, ${m.color} 12%, transparent)`,
      boxShadow: phase === "running" ? `0 0 10px color-mix(in oklab, ${m.color} 25%, transparent)` : "none",
    }}>
      <Icon name={m.icon} size={10} color={m.color} /> {m.label}
    </span>
  );
}

// ── Plan kanban (Main Cyber HUD Surface) ──────────────────────────────
function PlanKanban({ kanban = [], planMeta, onClose, onAbort, isStreaming = false, mode }) {
  const [filter, setFilter] = React.useState("all"); // all | live | pending | done
  const [search, setSearch] = React.useState("");

  const total   = kanban.reduce((n, c) => n + c.tasks.length, 0);
  const done    = kanban.reduce((n, c) => n + c.tasks.filter(t => t.status === "done").length, 0);
  const inProg  = kanban.reduce((n, c) => n + c.tasks.filter(t => t.status === "in_progress").length, 0);
  const pending = total - done - inProg;

  // Derive phase from task data & execution status
  const allDone = total > 0 && done === total;
  let phase = "idle";
  if (total === 0) {
    phase = isStreaming ? "running" : "idle";
  } else if (allDone) {
    phase = "done";
  } else if (isStreaming) {
    phase = "running";
  } else {
    phase = "queued";
  }
  if (mode && (mode === "running" || mode === "done" || mode === "idle" || mode === "queued")) {
    phase = mode;
  }
  const progressPercent = total ? Math.round((done / total) * 100) : 0;

  // Listen for Escape key to close kanban
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="kanban-scrim" onClick={onClose}>
      <div className="kanban slide-in" onClick={e => e.stopPropagation()}>

        {/* 1. Header */}
        <div className="kanban-head">
          <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="plan" size={17} color="var(--accent)" />
              <span style={{ fontSize: "var(--d-text-lg)", fontWeight: 600, letterSpacing: "-0.01em" }}>
                {phase === "done"
                  ? (window.t ? window.t("plan.complete", null, "plan complete") : "plan complete")
                  : phase === "running"
                    ? (window.t ? window.t("plan.executing", null, "executing plan") : "executing plan")
                    : (window.t ? window.t("plan.title", null, "Plan") : "Plan")}
              </span>
              <PhasePill phase={phase} />
              {planMeta?.branch && (
                <span className="chip mono muted" title={window.t ? window.t("plan.hud.branch", null, "Branch") : "Branch"}>
                  <Icon name="branch" size={9} color="var(--fg-4)" /> {planMeta.branch}
                </span>
              )}
            </div>
            {planMeta?.ask && (
              <div className="plan-ask selectable">
                <span className="mono" style={{ color: "var(--fg-4)" }}>ask &nbsp;</span>
                <span style={{ color: "var(--fg-2)" }}>{planMeta.ask}</span>
              </div>
            )}
          </div>
          <button className="btn ghost icon" onClick={onClose} title={window.t ? window.t("plan.close", null, "close (esc)") : "close (esc)"}>
            <Icon name="close" size={12} />
          </button>
        </div>

        {/* 2. HUD Telemetry Bar (KPIs + Filters + Search) */}
        <div className="kanban-hud">
          <div className="kanban-kpis">
            <span className="kanban-kpi-pill">
              <span style={{ color: "var(--fg-4)" }}>{window.t ? window.t("plan.hud.total", null, "Total") : "Total"}:</span>
              <strong style={{ color: "var(--fg)" }}>{total}</strong>
            </span>
            <span className={`kanban-kpi-pill ${inProg > 0 ? "live" : ""}`}>
              <span className="dot live" style={{ width: 6, height: 6 }} />
              <span>{window.t ? window.t("plan.hud.live", null, "Live") : "Live"}:</span>
              <strong>{inProg}</strong>
            </span>
            <span className={`kanban-kpi-pill ${done > 0 ? "done" : ""}`}>
              <Icon name="check" size={9} color={done > 0 ? "var(--accent)" : "var(--fg-4)"} />
              <span>{window.t ? window.t("plan.hud.done", null, "Shipped") : "Shipped"}:</span>
              <strong>{done}</strong>
            </span>
            <span className="kanban-kpi-pill gauge">
              <span>{progressPercent}%</span>
            </span>
          </div>

          <div className="kanban-controls">
            {/* Filter buttons */}
            <div className="kanban-filters">
              {[
                { id: "all",     label: window.t ? window.t("plan.filter.all", null, "All") : "All",         count: total },
                { id: "live",    label: window.t ? window.t("plan.filter.live", null, "Live") : "Live",       count: inProg },
                { id: "pending", label: window.t ? window.t("plan.filter.pending", null, "Queued") : "Queued", count: pending },
                { id: "done",    label: window.t ? window.t("plan.filter.done", null, "Done") : "Done",       count: done },
              ].map(f => (
                <button
                  key={f.id}
                  className={`kanban-filter-btn ${filter === f.id ? "active" : ""}`}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label} ({f.count})
                </button>
              ))}
            </div>

            {/* Keyword Search */}
            <div className="kanban-search">
              <Icon name="search" size={11} color="var(--fg-4)" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={window.t ? window.t("plan.searchPlaceholder", null, "Filter tasks or files…") : "Filter tasks or files…"}
              />
              {search && (
                <button
                  className="btn ghost icon"
                  style={{ width: 14, height: 14 }}
                  onClick={() => setSearch("")}
                >
                  <Icon name="close" size={8} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 3. Touched Files & Risks strip */}
        {planMeta?.touches?.length > 0 && (
          <div className="kanban-meta-strip">
            <span className="mono" style={{ color: "var(--fg-4)", whiteSpace: "nowrap" }}>
              <Icon name="file" size={10} color="var(--cyan)" /> {window.t ? window.t("plan.touches", null, "Touched files") : "Touched files"}:
            </span>
            {planMeta.touches.map((file, i) => (
              <TouchChip key={i} file={file} />
            ))}
          </div>
        )}

        {planMeta?.risks?.length > 0 && (
          <div className="plan-risks">
            <span className="mono" style={{ color: "var(--amber)" }}>risks:</span>
            {planMeta.risks.map((r, i) => (
              <span key={i} className="chip" style={{
                color: `var(--${r.tone})`,
                borderColor: `color-mix(in oklab, ${r.tone ? `var(--${r.tone})` : "var(--amber)"} 30%, var(--line))`,
                background:  `color-mix(in oklab, ${r.tone ? `var(--${r.tone})` : "var(--amber)"} 8%, transparent)`,
              }}>{r.text}</span>
            ))}
          </div>
        )}

        {/* 4. Victory banner if all tasks are shipped */}
        {phase === "done" && (
          <div className="kanban-victory-banner">
            <Icon name="sparkle" size={16} color="var(--accent)" />
            <span style={{ color: "var(--accent)", fontWeight: 600 }}>
              {window.t ? window.t("plan.allCompleted", null, "All objectives complete") : "All objectives complete"}
            </span>
            <span className="chip mono muted" style={{ marginLeft: "auto" }}>
              {done}/{total} tasks shipped
            </span>
          </div>
        )}

        {/* 5. Cyber Laser Progress Rail */}
        <div className="kanban-progress">
          <div
            className="kanban-progress-fill"
            style={{ width: total ? `${(done / total) * 100}%` : "0%" }}
          >
            {progressPercent > 0 && <span className="kanban-progress-spark" />}
          </div>
        </div>

        {/* 6. Columns Grid */}
        <div className="kanban-cols">
          {kanban.length > 0
            ? kanban.map((col, idx) => (
                <KanbanCol
                  key={col.id}
                  col={col}
                  idx={idx}
                  mode={phase}
                  filter={filter}
                  search={search}
                />
              ))
            : (
              <div style={{ padding: "40px 24px", color: "var(--fg-4)", fontSize: "var(--d-text-sm)", textAlign: "center", width: "100%" }}>
                {isStreaming
                  ? (window.t ? window.t("plan.waitingTasks", null, "waiting for agent to write tasks…") : "waiting for agent to write tasks…")
                  : (window.t ? window.t("plan.empty", null, "no plan yet. think out loud below.") : "no plan yet. think out loud below.")}
              </div>
            )
          }
        </div>

        {/* 7. Footer */}
        <div className="kanban-foot mono">
          {phase === "running" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="dot live" />
                <span style={{ color: "var(--cyan)" }}>
                  {window.t ? window.t("plan.agentExecuting", null, "Agent executing…") : "Agent executing…"}
                </span>
              </div>
              <div style={{ flex: 1 }} />
              <button className="btn ghost" onClick={onClose}>
                {window.t ? window.t("plan.close", null, "close (esc)") : "close (esc)"}
              </button>
              {onAbort && (
                <button className="btn danger" onClick={onAbort}>
                  <Icon name="stop" size={10} /> {window.t ? window.t("plan.abort", null, "abort") : "abort"}
                </button>
              )}
            </>
          )}
          {phase === "done" && (
            <>
              <span style={{ color: "var(--accent)" }}>
                {done}/{total} tasks shipped
              </span>
              <div style={{ flex: 1 }} />
              <button className="btn primary" onClick={onClose}>
                {window.t ? window.t("plan.close", null, "close") : "close"}
              </button>
            </>
          )}
          {(phase === "idle" || phase === "queued") && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  className="dot"
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: phase === "queued" ? "var(--amber)" : "var(--fg-4)",
                  }}
                />
                <span style={{ color: phase === "queued" ? "var(--amber)" : "var(--fg-3)" }}>
                  {phase === "queued"
                    ? (window.t ? window.t("plan.agentIdle", null, "agent idle · waiting for next instruction") : "agent idle · waiting for next instruction")
                    : (window.t ? window.t("plan.noActivePlan", null, "no active plan") : "no active plan")}
                </span>
              </div>
              <div style={{ flex: 1 }} />
              <button className="btn ghost" onClick={onClose}>
                {window.t ? window.t("plan.close", null, "close (esc)") : "close (esc)"}
              </button>
            </>
          )}
        </div>

      </div>
    </div>
  );
}

// ── Touched File Chip with Copy Feedback ──────────────────────────────
function TouchChip({ file }) {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = (e) => {
    e.stopPropagation();
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(file);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };

  return (
    <span
      className="kanban-touch-chip"
      onClick={handleCopy}
      title={copied
        ? (window.t ? window.t("plan.copied", null, "Copied!") : "Copied!")
        : (window.t ? window.t("plan.copyPath", null, "Copy file path") : "Copy file path")}
    >
      <Icon name={copied ? "check" : "file"} size={9} color={copied ? "var(--accent)" : "var(--fg-4)"} />
      <span>{file}</span>
      {copied && <span style={{ color: "var(--accent)", fontSize: 10 }}>✓</span>}
    </span>
  );
}

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

Object.assign(window, { PlanKanban });

