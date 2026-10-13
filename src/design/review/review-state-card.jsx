/* ═════════════════════════════════════════════════════════════════════
   review-state-card.jsx — Code Review State & Fallback Cards
   Renders empty states, environment errors, and no-change messages.
   ═════════════════════════════════════════════════════════════════════ */

function ReviewStateCard({ type, errorMsg, onOpenProject }) {
  const t = window.t;

  if (type === "no-project") {
    return (
      <div className="review-state-card">
        <div style={{ fontSize: 32 }}>📁</div>
        <div className="review-state-title">
          {t ? t("review.env.noProjectTitle") : "No Project Opened"}
        </div>
        <div className="review-state-desc">
          {t
            ? t("review.env.noProjectDesc")
            : "Open a project directory to review code changes and git diffs."}
        </div>
        <button
          type="button"
          className="review-secondary-btn"
          style={{ marginTop: 14 }}
          onClick={onOpenProject}
        >
          {t ? t("review.env.openProject") : "Open Project"}
        </button>
      </div>
    );
  }

  if (type === "no-git") {
    return (
      <div className="review-state-card">
        <div style={{ fontSize: 32 }}>⚠️</div>
        <div className="review-state-title">
          {t ? t("review.env.noGitTitle") : "Git is not installed"}
        </div>
        <div className="review-state-desc">
          {t ? t("review.env.noGitDesc") : "Please install Git CLI to use this feature."}
        </div>
      </div>
    );
  }

  if (type === "not-repo") {
    return (
      <div className="review-state-card">
        <div style={{ fontSize: 32 }}>📁</div>
        <div className="review-state-title">
          {t ? t("review.env.notRepoTitle") : "Not a Git Repository"}
        </div>
        <div className="review-state-desc">
          {t
            ? t("review.env.notRepoDesc")
            : "Current folder is not inside a git repository."}
        </div>
      </div>
    );
  }

  if (type === "error") {
    return (
      <div className="review-state-card">
        <div className="review-state-title" style={{ color: "var(--rose)" }}>
          Error
        </div>
        <div className="review-state-desc">{errorMsg}</div>
      </div>
    );
  }

  if (type === "empty") {
    return (
      <div className="review-state-card">
        <div style={{ fontSize: 28 }}>✓</div>
        <div className="review-state-title">
          {t ? t("review.empty.title") : "No Changes Found"}
        </div>
        <div className="review-state-desc">
          {t
            ? t("review.empty.desc")
            : "There are no differences to review for the selected target."}
        </div>
      </div>
    );
  }

  return null;
}

window.ReviewStateCard = ReviewStateCard;
