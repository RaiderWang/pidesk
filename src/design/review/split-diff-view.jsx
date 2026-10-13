/* ═════════════════════════════════════════════════════════════════════
   split-diff-view.jsx — Side-by-Side (Split) Diff View Component
   Renders side-by-side diff columns with aligned modifications,
   independent line gutters, per-side annotation triggers, and
   full-width inline annotation cards.
   ═════════════════════════════════════════════════════════════════════ */

function SplitDiffView({
  file,
  fileNotes,
  editingLineKey,
  onStartAnnotate,
  onSaveAnnotate,
  onCancelAnnotate,
  onDeleteAnnotate,
}) {
  const t = window.t;

  const splitRows = React.useMemo(() => {
    if (!window.ReviewSplit?.buildSplitRows) {
      return [];
    }
    return window.ReviewSplit.buildSplitRows(file.rows);
  }, [file.rows]);

  return (
    <div className="review-diff-scroll view-split">
      <div className="rd-split-table">
        {/* Split Column Headers */}
        <div className="rd-split-head-row">
          <div className="rd-split-head-col pane-left">
            <span>{t ? t("review.split.original") : "Original"}</span>
          </div>
          <div className="rd-split-head-col pane-right">
            <span>{t ? t("review.split.modified") : "Modified"}</span>
          </div>
        </div>

        {/* Diff Rows */}
        {splitRows.map((item, idx) => {
          if (item.type === "hunk") {
            return (
              <div key={`hunk-${idx}`} className="rd-split-hunk">
                {item.text}
              </div>
            );
          }

          if (item.type === "no-newline") {
            return (
              <div key={`nnl-${idx}`} className="rd-split-hunk rd-split-no-newline">
                {item.text}
              </div>
            );
          }

          // Keys come from the underlying unified row (old:<n> / new:<n>): a context
          // line shares one key across both panes, and a removed line never collides
          // with an added line of the same number.
          const keyOf = window.ReviewAnnotationKeys.keyForRow;
          const leftLineKey = keyOf(item.left?.raw);
          const rightLineKey = keyOf(item.right?.raw);

          const hasLeftNote = leftLineKey !== null && Boolean(fileNotes[leftLineKey]);
          const isEditingLeft = leftLineKey !== null && editingLineKey === leftLineKey;

          const hasRightNote = rightLineKey !== null && Boolean(fileNotes[rightLineKey]);
          const isEditingRight = rightLineKey !== null && editingLineKey === rightLineKey;

          return (
            <React.Fragment key={`split-row-${idx}`}>
              <div className="rd-split-row">
                {/* Left Pane (Original / Removed) */}
                <div className={`rd-split-pane pane-left k-${item.left.kind}`}>
                  {leftLineKey !== null && (
                    <button
                      type="button"
                      className="rd-add-note-btn rd-split-add-btn"
                      title={t("review.annotation.add")}
                      onClick={() => onStartAnnotate(file.path, leftLineKey)}
                    >
                      +
                    </button>
                  )}
                  <span className="rd-gutter">
                    {item.left.lineNum !== null && item.left.lineNum !== undefined
                      ? item.left.lineNum
                      : ""}
                  </span>
                  <span className="rd-mark">
                    {item.left.kind === "rem" ? "-" : " "}
                  </span>
                  <span className="rd-code">{item.left.text}</span>
                </div>

                {/* Right Pane (Modified / Added) */}
                <div className={`rd-split-pane pane-right k-${item.right.kind}`}>
                  {rightLineKey !== null && (
                    <button
                      type="button"
                      className="rd-add-note-btn rd-split-add-btn"
                      title={t("review.annotation.add")}
                      onClick={() => onStartAnnotate(file.path, rightLineKey)}
                    >
                      +
                    </button>
                  )}
                  <span className="rd-gutter">
                    {item.right.lineNum !== null && item.right.lineNum !== undefined
                      ? item.right.lineNum
                      : ""}
                  </span>
                  <span className="rd-mark">
                    {item.right.kind === "add" ? "+" : " "}
                  </span>
                  <span className="rd-code">{item.right.text}</span>
                </div>
              </div>

              {/* Render left-side annotation if any */}
              {(hasLeftNote || isEditingLeft) && (
                <div className="rd-split-annotation-wrap">
                  <window.AnnotationRow
                    fileKey={file.path}
                    lineKey={leftLineKey}
                    existingNote={fileNotes[leftLineKey]}
                    isEditing={isEditingLeft}
                    onSave={onSaveAnnotate}
                    onCancel={onCancelAnnotate}
                    onDelete={onDeleteAnnotate}
                  />
                </div>
              )}

              {/* Render right-side annotation if distinct from left */}
              {rightLineKey !== null && rightLineKey !== leftLineKey && (hasRightNote || isEditingRight) && (
                <div className="rd-split-annotation-wrap">
                  <window.AnnotationRow
                    fileKey={file.path}
                    lineKey={rightLineKey}
                    existingNote={fileNotes[rightLineKey]}
                    isEditing={isEditingRight}
                    onSave={onSaveAnnotate}
                    onCancel={onCancelAnnotate}
                    onDelete={onDeleteAnnotate}
                  />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

window.SplitDiffView = SplitDiffView;
