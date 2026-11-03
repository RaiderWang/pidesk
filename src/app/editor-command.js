/* app/editor-command.js — helpers for the external-editor tweak (the
   `externalEditor` command line used by the file tree's "Open in external
   editor" action). Pure logic, covered by test/editor-command.test.mjs.
   The Rust side (src-tauri/src/external_editor/launch.rs) splits the
   command on whitespace with double-quote grouping, so a path with spaces
   must be quoted before it is stored. */
(function () {
  /** Wrap `path` in double quotes when it contains whitespace (idempotent). */
  function quoteIfNeeded(path) {
    const p = typeof path === "string" ? path.trim() : "";
    if (!p) return "";
    if (p.length >= 2 && p.startsWith('"') && p.endsWith('"')) return p;
    return /\s/.test(p) ? `"${p}"` : p;
  }

  /** True when the tweak holds a non-blank command. */
  function isConfigured(editor) {
    return typeof editor === "string" && editor.trim().length > 0;
  }

  window.EditorCommand = { quoteIfNeeded, isConfigured };
})();
