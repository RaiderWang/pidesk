/* ui/mermaid-card.jsx — one ```mermaid fence rendered as a diagram card.

   Produced by MarkdownContent (via app/markdown-segments.js). Owns its own
   state (source toggle, copy, lightbox) so message re-renders never reset
   it. Rendering goes through MermaidRender (lazy, serialised, cached);
   a fence that is still streaming (`ready=false`) shows its source only. */

const { Icon: _McIcon, useMermaidSave: _mcUseSave, mermaidSaveLabel: _mcSaveLabel } = window;

const _mcT = (key, fallback) => (window.t ? window.t(key, null, fallback) : fallback);

// Layout changed after an async render — let the chat re-pin to the bottom.
const _mcNotifyResize = () => {
  try { window.dispatchEvent(new Event("pidesk:chat-resized")); } catch (_) {}
};

const _mcNaturalWidth = (svg) => {
  const m = /<svg\b[^>]*\swidth="(\d+)"/.exec(svg || "");
  return m ? Number(m[1]) : 0;
};

function _mcCurrentKey() {
  const cur = window.MermaidTheme.current();
  return cur.theme + "|" + cur.accent;
}

// Re-render triggers: appearance applied (theme/accent) and locale change.
function useMermaidEnv() {
  const [styleKey, setStyleKey] = React.useState(_mcCurrentKey);
  const [, setLocaleTick] = React.useState(0);
  React.useEffect(() => {
    const onAppearance = () => setStyleKey(_mcCurrentKey());
    const onLocale = () => setLocaleTick((n) => n + 1);
    window.addEventListener("appearanceapplied", onAppearance);
    window.addEventListener("i18nchange", onLocale);
    return () => {
      window.removeEventListener("appearanceapplied", onAppearance);
      window.removeEventListener("i18nchange", onLocale);
    };
  }, []);
  return styleKey;
}

function MermaidLightbox({ svg, onClose, saver }) {
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  // Registered in ModalStack so global shortcuts (palette, history, …) stay
  // suppressed while the diagram is expanded.
  React.useEffect(() => {
    const stack = window.ModalStack && window.ModalStack.shared;
    const id = "mermaid-lightbox-" + Math.random().toString(36).slice(2);
    if (stack) stack.push(id);
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (stack) stack.remove(id);
    };
  }, []);
  const natural = _mcNaturalWidth(svg);
  const width = `min(90vw, ${Math.max(Math.round(natural * 1.6), 480)}px)`;
  // The inline card still holds the original svg: give the zoomed copy its
  // own id prefix so ids / url(#…) refs never collide.
  const zoomSvg = React.useMemo(() => {
    const m = /<svg\b[^>]*\sid="([^"]+)"/.exec(svg);
    return m ? window.MermaidRender.remapIds(svg, m[1], m[1] + "-zoom") : svg;
  }, [svg]);
  // Portal to <body>: inside the chat column, an ancestor's stacking context /
  // containing block keeps the `fixed` scrim beneath the side panels.
  return ReactDOM.createPortal(
    <div className="lightbox-scrim" onClick={onClose}>
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        <div
          className="mermaid-lightbox-body"
          style={{ width, "--mm-natural": natural ? `${natural}px` : undefined }}
          dangerouslySetInnerHTML={{ __html: zoomSvg }}
        />
        {saver.canSave && (
          <button
            type="button"
            className="btn icon ghost lightbox-close lightbox-save"
            onClick={saver.save}
            disabled={saver.status === "saving"}
            title={_mcSaveLabel(saver.status)}
            aria-label={_mcSaveLabel(saver.status)}
          >
            <_McIcon name={saver.status === "saved" ? "check" : "download"} size={14} />
          </button>
        )}
        <button type="button" className="btn icon ghost lightbox-close" onClick={onClose} title={_mcT("mermaid.close", "Close")} aria-label={_mcT("mermaid.close", "Close")}>
          <_McIcon name="close" size={14} />
        </button>
      </div>
    </div>,
    document.body,
  );
}

function MermaidCard({ code, ready }) {
  const styleKey = useMermaidEnv();
  const [result, setResult] = React.useState(null); // { ok, svg } | { ok:false, error, tooLarge }
  const [showSource, setShowSource] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);

  React.useEffect(() => {
    if (!ready) { setResult(null); return undefined; }
    let cancelled = false;
    const [theme, accent] = styleKey.split("|");
    window.MermaidRender.render(code, { theme, accent }).then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => { cancelled = true; };
  }, [code, ready, styleKey]);

  // After React has committed the new DOM (svg / source view), so the chat
  // measures the final height before re-pinning to the bottom.
  React.useEffect(() => { if (result) _mcNotifyResize(); }, [result, showSource]);
  const closeLightbox = React.useCallback(() => setExpanded(false), []);

  const svg = result && result.ok ? result.svg : null;
  const failed = result && !result.ok;
  const sourceView = showSource || !svg;
  const saver = _mcUseSave(code, svg, styleKey);

  let note = null;
  if (!ready) note = _mcT("mermaid.pending", "Diagram is being generated…");
  else if (!result) note = _mcT("mermaid.rendering", "Rendering diagram…");
  else if (failed) {
    note = result.tooLarge
      ? _mcT("mermaid.tooLarge", "Diagram too large; showing source")
      : _mcT("mermaid.renderFailed", "Couldn't render the diagram; showing source");
  }

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (_) {}
  };

  return (
    <div className={`mermaid-card${failed ? " is-failed" : ""}`}>
      <div className="mermaid-head">
        <span className="mermaid-label mono">
          <_McIcon name="layers" size={11} /> {_mcT("mermaid.label", "diagram")}
        </span>
        {note && (
          <span className="mermaid-note" title={failed && result.error ? result.error : undefined}>{note}</span>
        )}
        <span className="mermaid-actions">
          {svg && (
            <button type="button" className="mermaid-btn" onClick={() => setShowSource((v) => !v)}>
              <_McIcon name="file" size={11} />
              {showSource ? _mcT("mermaid.viewDiagram", "View diagram") : _mcT("mermaid.viewSource", "View source")}
            </button>
          )}
          <button type="button" className="mermaid-btn" onClick={onCopy}>
            <_McIcon name={copied ? "check" : "copy"} size={11} />
            {copied ? _mcT("mermaid.copied", "Copied") : _mcT("mermaid.copySource", "Copy source")}
          </button>
          {svg && !showSource && saver.canSave && (
            <button
              type="button"
              className="mermaid-btn"
              onClick={saver.save}
              disabled={saver.status === "saving"}
            >
              <_McIcon name={saver.status === "saved" ? "check" : "download"} size={11} />
              {_mcSaveLabel(saver.status)}
            </button>
          )}
          {svg && !showSource && (
            <button type="button" className="mermaid-btn" onClick={() => setExpanded(true)}>
              <_McIcon name="focus" size={11} /> {_mcT("mermaid.expand", "Expand")}
            </button>
          )}
        </span>
      </div>
      {sourceView ? (
        <pre className="code-block mermaid-src"><code>{code}</code></pre>
      ) : (
        <div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />
      )}
      {expanded && svg && <MermaidLightbox svg={svg} onClose={closeLightbox} saver={saver} />}
    </div>
  );
}

Object.assign(window, { MermaidCard });
