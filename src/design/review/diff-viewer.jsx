/* ═════════════════════════════════════════════════════════════════════
   diff-viewer.jsx — Code Review Diff Content Viewer Component
   Coordinates view mode selection (unified vs. split), file path toolbar,
   and delegates diff rendering to UnifiedDiffView or SplitDiffView.
   ═════════════════════════════════════════════════════════════════════ */

function DiffViewer({
  file,
  annotations,
  editingLineKey,
  onStartAnnotate,
  onSaveAnnotate,
  onCancelAnnotate,
  onDeleteAnnotate,
}) {
  const [viewMode, setViewMode] = React.useState(() => {
    try {
      return localStorage.getItem("pidesk_review_view_mode") || "unified";
    } catch {
      return "unified";
    }
  });
  const t = window.t;

  const handleSelectMode = (mode) => {
    setViewMode(mode);
    try {
      localStorage.setItem("pidesk_review_view_mode", mode);
    } catch {}
  };

  if (!file) {
    return (
      <div className="review-state-card">
        <div className="review-state-title">
          {t ? t("review.files.none") : "No file selected"}
        </div>
      </div>
    );
  }

  const fileNotes = annotations[file.path] || {};

  return (
    <div className={`review-diff-pane ${viewMode === "split" ? "is-split-view" : "is-unified-view"}`}>
      <div className="review-diff-toolbar">
        <span className="review-diff-path">{file.path}</span>
        <div className="review-view-toggles">
          <button
            type="button"
            className={`review-view-btn ${viewMode === "unified" ? "active" : ""}`}
            onClick={() => handleSelectMode("unified")}
          >
            {t ? t("review.view.unified") : "Unified"}
          </button>
          <button
            type="button"
            className={`review-view-btn ${viewMode === "split" ? "active" : ""}`}
            onClick={() => handleSelectMode("split")}
          >
            {t ? t("review.view.split") : "Split"}
          </button>
        </div>
      </div>

      {viewMode === "split" && window.SplitDiffView ? (
        <window.SplitDiffView
          file={file}
          fileNotes={fileNotes}
          editingLineKey={editingLineKey}
          onStartAnnotate={onStartAnnotate}
          onSaveAnnotate={onSaveAnnotate}
          onCancelAnnotate={onCancelAnnotate}
          onDeleteAnnotate={onDeleteAnnotate}
        />
      ) : (
        <window.UnifiedDiffView
          file={file}
          fileNotes={fileNotes}
          editingLineKey={editingLineKey}
          onStartAnnotate={onStartAnnotate}
          onSaveAnnotate={onSaveAnnotate}
          onCancelAnnotate={onCancelAnnotate}
          onDeleteAnnotate={onDeleteAnnotate}
        />
      )}
    </div>
  );
}

window.DiffViewer = DiffViewer;
