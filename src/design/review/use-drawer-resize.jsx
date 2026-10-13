/* ═════════════════════════════════════════════════════════════════════
   use-drawer-resize.jsx — Drag-to-resize / expand state for the review drawer
   Width maths lives in review/review-drawer-width.js (unit-tested);
   this hook only wires it to pointer events and localStorage.
   ═════════════════════════════════════════════════════════════════════ */

const REVIEW_DRAWER_WIDTH_KEY = "pidesk_review_drawer_width";

function useDrawerResize(isOpen) {
  const W = window.ReviewDrawerWidth;

  const [viewport, setViewport] = React.useState(() => window.innerWidth);
  const [drawerWidth, setDrawerWidth] = React.useState(() => {
    try {
      return W.parseSavedWidth(localStorage.getItem(REVIEW_DRAWER_WIDTH_KEY), window.innerWidth);
    } catch {
      return W.clampWidth(W.DEFAULT_WIDTH, window.innerWidth);
    }
  });
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const cleanupRef = React.useRef(null);

  React.useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Collapse back to the side-drawer layout whenever it closes.
  React.useEffect(() => {
    if (!isOpen) setIsExpanded(false);
  }, [isOpen]);

  // Drop in-flight drag listeners if the component unmounts mid-drag.
  React.useEffect(() => () => cleanupRef.current?.(), []);

  const toggleExpand = React.useCallback(() => setIsExpanded((v) => !v), []);

  const startDrag = React.useCallback(
    (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = isExpanded ? W.clampWidth(window.innerWidth, window.innerWidth) : drawerWidth;
      let latest = startWidth;
      setIsDragging(true);
      if (isExpanded) setIsExpanded(false);

      const onMove = (ev) => {
        latest = W.widthAfterDrag(startWidth, startX, ev.clientX, window.innerWidth);
        setDrawerWidth(latest);
      };
      const finish = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", finish);
        cleanupRef.current = null;
        setIsDragging(false);
        try {
          localStorage.setItem(REVIEW_DRAWER_WIDTH_KEY, String(latest));
        } catch {}
      };
      cleanupRef.current = finish;
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", finish);
    },
    [isExpanded, drawerWidth, W]
  );

  return {
    width: isExpanded ? "100%" : `${W.clampWidth(drawerWidth, viewport)}px`,
    isExpanded,
    isDragging,
    toggleExpand,
    startDrag,
  };
}

window.useDrawerResize = useDrawerResize;
