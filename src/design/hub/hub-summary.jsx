/* hub/hub-summary.jsx — Summary mode for Agent Hub.
   Shows completed task results. Auto-collapses back to compact
   after 5 seconds of no interaction.

   Depends on: Icon, TOOL_META (ui/icons.jsx). */

const { Icon } = window;

const _HS_STATUS = {
  completed: { icon: "check", color: "var(--cyan)", label: "done" },
  failed:    { icon: "warn",  color: "var(--rose)", label: "failed" },
  aborted:   { icon: "stop",  color: "var(--amber)", label: "aborted" },
};

function _hsFmtTokens(n) {
  if (n == null || n === 0) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function _hsFmtDuration(ms) {
  if (!ms || ms <= 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  return `${Math.floor(sec / 60)}m ${Math.floor(sec % 60)}s`;
}

function HubSummary({ agents, history, onAutoCollapse }) {
  const [hovered, setHovered] = React.useState(false);
  const t = window.t;
  const list = agents ?? [];

  // Auto-collapse after 5s unless user is interacting
  React.useEffect(() => {
    if (hovered) return undefined;
    const timer = setTimeout(() => {
      onAutoCollapse?.();
    }, 5000);
    return () => clearTimeout(timer);
  }, [hovered, onAutoCollapse]);

  const totalTokens = list.reduce((s, a) => s + (a.tokens ?? 0), 0);
  const totalDur = list.reduce((s, a) => s + (a.durationMs ?? 0), 0);
  const allOk = list.every(a => a.status === "completed");

  return (
    <div className="hub-summary"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}>
      {/* Result header */}
      <div className="hub-summary-head">
        <Icon name={allOk ? "check" : "warn"} size={11}
          color={allOk ? "var(--cyan)" : "var(--amber)"} />
        <span style={{ color: allOk ? "var(--cyan)" : "var(--amber)", fontWeight: 500 }}>
          {t ? t("hub.mode.summary", null, "done") : "done"}
        </span>
        <span className="mono" style={{ marginLeft: "auto", color: "var(--fg-4)" }}>
          {list.length} {t ? t("hub.mode.tree", null, "workers") : "workers"}
        </span>
      </div>

      {/* Per-worker result rows */}
      <div className="hub-summary-rows">
        {list.map((a, i) => {
          const st = _HS_STATUS[a.status] || _HS_STATUS.completed;
          const name = a.agent || `worker-${a.index}`;
          return (
            <div key={a.id ?? i} className="hub-summary-row mono">
              <Icon name={st.icon} size={9} color={st.color} />
              <span style={{ color: "var(--fg-2)", overflow: "hidden",
                textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                {name}
              </span>
              <span style={{ color: "var(--fg-4)" }}>{_hsFmtTokens(a.tokens)}</span>
              <span style={{ color: "var(--fg-5)" }}>{_hsFmtDuration(a.durationMs)}</span>
            </div>
          );
        })}
      </div>

      {/* Totals */}
      <div className="hub-summary-totals">
        <span style={{ color: "var(--fg-4)" }}>
          {t ? t("hub.total", null, "total") : "total"}
        </span>
        <span className="mono" style={{ color: "var(--fg-3)" }}>{_hsFmtTokens(totalTokens)}</span>
        <span className="mono" style={{ color: "var(--fg-4)" }}>{_hsFmtDuration(totalDur)}</span>
      </div>
    </div>
  );
}

Object.assign(window, { HubSummary });
