/* ═════════════════════════════════════════════════════════════════════
   use-review-diff.jsx — Git environment + diff loading for the review drawer
   Every request carries a monotonically increasing token; results that
   arrive after a newer request (or after closing) are discarded, so a slow
   response can never overwrite the diff the user is actually looking at.
   ═════════════════════════════════════════════════════════════════════ */

function useReviewDiff({ isOpen, sessionId }) {
  const invoke = window.__TAURI__?.core?.invoke;

  const [envStatus, setEnvStatus] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState(null);

  const [targetKind, setTargetKind] = React.useState("uncommitted");
  const [targetRef, setTargetRef] = React.useState(null);
  const [branches, setBranches] = React.useState([]);
  const [commits, setCommits] = React.useState([]);

  const [diffFiles, setDiffFiles] = React.useState([]);
  const [excludedFiles, setExcludedFiles] = React.useState([]);
  const [diffText, setDiffText] = React.useState("");
  const [truncated, setTruncated] = React.useState(false);
  const [selectedFilePath, setSelectedFilePath] = React.useState(null);

  const tokenRef = React.useRef(0);
  const targetRefObj = React.useRef({ kind: "uncommitted", ref: null });
  const lastSessionRef = React.useRef(null);

  const getCwd = () => window.OMP_BRIDGE?.getCwd?.() || "";

  const applyTarget = (kind, ref) => {
    targetRefObj.current = { kind, ref };
    setTargetKind(kind);
    setTargetRef(ref);
  };

  const clearDiff = () => {
    setDiffFiles([]);
    setExcludedFiles([]);
    setDiffText("");
    setTruncated(false);
    setSelectedFilePath(null);
  };

  // Fetch + parse one diff. Returns silently if a newer request superseded `token`.
  const fetchDiff = React.useCallback(
    async (kind, ref, token) => {
      const res = await invoke("review_get_diff", {
        cwd: getCwd(),
        targetKind: kind,
        targetRef: ref,
      });
      if (token !== tokenRef.current) return;

      const RD = window.ReviewDiff;
      const parsed = RD?.parseMultiFileDiff(res.rawDiff) || [];
      const { displayFiles, excludedFiles: excluded } = RD?.filterExcludedFiles(parsed) || {
        displayFiles: [],
        excludedFiles: [],
      };
      setDiffFiles(displayFiles);
      setExcludedFiles(excluded);
      // Only non-excluded files are ever shown or sent to the model.
      setDiffText(RD?.joinFileDiffs(displayFiles) || "");
      setTruncated(Boolean(res.truncated));
      setSelectedFilePath((prev) =>
        displayFiles.some((f) => f.path === prev) ? prev : displayFiles[0]?.path ?? null
      );
    },
    [invoke]
  );

  // Run `task(token)` as the newest request; errors surface in the drawer.
  const runLatest = React.useCallback(async (task) => {
    const token = ++tokenRef.current;
    setLoading(true);
    setErrorMsg(null);
    try {
      await task(token);
    } catch (err) {
      if (token === tokenRef.current) {
        clearDiff();
        setErrorMsg(String(err));
      }
    } finally {
      if (token === tokenRef.current) setLoading(false);
    }
  }, []);

  const load = React.useCallback(() => {
    if (!invoke) return Promise.resolve();
    return runLatest(async (token) => {
      const cwd = getCwd();
      const status = await invoke("review_check_environment", { cwd });
      if (token !== tokenRef.current) return;
      setEnvStatus(status);
      if (!status.hasProject || !status.gitInstalled || !status.isGitRepo) {
        clearDiff();
        return;
      }

      // A different tab means different branches/commits: start from the default target.
      if (lastSessionRef.current !== sessionId) applyTarget("uncommitted", null);
      lastSessionRef.current = sessionId;

      const [bList, cList] = await Promise.all([
        invoke("review_list_branches", { cwd }).catch(() => []),
        invoke("review_list_commits", { cwd, count: 20 }).catch(() => []),
      ]);
      if (token !== tokenRef.current) return;
      setBranches(bList);
      setCommits(cList);

      const { kind, ref } = targetRefObj.current;
      await fetchDiff(kind, ref, token);
    });
  }, [invoke, sessionId, runLatest, fetchDiff]);

  // (Re)load on open and whenever the active tab (cwd) changes while open.
  React.useEffect(() => {
    if (isOpen) {
      load();
    } else {
      tokenRef.current++; // invalidate anything still in flight
      setLoading(false);
    }
  }, [isOpen, load]);

  const selectTarget = React.useCallback(
    (kind, ref) => {
      applyTarget(kind, ref);
      if (invoke) runLatest((token) => fetchDiff(kind, ref, token));
    },
    [invoke, runLatest, fetchDiff]
  );

  const refresh = React.useCallback(() => {
    const { kind, ref } = targetRefObj.current;
    if (invoke) runLatest((token) => fetchDiff(kind, ref, token));
  }, [invoke, runLatest, fetchDiff]);

  const diffKey = React.useMemo(
    () => (diffText && window.ReviewStore ? window.ReviewStore.computeDiffHash(diffText) : null),
    [diffText]
  );

  return {
    envStatus,
    loading,
    errorMsg,
    targetKind,
    targetRef,
    branches,
    commits,
    diffFiles,
    excludedFiles,
    diffText,
    diffKey,
    truncated,
    selectedFilePath,
    setSelectedFilePath,
    selectTarget,
    refresh,
    reload: load,
  };
}

window.useReviewDiff = useReviewDiff;
