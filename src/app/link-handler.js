/* ═════════════════════════════════════════════════════════════════════
   app/link-handler.js — keeps Markdown links from navigating the WebView.

   A bare <a href> click makes the WebView leave index.html (the app then
   reloads as a "new conversation"). This installs a capture-phase handler
   for `.md-content a[href]` that always cancels the default action and
   routes the target through LinkTarget.classify:

     external -> invoke("open_url_external", { url })
     path     -> invoke("open_link_path", { path, editor })

   preventDefault() runs synchronously on the first line — never after an
   await. Loaded by index.html and quick-bar.html (needs link-target.js).
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.LinkHandler = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /**
   * deps: { classify, invoke, getCwd(), getEditor() } — all synchronous
   * except `invoke`. Returns the DOM event listener.
   */
  function createHandler(deps) {
    return function onLinkEvent(e) {
      const a = e.target?.closest?.("a[href]");
      if (!a?.closest?.(".md-content")) return;
      e.preventDefault(); // synchronous: before any async work

      // click = primary button; auxclick fires for middle/right buttons.
      const primary = e.type === "click" ? true : e.button === 1;
      if (!primary) return;

      // getAttribute, not `a.href`: the latter is resolved against the app
      // origin ("http://tauri.localhost/x.md") and would look external.
      const target = deps.classify(a.getAttribute("href"), deps.getCwd());
      let call = null;
      if (target.kind === "external") {
        call = deps.invoke("open_url_external", { url: target.url });
      } else if (target.kind === "path") {
        call = deps.invoke("open_link_path", {
          path: target.path,
          editor: deps.getEditor() || null,
        });
      }
      call?.catch?.((err) => console.warn("[link] open failed:", target, err));
    };
  }

  function install() {
    if (typeof document === "undefined") return null;
    const win = window;
    let overrideCwd = null; // set by Quick Bar (no OMP_BRIDGE there)
    let defaultCwd = "";
    const tauriInvoke = (cmd, args) => win.__TAURI__?.core?.invoke?.(cmd, args);

    tauriInvoke("get_default_cwd")?.then((d) => { defaultCwd = d || ""; }).catch(() => {});

    const handler = createHandler({
      classify: (href, cwd) => win.LinkTarget.classify(href, cwd),
      invoke: (cmd, args) => tauriInvoke(cmd, args) ?? Promise.reject(new Error("no tauri")),
      getCwd: () => (overrideCwd ?? win.OMP_BRIDGE?.getCwd?.()) || defaultCwd,
      getEditor: () => win.loadTweaksFromStorage?.()?.externalEditor || "",
    });
    document.addEventListener("click", handler, true);
    document.addEventListener("auxclick", handler, true);
    return { setCwd: (cwd) => { overrideCwd = cwd || ""; } };
  }

  const installed = install();
  return { createHandler, setCwd: (cwd) => installed?.setCwd(cwd) };
});
