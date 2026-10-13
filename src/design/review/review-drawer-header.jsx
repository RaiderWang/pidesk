/* ═════════════════════════════════════════════════════════════════════
   review-drawer-header.jsx — Code Review Drawer Top Navigation Bar
   Displays expand/collapse toggle at top-left, title, git branch badge,
   and close action.
   ═════════════════════════════════════════════════════════════════════ */

function ReviewDrawerHeader({ isExpanded, onToggleExpand, envStatus, onClose }) {
  const t = window.t;
  const expandTitle = isExpanded
    ? (t ? t("review.collapse") : "Collapse to default width")
    : (t ? t("review.expand") : "Expand to full width");

  return (
    <div className="review-header">
      <div className="review-title-wrap">
        <button
          type="button"
          className={`review-icon-btn review-expand-btn ${isExpanded ? "active" : ""}`}
          title={expandTitle}
          aria-label={expandTitle}
          onClick={onToggleExpand}
        >
          {isExpanded ? (
            /* 收缩图标：双箭头向右，指示收缩回右侧默认位置 */
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M7 3.5L11.5 8 7 12.5" />
              <path d="M2.5 3.5L7 8l-4.5 4.5" />
            </svg>
          ) : (
            /* 展开图标：双箭头向左，指示向左扩展到最左侧 */
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 3.5L4.5 8 9 12.5" />
              <path d="M13.5 3.5L9 8l4.5 4.5" />
            </svg>
          )}
        </button>
        <span className="review-title">{t ? t("review.title") : "Code Review"}</span>
        {envStatus?.currentBranch && (
          <span className="review-badge">⎇ {envStatus.currentBranch}</span>
        )}
      </div>
      <div className="review-header-actions">
        <button
          type="button"
          className="review-icon-btn"
          title={t ? t("review.close") : "Close (Esc)"}
          onClick={onClose}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

window.ReviewDrawerHeader = ReviewDrawerHeader;
