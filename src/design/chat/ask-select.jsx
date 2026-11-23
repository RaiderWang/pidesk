/* chat/ask-select.jsx — body of an ask bubble for `select` requests.
   Single-select: option chips + optional free-text ("Other") input.
   Multi-select:  toggle chips, a Done button (sends the server's original
   doneRow string) and, when Other is checked, a chip with a Clear button.
   Every answer goes out through onAnswer(id, payload); the bubble state
   machine (open → pending → …) lives in app/ask-model.js / ask-answer.js. */

const { Icon: _AskSelIcon } = window;

function _askSelT(key, params, fallback) {
  return window.t ? window.t(key, params, fallback) : fallback;
}

function AskSelectBody({ msg, onAnswer }) {
  const [custom, setCustom] = React.useState("");
  // The same bubble is reopened in place for every multi-select round: drop stale text.
  React.useEffect(() => { setCustom(""); }, [msg.id]);

  const st = msg.state ?? (msg.cancelled ? "cancelled" : msg.answered ? "answered" : "open");
  const open = st === "open";
  const final = st === "answered" || st === "cancelled";
  const multi = Boolean(msg.multi);
  const checked = msg.checked ?? [];
  const options = msg.options ?? [];
  const selectedCount = checked.length + (msg.otherChecked ? 1 : 0);

  const submitCustom = () => {
    const text = custom.trim();
    if (open && text) onAnswer(msg.id, { custom: text });
  };
  const onKey = (e) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submitCustom();
    }
  };

  return (
    <>
      {options.length > 0 && (
        <div className="ask-options">
          {options.map((opt, i) => {
            const isSelected = multi ? checked.includes(opt) : (msg.answered && msg.answer === opt);
            const isDimmed = final && !isSelected;
            return (
              <button
                key={i}
                className={["ask-opt", isSelected ? "selected" : "", isDimmed ? "dimmed" : ""].filter(Boolean).join(" ")}
                disabled={!open}
                aria-pressed={multi ? isSelected : undefined}
                onClick={() => onAnswer(msg.id, { value: opt })}
              >
                {isSelected && <_AskSelIcon name="check" size={10} color="var(--accent)" />}
                {opt}
              </button>
            );
          })}
          {multi && !final && (
            <button
              className="ask-opt done-opt"
              disabled={!open || !msg.doneRow}
              onClick={() => onAnswer(msg.id, { value: msg.doneRow })}
            >
              <_AskSelIcon name="check" size={10} color="currentColor" />
              {_askSelT("ask.done", null, "Done")}
              {selectedCount > 0 && (
                <span className="ask-count">{_askSelT("ask.selectedCount", { n: selectedCount }, `${selectedCount} selected`)}</span>
              )}
            </button>
          )}
        </div>
      )}

      {/* Free text exists only when the server offered an "Other" row; sending
          a non-offered select value aborts the turn on newer omp. */}
      {msg.otherRow && (
        <div className="ask-other">
          {multi && msg.otherChecked ? (
            <>
              <span className="ask-other-chip">
                <_AskSelIcon name="check" size={10} color="var(--accent)" />
                <span className="ask-other-label">
                  {_askSelT("ask.otherChecked", null, "Custom answer")}{msg.otherText ? ":" : ""}
                </span>
                {msg.otherText && <span className="ask-other-text">{msg.otherText}</span>}
              </span>
              {open && (
                <button className="ask-submit" onClick={() => onAnswer(msg.id, { clearOther: true })}>
                  {_askSelT("ask.clearOther", null, "Clear")}
                </button>
              )}
            </>
          ) : (
            <>
              <input
                className="ask-other-input"
                type="text"
                placeholder={_askSelT("ask.otherPlaceholder", null, "Or type your own answer…")}
                value={custom}
                disabled={!open}
                onChange={e => setCustom(e.target.value)}
                onKeyDown={onKey}
              />
              {open && custom.trim() && (
                <button className="ask-submit" onClick={submitCustom}>
                  {_askSelT("ask.submit", null, "Submit")}
                </button>
              )}
              {/* Typed rather than clicked: echo the answer once it is sent. */}
              {!multi && st === "answered" && msg.answer && !options.includes(msg.answer) && (
                <span className="ask-custom-echo">{msg.answer}</span>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

Object.assign(window, { AskSelectBody });
