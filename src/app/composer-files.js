/* ═════════════════════════════════════════════════════════════════════
   app/composer-files.js — tiny pub/sub that lets the file panel, command
   palette and composer @-autocomplete attach a file chip to the composer
   without reaching into its React state. Mirrors app/composer-insert.js.
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ComposerFiles = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const listeners = new Set();

  function normalize(rel) {
    return String(rel || "").trim().replace(/\\/g, "/");
  }

  /** Append `rel` to `list` unless already present. Returns the same list when unchanged. */
  function addUnique(list, rel) {
    const p = normalize(rel);
    if (!p || list.includes(p)) return list;
    return [...list, p];
  }

  /** Ask the composer to attach `rel` (project-relative). Returns true when a composer received it. */
  function add(rel) {
    const p = normalize(rel);
    if (!p || listeners.size === 0) return false;
    for (const fn of Array.from(listeners)) fn(p);
    return true;
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return { add, subscribe, addUnique, normalize };
});
