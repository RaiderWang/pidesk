/* hub/hub-tree.jsx — Tree mode for Agent Hub.
   Shows a live subagent tree when a `task` tool is active.
   Each agent node: status dot + name + badge + tokens + duration,
   expandable log stream, task description.

   Depends on: Icon, TOOL_META (ui/icons.jsx). */

const { Icon, TOOL_META: _HT_META } = window;

const _TA_CLR = {
  running:   "var(--accent)",
  completed: "var(--cyan)",
  failed:    "var(--rose)",
  aborted:   "var(--amber)",
};

function _htFmtTokens(n) {
  if (n == null || n === 0) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function _htFmtDuration(ms) {
  if (!ms || ms <= 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  return `${Math.floor(sec / 60)}m ${Math.floor(sec % 60)}s`;
}

function HubAgentNode({ agent, isStreaming }) {
  const [expanded, setExpanded] = React.useState(false);
  const logRef = React.useRef(null);
  const color = _TA_CLR[agent.status] || "var(--fg-4)";
  const name = agent.agent || `worker-${agent.index}`;
  const stream = agent._stream ?? [];
  const t = window.t;

  // Auto-scroll log when expanded and streaming
  React.useEffect(() => {
    if (expanded && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [expanded, stream.length]);

  return (
    <div className="hub-agent-node">
      <div className="hub-agent-head" onClick={() => stream.length > 0 && setExpanded(e => !e)}>
        <span className="dot" style={{
          background: color,
          boxShadow: agent.status === "running" ? `0 0 6px ${color}` : "none",
          animation: agent.status === "running" ? "pulseDot 1.8s ease-in-out infinite" : "none",
        }} />
        <span className="hub-agent-name" style={{ color: "var(--fg-2)" }}>{name}</span>
        <span className="chip" style={{
          color,
          borderColor: `color-mix(in oklab, ${color} 30%, var(--line))`,
          background: `color-mix(in oklab, ${color} 10%, transparent)`,
        }}>{agent.status}</span>
        <span className="mono" style={{ color: "var(--fg-4)", marginLeft: "auto" }}>
          {_htFmtTokens(agent.tokens)}
        </span>
        <span className="mono" style={{ color: "var(--fg-5)" }}>
          {_htFmtDuration(agent.durationMs)}
        </span>
        {stream.length > 0 && (
          <Icon name={expanded ? "chev" : "chevR"} size={9} color="var(--fg-4)" />
        )}
      </div>

      {agent.task && (
        <div className="hub-agent-task mono">{agent.task}</div>
      )}

      {agent.lastIntent && (
        <div className="hub-agent-intent mono">
          <Icon name="edit" size={8} color="var(--fg-4)" /> {agent.lastIntent}
        </div>
      )}

      {expanded && stream.length > 0 && (
        <div className="hub-agent-log" ref={logRef}>
          {stream.slice(-50).map((line, i) => (
            <div key={i} className="hub-agent-log-line">{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function HubTree({ agents, isStreaming }) {
  const t = window.t;
  const list = agents ?? [];
  const totalTokens = list.reduce((s, a) => s + (a.tokens ?? 0), 0);
  const totalDur = list.reduce((s, a) => s + (a.durationMs ?? 0), 0);

  return (
    <div className="hub-tree">
      {/* Summary row */}
      <div className="hub-tree-summary">
        <span style={{ color: "var(--fg-3)" }}>
          {list.length} {t ? t("hub.mode.tree", null, "workers") : "workers"}
        </span>
        <span className="mono" style={{ color: "var(--fg-4)" }}>
          {_htFmtTokens(totalTokens)} {t ? t("hub.total", null, "total") : "total"}
        </span>
        <span className="mono" style={{ color: "var(--fg-5)" }}>
          {_htFmtDuration(totalDur)}
        </span>
      </div>

      {/* Agent nodes */}
      <div className="hub-tree-nodes">
        {list.map((a, i) => (
          <HubAgentNode key={a.id ?? a.index ?? i} agent={a} isStreaming={isStreaming} />
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { HubTree });
