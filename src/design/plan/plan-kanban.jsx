/* plan/plan-kanban.jsx — full-screen kanban board (Modal). Opened from the dock Plan view. */

const { Icon, Modal, PhasePill, TouchChip, KanbanCol } = window;

// ── Plan kanban (Main Cyber HUD Surface) ──────────────────────────────
function PlanKanban({ kanban = [], planMeta, onClose, onAbort, isStreaming = false, mode }) {
  const [filter, setFilter] = React.useState("all"); // all | live | pending | done
  const [search, setSearch] = React.useState("");

  const { total, done, inProg, pending, phase, percent: progressPercent } =
    window.PlanStats.summarizePlan(kanban, { isStreaming, mode });

  return (
    <Modal bare onClose={onClose} scrimClassName="kanban-scrim" panelClassName="kanban slide-in"
      ariaLabel={window.t ? window.t("plan.title", null, "Plan") : "Plan"}>

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

    </Modal>
  );
}

Object.assign(window, { PlanKanban });
