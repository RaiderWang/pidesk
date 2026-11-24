/* ui/use-mermaid-save.jsx — "save diagram as PNG" state for MermaidCard.

   Shared by the inline card toolbar and the expanded lightbox, so both show
   one `saving` state (a native save dialog stays open while pending; a
   second click must not stack another). Rasterising lives in
   app/mermaid-export.js, the file dialog in Rust (`save_image_to_disk`).

   status: "idle" | "saving" | "saved". A cancelled dialog returns to idle
   silently; failures raise a LinkToast and also return to idle. */

const _msT = (key, params, fallback) => (window.t ? window.t(key, params, fallback) : fallback);
const _msInvoke = () => window.__TAURI__?.core?.invoke;
const _MS_FEEDBACK_MS = 1500;
// One export at a time across all cards: rapid clicks on different diagrams
// must not stack two save dialogs.
let _msGlobalBusy = false;

function useMermaidSave(code, svg, styleKey) {
  const [status, setStatus] = React.useState("idle");
  const timerRef = React.useRef(null);
  const busyRef = React.useRef(false);
  const aliveRef = React.useRef(true);

  const clearTimer = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  };

  React.useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; clearTimer(); };
  }, []);

  // A new diagram (re-render / theme change) drops any "saved" feedback.
  React.useEffect(() => {
    setStatus((s) => (s === "saved" ? "idle" : s));
    return clearTimer;
  }, [svg]);

  const save = React.useCallback(async () => {
    const invoke = _msInvoke();
    if (busyRef.current || _msGlobalBusy || !svg || !invoke) return;
    busyRef.current = true;
    _msGlobalBusy = true;
    clearTimer();
    setStatus("saving");
    let next = "idle";
    try {
      const [theme, accent] = styleKey.split("|");
      const base64Data = await window.MermaidExport.exportPng({ svg, code, style: { theme, accent } });
      const saved = await invoke("save_image_to_disk", {
        base64Data,
        defaultFilename: window.MermaidExport.defaultFilename(new Date()),
      });
      if (saved) next = "saved";
    } catch (err) {
      const error = String((err && err.message) || err);
      if (window.LinkToast) {
        window.LinkToast.show(_msT("mermaid.saveFailed", { error }, `Couldn't save the image: ${error}`));
      }
    } finally {
      busyRef.current = false;
      _msGlobalBusy = false;
    }
    if (!aliveRef.current) return;
    setStatus(next);
    if (next === "saved") {
      timerRef.current = setTimeout(() => { timerRef.current = null; setStatus("idle"); }, _MS_FEEDBACK_MS);
    }
  }, [code, svg, styleKey]);

  return { status, save, canSave: !!svg && !!window.MermaidExport && typeof _msInvoke() === "function" };
}

const _msLabel = (status) => {
  if (status === "saving") return _msT("mermaid.saving", null, "Saving…");
  if (status === "saved") return _msT("mermaid.saved", null, "Saved");
  return _msT("mermaid.saveImage", null, "Save PNG");
};

Object.assign(window, { useMermaidSave, mermaidSaveLabel: _msLabel });
