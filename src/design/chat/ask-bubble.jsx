/* chat/ask-bubble.jsx — interactive ask-tool bubble.
   Rendered for extension_ui_request frames of the ask tool: `select`
   (ask-select.jsx) and `input` / `editor` (ask-text-input.jsx).
   Stays interactive until the user answers or the agent cancels the request.
   Tolerates bubbles without the newer fields (`mode` defaults to "select"). */

const { Icon: _AskIcon, AskSelectBody: _AskB_Select, AskTextBody: _AskB_Text } = window;

function AskBubble({ msg, idx, highlighted, onAnswer, onCancel }) {
  const st = msg.state ?? (msg.cancelled ? "cancelled" : msg.answered ? "answered" : "open");
  const text = msg.mode === "input" || msg.mode === "editor";
  const tt = (key, fallback) => (window.t ? window.t(key, null, fallback) : fallback);

  return (
    <div className={`row ask fade-up${highlighted ? " mm-hot" : ""}${st === "pending" ? " ask-pending" : ""}`} data-msg-idx={idx}>
      <div className="ass-rail">
        <div className="ass-glyph ask-glyph">
          <_AskIcon name="circle" size={11} color="var(--amber)" />
        </div>
        <div className="ass-thread" />
      </div>
      <div className="ass-body">
        <div className="ass-meta">
          <span className="mono" style={{ color: "var(--amber)" }}>{tt("chat.ask", "Ask")}</span>
          <span className="chip muted">{msg.time}</span>
          {st === "answered" && (
            <span className="chip" style={{ color: "var(--accent)", borderColor: "color-mix(in oklab, var(--accent) 30%, var(--line))" }}>
              {tt("chat.answered", "answered")}
            </span>
          )}
          {st === "cancelled" && (
            <span className="chip" style={{ color: "var(--fg-4)", borderColor: "var(--line-bright)" }}>
              {tt("chat.cancelled", "cancelled")}
            </span>
          )}
        </div>

        <div className="ask-question">{msg.title}</div>

        {text
          ? <_AskB_Text msg={msg} onAnswer={onAnswer} onCancel={onCancel} />
          : <_AskB_Select msg={msg} onAnswer={onAnswer} />}
      </div>
    </div>
  );
}

Object.assign(window, { AskBubble });
