/* ═════════════════════════════════════════════════════════════════════
   review-drawer-width.js — Pure width maths for the resizable drawer
   Min/max clamping, persisted-value sanitising and drag deltas, kept
   free of React/DOM so it can be unit-tested.
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ReviewDrawerWidth = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_WIDTH = 580;
  const MIN_WIDTH = 400;
  const MAX_VIEWPORT_RATIO = 0.85;

  /** Widest the drawer may be dragged to for a given viewport width. */
  function maxWidth(viewport) {
    const vw = Number.isFinite(viewport) && viewport > 0 ? viewport : DEFAULT_WIDTH * 2;
    return Math.max(MIN_WIDTH, Math.floor(vw * MAX_VIEWPORT_RATIO));
  }

  function clampWidth(width, viewport) {
    if (!Number.isFinite(width)) return Math.min(DEFAULT_WIDTH, maxWidth(viewport));
    return Math.max(MIN_WIDTH, Math.min(maxWidth(viewport), Math.round(width)));
  }

  /** Sanitise a persisted localStorage value (null / NaN / out-of-range safe). */
  function parseSavedWidth(raw, viewport) {
    if (raw === null || raw === undefined || raw === "") return clampWidth(DEFAULT_WIDTH, viewport);
    return clampWidth(parseInt(raw, 10), viewport);
  }

  /** Width after dragging the left edge: moving left (negative dx) widens. */
  function widthAfterDrag(startWidth, startX, currentX, viewport) {
    return clampWidth(startWidth + (startX - currentX), viewport);
  }

  return {
    DEFAULT_WIDTH,
    MIN_WIDTH,
    MAX_VIEWPORT_RATIO,
    maxWidth,
    clampWidth,
    parseSavedWidth,
    widthAfterDrag,
  };
});
