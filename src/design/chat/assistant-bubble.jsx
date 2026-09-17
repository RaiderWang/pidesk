/* chat/assistant-bubble.jsx — assistant block (text + plan + thoughts) +
   InlinePlan (mini-plan rendered inline in the first plan reply). */

const { Icon: _ChatIcon, MarkdownContent: _ChatMd, AnnotablePlan: _ChatAP } = window;

function InlinePlan({ plan }) {
  return (
    <div className="inline-plan slide-in">
      <div className="inline-plan-head">
        <_ChatIcon name="plan" size={12} color="var(--accent)" />
        <span style={{ color: "var(--fg-2)", fontWeight: 600 }}>{plan.title}</span>
        <span className="chip muted">{plan.phases.reduce((n, p) => n + p.tasks.length, 0)} tasks</span>
        <div style={{ flex: 1 }} />
        <button className="btn ghost" style={{ height: 22 }}>open kanban →</button>
      </div>
      <div className="inline-plan-body">
        {plan.phases.map((ph) => (
          <div key={ph.id} className="inline-phase">
            <div className="inline-phase-head">
              <span className="mono" style={{ color: "var(--fg-3)" }}>{ph.label.toUpperCase()}</span>
              <span className="hr" />
            </div>
            {ph.tasks.map((t) => (
              <div key={t.id} className={`inline-task status-${t.status}`}>
                <span className="task-mark">
                  {t.status === "done" && <_ChatIcon name="check" size={10} />}
                  {t.status === "in_progress" && <span className="pulse-dot" />}
                  {t.status === "pending" && <span className="mono" style={{ color: "var(--fg-4)" }}>○</span>}
                </span>
                <span className="task-text selectable">{t.text}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function AssistantBubble({ msg, idx, highlighted, annotable, annotations, onAnnotate, onBranch }) {
  const [copied, setCopied] = React.useState(false);

  function handleCopy() {
    const text = (msg.blocks || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("\n\n");
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }

  return (
    <div className={`row assistant fade-up${highlighted ? " mm-hot" : ""}`} data-msg-idx={idx}>
      <div className="ass-rail">
        <div className="ass-glyph"><_ChatIcon name="sparkle" size={11} color="var(--accent)" /></div>
        <div className="ass-thread" />
      </div>
      <div className="ass-body">
        <div className="ass-meta">
          <span className="mono" style={{ color: "var(--accent)" }}>{msg.model ?? "–"}</span>
          <span className="chip muted">{msg.time}</span>
          {msg.lead === "thinking" && (
            <span className="chip" style={{ color: "var(--lilac)", borderColor: "color-mix(in oklab, var(--lilac) 30%, var(--line))" }}>
              <_ChatIcon name="thinking" size={10} />
              thinking
            </span>
          )}
        </div>
        {msg.thought && (
          <div className="thought selectable">
            <span className="mono" style={{ color: "var(--fg-4)" }}>// </span>
            <span style={{ color: "var(--fg-3)", fontStyle: "italic" }}>{msg.thought}</span>
          </div>
        )}
        {msg.blocks?.map((b, i) => {
          if (b.type === "text") {
            // Last message in plan mode: render annotatable blocks (not streaming)
            if (annotable && !msg.streaming) {
              return (
                <_ChatAP key={i} text={b.text}
                  annotations={annotations}
                  onAnnotate={onAnnotate} />
              );
            }
            return (
              <_ChatMd key={i} text={b.text}
                streaming={msg.streaming && i === msg.blocks.length - 1} />
            );
          }
          if (b.type === "plan") {
            return <InlinePlan key={i} plan={b} />;
          }
          return null;
        })}
        <div className="msg-actions">
          <button
            className="msg-act-btn"
            title={copied ? "copied!" : (window.t ? window.t("action.copy", null, "copy as markdown") : "copy as markdown")}
            onClick={handleCopy}
          >
            <_ChatIcon name={copied ? "check" : "copy"} size={12} />
          </button>
          {onBranch && !msg.streaming && (
            <button
              className="msg-act-btn"
              title={window.t ? window.t("cmd.branch.fromHere", null, "branch from here") : "branch from here"}
              onClick={() => onBranch(idx)}
            >
              <_ChatIcon name="branch" size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { AssistantBubble, InlinePlan });
