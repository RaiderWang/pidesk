/* live/window-chrome.js — frameless-window drag + min/max/close controls (Tauri only).

   Uses document-level delegation: React mounts after DOMContentLoaded, so a
   querySelector here would miss the buttons.
   Registers window._Live.WindowChrome; no dependencies. */
(function () {
  "use strict";
  window._Live = window._Live || {};

  function setup() {
    if (!window.__TAURI__) return;
    const { getCurrentWindow } = window.__TAURI__.window;
    const win  = getCurrentWindow();
    const isWin = navigator.userAgent.includes("Windows") || navigator.platform.startsWith("Win");

    // Drag: delegate from document so it works regardless of React render timing.
    // startDragging() must be called synchronously within the mousedown handler.
    document.addEventListener("mousedown", e => {
      if (!e.target.closest(".chrome")) return;
      if (e.target.closest("button, .chrome-lights, .win-controls")) return;
      win.startDragging().catch(() => {});
    });

    if (isWin) {
      document.addEventListener("click", e => {
        if (e.target.closest(".win-min"))        win.minimize();
        else if (e.target.closest(".win-max"))   win.isMaximized().then(m => m ? win.unmaximize() : win.maximize());
        else if (e.target.closest(".win-close")) win.close();
      });
    } else {
      document.addEventListener("click", e => {
        const t = e.target.closest(".light");
        if (!t) return;
        if (t.classList.contains("red"))        win.close();
        else if (t.classList.contains("amber")) win.minimize();
        else if (t.classList.contains("green")) win.isMaximized().then(m => m ? win.unmaximize() : win.maximize());
      });
    }
  }

  window._Live.WindowChrome = { setup };
})();
