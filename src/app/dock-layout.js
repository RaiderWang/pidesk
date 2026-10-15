/* app/dock-layout.js — pure stage grid maths: which panels are visible at a
   given window width and the matching `grid-template-columns`.
   Column order: [activity bar] [files] <session 1fr> [split peer] [dock]. */
(function () {
  const ACTIVITY_W = 44;
  const FILES = { min: 160, max: 600, def: 240 };
  const DOCK = { min: 220, max: 520, def: 280 };
  const SPLIT = { min: 240, max: 480, def: 320 };
  const COLLAPSE_BELOW = 900; // files tree + dock auto-hide
  const NARROW_BELOW = 1100;  // dock/split shrink to their compact widths
  const NARROW_DOCK_W = 240;
  const NARROW_SPLIT_W = 280;

  function clamp(n, range) {
    const v = Number(n);
    if (!Number.isFinite(v)) return range.def;
    return Math.round(Math.min(range.max, Math.max(range.min, v)));
  }

  /** Resolve visibility + pixel widths. `width` (window px) is optional:
   *  omit it to skip the responsive rules. */
  function resolveStageLayout(opts) {
    const o = opts || {};
    const hasWidth = Number.isFinite(o.width);
    const collapsed = hasWidth && o.width < COLLAPSE_BELOW;
    const narrow = hasWidth && o.width < NARROW_BELOW;

    const activity = o.activity !== false;
    const files = Boolean(o.files) && !collapsed;
    const dock = Boolean(o.dock) && !collapsed;
    const split = Boolean(o.split);

    const filesW = clamp(o.filesW, FILES);
    let dockW = clamp(o.dockW, DOCK);
    let splitW = clamp(o.splitW, SPLIT);
    if (narrow) {
      dockW = Math.min(dockW, NARROW_DOCK_W);
      splitW = Math.min(splitW, NARROW_SPLIT_W);
    }

    const cols = [];
    if (activity) cols.push(`${ACTIVITY_W}px`);
    if (files) cols.push(`${filesW}px`);
    cols.push("minmax(0, 1fr)");
    if (split) cols.push(`${splitW}px`);
    if (dock) cols.push(`${dockW}px`);

    return { activity, files, split, dock, collapsed, filesW, splitW, dockW, columns: cols.join(" ") };
  }

  function buildStageColumns(opts) {
    return resolveStageLayout(opts).columns;
  }

  window.DockLayout = {
    ACTIVITY_W, FILES, DOCK, SPLIT, COLLAPSE_BELOW, NARROW_BELOW,
    clamp, resolveStageLayout, buildStageColumns,
  };
})();
