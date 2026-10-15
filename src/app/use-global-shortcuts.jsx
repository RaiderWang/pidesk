/* app/use-global-shortcuts.jsx — one window-level keydown listener that
   dispatches registry shortcuts (app/shortcuts.js) to `handlers[id]`.
   Handlers are read through a ref, so callers may pass fresh closures on
   every render without re-subscribing or hitting stale state. */

function useGlobalShortcuts(handlers) {
  const ref = React.useRef(handlers);
  ref.current = handlers;

  React.useEffect(() => {
    const onKey = (e) => {
      const id = window.AppShortcuts.matchAction(e);
      if (!window.AppShortcuts.shouldDispatch(id, {
        modalOpen: window.ModalStack.shared.size() > 0,
        defaultPrevented: e.defaultPrevented,
      })) return;
      const fn = ref.current[id];
      if (!fn) return;
      e.preventDefault();
      fn(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

Object.assign(window, { useGlobalShortcuts });
