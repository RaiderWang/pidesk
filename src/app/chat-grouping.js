/* app/chat-grouping.js — pure helpers that fold runs of consecutive tool
   messages into a single collapsible group for ChatView.

   Rules:
   - Only `kind === "tool"` messages are grouped. Any other kind (user,
     assistant, ask, compact …) ends the current run.
   - A run is split at its first still-running tool: the finished head is
     grouped (when it has at least `minRun` items), the rest stays as plain
     messages so the live tail is always visible and the head's group key
     stays stable while the run grows.
   - Every item keeps its original index in `messages`, so the minimap and
     `data-msg-idx` lookups keep working. */
(function () {
  const DEFAULT_MIN_RUN = 3;

  function isToolMsg(m) {
    return Boolean(m) && m.kind === "tool";
  }

  function isFailed(m) {
    return m.status === "error" || m.status === "failed";
  }

  /** Aggregate counters for a list of `{ idx, msg }` items. */
  function summarizeRun(items) {
    const byTool = {};
    let failed = 0;
    let aborted = 0;
    let durationMs = 0;
    for (const { msg } of items) {
      const tool = msg.tool || "tool";
      byTool[tool] = (byTool[tool] || 0) + 1;
      if (isFailed(msg)) failed += 1;
      else if (msg.status === "aborted") aborted += 1;
      if (typeof msg.duration === "number" && msg.duration > 0) durationMs += msg.duration;
    }
    return { total: items.length, byTool, failed, aborted, durationMs };
  }

  function pushPlain(out, items) {
    for (const it of items) out.push({ type: "msg", idx: it.idx, msg: it.msg });
  }

  function flushRun(out, run, minRun) {
    if (run.length === 0) return;
    let firstRunning = run.findIndex((it) => it.msg.status === "running");
    if (firstRunning === -1) firstRunning = run.length;
    const head = run.slice(0, firstRunning);
    const tail = run.slice(firstRunning);
    if (head.length >= minRun) {
      const first = head[0];
      out.push({
        type: "group",
        key: first.msg._id ?? `idx-${first.idx}`,
        startIdx: first.idx,
        endIdx: head[head.length - 1].idx,
        items: head,
        stats: summarizeRun(head),
      });
    } else {
      pushPlain(out, head);
    }
    pushPlain(out, tail);
  }

  /**
   * @param {Array} messages
   * @param {{ minRun?: number, enabled?: boolean }} [opts]
   * @returns {Array<{type:"msg",idx:number,msg:object}|{type:"group",key:string|number,startIdx:number,endIdx:number,items:Array,stats:object}>}
   */
  function groupToolRuns(messages, opts) {
    const minRun = Math.max(2, (opts && opts.minRun) || DEFAULT_MIN_RUN);
    const enabled = !opts || opts.enabled !== false;
    const out = [];
    let run = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (enabled && isToolMsg(msg)) {
        run.push({ idx: i, msg });
        continue;
      }
      flushRun(out, run, minRun);
      run = [];
      out.push({ type: "msg", idx: i, msg });
    }
    flushRun(out, run, minRun);
    return out;
  }

  /** Key of the group that contains message `idx`, or null. */
  function findGroupKeyForIdx(entries, idx) {
    for (const e of entries) {
      if (e.type === "group" && idx >= e.startIdx && idx <= e.endIdx) return e.key;
    }
    return null;
  }

  window.ChatGrouping = { groupToolRuns, summarizeRun, findGroupKeyForIdx, DEFAULT_MIN_RUN };
})();
