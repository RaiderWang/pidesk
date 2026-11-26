/* live/events-tool.js — tool_execution_start / _update / _end.

   Owns the ephemeral tool cards in chat, the running/recent tool trail, tool
   log buffers, Agent Hub task tracking and the activity sparkline log.
   Registers window._Live.EventsTool; load after runtime.js and todo-phases.js.
   Depends on window.ToolTarget (app/tool-target.js) for the display target and
   window.FsActivity (app/fs-activity.js) to bump `rt.seq.fsEpoch` on file-writing tools. */
(function () {
  "use strict";
  window._Live = window._Live || {};

  /**
   * @param {object}   ctx
   * @param {object}   ctx.state
   * @param {object}   ctx.rt
   * @param {Function} ctx.notify
   * @param {object}   ctx.todo               TodoPhases instance
   * @param {Function} ctx.finalizeAsks       from EventsUi
   * @param {Function} ctx.reindexToolCards   from Runtime
   */
  function create({ state, rt, notify, todo, finalizeAsks, reindexToolCards }) {
    function onStart(ev) {
      const now  = Date.now();
      const time = window.timeNow();
      const s = rt.session;
      const card = window.buildToolStartCard(ev, time);
      const idx  = state.messages.length;
      s.activeToolCards.set(ev.toolCallId, idx);
      state.messages = [...state.messages, card];
      // Track running tool for the agent activity card
      const toolName = window.normalizeToolName(ev.toolName ?? "");
      const args = (typeof ev.args === "object" && ev.args !== null) ? ev.args : {};
      const target = window.ToolTarget.of(toolName, args);
      state.runningTools = [...state.runningTools, {
        id: ev.toolCallId, tool: toolName, target, startMs: now,
      }];
      // Initialize tool log buffer (command keeps the full text / full path)
      const cmdStr = typeof args.command === "string" ? args.command : window.ToolTarget.raw(toolName, args);
      state.toolLogs = {
        ...state.toolLogs,
        [ev.toolCallId]: {
          id: ev.toolCallId,
          tool: toolName,
          target,
          title: card.title || toolName,
          command: cmdStr,
          status: "running",
          startMs: now,
          lines: typeof args.command === "string" ? [`$ ${args.command}`] : [],
        },
      };
      // omp may emit an ask's select/input before tool_execution_start: put the ask
      // card ahead of those orphan bubbles so chat order is [tool_card, ask_bubble].
      if (toolName === "ask") {
        const hoisted = window.AskModel.hoistToolCard(state.messages, idx);
        if (hoisted.changed) {
          state.messages = hoisted.messages;
          reindexToolCards();
        }
      }

      s.activityLog.push({ ts: now, toolName: ev.toolName ?? "" });
      const cutoff = now - 60_000;
      while (s.activityLog.length && s.activityLog[0].ts < cutoff) s.activityLog.shift();
      state.activity = window.buildActivityFromLog(s.activityLog);
      // Hub: when a task tool starts, switch to tree mode
      if (toolName === "task") {
        state.hubMode    = "tree";
        state.hubTaskId  = ev.toolCallId;
        state.hubAgents  = [];
      }
      if (toolName === "todo" || ev.toolName === "todo_write") {
        const raw = args.phases ?? args.todos ?? (Array.isArray(args) ? args : null);
        todo.apply(raw);
      }
      notify();
    }

    function onUpdate(ev) {
      const idx = rt.session.activeToolCards.get(ev.toolCallId);
      if (idx !== undefined) {
        const card = state.messages[idx];
        if (card?.kind === "tool") {
          const updated = window.updateToolCard(card, ev);
          const msgs = [...state.messages];
          msgs[idx] = updated;
          state.messages = msgs;
          // Hub: sync subagent list from task progress updates
          if (state.hubTaskId === ev.toolCallId && updated.subagents) {
            state.hubAgents = updated.subagents;
          }
        }
      }
      if (state.toolLogs[ev.toolCallId]) {
        const pr = ev.partialResult ?? {};
        const text = pr.content?.[0]?.text ?? pr.details?.output ?? "";
        if (text) {
          const prev = state.toolLogs[ev.toolCallId];
          const rawLines = text.split("\n");
          const capped = rawLines.length > 2000 ? rawLines.slice(-2000) : rawLines;
          state.toolLogs = {
            ...state.toolLogs,
            [ev.toolCallId]: { ...prev, lines: capped },
          };
        }
      }
      notify();
    }

    function onEnd(ev) {
      const now  = Date.now();
      const time = window.timeNow();
      // Move the finished tool into the recent-tools trail (keep last 3)
      const RECENT_MAX = 3;
      const finished = state.runningTools.find(t => t.id === ev.toolCallId);
      state.runningTools = state.runningTools.filter(t => t.id !== ev.toolCallId);
      if (finished) {
        state.recentTools = [...state.recentTools, {
          id: finished.id, tool: finished.tool, target: finished.target,
          durationMs: now - finished.startMs,
        }].slice(-RECENT_MAX);
      }
      if (state.toolLogs[ev.toolCallId]) {
        const prev = state.toolLogs[ev.toolCallId];
        const details = ev.result?.details;
        let finalLines = prev.lines;
        if (details?.output) {
          finalLines = String(details.output).split("\n");
          if (finalLines.length > 2000) finalLines = finalLines.slice(-2000);
        } else if (ev.result?.content?.[0]?.text) {
          finalLines = String(ev.result.content[0].text).split("\n");
          if (finalLines.length > 2000) finalLines = finalLines.slice(-2000);
        }
        state.toolLogs = {
          ...state.toolLogs,
          [ev.toolCallId]: {
            ...prev,
            status: ev.isError ? "failed" : "completed",
            durationMs: now - prev.startMs,
            lines: finalLines,
          },
        };
      }
      const idx = rt.session.activeToolCards.get(ev.toolCallId);
      let card = idx !== undefined ? state.messages[idx] : null;
      if (!card || card._toolCallId !== ev.toolCallId) {
        card = state.messages.find(m => m._toolCallId === ev.toolCallId);
      }
      if (card?.kind === "tool") {
        const updated = window.finalizeToolCard(card, ev);
        // Hub: when the tracked task finishes, switch to summary mode
        if (state.hubTaskId === ev.toolCallId) {
          const finalAgents = updated.subagents ?? state.hubAgents;
          state.hubAgents  = finalAgents;
          state.hubMode    = "summary";
          state.hubHistory = [...state.hubHistory, {
            taskId: ev.toolCallId, agents: finalAgents, time,
          }].slice(-3);
          state.hubTaskId  = null;
        }
      }
      // Update kanban whenever a todo tool completes, even if no tool card was created
      // (e.g. Cursor agent resolves todo server-side and emits tool_execution_end without tool_execution_start).
      const finishedTool = window.normalizeToolName ? window.normalizeToolName(ev.toolName ?? "") : (ev.toolName ?? "");
      if (finishedTool === "todo" || ev.toolName === "todo_write" || ev.toolName === "todo") {
        const raw = ev.result?.details?.phases ?? ev.result?.details?.todos ?? ev.result?.details ?? ev.result?.phases ?? ev.result?.todos ?? ev.result;
        todo.apply(raw, { fallback: raw?.phases ?? raw ?? [] });
      }
      // A tool that may have written files: let the file tree refresh now
      // rather than wait for the turn to end. (`toolName` may be absent on the end frame.)
      if (window.FsActivity.mayChangeFiles(ev.toolName || finished?.tool)) rt.seq.fsEpoch += 1;
      // Ephemeral tool card: remove finished card from chat messages array
      state.messages = state.messages.filter(m => m !== card && m._toolCallId !== ev.toolCallId);
      // Only the ask tool owns ask bubbles; another tool ending must not disturb an in-flight handshake.
      // (`toolName` may be absent on the end frame, so the card is consulted too.)
      if (finishedTool === "ask" || card?.tool === "ask") finalizeAsks({ aborted: Boolean(ev.isError) });
      rt.session.activeToolCards.delete(ev.toolCallId);
      reindexToolCards();
      notify();
    }

    return {
      handlers: {
        tool_execution_start:  onStart,
        tool_execution_update: onUpdate,
        tool_execution_end:    onEnd,
      },
    };
  }

  window._Live.EventsTool = { create };
})();
