/* design/use-file-index.jsx — lazily built, TTL-cached project file index
   shared by the command palette ("@" mode) and the composer's @-autocomplete.
   Index building lives in app/file-index.js; this hook only owns lifecycle:
   it indexes while `enabled`, re-indexes when stale, and drops results for a
   project that is no longer being indexed (user switched mid-scan). */

const _UFI_TTL_MS = 30000;
const _UFI_EMPTY = [];

function useFileIndex({ enabled, projectPath }) {
  const [state, setState] = React.useState({
    root: null, list: _UFI_EMPTY, loading: false, loadingRoot: null, at: 0,
  });
  const buildingRef = React.useRef(null);

  React.useEffect(() => {
    if (!enabled || !projectPath) return;
    const fresh = state.root === projectPath && Date.now() - state.at < _UFI_TTL_MS;
    if (fresh || buildingRef.current === projectPath) return;
    buildingRef.current = projectPath;
    setState((s) => ({ ...s, loading: true, loadingRoot: projectPath }));
    const lister = window.OMP_BRIDGE?.listDirectory?.bind(window.OMP_BRIDGE) ?? (async () => []);
    const settle = (list) => {
      if (buildingRef.current !== projectPath) return;
      buildingRef.current = null;
      setState({ root: projectPath, list, loading: false, loadingRoot: null, at: Date.now() });
    };
    window.FileIndex.buildFileIndex(projectPath, lister)
      .then(settle)
      .catch(() => settle(_UFI_EMPTY));
  }, [enabled, projectPath, state.root, state.at]);

  // A list built for another project must never be offered for this one.
  const list = state.root === projectPath ? state.list : _UFI_EMPTY;
  // Likewise, a scan still running for another project is not "loading" here.
  return { list, loading: state.loading && state.loadingRoot === projectPath };
}

Object.assign(window, { useFileIndex });
