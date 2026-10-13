/* ═════════════════════════════════════════════════════════════════════
   file-sidebar.jsx — Review Changed Files Sidebar
   Displays modified files tree, diff counts, annotation indicators,
   and collapsible excluded/vendor lists.
   ═════════════════════════════════════════════════════════════════════ */

function FileSidebar({
  files,
  excludedFiles,
  selectedFilePath,
  annotations,
  onSelectFile,
}) {
  const [showExcluded, setShowExcluded] = React.useState(false);
  const t = window.t;

  return (
    <div className="review-sidebar">
      <div className="review-sidebar-header">
        {t ? t("review.files.title") : "Changed Files"} ({files.length})
      </div>
      <div className="review-file-list">
        {files.map((file) => {
          const isSelected = file.path === selectedFilePath;
          const noteCount = Object.keys(annotations[file.path] || {}).length;

          return (
            <div
              key={file.path}
              className={`review-file-item ${isSelected ? "active" : ""}`}
              onClick={() => onSelectFile(file.path)}
            >
              <span className="review-file-name" title={file.path}>
                {file.path}
              </span>
              <div className="review-file-stats">
                {noteCount > 0 && (
                  <span className="review-notes-badge">{noteCount}</span>
                )}
                {file.linesAdded > 0 && (
                  <span className="review-stat-add">+{file.linesAdded}</span>
                )}
                {file.linesRemoved > 0 && (
                  <span className="review-stat-rem">-{file.linesRemoved}</span>
                )}
              </div>
            </div>
          );
        })}

        {excludedFiles && excludedFiles.length > 0 && (
          <div style={{ marginTop: 8, borderTop: "1px solid var(--line)" }}>
            <div
              className="review-sidebar-header"
              style={{ cursor: "pointer", display: "flex", justifyContent: "space-between" }}
              onClick={() => setShowExcluded(!showExcluded)}
            >
              <span>{t ? t("review.files.excluded") : "Excluded"} ({excludedFiles.length})</span>
              <span>{showExcluded ? "▲" : "▼"}</span>
            </div>
            {showExcluded &&
              excludedFiles.map((file) => (
                <div
                  key={`exc-${file.path}`}
                  className="review-file-item"
                  style={{ opacity: 0.6 }}
                  title={`${file.path} (${file.excludeReason})`}
                >
                  <span className="review-file-name">{file.path}</span>
                  <span style={{ fontSize: 10, color: "var(--fg-4)" }}>
                    {file.excludeReason}
                  </span>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

window.FileSidebar = FileSidebar;
