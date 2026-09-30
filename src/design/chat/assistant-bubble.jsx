/* chat/assistant-bubble.jsx — assistant block (text + plan + thoughts) +
   InlinePlan (mini-plan rendered inline in the first plan reply). */

const { Icon: _ChatIcon, MarkdownContent: _ChatMd, AnnotablePlan: _ChatAP } = window;

function InlinePlan({ plan, onOpenKanban }) {
  return (
    <div className="inline-plan slide-in">
      <div className="inline-plan-head">
        <_ChatIcon name="plan" size={12} color="var(--accent)" />
        <span style={{ color: "var(--fg-2)", fontWeight: 600 }}>{plan.title}</span>
        <span className="chip muted">{plan.phases.reduce((n, p) => n + p.tasks.length, 0)} tasks</span>
        <div style={{ flex: 1 }} />
        <button className="btn ghost" style={{ height: 22 }} onClick={onOpenKanban}>
          {window.t ? window.t("plan.openKanbanBtn", null, "open kanban →") : "open kanban →"}
        </button>
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

function ThoughtBlock({ thought, streaming, lead }) {
  if (!thought && (!streaming || lead !== "thinking")) return null;

  // Active thinking: currently streaming and either explicitly marked as thinking
  // or streaming without thought content yet.
  const isThinking = Boolean(streaming && (lead === "thinking" || !thought));

  // Auto state: open while actively streaming/thinking, collapsed once finished.
  // User override (userOpen): once user clicks toggle, their choice persists.
  const [userOpen, setUserOpen] = React.useState(null);
  const isOpen = userOpen !== null ? userOpen : isThinking;

  const toggleOpen = React.useCallback(() => {
    if (window.getSelection && window.getSelection().toString()) return;
    setUserOpen(prev => !(prev !== null ? prev : isThinking));
  }, [isThinking]);

  const toggleTitle = isOpen
    ? (window.t ? window.t("chat.collapseThought", null, "Collapse thinking process") : "Collapse thinking process")
    : (window.t ? window.t("chat.expandThought", null, "Expand thinking process") : "Expand thinking process");

  return (
    <div className={`thought-block ${isThinking ? "thinking" : "done"} ${isOpen ? "expanded" : "collapsed"}`}>
      <button
        type="button"
        className="thought-head"
        onClick={toggleOpen}
        title={toggleTitle}
        aria-expanded={isOpen}
      >
        <span className="thought-glyph">
          <_ChatIcon name="thinking" size={11} color="var(--lilac)" />
        </span>
        <span className="thought-title">
          {isThinking
            ? (window.t ? window.t("chat.thinkingActive", null, "thinking…") : "thinking…")
            : (window.t ? window.t("chat.thought", null, "thinking process") : "thinking process")}
        </span>
        {isThinking ? (
          <span className="chip" style={{ color: "var(--lilac)", borderColor: "color-mix(in oklab, var(--lilac) 30%, var(--line))", animation: "pulseDot 1.4s infinite" }}>
            <span className="dot live" />
          </span>
        ) : (
          thought && (
            <span className="chip muted mono" style={{ fontSize: "var(--d-text-xs)" }}>
              {thought.length > 1000 ? `${(thought.length / 1000).toFixed(1)}k chars` : `${thought.length} chars`}
            </span>
          )
        )}
        <div style={{ flex: 1 }} />
        <span className="thought-toggle" aria-label={toggleTitle}>
          <_ChatIcon name={isOpen ? "chev" : "chevR"} size={10} color="var(--fg-4)" />
        </span>
      </button>

      {isOpen && (
        <div className="thought-body selectable">
          <div className="thought-content">{thought || (isThinking ? (window.t ? window.t("chat.thinkingActive", null, "thinking…") : "thinking…") : "")}</div>
        </div>
      )}
    </div>
  );
}

function AssistantBubble({ msg, idx, highlighted, annotable, annotations, onAnnotate, onBranch, onOpenKanban }) {
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
        </div>
        <ThoughtBlock thought={msg.thought} streaming={msg.streaming} lead={msg.lead} />
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
            return <InlinePlan key={i} plan={b} onOpenKanban={onOpenKanban} />;
          }
          return null;
        })}
        {msg.error && (
          <div className="msg-error-card" style={{
            margin: "8px 0 4px",
            padding: "8px 10px",
            borderRadius: "6px",
            background: "color-mix(in oklab, var(--rose) 10%, transparent)",
            border: "1px solid color-mix(in oklab, var(--rose) 30%, var(--line))",
            color: "var(--fg-1)",
            fontSize: "var(--d-text-xs, 12px)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
              <_ChatIcon name="warn" size={12} color="var(--rose)" />
              <span style={{ fontWeight: 600, color: "var(--rose)" }}>
                {window.t ? window.t("chat.error.providerError", null, "Provider Error") : "Provider Error"}
              </span>
              {(msg.error.provider || msg.error.httpStatus) && (
                <span className="chip muted mono" style={{ fontSize: "11px" }}>
                  {[msg.error.provider, msg.error.httpStatus].filter(Boolean).join(" · ")}
                </span>
              )}
              {msg.error.retryable && (
                <span className="chip" style={{
                  fontSize: "11px",
                  color: "var(--amber)",
                  borderColor: "color-mix(in oklab, var(--amber) 40%, var(--line))",
                }}>
                  {window.t ? window.t("chat.error.retryable", null, "Retryable") : "Retryable"}
                </span>
              )}
            </div>
            <div className="selectable" style={{ color: "var(--fg-2)", lineHeight: 1.4, wordBreak: "break-word" }}>
              {msg.error.message}
            </div>
          </div>
        )}
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

Object.assign(window, { AssistantBubble, InlinePlan, ThoughtBlock });
