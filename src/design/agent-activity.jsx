/* agent-activity.jsx — live agent status card for the ambient rail.
   Shows current state (idle / thinking / tool), running tools with
   ticking elapsed timers, a rolling trail of recent completed actions,
   and a heartbeat pulse so the user knows the agent process is alive.

   Depends on: Icon, TOOL_META (ui/icons.jsx). */

const { Icon, TOOL_META } = window;

function _fmtElapsed(ms) {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s < 10 ? "0" : ""}${s}s`;
}

function _fmtDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function AgentActivity({ isStreaming, turnStartMs, runningTools, recentTools }) {
  const [tick, setTick] = React.useState(Date.now());

  React.useEffect(() => {
    if (!isStreaming) return undefined;
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isStreaming]);

  const turnElapsed = (isStreaming && turnStartMs) ? tick - turnStartMs : 0;
  const tools  = runningTools ?? [];
  const recent = recentTools ?? [];

  // Derive a single-line label for the current phase
  let phaseLabel, phaseColor;
  if (!isStreaming) {
    phaseLabel = window.t ? window.t("agent.idle", null, "idle") : "idle";
    phaseColor = "var(--fg-5)";
  } else if (tools.length > 0) {
    const latest = tools[tools.length - 1];
    const meta = TOOL_META[latest.tool] || TOOL_META.edit;
    phaseLabel = latest.target
      ? `${meta.label} · ${latest.target}`
      : meta.label;
    phaseColor = meta.color;
  } else {
    phaseLabel = window.t ? window.t("agent.thinking", null, "thinking…") : "thinking…";
    phaseColor = "var(--lilac)";
  }

  return (
    <div className="agent-act">
      <div className="agent-act-head">
        <span className={`agent-heartbeat ${isStreaming ? "alive" : ""}`} />
        <span style={{ color: "var(--fg-2)", fontWeight: 500 }}>
          {window.t ? window.t("agent.status", null, "agent status") : "agent status"}
        </span>
        {isStreaming && turnStartMs ? (
          <span className="chip muted mono" style={{ marginLeft: "auto" }}>
            {_fmtElapsed(turnElapsed)}
          </span>
        ) : (
          <span className="chip muted" style={{ marginLeft: "auto" }}>—</span>
        )}
      </div>

      <div className="agent-act-phase mono" style={{ color: phaseColor }}>
        {isStreaming && <span className="dot live" style={{ background: phaseColor }} />}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {phaseLabel}
        </span>
      </div>

      {/* Currently running tools — ticking elapsed timers */}
      {tools.length > 0 && (
        <div className="agent-act-tools">
          {tools.map(t => {
            const meta = TOOL_META[t.tool] || TOOL_META.edit;
            const elapsed = tick - t.startMs;
            return (
              <div key={t.id} className="agent-act-tool mono">
                <Icon name={meta.icon} size={10} color={meta.color} />
                <span style={{ color: meta.color }}>{meta.label}</span>
                <span style={{ color: "var(--fg-3)", overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                  {t.target || "—"}
                </span>
                <span className={`agent-act-timer ${elapsed > 30000 ? "slow" : ""}`}>
                  {_fmtElapsed(elapsed)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Recent completed tools — rolling trail of last 3 actions */}
      {recent.length > 0 && (
        <div className="agent-act-recent">
          <span className="agent-act-recent-label mono">
            {window.t ? window.t("agent.recent", null, "recent") : "recent"}
          </span>
          {recent.map((t, i) => {
            const meta = TOOL_META[t.tool] || TOOL_META.edit;
            return (
              <div key={t.id ?? i} className="agent-act-trail mono fade-up">
                <Icon name={meta.icon} size={9} color={meta.color} />
                <span style={{ color: meta.color }}>{meta.label}</span>
                <span style={{ color: "var(--fg-4)", overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                  {t.target || "—"}
                </span>
                <span className="agent-act-dur">{_fmtDuration(t.durationMs)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { AgentActivity });
