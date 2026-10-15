/* dock/use-dock-resize.jsx — drag the dock's left edge to resize it.
   Width maths lives in app/dock-layout.js (DockLayout.clamp). */

function useDockResize({ width, onChange }) {
  const [dragging, setDragging] = React.useState(false);
  const cleanupRef = React.useRef(null);

  // Drop in-flight drag listeners if the dock unmounts mid-drag.
  React.useEffect(() => () => cleanupRef.current?.(), []);

  const onMouseDown = React.useCallback((e) => {
    e.preventDefault();
    const L = window.DockLayout;
    const startX = e.clientX;
    const startW = width;
    setDragging(true);

    const onMove = (ev) => onChange(L.clamp(startW + (startX - ev.clientX), L.DOCK));
    const finish = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", finish);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      cleanupRef.current = null;
      setDragging(false);
    };
    cleanupRef.current = finish;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", finish);
  }, [width, onChange]);

  const onDoubleClick = React.useCallback(() => onChange(window.DockLayout.DOCK.def), [onChange]);

  return { dragging, onMouseDown, onDoubleClick };
}

Object.assign(window, { useDockResize });
