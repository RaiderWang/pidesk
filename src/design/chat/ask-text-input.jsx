/* chat/ask-text-input.jsx — body of an ask bubble for `input` / `editor` requests.
   Empty submit is allowed (the only way to skip an optional field); Cancel
   aborts the whole question on the server. `secret` inputs are masked and the
   answer is never echoed back into the chat. */

function _askTxtT(key, params, fallback) {
  return window.t ? window.t(key, params, fallback) : fallback;
}

function AskTextBody({ msg, onAnswer, onCancel }) {
  const [value, setValue] = React.useState(msg.prefill ?? "");
  // A validation re-ask arrives as a new bubble, but reset on id anyway.
  React.useEffect(() => { setValue(msg.prefill ?? ""); }, [msg.id]);

  const st = msg.state ?? (msg.cancelled ? "cancelled" : msg.answered ? "answered" : "open");
  const open = st === "open";
  const area = window.AskModel.textInputKind(msg) === "area";

  const submit = () => { if (open) onAnswer(msg.id, { text: value }); };
  const onKey = (e) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    // Multi-line editor: Enter inserts a newline, Ctrl/Cmd+Enter submits.
    if (area && !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    submit();
  };

  if (!open) {
    // Settled: show what was sent (never a secret).
    if (msg.answerMasked) return <div className="ask-custom-echo">{_askTxtT("ask.secretHidden", null, "(hidden)")}</div>;
    return st === "answered" && msg.answer ? <div className="ask-custom-echo ask-pre">{msg.answer}</div> : null;
  }

  const common = {
    className: "ask-other-input ask-text-field",
    value,
    placeholder: msg.mode === "editor"
      ? _askTxtT("ask.editorPlaceholder", null, "Edit your answer…")
      : (msg.placeholder || _askTxtT("ask.inputPlaceholder", null, "Type your answer…")),
    onChange: e => setValue(e.target.value),
    onKeyDown: onKey,
    autoFocus: true,
  };

  return (
    <div className="ask-text">
      {area
        ? <textarea {...common} rows={5} />
        : <input {...common} type={msg.secret ? "password" : "text"} autoComplete={msg.secret ? "off" : undefined} />}
      <div className="ask-text-actions">
        <button className="ask-submit" onClick={submit}>{_askTxtT("ask.submit", null, "Submit")}</button>
        <button className="ask-submit ask-cancel" title={_askTxtT("ask.cancelHint", null, "Cancelling stops the whole question")}
                onClick={() => onCancel && onCancel(msg.id)}>
          {_askTxtT("ask.cancel", null, "Cancel")}
        </button>
        <span className="ask-hint">
          {area ? _askTxtT("ask.editorHint", null, "Ctrl/Cmd+Enter to submit") : _askTxtT("ask.skipEmpty", null, "Submit empty to skip an optional field")}
        </span>
      </div>
    </div>
  );
}

Object.assign(window, { AskTextBody });
