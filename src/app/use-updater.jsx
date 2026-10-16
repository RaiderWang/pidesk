/* app/use-updater.jsx — wires window.Updater (pure state machine) to the
   Rust updater commands: check_update / install_update / restart_app and the
   `update://progress` event. Silent startup + 24h checks when autoUpdate is on. */

function useUpdater({ autoUpdate = true } = {}) {
  const U = window.Updater;
  const [state, dispatch] = React.useReducer(U.reduce, undefined, U.initialState);
  const [ignored, setIgnored] = React.useState(() => U.loadIgnored(window.localStorage));
  const ignoredRef = React.useRef(ignored);
  ignoredRef.current = ignored;
  const tauri = window.__TAURI__;
  const invoke = tauri?.core?.invoke;

  // Mirror of `state` plus synchronous in-flight flags: React state updates are
  // async, so refs are what stop a second call racing the first.
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const checkingRef = React.useRef(false);
  const installingRef = React.useRef(false);

  const check = React.useCallback(async (manual = false) => {
    if (!invoke) return;
    const allowed = !checkingRef.current && !installingRef.current && U.canCheck(stateRef.current, manual);
    // Always tell the reducer: an in-flight silent check upgrades to manual.
    dispatch({ type: "check-start", manual });
    if (!allowed) return;
    checkingRef.current = true;
    try {
      const info = await invoke("check_update");
      if (info) {
        dispatch({ type: "check-found", info, ignored: U.isIgnored(info, ignoredRef.current) });
      } else {
        dispatch({ type: "check-none" });
      }
    } catch (err) {
      dispatch({ type: "check-fail", error: String(err) });
    } finally {
      checkingRef.current = false;
    }
  }, [invoke, U]);

  React.useEffect(() => {
    if (!invoke || !autoUpdate) return undefined;
    const first = setTimeout(() => check(false), U.AUTO_CHECK_DELAY_MS);
    const every = setInterval(() => check(false), U.AUTO_CHECK_INTERVAL_MS);
    return () => { clearTimeout(first); clearInterval(every); };
  }, [invoke, autoUpdate, check, U]);

  // Download progress emitted by `install_update`.
  React.useEffect(() => {
    const listen = tauri?.event?.listen;
    if (!listen) return undefined;
    let unlisten = null;
    let disposed = false;
    listen("update://progress", (e) => {
      dispatch({ type: "progress", percent: e?.payload?.percent });
    }).then((fn) => { if (disposed) fn(); else unlisten = fn; });
    return () => { disposed = true; if (unlisten) unlisten(); };
  }, [tauri]);

  const install = React.useCallback(async () => {
    if (!invoke || installingRef.current || !U.canInstall(stateRef.current)) return;
    installingRef.current = true;
    dispatch({ type: "install-start" });
    try {
      await invoke("install_update");
      dispatch({ type: "installed" });
    } catch (err) {
      dispatch({ type: "install-fail", error: String(err) });
    } finally {
      installingRef.current = false;
    }
  }, [invoke, U]);

  const restart = React.useCallback(() => invoke?.("restart_app"), [invoke]);
  const dismiss = React.useCallback(() => dispatch({ type: "dismiss" }), []);

  const ignore = React.useCallback(() => {
    if (state.info?.version) {
      U.saveIgnored(window.localStorage, state.info.version);
      setIgnored(state.info.version);
    }
    dispatch({ type: "ignore" });
  }, [state.info, U]);

  const openReleases = React.useCallback(
    () => invoke?.("open_url_external", { url: U.RELEASES_URL }),
    [invoke, U],
  );

  return {
    state,
    bannerVisible: U.isBannerVisible(state),
    check,
    install,
    restart,
    dismiss,
    ignore,
    openReleases,
  };
}

Object.assign(window, { useUpdater });
