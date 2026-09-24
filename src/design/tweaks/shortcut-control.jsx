/* tweaks/shortcut-control.jsx — Shortcut recording control for Tweaks panel.
   Exposes TweakShortcut component on window. */

function TweakShortcut({ label, value, defaultValue, onChange }) {
  const [recording, setRecording] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState(null);
  const btnRef = React.useRef(null);

  const displayVal = React.useMemo(() => {
    if (recording) {
      return window.t ? window.t("tweaks.shortcut.recording", null, "Press keys…") : "Press keys…";
    }
    return window.ShortcutUtil?.formatDisplayShortcut(value) || value || "—";
  }, [recording, value]);

  const handleKeyDown = React.useCallback((e) => {
    if (!recording) return;

    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Escape") {
      setRecording(false);
      return;
    }

    const combo = window.ShortcutUtil?.parseKeyCombo(e);
    if (!combo) return; // Only modifier was pressed, keep recording

    setRecording(false);
    setErrorMsg(null);

    Promise.resolve(onChange(combo)).catch((err) => {
      const msg = typeof err === "string" ? err : (err?.message || "Invalid shortcut");
      setErrorMsg(msg);
      setTimeout(() => setErrorMsg(null), 3500);
    });
  }, [recording, onChange]);

  const startRecording = React.useCallback(() => {
    setErrorMsg(null);
    setRecording(true);
  }, []);

  const handleBlur = React.useCallback(() => {
    if (recording) {
      setRecording(false);
    }
  }, [recording]);

  const handleReset = React.useCallback((e) => {
    e.stopPropagation();
    if (!defaultValue || defaultValue === value) return;
    setErrorMsg(null);
    Promise.resolve(onChange(defaultValue)).catch((err) => {
      const msg = typeof err === "string" ? err : (err?.message || "Invalid shortcut");
      setErrorMsg(msg);
      setTimeout(() => setErrorMsg(null), 3500);
    });
  }, [defaultValue, value, onChange]);

  return (
    <window.TweakRow label={label}>
      <div className="twk-shortcut-wrap">
        <button
          ref={btnRef}
          type="button"
          className={`twk-shortcut-btn${recording ? " recording" : ""}`}
          onClick={startRecording}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          title={recording ? "Press new shortcut combination (Esc to cancel)" : "Click to record shortcut"}
        >
          {displayVal}
        </button>
        {defaultValue && defaultValue !== value && (
          <button
            type="button"
            className="twk-shortcut-reset"
            title={window.t ? window.t("tweaks.shortcut.reset", null, "Reset to default") : "Reset to default"}
            onClick={handleReset}
          >
            {window.t ? window.t("tweaks.shortcut.reset", null, "Reset") : "Reset"}
          </button>
        )}
      </div>
      {errorMsg && <div className="twk-shortcut-err">{errorMsg}</div>}
    </window.TweakRow>
  );
}

Object.assign(window, { TweakShortcut });
