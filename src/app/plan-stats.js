/* app/plan-stats.js — pure plan/kanban statistics shared by the kanban modal
   and the dock Plan view. No DOM, no React. */
(function () {
  const PHASES = ["idle", "queued", "running", "done"];

  /** Phase of a plan: derived from task counts + whether the agent is busy.
   *  `override` (a valid phase string) wins, mirroring the legacy `mode` prop. */
  function derivePhase(total, done, isStreaming, override) {
    if (override && PHASES.includes(override)) return override;
    if (total === 0) return isStreaming ? "running" : "idle";
    if (done === total) return "done";
    return isStreaming ? "running" : "queued";
  }

  /** Counts + phase for a kanban (`[{ tasks: [{status}] }]`). */
  function summarizePlan(kanban, opts) {
    const { isStreaming = false, mode } = opts || {};
    let total = 0;
    let done = 0;
    let inProg = 0;
    for (const col of kanban || []) {
      for (const task of col.tasks || []) {
        total += 1;
        if (task.status === "done") done += 1;
        else if (task.status === "in_progress") inProg += 1;
      }
    }
    return {
      total,
      done,
      inProg,
      pending: total - done - inProg,
      percent: total ? Math.round((done / total) * 100) : 0,
      phase: derivePhase(total, done, isStreaming, mode),
    };
  }

  /** Flat task lists by status, each task tagged with its column title.
   *  Order inside a bucket follows the kanban order. */
  function groupTasksByStatus(kanban) {
    const out = { live: [], pending: [], done: [] };
    for (const col of kanban || []) {
      for (const task of col.tasks || []) {
        const bucket = task.status === "done" ? out.done : task.status === "in_progress" ? out.live : out.pending;
        bucket.push({ ...task, column: col.title });
      }
    }
    return out;
  }

  window.PlanStats = { PHASES, derivePhase, summarizePlan, groupTasksByStatus };
})();
