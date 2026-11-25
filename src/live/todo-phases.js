/* live/todo-phases.js — turn todo/plan phases into kanban, plan meta and the
   inline plan block of the latest assistant bubble.

   One helper for every place that learns about todo phases (get_messages
   history, `custom` events, tool_execution_start/end, get_state). Callers keep
   their own raw-payload extraction and their own fallback for hosts without
   `window.normalizeTodoPhases`, which differs per site on purpose.
   Registers window._Live.TodoPhases; independent of the other live/* parts. */
(function () {
  "use strict";
  window._Live = window._Live || {};

  function create({ state, rt }) {
    // Replace the plan block of the latest real assistant bubble (and of the
    // in-flight streaming bubble, so the next update does not drop it).
    function injectInlinePlan(phases) {
      const idx = [...state.messages].reverse().findIndex(m => m.kind === "assistant" && !m.notice);
      if (idx === -1) return;
      const realIdx = state.messages.length - 1 - idx;
      const msg     = state.messages[realIdx];
      const planBlock = {
        type: "plan", title: "Plan",
        phases: phases.map(ph => ({
          id: ph.name, label: ph.name,
          tasks: ph.tasks.map((t, i) => ({
            id: `${ph.name}-${i}`, text: t.content,
            status: (t.status === "completed" || t.status === "abandoned") ? "done" : t.status,
          })),
        })),
      };
      const msgs    = [...state.messages];
      const nonPlanBlocks = (msg.blocks ?? []).filter(b => b.type !== "plan");
      msgs[realIdx] = { ...msg, blocks: [...nonPlanBlocks, planBlock] };
      state.messages = msgs;
      const sb = rt.session.streamingBubble;
      if (sb) {
        const sbNonPlan = (sb.blocks ?? []).filter(b => b.type !== "plan");
        sb.blocks = [...sbNonPlan, planBlock];
      }
    }

    /**
     * Normalise `raw` and, when it holds phases, update kanban + planMeta.
     * @param {*}       raw
     * @param {object}  [opts]
     * @param {Array}   [opts.fallback=[]]  Phases used only when `window.normalizeTodoPhases` is missing.
     * @param {boolean} [opts.inject=true]  Also inject the inline plan block into chat.
     * @returns {boolean} true when phases were applied.
     */
    function apply(raw, { fallback = [], inject = true } = {}) {
      const phases = window.normalizeTodoPhases ? window.normalizeTodoPhases(raw) : fallback;
      if (!(phases?.length > 0)) return false;
      state.kanban   = window.buildKanban(phases);
      state.planMeta = window.buildPlanMeta(phases, state.rpcState);
      if (inject) injectInlinePlan(phases);
      return true;
    }

    return { apply, injectInlinePlan };
  }

  window._Live.TodoPhases = { create };
})();
