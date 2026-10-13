/* ═════════════════════════════════════════════════════════════════════
   review-target-picker.jsx — Target Selection Toolbar
   Switches between Uncommitted, Base Branch, and Specific Commit diffs.
   ═════════════════════════════════════════════════════════════════════ */

function ReviewTargetPicker({
  targetKind,
  targetRef,
  branches,
  commits,
  loading = false,
  onSelectTarget,
  onRefresh,
}) {
  const t = window.t;

  return (
    <div className="review-target-bar">
      <div className="review-target-tabs">
        <button
          type="button"
          className={`review-target-tab ${targetKind === "uncommitted" ? "active" : ""}`}
          onClick={() => onSelectTarget("uncommitted", null)}
        >
          {t ? t("review.target.uncommitted") : "Uncommitted"}
        </button>
        <button
          type="button"
          className={`review-target-tab ${targetKind === "base-branch" ? "active" : ""}`}
          onClick={() => onSelectTarget("base-branch", branches[0] || "main")}
        >
          {t ? t("review.target.baseBranch") : "Branch"}
        </button>
        <button
          type="button"
          className={`review-target-tab ${targetKind === "commit" ? "active" : ""}`}
          onClick={() => onSelectTarget("commit", commits[0]?.hash || null)}
        >
          {t ? t("review.target.commit") : "Commit"}
        </button>
      </div>

      {targetKind === "base-branch" && (
        <select
          className="review-target-select"
          value={targetRef || ""}
          onChange={(e) => onSelectTarget("base-branch", e.target.value)}
        >
          {branches.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      )}

      {targetKind === "commit" && (
        <select
          className="review-target-select"
          value={targetRef || ""}
          onChange={(e) => onSelectTarget("commit", e.target.value)}
        >
          {commits.map((c) => (
            <option key={c.hash} value={c.hash}>
              {c.hash.slice(0, 7)} {c.subject.slice(0, 30)}
            </option>
          ))}
        </select>
      )}

      <button
        type="button"
        className="review-icon-btn"
        title={t ? t("review.target.refresh") : "Refresh"}
        onClick={onRefresh}
        disabled={loading}
        style={{ marginLeft: "auto" }}
      >
        <span style={{ fontSize: 13 }} className={loading ? "review-spin" : ""}>↻</span>
      </button>
    </div>
  );
}

window.ReviewTargetPicker = ReviewTargetPicker;
