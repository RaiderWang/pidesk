/* ═════════════════════════════════════════════════════════════════════
   use-file-tree-watch.jsx — keeps the file tree in sync with the disk.

   Every auto-refresh source funnels through one RefreshGate (cooldown,
   paused while the window is hidden):
     • the OS watcher (`files://changed` from Rust)
     • `refreshSignal` bumps (agent write-class tool end / turn end) — works
       even when the OS watcher is silent (sync folders, network drives)
     • window focus / becoming visible (edits made in another app)
     • a slow poll, only if the watcher could not be started

   No top-level destructures (Babel scripts share the document scope).
   ═════════════════════════════════════════════════════════════════════ */

const FILE_TREE_FALLBACK_POLL_MS = 5000;

function useFileTreeWatch({ rootPath, bridge, refresh, refreshSignal, onWatchError }) {
  const refreshRef = React.useRef(refresh);
  refreshRef.current = refresh;
  const onErrorRef = React.useRef(onWatchError);
  onErrorRef.current = onWatchError;

  const gateRef = React.useRef(null);
  const lastSignalRef = React.useRef(refreshSignal);
  const signalRef = React.useRef(refreshSignal);
  signalRef.current = refreshSignal;

  React.useEffect(() => {
    if (!rootPath) return undefined;

    const watchId = rootPath;
    let active = true;
    let unlisten = null;
    let pollTimer = null;

    const gate = window.RefreshGate.create({
      run: () => refreshRef.current?.(),
      isHidden: () => document.hidden,
    });
    gateRef.current = gate;
    // A tab / project switch must not read as "the agent just finished".
    lastSignalRef.current = signalRef.current;

    const onFocus = () => gate.request();
    const onVisibility = () => {
      if (!document.hidden) gate.request();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    const tauriEvent = window.__TAURI__?.event;
    if (tauriEvent?.listen) {
      tauriEvent
        .listen("files://changed", (event) => {
          if (!active) return;
          if (window.FileWatchMatch.matchesEvent(event.payload, watchId, rootPath)) {
            gate.request();
          }
        })
        .then((fn) => {
          if (active) unlisten = fn;
          else fn();
        })
        .catch((err) => console.error("[files] listen files://changed failed:", err));
    }

    Promise.resolve(bridge?.startFilesWatch?.(watchId, rootPath)).then((res) => {
      if (!active || !res || res.ok || res.unavailable) return;
      // The OS watcher failed: say so once and fall back to a slow poll.
      onErrorRef.current?.(res.error);
      pollTimer = setInterval(() => gate.request(), FILE_TREE_FALLBACK_POLL_MS);
    });

    return () => {
      active = false;
      gate.cancel();
      if (gateRef.current === gate) gateRef.current = null;
      if (pollTimer !== null) clearInterval(pollTimer);
      if (unlisten) unlisten();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      bridge?.stopFilesWatch?.(watchId);
    };
  }, [rootPath, bridge]);

  // Agent finished writing: refresh even if the OS reported nothing.
  React.useEffect(() => {
    if (lastSignalRef.current === refreshSignal) return;
    lastSignalRef.current = refreshSignal;
    gateRef.current?.request();
  }, [refreshSignal]);
}

Object.assign(window, { useFileTreeWatch });
