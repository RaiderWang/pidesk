/* ═════════════════════════════════════════════════════════════════════
   export-bridge.js — orchestration for "/export" (Markdown or HTML).

   Markdown: get_entries → ExportMarkdown.toMarkdown → (empty? say so, no
   dialog) → Rust `save_markdown_export` (dialog + write in one command).
   HTML:     omp `export_html` writes the file → Rust `save_html_export`
   (dialog, move, cleanup in one command). The WebView never passes a
   destination path.

   Like undo, an export awaits RPC responses on the *current* line listener,
   so tab switches wait for it (`whenIdle`) and every notice is written only
   to the tab the export started in.

   Known limit: get_entries is one stdout line, and the Rust reader drops
   lines over 16 MiB — a huge image-laden session times out; the message
   points the user at the HTML export.

   Loaded as a plain script before live.js; live.js injects its IIFE-private
   helpers via ExportBridge.create(deps) (same pattern as UndoBridge).
   ═════════════════════════════════════════════════════════════════════ */

(function () {
  const RPC_TIMEOUT_MS = 30000;
  const ABSOLUTE_PATH = /^[A-Za-z]:[\\/]|^\//;

  /**
   * deps:
   *   state, notify, sendWithResponse(cmd, timeout), getActiveSessionId()
   *   getSessionInfo() — `{ name, cwd }` of the active session (cwd may be "")
   */
  function create(deps) {
    let inflight = null;

    const tr = (key, params) => (window.t ? window.t(key, params) : key);

    /** Write a notice into the originating tab only — never whichever tab is active now. */
    function notice(sessionId, text) {
      if (deps.getActiveSessionId() !== sessionId) {
        console.warn(`[live] export notice dropped after tab switch: ${text}`);
        return;
      }
      deps.state.messages = [...deps.state.messages, window.NoticeBubble.make(text)];
      deps.notify();
    }

    const warn = (sessionId, key, params) => {
      notice(sessionId, `⚠️ ${tr(key, params)}`);
      return { ok: false, reason: key };
    };

    function failure(sessionId, err, timeoutKey) {
      const message = err?.message ?? String(err);
      console.warn("[live] export failed:", err);
      if (timeoutKey && /timed out/i.test(message)) return warn(sessionId, timeoutKey);
      return warn(sessionId, "export.fail.generic", { error: message });
    }

    const labels = () => ({
      user: tr("export.role.user"),
      assistant: tr("export.role.assistant"),
      image: tr("export.image"),
    });

    const dialogArgs = (info, titleKey) => ({
      // Tab titles come from the first prompt and may contain path separators; the
      // dialog suggestion must keep the whole title, so flatten them (Rust would
      // otherwise keep only the part after the last separator).
      defaultName: (info.name || "").replace(/[\\/]+/g, "_") || null,
      title: tr(titleKey),
    });

    function done(sessionId, savedPath, kind) {
      if (!savedPath) return { ok: false, reason: "cancelled" }; // dialog cancelled: stay quiet
      // The path is appended, not passed as an i18n param: `t()` feeds params to
      // String.replace, where `$&`-style sequences in a path would be expanded.
      notice(sessionId, `✅ ${tr(`export.done.${kind}`)} \`${savedPath}\``);
      return { ok: true, path: savedPath };
    }

    async function exportMarkdown(sessionId, info) {
      let listing;
      try {
        listing = (await deps.sendWithResponse({ type: "get_entries" }, RPC_TIMEOUT_MS)) ?? {};
      } catch (err) {
        return failure(sessionId, err, "export.fail.timeoutMd");
      }
      if (deps.getActiveSessionId() !== sessionId) return { ok: false, reason: "switched" };

      const content = window.ExportMarkdown.toMarkdown(listing.entries, listing.leafId, labels());
      if (!content) return warn(sessionId, "export.fail.empty");

      try {
        const saved = await window.__TAURI__.core.invoke("save_markdown_export", {
          content,
          ...dialogArgs(info, "export.dialog.markdown"),
        });
        return done(sessionId, saved, "markdown");
      } catch (err) {
        return failure(sessionId, err);
      }
    }

    async function exportHtml(sessionId, info) {
      try {
        const data = await deps.sendWithResponse({ type: "export_html" }, RPC_TIMEOUT_MS);
        // omp writes the file itself and returns its path (relative to the session cwd).
        const filename = data?.path ?? null;
        if (!filename) return warn(sessionId, "export.fail.noPath");

        const sourcePath =
          ABSOLUTE_PATH.test(filename) || !info.cwd ? filename : `${info.cwd}/${filename}`;
        const saved = await window.__TAURI__.core.invoke("save_html_export", {
          sourcePath,
          ...dialogArgs(info, "export.dialog.html"),
        });
        return done(sessionId, saved, "html");
      } catch (err) {
        return failure(sessionId, err);
      }
    }

    /**
     * Export the active session as `"markdown"` or `"html"`. Resolves to
     * `{ ok: true, path }` or `{ ok: false, reason }`; failures after the guard
     * checks surface an i18n warning bubble in the originating tab. A
     * cancelled dialog resolves `{ ok: false, reason: "cancelled" }` silently.
     */
    function exportSession(format) {
      if (!window.__TAURI__ || inflight) return Promise.resolve({ ok: false, reason: "busy" });
      if (format !== "markdown" && format !== "html") return Promise.resolve({ ok: false, reason: "invalid" });
      const sessionId = deps.getActiveSessionId();
      if (!sessionId) return Promise.resolve({ ok: false, reason: "invalid" });
      // A dead omp never answers: without this the RPC would hold `inflight` (and
      // so every tab switch) for the whole 30 s timeout and then blame the size.
      if (deps.state.agentError) {
        return Promise.resolve(warn(sessionId, "export.fail.generic", { error: deps.state.agentError }));
      }

      const info = deps.getSessionInfo() ?? {};
      const run = format === "markdown" ? exportMarkdown : exportHtml;
      const p = run(sessionId, info).finally(() => { inflight = null; });
      inflight = p;
      return p;
    }

    /** Resolves once no export is in flight (see undo-bridge `whenIdle`). */
    function whenIdle() {
      if (!inflight) return Promise.resolve();
      return inflight.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 0)));
    }

    return { exportSession, whenIdle };
  }

  window.ExportBridge = { create };
})();
