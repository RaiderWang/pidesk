/* use-auto-height.jsx — keeps the Quick Bar native window height in sync
   with the card (.qb-root). Rust adds the transparent gutter around the
   reported content height, so we report the card's own height only.

   Intentionally no top-level `const` destructures: Babel scripts share the
   document top-level scope with quick-bar.jsx. */

/** Measure the card and ask the host to resize the window to fit it. */
function reportQuickBarHeight() {
  if (!window.__TAURI__) return;
  const root = document.querySelector(".qb-root");
  if (!root) return;
  const height = Math.ceil(root.getBoundingClientRect().height);
  window.__TAURI__.core.invoke("set_quick_bar_height", { height }).catch(() => {});
}

/** Observe the card and report its height whenever it changes. */
function useAutoHeight() {
  React.useEffect(() => {
    const root = document.querySelector(".qb-root");
    if (!root) return undefined;
    const observer = new ResizeObserver(reportQuickBarHeight);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
}

Object.assign(window, { useAutoHeight, reportQuickBarHeight });
