/* ═════════════════════════════════════════════════════════════════════
   file-tree-delete-modal.jsx — delete confirmation dialog for FileTreePanel.
   ═════════════════════════════════════════════════════════════════════ */

const { Icon } = window;

function FileTreeDeleteModal({ target, onCancel, onConfirm }) {
  const fallbackMsg = `Are you sure you want to delete ${target.name}?`;
  return (
    <div className="files-modal-scrim" onClick={onCancel}>
      <div className="files-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="files-modal-title">
          <Icon name="trash" size={14} color="var(--rose, #ff5f57)" />
          <span>
            {window.t ? window.t("files.delete.title", null, "Delete Item") : "Delete Item"}
          </span>
        </div>
        <div className="files-modal-body">
          {window.t
            ? window.t("files.delete.confirm", { name: target.name }, fallbackMsg)
            : fallbackMsg}
        </div>
        <div className="files-modal-foot">
          <button className="btn ghost" onClick={onCancel}>
            {window.t ? window.t("files.delete.cancel", null, "Cancel") : "Cancel"}
          </button>
          <button className="btn danger" onClick={onConfirm}>
            {window.t ? window.t("files.delete.delete", null, "Delete") : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { FileTreeDeleteModal });
