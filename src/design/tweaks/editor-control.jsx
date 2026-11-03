/* tweaks/editor-control.jsx — External editor command control for the
   Tweaks panel. The text field spans the full row (the panel is only 280px
   wide); the hint and the Browse / Clear buttons sit on a row below it.
   Value is written live on every change: it is a plain localStorage tweak,
   so there is no blur/commit step to race with the buttons.
   Exposes TweakEditor on window. */

function TweakEditor({ label, value, onChange }) {
  const [errorMsg, setErrorMsg] = React.useState(null);
  const tt = (key, fallback) => (window.t ? window.t(key, null, fallback) : fallback);

  const handleBrowse = React.useCallback(async () => {
    setErrorMsg(null);
    if (!window.__TAURI__) return;
    try {
      const picked = await window.__TAURI__.core.invoke("pick_editor_executable");
      if (picked) onChange(window.EditorCommand.quoteIfNeeded(picked));
    } catch (err) {
      setErrorMsg(typeof err === "string" ? err : (err?.message || "Failed to pick editor"));
      setTimeout(() => setErrorMsg(null), 3500);
    }
  }, [onChange]);

  return (
    <window.TweakRow label={label}>
      <input
        className="twk-field"
        type="text"
        value={value || ""}
        placeholder={tt("tweaks.editor.placeholder", "e.g. code -g")}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="twk-editor-actions">
        <span className="twk-editor-hint">{tt("tweaks.editor.hint", "Empty = hide the menu item")}</span>
        <button type="button" className="twk-editor-btn" onClick={handleBrowse}>
          {tt("tweaks.editor.browse", "Browse…")}
        </button>
        {value ? (
          <button type="button" className="twk-editor-btn" onClick={() => onChange("")}>
            {tt("tweaks.editor.clear", "Clear")}
          </button>
        ) : null}
      </div>
      {errorMsg && <div className="twk-shortcut-err">{errorMsg}</div>}
    </window.TweakRow>
  );
}

Object.assign(window, { TweakEditor });
