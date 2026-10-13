/* ═════════════════════════════════════════════════════════════════════
   review-annotation-keys.js — Line annotation key scheme
   A unified-diff row is addressed by `old:<n>` (removed lines, old file
   numbering) or `new:<n>` (added + context lines, new file numbering), so
   a removed line 12 and an added line 12 never collide. Legacy `L<n>` keys
   (pre-0.3.4 storage) are still understood for display/prompt purposes.
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ReviewAnnotationKeys = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /** Key for a parsed unified row, or null when the row is not annotatable. */
  function keyForRow(row) {
    if (!row) return null;
    if (row.kind === "rem" && Number.isInteger(row.oldLine)) return `old:${row.oldLine}`;
    if ((row.kind === "add" || row.kind === "ctx") && Number.isInteger(row.newLine)) {
      return `new:${row.newLine}`;
    }
    return null;
  }

  /** Parse a key into `{ side: "old" | "new" | "legacy", line }`, or null. */
  function parseKey(key) {
    if (typeof key !== "string") return null;
    const m = /^(old|new):(\d+)$/.exec(key);
    if (m) return { side: m[1], line: Number(m[2]) };
    const legacy = /^L(\d+)$/.exec(key);
    if (legacy) return { side: "legacy", line: Number(legacy[1]) };
    return null;
  }

  /** Find the parsed diff row a key points at (best effort for legacy keys). */
  function findRow(file, key) {
    const parsed = parseKey(key);
    if (!parsed || !file || !Array.isArray(file.rows)) return null;
    const { side, line } = parsed;
    const rows = file.rows;
    if (side === "old") return rows.find((r) => r.kind === "rem" && r.oldLine === line) || null;
    if (side === "new") {
      return rows.find((r) => (r.kind === "add" || r.kind === "ctx") && r.newLine === line) || null;
    }
    return (
      rows.find((r) => (r.kind === "add" || r.kind === "ctx") && r.newLine === line) ||
      rows.find((r) => r.kind === "rem" && r.oldLine === line) ||
      null
    );
  }

  /** Sort comparator: new-side first by line, then removed lines. */
  function compareKeys(a, b) {
    const pa = parseKey(a);
    const pb = parseKey(b);
    if (!pa || !pb) return String(a).localeCompare(String(b));
    if (pa.line !== pb.line) return pa.line - pb.line;
    return pa.side.localeCompare(pb.side);
  }

  return { keyForRow, parseKey, findRow, compareKeys };
});
