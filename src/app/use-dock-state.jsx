/* app/use-dock-state.jsx — React glue for the persisted dock / file-tree
   state (app/dock-state.js) and the viewport width that drives the stage
   grid's responsive rules (app/dock-layout.js). */

function _UD_storage() {
  try { return window.localStorage; } catch { return null; }
}

function useDockState() {
  const DS = window.DockState;
  const [state, setState] = React.useState(() => DS.loadDockState(_UD_storage()));

  React.useEffect(() => { DS.saveDockState(_UD_storage(), state); }, [DS, state]);

  const patch = React.useCallback(
    (p) => setState((s) => DS.normalizeDockState({ ...s, ...p })),
    [DS],
  );

  return React.useMemo(() => ({
    state,
    toggleFiles:    () => setState((s) => DS.normalizeDockState({ ...s, filesOpen: !s.filesOpen })),
    setFilesWidth:  (w) => patch({ filesWidth: w }),
    setDockOpen:    (open) => patch({ dockOpen: open }),
    setDockWidth:   (w) => patch({ dockWidth: w }),
    openDock:       (tab) => patch({ dockOpen: true, ...(tab ? { dockTab: tab } : {}) }),
    setDockTab:     (tab) => patch({ dockTab: tab }),
  }), [state, patch, DS]);
}

function useViewportWidth() {
  const [width, setWidth] = React.useState(() => window.innerWidth);
  React.useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

Object.assign(window, { useDockState, useViewportWidth });
