/* ═════════════════════════════════════════════════════════════════════
   review-split.js — Side-by-Side (Split) Diff Alignment Calculator
   Converts unified diff row streams into horizontally aligned
   left (original) and right (modified) side-by-side row pairs.
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ReviewSplit = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const EMPTY_CELL = Object.freeze({
    kind: "empty",
    lineNum: null,
    text: "",
  });

  /**
   * Aligns unified rows into split side-by-side rows.
   *
   * @param {Array<Object>} rows - Unified rows from ReviewDiff.parseSingleFileDiff
   * @returns {Array<Object>} List of split items ({ type: 'hunk' | 'row' | 'no-newline', left, right, ... })
   */
  function buildSplitRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return [];
    }

    const result = [];
    let pendingRem = [];
    let pendingAdd = [];

    function flushPending() {
      if (pendingRem.length === 0 && pendingAdd.length === 0) {
        return;
      }

      const count = Math.max(pendingRem.length, pendingAdd.length);
      for (let i = 0; i < count; i++) {
        const remItem = pendingRem[i];
        const addItem = pendingAdd[i];

        result.push({
          type: "row",
          left: remItem
            ? {
                kind: "rem",
                lineNum: remItem.oldLine,
                text: remItem.text,
                raw: remItem,
              }
            : EMPTY_CELL,
          right: addItem
            ? {
                kind: "add",
                lineNum: addItem.newLine,
                text: addItem.text,
                raw: addItem,
              }
            : EMPTY_CELL,
        });
      }

      pendingRem = [];
      pendingAdd = [];
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      if (row.kind === "hunk") {
        flushPending();
        result.push({
          type: "hunk",
          text: row.text,
          raw: row,
        });
        continue;
      }

      if (row.kind === "no-newline") {
        flushPending();
        result.push({
          type: "no-newline",
          text: row.text,
          raw: row,
        });
        continue;
      }

      if (row.kind === "ctx") {
        flushPending();
        result.push({
          type: "row",
          left: {
            kind: "ctx",
            lineNum: row.oldLine,
            text: row.text,
            raw: row,
          },
          right: {
            kind: "ctx",
            lineNum: row.newLine,
            text: row.text,
            raw: row,
          },
        });
        continue;
      }

      if (row.kind === "rem") {
        // If we already accumulated adds, flush before starting new deletions
        if (pendingAdd.length > 0) {
          flushPending();
        }
        pendingRem.push(row);
        continue;
      }

      if (row.kind === "add") {
        pendingAdd.push(row);
        continue;
      }
    }

    flushPending();
    return result;
  }

  return {
    buildSplitRows,
    EMPTY_CELL,
  };
});
