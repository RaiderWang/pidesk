/* ═════════════════════════════════════════════════════════════════════
   review-loading.jsx — Animated Loading View for Code Review Drawer
   Replaces static loading text with a multi-layered motion experience:
   - Diff radar scanner badge with rotating orbital ring and scan line
   - Shimmering gradient status typography with bouncing pulse dots
   - Animated diff code skeleton with sweeping shimmer effect
   ═════════════════════════════════════════════════════════════════════ */

function ReviewLoading({ title, desc, fullHeight = false }) {
  const resolver =
    window.ReviewLoadingState?.resolveReviewLoadingTexts ||
    window.resolveReviewLoadingTexts;

  const texts = resolver
    ? resolver({ title, desc, t: window.t })
    : {
        title:
          title ||
          (window.t ? window.t("review.loading.title") : "Analyzing code changes"),
        desc:
          desc ||
          (window.t
            ? window.t("review.loading.desc")
            : "Inspecting git diff and preparing line annotations…"),
      };

  return (
    <div className={`review-loading-view ${fullHeight ? "full-height" : ""}`}>
      {/* ── Dynamic Radar & Git Diff Scanner ─────────────────────────── */}
      <div className="review-loading-scanner" aria-hidden="true">
        <div className="review-loading-pulse-ring" />
        <div className="review-loading-spinner-ring" />
        <div className="review-loading-icon-badge">
          <svg
            className="review-loading-svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="6" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="12" r="3" />
            <path d="M6 9v6" />
            <path d="M9 6h3a4 4 0 0 1 4 4v2" />
          </svg>
          <div className="review-loading-scan-line" />
        </div>
      </div>

      {/* ── Shimmering Status Typography & Bouncing Dots ────────────── */}
      <div className="review-loading-text-wrap">
        <div className="review-loading-title">{texts.title}</div>
        <div className="review-loading-desc">
          <span>{texts.desc}</span>
          <span className="review-loading-dots" aria-hidden="true">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </span>
        </div>
      </div>

      {/* ── Animated Code Diff Skeleton Preview ─────────────────────── */}
      <div className="review-loading-skeleton" aria-hidden="true">
        <div className="review-skeleton-header">
          <div className="review-skeleton-tag" />
          <div className="review-skeleton-filename" />
          <div className="review-skeleton-stats" />
        </div>
        <div className="review-skeleton-body">
          <div className="review-skeleton-row">
            <div className="review-skeleton-gutter" />
            <div className="review-skeleton-bar w-mid" />
          </div>
          <div className="review-skeleton-row diff-del">
            <div className="review-skeleton-gutter" />
            <div className="review-skeleton-bar w-long" />
          </div>
          <div className="review-skeleton-row diff-add">
            <div className="review-skeleton-gutter" />
            <div className="review-skeleton-bar w-long" />
          </div>
          <div className="review-skeleton-row diff-add">
            <div className="review-skeleton-gutter" />
            <div className="review-skeleton-bar w-short" />
          </div>
          <div className="review-skeleton-row">
            <div className="review-skeleton-gutter" />
            <div className="review-skeleton-bar w-mid" />
          </div>
        </div>
        <div className="review-skeleton-shimmer" />
      </div>
    </div>
  );
}

window.ReviewLoading = ReviewLoading;
