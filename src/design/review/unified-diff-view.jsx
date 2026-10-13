/* ═════════════════════════════════════════════════════════════════════
   unified-diff-view.jsx — Unified Diff Line Renderer Component
   Renders standard unified git diff rows with line numbers,
   +/- indicators, and inline annotation rows.
   ═════════════════════════════════════════════════════════════════════ */

function UnifiedDiffView({
  file,
  fileNotes,
  editingLineKey,
  onStartAnnotate,
  onSaveAnnotate,
  onCancelAnnotate,
  onDeleteAnnotate,
}) {
  const t = window.t;

  return (
    <div className="review-diff-scroll view-unified">
      {file.rows.map((row, idx) => {
        if (row.kind === "hunk") {
          return (
            <div key={`hunk-${idx}`} className="rd-row k-hunk">
              {row.text}
            </div>
          );
        }

        // `old:<n>` for removed lines, `new:<n>` for added/context lines;
        // null for non-code rows such as "\ No newline at end of file".
        const lineKey = window.ReviewAnnotationKeys.keyForRow(row);
        const hasNote = lineKey !== null && Boolean(fileNotes[lineKey]);
        const isEditing = lineKey !== null && editingLineKey === lineKey;

        return (
          <React.Fragment key={`row-${idx}`}>
            <div className={`rd-row k-${row.kind}`}>
              {lineKey !== null && (
                <button
                  type="button"
                  className="rd-add-note-btn"
                  title={t("review.annotation.add")}
                  onClick={() => onStartAnnotate(file.path, lineKey)}
                >
                  +
                </button>
              )}
              <span className="rd-gutter rd-old">
                {row.oldLine !== undefined ? row.oldLine : ""}
              </span>
              <span className="rd-gutter rd-new">
                {row.newLine !== undefined ? row.newLine : ""}
              </span>
              <span className="rd-mark">
                {row.kind === "add" ? "+" : row.kind === "rem" ? "-" : " "}
              </span>
              <span className="rd-code">{row.text}</span>
            </div>

            {(hasNote || isEditing) && (
              <window.AnnotationRow
                fileKey={file.path}
                lineKey={lineKey}
                existingNote={fileNotes[lineKey]}
                isEditing={isEditing}
                onSave={onSaveAnnotate}
                onCancel={onCancelAnnotate}
                onDelete={onDeleteAnnotate}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

window.UnifiedDiffView = UnifiedDiffView;
