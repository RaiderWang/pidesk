/* app/agent-startup-wait.js — waiting for an omp process that is still
   starting (the post-update grace period, see src-tauri/src/agent/grace.rs).
   Pure logic + an injectable poll loop: no DOM, no Tauri (live.js supplies
   the status query), so it is covered by test/agent-startup-wait.test.mjs. */
(function () {
  /** Status poll cadence while omp is starting. */
  const POLL_MS = 500;
  /** Slightly above the Rust grace total (30 s) so its verdict always lands first. */
  const MAX_WAIT_MS = 35000;

  /**
   * Classify a session status `{ error, running, starting }`:
   * "failed" (a cached error exists), "running", "wait" (still starting) or
   * "stopped" (not running and nothing pending — the plain not-running case).
   */
  function decide(status) {
    const s = status || {};
    if (typeof s.error === "string" && s.error.trim()) return "failed";
    if (s.running) return "running";
    if (s.starting) return "wait";
    return "stopped";
  }

  /**
   * Poll `query()` until the session is running, fails, or `maxMs` passes.
   * Resolves with { outcome: "running"|"failed"|"cancelled", error } and calls
   * the matching callback exactly once (never after `isCurrent()` turns
   * false — the user switched tabs). A timeout or a plain "stopped" status
   * is reported as "failed" with an empty error (caller shows its generic text).
   */
  async function waitUntilStarted(opts) {
    const {
      query, isCurrent, onRunning, onFailed,
      sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
      now = () => Date.now(),
      pollMs = POLL_MS, maxMs = MAX_WAIT_MS,
    } = opts;
    const began = now();
    const finish = (outcome, error) => {
      if (outcome === "running") onRunning?.();
      else if (outcome === "failed") onFailed?.(error);
      return { outcome, error };
    };
    while (now() - began < maxMs) {
      await sleep(pollMs);
      if (!isCurrent()) return { outcome: "cancelled", error: "" };
      let status;
      try { status = await query(); } catch (_) { status = { error: "", running: false, starting: true }; }
      if (!isCurrent()) return { outcome: "cancelled", error: "" };
      const verdict = decide(status);
      if (verdict === "running") return finish("running", "");
      if (verdict === "failed") return finish("failed", String(status.error).trim());
      if (verdict === "stopped") return finish("failed", "");
    }
    return finish("failed", "");
  }

  /** Cap per session so a stuck start can't buffer unbounded commands. */
  const QUEUE_MAX = 20;

  /**
   * Commands issued while omp is still starting can't be delivered yet, and
   * dropping them would leave e.g. a sent prompt on screen that omp never
   * saw. `queues` is a Map<sessionId, command[]>; returns false when full.
   */
  function enqueue(queues, id, cmd) {
    const q = queues.get(id) || [];
    if (q.length >= QUEUE_MAX) return false;
    q.push(cmd);
    queues.set(id, q);
    return true;
  }

  /** Take (and forget) everything queued for `id`, oldest first. */
  function drain(queues, id) {
    const q = queues.get(id) || [];
    queues.delete(id);
    return q;
  }

  window.AgentStartupWait = {
    decide, waitUntilStarted, enqueue, drain, POLL_MS, MAX_WAIT_MS, QUEUE_MAX,
  };
})();
