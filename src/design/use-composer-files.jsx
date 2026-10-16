/* design/use-composer-files.jsx — composer state for @file references:
   the attached-file chips (fed by the file panel / palette via
   ComposerFiles, or by picking from the @-autocomplete) and the
   autocomplete itself (query under the caret, fuzzy matches, keyboard). */

const _UCF_MAX = 30;
const _UCF_EMPTY = [];

function useComposerFiles({ text, setText, taRef, projectPath, suppressAt }) {
  const [files, setFiles] = React.useState(_UCF_EMPTY);
  const [caret, setCaret] = React.useState(0);
  const [dismissed, setDismissed] = React.useState(null);
  const [typed, setTyped] = React.useState(null);
  const [idx, setIdx] = React.useState(0);
  const listRef = React.useRef(null);

  // Chips pushed from elsewhere in the app (file panel menu, command palette).
  React.useEffect(() => window.ComposerFiles.subscribe((rel) => {
    setFiles((prev) => window.ComposerFiles.addUnique(prev, rel));
    requestAnimationFrame(() => taRef.current?.focus());
  }), [taRef]);

  // References are relative to a project root — drop them on project switch.
  React.useEffect(() => { setFiles(_UCF_EMPTY); }, [projectPath]);

  const range = React.useMemo(() => window.FileMention.findAtQuery(text, caret), [text, caret]);
  React.useEffect(() => {
    if (!range && dismissed !== null) setDismissed(null);
  }, [range, dismissed]);

  // Only text the user typed arms the popup: programmatic changes (undo-restore,
  // picking a file) must not pop it open just because the caret lands on an @token.
  const wanted = Boolean(range) && text === typed && !suppressAt && Boolean(projectPath)
    && range.start !== dismissed;
  const index = window.useFileIndex({ enabled: wanted, projectPath });
  const query = range ? range.query : "";
  const matches = React.useMemo(() => {
    if (!wanted) return _UCF_EMPTY;
    if (!query) return index.list.slice(0, _UCF_MAX).map((item) => ({ item, ranges: [] }));
    return window.Fuzzy.fuzzyRank(index.list, query, (f) => f.rel).slice(0, _UCF_MAX);
  }, [wanted, query, index.list]);

  // The "indexing" notice only makes sense while there is nothing to match against;
  // during a background refresh the cached list keeps serving (and may match nothing).
  const open = wanted && (matches.length > 0 || (index.loading && index.list.length === 0));
  const clamped = Math.min(idx, Math.max(matches.length - 1, 0));

  React.useEffect(() => {
    if (!open || !listRef.current) return;
    listRef.current.querySelector(".slash-row.active")?.scrollIntoView({ block: "nearest" });
  }, [open, clamped, matches]);

  const pick = (entry) => {
    if (!range || !entry) return;
    setText(window.FileMention.replaceRange(text, range.start, range.end, ""));
    setFiles((prev) => window.ComposerFiles.addUnique(prev, entry.item.rel));
    setCaret(range.start);
    setIdx(0);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      ta.selectionStart = ta.selectionEnd = range.start;
    });
  };

  /** Returns true when the key was consumed by the autocomplete. */
  const onKey = (e) => {
    if (!open) return false;
    // Esc must close the popup even while it only shows the "indexing" notice —
    // otherwise it falls through to the composer's abort-on-Esc while streaming.
    if (e.key === "Escape") { e.preventDefault(); setDismissed(range.start); return true; }
    if (matches.length === 0) return false;
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx(Math.min(clamped + 1, matches.length - 1)); return true; }
    if (e.key === "ArrowUp") { e.preventDefault(); setIdx(Math.max(clamped - 1, 0)); return true; }
    if ((e.key === "Enter" || e.key === "Tab") && !e.nativeEvent?.isComposing) {
      e.preventDefault();
      pick(matches[clamped]);
      return true;
    }
    return false;
  };

  return {
    files,
    removeFile: (rel) => setFiles((prev) => prev.filter((f) => f !== rel)),
    clearFiles: () => setFiles(_UCF_EMPTY),
    at: { open, matches, loading: index.loading, activeIdx: clamped, listRef, setIdx, pick },
    onKey,
    syncCaret: (e) => setCaret(e.target.selectionEnd ?? 0),
    onTextChange: (e) => {
      setTyped(e.target.value);
      setDismissed(null); // typing after Esc brings the popup back
      setCaret(e.target.selectionEnd ?? 0);
      setIdx(0);
    },
  };
}

Object.assign(window, { useComposerFiles });
