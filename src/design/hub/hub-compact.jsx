/* hub/hub-compact.jsx — Compact mode for Agent Hub.
   Merges AgentActivity (heartbeat + phase + running tools + recent trail)
   with a mini tool-distribution bar replacing the 60-cell radar.
   Shown when no subagent task is active.

   Depends on: Icon, TOOL_META (ui/icons.jsx). */

const { Icon, TOOL_META: _HC_META } = window;

function _hcFmtElapsed(ms) {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s < 10 ? "0" : ""}${s}s`;
}

function _hcFmtDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const RECENT_MAX = 8;

function HubCompact({ runningTools, recentTools, isStreaming, turnStartMs, activity }) {
  const [tick, setTick] = React.useState(Date.now());

  React.useEffect(() => {
    if (!isStreaming) return undefined;
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isStreaming]);

  const turnElapsed = (isStreaming && turnStartMs) ? tick - turnStartMs : 0;
  const tools  = runningTools ?? [];
  const recent = (recentTools ?? []).slice(-RECENT_MAX);
  const t = window.t;

  // Phase label
  let phaseLabel, phaseColor;
  if (!isStreaming) {
    phaseLabel = t ? t("agent.idle", null, "idle") : "idle";
    phaseColor = "var(--fg-5)";
  } else if (tools.length > 0) {
    const latest = tools[tools.length - 1];
    const meta = _HC_META[latest.tool] || _HC_META.edit;
    phaseLabel = latest.target ? `${meta.label} · ${latest.target}` : meta.label;
    phaseColor = meta.color;
  } else {
    phaseLabel = t ? t("agent.thinking", null, "thinking…") : "thinking…";
    phaseColor = "var(--lilac)";
  }

  // Mini tool distribution bar from activity log
  const dist = React.useMemo(() => {
    const counts = {};
    let total = 0;
    for (const a of (activity ?? [])) {
      const k = a.k || "edit";
      counts[k] = (counts[k] || 0) + 1;
      total++;
    }
    if (total === 0) return null;
    return { counts, total };
  }, [activity]);

  return (
    <div className="hub-compact">
      {/* Header: heartbeat + title + elapsed */}
      <div className="hub-compact-head">
        <span className={`agent-heartbeat ${isStreaming ? "alive" : ""}`} />
        <span style={{ color: "var(--fg-2)", fontWeight: 500 }}>
          {t ? t("hub.title", null, "agent hub") : "agent hub"}
        </span>
        {isStreaming && turnStartMs ? (
          <span className="chip muted mono" style={{ marginLeft: "auto" }}>
            {_hcFmtElapsed(turnElapsed)}
          </span>
        ) : (
          <span className="chip muted" style={{ marginLeft: "auto" }}>
            {t ? t("hub.mode.compact", null, "compact") : "compact"}
          </span>
        )}
      </div>

      {/* Current phase */}
      <div className="hub-compact-phase mono" style={{ color: phaseColor }}>
        {isStreaming && <span className="dot live" style={{ background: phaseColor }} />}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {phaseLabel}
        </span>
      </div>

      {/* Running tools */}
      {tools.length > 0 && (
        <div className="hub-compact-running">
          {tools.map(tl => {
            const meta = _HC_META[tl.tool] || _HC_META.edit;
            const elapsed = tick - tl.startMs;
            return (
              <div key={tl.id} className="hub-compact-tool mono">
                <Icon name={meta.icon} size={10} color={meta.color} />
                <span style={{ color: meta.color }}>{meta.label}</span>
                <span style={{ color: "var(--fg-3)", overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                  {tl.target || "—"}
                </span>
                <span className={`hub-compact-timer ${elapsed > 30000 ? "slow" : ""}`}>
                  {_hcFmtElapsed(elapsed)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Recent tools trail */}
      {recent.length > 0 && (
        <div className="hub-compact-recent">
          <span className="hub-compact-recent-label mono">
            {t ? t("agent.recent", null, "recent") : "recent"}
          </span>
          {recent.map((tl, i) => {
            const meta = _HC_META[tl.tool] || _HC_META.edit;
            return (
              <div key={tl.id ?? i} className="hub-compact-trail mono">
                <Icon name={meta.icon} size={9} color={meta.color} />
                <span style={{ color: meta.color }}>{meta.label}</span>
                <span style={{ color: "var(--fg-4)", overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                  {tl.target || "—"}
                </span>
                <span className="hub-compact-dur">{_hcFmtDuration(tl.durationMs)}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* No activity placeholder */}
      {!isStreaming && recent.length === 0 && tools.length === 0 && (
        <div className="hub-compact-empty mono">
          {t ? t("hub.noActivity", null, "no recent activity") : "no recent activity"}
        </div>
      )}

      {/* Mini tool distribution bar */}
      {dist && (
        <div className="hub-tool-bar-wrap">
          <div className="hub-tool-bar">
            {Object.entries(dist.counts).map(([k, count]) => {
              const meta = _HC_META[k] || _HC_META.edit;
              const pct = (count / dist.total) * 100;
              return (
                <div key={k} className="hub-tool-bar-seg"
                  style={{ width: `${pct}%`, background: meta.color }}
                  title={`${meta.label}: ${count}`} />
              );
            })}
          </div>
          <div className="hub-tool-bar-foot">
            <span style={{ color: "var(--fg-4)" }}>{t ? t("hub.tools", null, "tools") : "tools"}</span>
            <span className="mono" style={{ color: "var(--fg-3)" }}>{dist.total}</span>
          </div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { HubCompact });
