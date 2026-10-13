/* ═════════════════════════════════════════════════════════════════════
   review-actions.jsx — Code Review Drawer Action Bar
   Inputs custom review focus and submits/inserts review prompts.
   ═════════════════════════════════════════════════════════════════════ */

function ReviewActions({
  focusText,
  onChangeFocus,
  onSendReview,
  onInsertComposer,
  disabled,
}) {
  const t = window.t;

  return (
    <div className="review-footer">
      <input
        type="text"
        className="review-focus-input"
        placeholder={
          t
            ? t("review.focus.placeholder")
            : "Additional review focus / instructions…"
        }
        value={focusText}
        onChange={(e) => onChangeFocus(e.target.value)}
        disabled={disabled}
      />
      <div className="review-footer-buttons">
        <button
          type="button"
          className="review-secondary-btn"
          onClick={onInsertComposer}
          disabled={disabled}
        >
          {t ? t("review.actions.insert") : "Insert into Input"}
        </button>
        <button
          type="button"
          className="review-primary-btn"
          onClick={onSendReview}
          disabled={disabled}
        >
          <span>✦</span>
          <span>{t ? t("review.actions.send") : "Send to Current Session"}</span>
        </button>
      </div>
    </div>
  );
}

window.ReviewActions = ReviewActions;
