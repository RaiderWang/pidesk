/* design/composer-file-chips.jsx — attached @file chips above the input,
   plus the @-autocomplete popup (reuses the slash palette's look). */

function ComposerFileChips({ files, onRemove }) {
  if (!files || files.length === 0) return null;
  const t = window.t;
  const removeTitle = t ? t("composer.fileChip.remove", null, "remove file") : "remove file";
  return (
    <div className="composer-file-chips">
      {files.map((rel) => (
        <window.FileChip key={rel} path={rel} removeTitle={removeTitle} onRemove={() => onRemove(rel)} />
      ))}
    </div>
  );
}

function ComposerAtPopup({ at }) {
  if (!at.open) return null;
  const t = window.t;
  return (
    <div className="slash-pop at-pop" ref={at.listRef}>
      {at.matches.length === 0 ? (
        <div className="at-pop-notice">
          {t ? t("composer.at.loading", null, "Indexing project files…") : "Indexing project files…"}
        </div>
      ) : at.matches.map((m, i) => (
        <button
          key={m.item.path}
          className={`slash-row${i === at.activeIdx ? " active" : ""}`}
          onMouseEnter={() => at.setIdx(i)}
          onMouseDown={(e) => { e.preventDefault(); at.pick(m); }}
        >
          <span className="slash-glyph"><window.Icon name="file" size={11} /></span>
          <span className="at-pop-label mono">
            {window.Fuzzy.highlightSegments(m.item.rel, m.ranges).map((s, k) => (
              s.hit ? <span key={k} className="palette-hit">{s.text}</span> : <React.Fragment key={k}>{s.text}</React.Fragment>
            ))}
          </span>
        </button>
      ))}
    </div>
  );
}

Object.assign(window, { ComposerFileChips, ComposerAtPopup });
