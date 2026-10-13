/* ═════════════════════════════════════════════════════════════════════
   annotation-row.jsx — Inline Code Review Annotation Row Component
   Renders user comments embedded directly beneath code lines,
   supporting editing, deletion, and quick keyboard shortcuts.
   ═════════════════════════════════════════════════════════════════════ */

function AnnotationRow({
  fileKey,
  lineKey,
  existingNote,
  isEditing,
  onSave,
  onCancel,
  onDelete,
}) {
  const [draft, setDraft] = React.useState(existingNote || "");
  const inputRef = React.useRef(null);
  const t = window.t;

  React.useEffect(() => {
    if (isEditing) {
      setDraft(existingNote || "");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isEditing, existingNote]);

  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (draft.trim()) onSave(fileKey, lineKey, draft.trim());
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel(fileKey, lineKey);
    }
  };

  const handleSaveClick = () => {
    if (draft.trim()) {
      onSave(fileKey, lineKey, draft.trim());
    }
  };

  if (isEditing) {
    return (
      <div className="rd-annotation-box">
        <textarea
          ref={inputRef}
          className="rd-annotation-input"
          placeholder={t ? t("review.annotation.placeholder") : "Add note for this line…"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="rd-annotation-actions">
          <button
            type="button"
            className="rd-btn-sm rd-btn-cancel"
            onClick={() => onCancel(fileKey, lineKey)}
          >
            {t ? t("review.annotation.cancel") : "Cancel"}
          </button>
          <button
            type="button"
            className="rd-btn-sm rd-btn-save"
            onClick={handleSaveClick}
            disabled={!draft.trim()}
          >
            {t ? t("review.annotation.save") : "Save"}
          </button>
        </div>
      </div>
    );
  }

  if (!existingNote) return null;

  return (
    <div className="rd-annotation-box">
      <div className="rd-annotation-bubble">
        <div className="rd-annotation-text">{existingNote}</div>
        <div className="rd-annotation-actions">
          <button
            type="button"
            className="rd-btn-sm rd-btn-cancel"
            onClick={() => onDelete(fileKey, lineKey)}
          >
            {t ? t("review.annotation.delete") : "Delete"}
          </button>
          <button
            type="button"
            className="rd-btn-sm rd-btn-save"
            onClick={() => onSave(fileKey, lineKey, existingNote, true)}
          >
            {t ? t("review.annotation.edit", null, "Edit") : "Edit"}
          </button>
        </div>
      </div>
    </div>
  );
}

window.AnnotationRow = AnnotationRow;
