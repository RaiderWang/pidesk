/* export-format-modal.jsx — `/export` format choice.

   The format is picked here, in-app, before the native save dialog: the
   dialog cannot offer a reliable format dropdown on macOS/Linux. */

const EXPORT_FORMATS = [
  { id: "markdown", icon: "file",     titleKey: "export.format.markdown", bodyKey: "export.format.markdown.body" },
  { id: "html",     icon: "download", titleKey: "export.format.html",     bodyKey: "export.format.html.body" },
];

function ExportFormatModal({ onPick, onClose }) {
  const t = (key, params) => (window.t ? window.t(key, params) : key);

  return (
    <window.Modal layer="nested" size="sm" placement="center" onClose={onClose} ariaLabel={t("export.modal.title")}>
      <div className="modal-pad">
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--accent)", fontWeight: 600 }}>
          <window.Icon name="download" size={16} /> {t("export.modal.title")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {EXPORT_FORMATS.map((f, i) => (
            <button
              key={f.id}
              type="button"
              className="btn outlined"
              autoFocus={i === 0}
              onClick={() => onPick(f.id)}
              style={{ display: "flex", alignItems: "flex-start", gap: 10, textAlign: "left", height: "auto", padding: "10px 12px" }}
            >
              <window.Icon name={f.icon} size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontWeight: 600 }}>{t(f.titleKey)}</span>
                <span style={{ fontSize: "var(--d-text-sm)", color: "var(--fg-3)", whiteSpace: "normal" }}>{t(f.bodyKey)}</span>
              </span>
            </button>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="btn ghost" onClick={onClose}>{t("export.modal.cancel")}</button>
        </div>
      </div>
    </window.Modal>
  );
}

window.ExportFormatModal = ExportFormatModal;
