/* ui/modal.jsx — shared modal shell.

   - Portal into <body>, scrim + dialog panel, `role="dialog"`.
   - Escape and Tab only act on the topmost modal (app/modal-stack.js);
     Escape is handled in the capture phase so global listeners (composer
     abort, review drawer …) do not also react to it.
   - Focus moves into the panel on open (unless a child already took it),
     is trapped on Tab, and is restored on close.

   Props:
     open          default true — pass false to render nothing
     onClose       scrim click / default Escape action
     onEscape      overrides Escape (e.g. step back in a multi-view dialog)
     size          sm | md | lg | xl (panel width tier)
     placement     top | center
     top           CSS offset from the top for placement="top"
     layer         base | nested (z-index tier; nested sits above base)
     closeOnScrim  default true
     bare          skip default scrim/panel styling; use scrimClassName /
                   panelClassName for fully custom surfaces (e.g. kanban)
     ariaLabel, scrimClassName, panelClassName, panelStyle */

const _MD_FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
let _mdSeq = 0;

function _mdTrapTab(e, panel) {
  const nodes = Array.from(panel.querySelectorAll(_MD_FOCUSABLE))
    .filter((n) => n.getClientRects().length > 0);
  if (nodes.length === 0) {
    e.preventDefault();
    panel.focus({ preventScroll: true });
    return;
  }
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === panel || !panel.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

function Modal({
  open = true, onClose, onEscape, size = "md", placement = "top", top,
  layer = "base", closeOnScrim = true, bare = false,
  ariaLabel, scrimClassName = "", panelClassName = "", panelStyle, children,
}) {
  const idRef = React.useRef(null);
  if (idRef.current === null) idRef.current = `modal-${++_mdSeq}`;
  const panelRef = React.useRef(null);
  const downOnScrim = React.useRef(false);
  const handlersRef = React.useRef({});
  handlersRef.current = { onClose, onEscape };

  React.useEffect(() => {
    if (!open) return undefined;
    const id = idRef.current;
    const stack = window.ModalStack.shared;
    stack.push(id);
    const prevFocus = document.activeElement;
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });

    const onKey = (e) => {
      if (!stack.isTop(id)) return;
      if (e.key === "Escape" && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        const h = handlersRef.current;
        (h.onEscape || h.onClose)?.();
      } else if (e.key === "Tab" && panelRef.current) {
        _mdTrapTab(e, panelRef.current);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      stack.remove(id);
      if (prevFocus && prevFocus !== document.body && document.contains(prevFocus)) {
        prevFocus.focus?.({ preventScroll: true });
      }
    };
  }, [open]);

  if (!open) return null;

  const scrimClass = bare
    ? scrimClassName
    : `modal-scrim placement-${placement}${layer === "nested" ? " is-nested" : ""} ${scrimClassName}`.trim();
  // Always layered by ModalStack (bare surfaces too) so visual order matches
  // the Escape/focus order; `--modal-top` only applies to the default scrim.
  const scrimStyle = {
    zIndex: window.ModalStack.zIndexFor(layer),
    ...(!bare && top ? { "--modal-top": top } : null),
  };
  const panelClass = bare
    ? panelClassName
    : `modal-panel size-${size} slide-in ${panelClassName}`.trim();

  return ReactDOM.createPortal(
    <div
      className={scrimClass}
      style={scrimStyle}
      onMouseDown={(e) => { downOnScrim.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (closeOnScrim && downOnScrim.current && e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        className={panelClass}
        style={panelStyle}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

Object.assign(window, { Modal });
