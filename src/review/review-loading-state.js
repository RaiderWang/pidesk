/* ═════════════════════════════════════════════════════════════════════
   review-loading-state.js — State & Copy Resolver for Review Loading
   Resolves animated loading title and description with i18n support.
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ReviewLoadingState = factory();
    root.resolveReviewLoadingTexts = root.ReviewLoadingState.resolveReviewLoadingTexts;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const FALLBACK_TITLE = "Analyzing code changes";
  const FALLBACK_DESC = "Inspecting git diff and preparing line annotations…";

  function resolveReviewLoadingTexts(options = {}) {
    const { title, desc, t } = options;
    const translate =
      typeof t === "function"
        ? t
        : typeof window !== "undefined" && typeof window.t === "function"
        ? window.t
        : null;

    const resolvedTitle =
      title ||
      (translate ? translate("review.loading.title") : null) ||
      FALLBACK_TITLE;

    const resolvedDesc =
      desc ||
      (translate ? translate("review.loading.desc") : null) ||
      FALLBACK_DESC;

    return {
      title: resolvedTitle,
      desc: resolvedDesc,
    };
  }

  return {
    FALLBACK_TITLE,
    FALLBACK_DESC,
    resolveReviewLoadingTexts,
  };
});
