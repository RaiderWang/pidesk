/* chat/undo-confirm-modal.jsx — confirmation shown before "undo message".
   Spells out what is cleared and, importantly, what is NOT rolled back. */

function UndoConfirmModal({ open, counts, onConfirm, onCancel }) {
  const t = (key, params) => (window.t ? window.t(key, params) : key);
  const hasLater = Boolean(counts && (counts.messages > 0 || counts.tools > 0));

  return (
    <Modal open={open} layer="nested" size="sm" placement="center" onClose={onCancel} ariaLabel={t("undo.confirm.title")}>
      <div className="modal-pad">
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--accent)", fontWeight: 600 }}>
          <window.Icon name="undo" size={16} /> {t("undo.confirm.title")}
        </div>
        <div style={{ fontSize: "var(--d-text-sm)", color: "var(--fg-2)" }}>
          {hasLater
            ? t("undo.confirm.body", { count: counts.messages, tools: counts.tools })
            : t("undo.confirm.bodyLast")}
        </div>
        <div style={{ fontSize: "var(--d-text-sm)", color: "var(--amber)" }}>
          {t("undo.confirm.files")}
        </div>
        <div style={{ fontSize: "var(--d-text-xs)", color: "var(--fg-4)" }}>
          {t("undo.confirm.backup")}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn ghost" onClick={onCancel}>{t("undo.confirm.cancel")}</button>
          <button className="btn" autoFocus onClick={onConfirm}>{t("undo.confirm.ok")}</button>
        </div>
      </div>
    </Modal>
  );
}

Object.assign(window, { UndoConfirmModal });
