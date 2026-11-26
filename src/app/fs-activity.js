/* ═════════════════════════════════════════════════════════════════════
   app/fs-activity.js — which agent tool calls may have changed files.
   Their completion bumps `rt.seq.fsEpoch` (live/events-tool.js), which makes
   the file tree refresh even when the OS watcher reports nothing (sync
   folders, network drives). Plain script (IIFE): `window.FsActivity`.
   ═════════════════════════════════════════════════════════════════════ */
(function () {
  // Tools that only look: finishing one must not rescan every open folder.
  // Raw omp names and the design names `normalizeToolName` folds them into
  // (the end frame may carry only the latter). Anything unknown, `bash`,
  // `edit`, `write`, `lsp` (can rename) … counts as a possible write.
  const READ_ONLY = new Set([
    "read", "search", "find", "grep", "glob", "ls",
    "web_search", "fetch", "todo", "todo_write", "ask", "hub",
  ]);

  /** True unless `toolName` is a known read-only tool. */
  function mayChangeFiles(toolName) {
    return !READ_ONLY.has(String(toolName ?? "").toLowerCase());
  }

  window.FsActivity = { mayChangeFiles, READ_ONLY };
})();
