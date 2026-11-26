/* ═════════════════════════════════════════════════════════════════════
   app/refresh-gate.js — one throttle in front of every auto-refresh source
   (OS watcher, agent tool end, turn end, window focus). Sources often fire
   together, so requests inside the cooldown merge into a single trailing
   run instead of being dropped (the last change must still be shown).
   Plain script (IIFE): exposes `window.RefreshGate`.
   ═════════════════════════════════════════════════════════════════════ */
(function () {
  const DEFAULT_COOLDOWN_MS = 400;

  /**
   * @param {object}   opts
   * @param {Function} opts.run                 the refresh to perform
   * @param {number}   [opts.cooldownMs=400]    min gap between two runs
   * @param {Function} [opts.isHidden]          true while the window is hidden:
   *                                            requests are dropped (focus /
   *                                            visibility asks again on return)
   * @param {Function} [opts.now]               clock, injectable for tests
   * @param {Function} [opts.setTimer]          `setTimeout`, injectable
   * @param {Function} [opts.clearTimer]        `clearTimeout`, injectable
   */
  function create({
    run,
    cooldownMs = DEFAULT_COOLDOWN_MS,
    isHidden = () => false,
    now = () => Date.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id),
  }) {
    let lastRun = -Infinity;
    let timer = null;

    function fire() {
      timer = null;
      // Hidden since the trailing run was queued: skip it, and do not stamp
      // `lastRun`, or the refresh asked for on return would hit the cooldown.
      if (isHidden()) return;
      lastRun = now();
      run();
    }

    function request() {
      if (isHidden()) return;
      if (timer !== null) return; // a trailing run is already queued
      const wait = cooldownMs - (now() - lastRun);
      if (wait <= 0) fire();
      else timer = setTimer(fire, wait);
    }

    function cancel() {
      if (timer !== null) clearTimer(timer);
      timer = null;
    }

    return { request, cancel };
  }

  window.RefreshGate = { create, DEFAULT_COOLDOWN_MS };
})();
