/* ═════════════════════════════════════════════════════════════════════
   app/link-toast.js — tiny DOM toast for failed link clicks.

   describeFailure(target, err, t) -> user-facing message (pure)
   show(text)                      -> shows a transient `.link-toast`

   Plain DOM (no React) so the main window and the Quick Bar webview share
   it. `err` from `open_link_path` starts with "not found: " when the file
   does not exist (see link_open.rs `NOT_FOUND_PREFIX`).
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.LinkToast = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const NOT_FOUND_PREFIX = "not found: ";
  const VISIBLE_MS = 3000;

  function basename(p) {
    const parts = String(p || "").split(/[\\/]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : String(p || "");
  }

  function describeFailure(target, err, t) {
    const msg = String(err?.message ?? err ?? "");
    if (msg.startsWith(NOT_FOUND_PREFIX)) {
      const name = basename(target?.path || msg.slice(NOT_FOUND_PREFIX.length));
      return t("link.fail.notFound", { name }, `File not found: ${name}`);
    }
    return t("link.fail.generic", { error: msg }, `Couldn't open link: ${msg}`);
  }

  let timer = null;

  function show(text) {
    if (typeof document === "undefined" || !text) return;
    let el = document.querySelector(".link-toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "link-toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = text;
    clearTimeout(timer);
    timer = setTimeout(() => el.remove(), VISIBLE_MS);
  }

  return { describeFailure, show };
});
