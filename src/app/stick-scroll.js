/* ═════════════════════════════════════════════════════════════════════
   stick-scroll.js — pure logic behind "pin a streaming output box to its
   bottom, pause when the user scrolls up". Consumed by
   design/ui/use-stick-scroll.jsx. Exposes window.StickScroll.
   ═════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  /** Distance (px) from the bottom that still counts as "at the bottom". */
  const DEFAULT_THRESHOLD = 40;

  /** True when `el` is scrolled to (or within `threshold` px of) its bottom. */
  function isNearBottom(el, threshold = DEFAULT_THRESHOLD) {
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
  }

  /**
   * Next "pinned" state.
   * - Scroll event (`nearBottom` is a boolean): follow the user's position,
   *   so scrolling up pauses pinning and scrolling back down resumes it.
   * - Content/active change: an inactive -> active transition (e.g. a
   *   collapsed row re-opened while still streaming) re-pins; otherwise keep.
   */
  function nextStick({ stuck, active, wasActive, nearBottom }) {
    if (typeof nearBottom === "boolean") return nearBottom;
    if (active && !wasActive) return true;
    return stuck;
  }

  window.StickScroll = { DEFAULT_THRESHOLD, isNearBottom, nextStick };
})();
