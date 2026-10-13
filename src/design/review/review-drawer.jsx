/* ═════════════════════════════════════════════════════════════════════
   review-drawer.jsx — Resizable Code Review Drawer (Main Container)
   Composes the resize / diff-loading / annotation hooks with the drawer
   chrome, and builds the review prompt for send / insert actions.
   ═════════════════════════════════════════════════════════════════════ */

function ReviewDrawer({ isOpen, onClose, onInsertComposer, activeSessionId, initialFocus = "" }) {
  const t = window.t;

  const resize = window.useDrawerResize(isOpen);
  const diff = window.useReviewDiff({ isOpen, sessionId: activeSessionId });
  const notes = window.useReviewAnnotations({
    sessionId: activeSessionId,
    diffKey: diff.diffKey,
  });

  const [focusText, setFocusText] = React.useState("");
  const [notice, setNotice] = React.useState(null);

  // `/review <focus>` pre-fills the focus field; never clobber typed text with "".
  React.useEffect(() => {
    if (isOpen && initialFocus) setFocusText(initialFocus);
    if (isOpen) setNotice(null);
  }, [isOpen, initialFocus]);

  // ── Close on Escape (unless an inner control already consumed it) ───
  React.useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.stopPropagation();
      onClose?.();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  // ── Review prompt ───────────────────────────────────────────────────
  const getTargetLabel = () => {
    if (diff.targetKind === "base-branch") {
      return `${t("review.target.baseBranch")}: ${diff.targetRef || "main"}`;
    }
    if (diff.targetKind === "commit") {
      return `${t("review.target.commit")}: ${(diff.targetRef || "").slice(0, 7)}`;
    }
    return t("review.target.uncommitted");
  };

  const buildPrompt = () =>
    window.ReviewPrompt.buildReviewPrompt({
      targetLabel: getTargetLabel(),
      files: diff.diffFiles,
      rawDiff: diff.diffText, // already excludes lockfiles / vendor / build output
      annotations: notes.annotations,
      focusInstructions: focusText,
      truncated: diff.truncated,
      lang: String(window.I18N?.getLocale?.() || "").startsWith("zh") ? "zh" : "en",
    });

  const handleSendReview = () => {
    if (!window.ReviewPrompt || !window.OMP_BRIDGE?.sendUserMessage) return;
    window.OMP_BRIDGE.sendUserMessage(buildPrompt());
    onClose?.();
  };

  const handleInsertComposer = () => {
    if (!window.ReviewPrompt) return;
    if (onInsertComposer?.(buildPrompt()) === false) {
      // Composer not mounted: keep the drawer (and the user's notes) open.
      setNotice(t("review.insert.failed"));
      return;
    }
    onClose?.();
  };

  const handlePickProject = async () => {
    const picked = await window.OMP_BRIDGE?.pickFolder?.();
    if (picked) {
      await window.OMP_BRIDGE?.openSession?.(picked);
      diff.reload();
    }
  };

  if (!isOpen) return null;

  const { envStatus } = diff;
  const currentFile = diff.diffFiles.find((f) => f.path === diff.selectedFilePath);

  const renderBody = () => {
    if (diff.loading) return <window.ReviewLoading />;
    if (diff.errorMsg) return <window.ReviewStateCard type="error" errorMsg={diff.errorMsg} />;
    if (diff.diffFiles.length === 0) return <window.ReviewStateCard type="empty" />;
    return (
      <div className="review-body">
        <window.FileSidebar
          files={diff.diffFiles}
          excludedFiles={diff.excludedFiles}
          selectedFilePath={diff.selectedFilePath}
          annotations={notes.annotations}
          onSelectFile={diff.setSelectedFilePath}
        />
        <window.DiffViewer
          file={currentFile}
          annotations={notes.annotations}
          editingLineKey={notes.editingLineKeyFor(diff.selectedFilePath)}
          onStartAnnotate={notes.startAnnotate}
          onSaveAnnotate={notes.saveAnnotate}
          onCancelAnnotate={notes.cancelAnnotate}
          onDeleteAnnotate={notes.deleteAnnotate}
        />
      </div>
    );
  };

  const renderContent = () => {
    if (diff.loading && !envStatus) return <window.ReviewLoading fullHeight />;
    if (envStatus?.hasProject === false) {
      return <window.ReviewStateCard type="no-project" onOpenProject={handlePickProject} />;
    }
    if (envStatus?.gitInstalled === false) return <window.ReviewStateCard type="no-git" />;
    if (envStatus?.isGitRepo === false) return <window.ReviewStateCard type="not-repo" />;
    return (
      <>
        <window.ReviewTargetPicker
          targetKind={diff.targetKind}
          targetRef={diff.targetRef}
          branches={diff.branches}
          commits={diff.commits}
          loading={diff.loading}
          onSelectTarget={diff.selectTarget}
          onRefresh={diff.refresh}
        />
        {diff.truncated && !diff.loading && (
          <div className="review-notice is-warn">{t("review.truncated")}</div>
        )}
        {notice && <div className="review-notice is-error">{notice}</div>}
        {renderBody()}
        <window.ReviewActions
          focusText={focusText}
          onChangeFocus={setFocusText}
          onSendReview={handleSendReview}
          onInsertComposer={handleInsertComposer}
          disabled={diff.loading || diff.diffFiles.length === 0}
        />
      </>
    );
  };

  return (
    <div
      className={`review-drawer open ${resize.isExpanded ? "maximized" : ""} ${resize.isDragging ? "dragging" : ""}`}
      style={{ width: resize.width }}
    >
      <div className="review-resize-handle" onMouseDown={resize.startDrag} />
      <window.ReviewDrawerHeader
        isExpanded={resize.isExpanded}
        onToggleExpand={resize.toggleExpand}
        envStatus={envStatus}
        onClose={onClose}
      />
      {renderContent()}
    </div>
  );
}

window.ReviewDrawer = ReviewDrawer;
