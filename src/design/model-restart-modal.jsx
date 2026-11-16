/* model-restart-modal.jsx — offered after models.yml is saved.
   omp reads models.yml only at startup, so the active tab's agent must be
   respawned (history kept via --resume) before edited models can be used. */

const RESTART_FAIL_KEYS = {
  "busy":            "models.restart.fail.busy",
  "no-session-file": "models.restart.fail.noSessionFile",
};

function ModelRestartModal({ onConfirm, onClose }) {
  const t = (key, params) => (window.t ? window.t(key, params) : key);
  const [busy, setBusy]   = React.useState(false);
  const [error, setError] = React.useState(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    let r = null;
    try { r = await onConfirm(); } catch (e) { r = { ok: false, error: e?.message || String(e) }; }
    setBusy(false);
    if (r?.ok) { onClose(); return; }
    if (r?.reason === "start-failed") setError(t("models.restart.fail.start", { error: r.error || "" }));
    else setError(t(RESTART_FAIL_KEYS[r?.reason] || "models.restart.fail.generic"));
  };

  return (
    <window.Modal layer="nested" size="sm" placement="center" onClose={busy ? undefined : onClose} ariaLabel={t("models.restart.title")}>
      <div className="modal-pad">
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--accent)", fontWeight: 600 }}>
          <window.Icon name="refresh" size={16} /> {t("models.restart.title")}
        </div>
        <div style={{ fontSize: "var(--d-text-sm)", color: "var(--fg-2)" }}>{t("models.restart.body")}</div>
        {error && <div style={{ fontSize: "var(--d-text-sm)", color: "var(--amber)" }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn ghost" disabled={busy} onClick={onClose}>{t("models.restart.later")}</button>
          <button className="btn" autoFocus disabled={busy} onClick={confirm}>
            {busy ? t("models.restart.restarting") : t("models.restart.ok")}
          </button>
        </div>
      </div>
    </window.Modal>
  );
}

window.ModelRestartModal = ModelRestartModal;
