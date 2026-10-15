/* plan/plan-dock-view.jsx — narrow vertical Plan view for the dock's Plan tab.
   Phase + progress, the user's ask, tasks grouped by status, abort, and an
   "expand" button that opens the full-screen kanban modal. */

const { Icon: _PD_Icon, PhasePill: _PD_PhasePill, TOOL_META: _PD_TOOL_META } = window;

function PlanTaskRow({ task }) {
  const [open, setOpen] = React.useState(false);
  const t = window.t;
  const meta = _PD_TOOL_META[task.tool];
  return (
    <div className={`pdock-task ${task.status} ${open ? "open" : ""}`} onClick={() => setOpen((v) => !v)}>
      <span className="pdock-mark">
        {task.status === "done" && <_PD_Icon name="check" size={10} color="var(--accent)" />}
        {task.status === "in_progress" && <span className="pulse-dot" style={{ width: 6, height: 6 }} />}
        {task.status !== "done" && task.status !== "in_progress" && <span className="pdock-mark-idle">○</span>}
      </span>
      <div className="pdock-task-main">
        <div className="pdock-task-text selectable">{task.text}</div>
        {(meta || task.file) && (
          <div className="pdock-task-meta mono">
            {meta && <span style={{ color: meta.color }}>{meta.label}</span>}
            {task.file && <span className="pdock-task-file" title={task.file}>{task.file}</span>}
          </div>
        )}
        {open && task.reason && (
          <div className="pdock-task-why selectable">
            <span className="mono" style={{ color: "var(--lilac)" }}>// {t ? t("plan.rationale", null, "Rationale") : "Rationale"}: </span>
            {task.reason}
          </div>
        )}
      </div>
    </div>
  );
}

function PlanTaskGroup({ id, tasks, collapsible, defaultOpen = true }) {
  const t = window.t;
  const [open, setOpen] = React.useState(defaultOpen);
  if (tasks.length === 0) return null;
  const label = t ? t(`plan.dock.group.${id}`, null, id) : id;
  return (
    <div className="pdock-group">
      <button className="pdock-group-head mono" onClick={() => collapsible && setOpen((v) => !v)}
        style={{ cursor: collapsible ? "pointer" : "default" }}>
        {collapsible && <_PD_Icon name={open ? "chev" : "chevR"} size={9} color="var(--fg-4)" />}
        <span>{label}</span>
        <span className="pdock-count">{tasks.length}</span>
      </button>
      {open && tasks.map((task) => <PlanTaskRow key={task.id} task={task} />)}
    </div>
  );
}

function PlanDockView({ kanban = [], planMeta, isStreaming = false, onAbort, onExpand }) {
  const t = window.t;
  const stats = window.PlanStats.summarizePlan(kanban, { isStreaming });
  const groups = window.PlanStats.groupTasksByStatus(kanban);
  const { total, done, phase, percent } = stats;

  return (
    <div className="pdock">
      <div className="pdock-head">
        <_PD_PhasePill phase={phase} />
        <span className="mono pdock-progress-label">{done}/{total} · {percent}%</span>
        <div style={{ flex: 1 }} />
        {onAbort && phase === "running" && (
          <button className="btn danger" onClick={onAbort} style={{ height: 22 }}
            title={t ? t("plan.abort", null, "abort") : "abort"}>
            <_PD_Icon name="stop" size={9} />
          </button>
        )}
        <button className="btn ghost outlined" onClick={onExpand} style={{ height: 22, gap: 4 }}
          title={t ? t("plan.dock.expand", null, "Expand to board") : "Expand to board"}>
          <_PD_Icon name="external" size={10} />
          <span>{t ? t("plan.dock.expandShort", null, "board") : "board"}</span>
        </button>
      </div>

      <div className="pdock-progress">
        <div className="pdock-progress-fill" style={{ width: `${percent}%` }} />
      </div>

      {planMeta?.ask && (
        <div className="pdock-ask selectable">
          <span className="mono" style={{ color: "var(--fg-4)" }}>{t ? t("plan.ask", null, "ask") : "ask"} </span>
          <span style={{ color: "var(--fg-2)" }}>{planMeta.ask}</span>
        </div>
      )}

      {total === 0 ? (
        <div className="pdock-empty">
          {isStreaming
            ? (t ? t("plan.waitingTasks", null, "waiting for agent to write tasks…") : "waiting for agent to write tasks…")
            : (t ? t("plan.empty", null, "no plan yet. think out loud below.") : "no plan yet. think out loud below.")}
        </div>
      ) : (
        <div className="pdock-groups">
          <PlanTaskGroup id="live" tasks={groups.live} />
          <PlanTaskGroup id="pending" tasks={groups.pending} />
          <PlanTaskGroup id="done" tasks={groups.done} collapsible defaultOpen={groups.live.length + groups.pending.length === 0} />
        </div>
      )}
    </div>
  );
}

Object.assign(window, { PlanDockView });
