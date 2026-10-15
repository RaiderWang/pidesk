/* palette/palette-row.jsx — shared building blocks for the command palette:
   highlighted text, a result row, and the keyboard cursor hook. */

const { Icon: _PR_Icon } = window;

function PaletteHighlight({ text, ranges }) {
  const segs = window.Fuzzy.highlightSegments(text, ranges);
  return (
    <>
      {segs.map((s, i) => (s.hit
        ? <span key={i} className="palette-hit">{s.text}</span>
        : <React.Fragment key={i}>{s.text}</React.Fragment>))}
    </>
  );
}

/** entry: { item, ranges }. item: { label, hint, glyph, labelClass, labelColor, trailing, shortcut } */
function PaletteRow({ entry, cursor, onRun, onHover }) {
  const { item, ranges } = entry;
  return (
    <button
      className={`bridge-row${cursor ? " is-cursor" : ""}`}
      data-cursor={cursor ? "true" : undefined}
      onMouseMove={onHover}
      onClick={onRun}
    >
      <span className="bridge-glyph">{item.glyph}</span>
      <span className={`palette-label ${item.labelClass || ""}`} style={item.labelColor ? { color: item.labelColor } : undefined}>
        <PaletteHighlight text={item.label} ranges={ranges} />
      </span>
      {item.hint && <span className="palette-hint">{item.hint}</span>}
      <span className="palette-trail">
        {item.trailing}
        {item.shortcut && <span className="kbd">{item.shortcut}</span>}
      </span>
      {item.drill && <_PR_Icon name="chevR" size={11} color="var(--fg-4)" />}
    </button>
  );
}

/**
 * Keyboard cursor over `count` rows. `resetKey` puts the cursor back on the
 * first row (e.g. when the query changes). Returns handlers to wire onto the
 * search input; `onRun(index)` fires on Enter.
 */
function usePaletteCursor(count, resetKey) {
  const [cursor, setCursor] = React.useState(0);
  const bodyRef = React.useRef(null);
  React.useEffect(() => { setCursor(0); }, [resetKey]);
  const clamped = count > 0 ? Math.min(cursor, count - 1) : 0;

  React.useEffect(() => {
    bodyRef.current?.querySelector('[data-cursor="true"]')?.scrollIntoView({ block: "nearest" });
  }, [clamped, count]);

  const onKeyDown = (e, onRun) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, Math.max(count - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter" && count > 0 && !e.nativeEvent?.isComposing) {
      e.preventDefault();
      onRun(clamped);
    }
  };

  return { cursor: clamped, setCursor, onKeyDown, bodyRef };
}

Object.assign(window, { PaletteHighlight, PaletteRow, usePaletteCursor });
