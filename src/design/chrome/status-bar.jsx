/* chrome/status-bar.jsx — footer status line.
   Persistent: connection dot, model, context gauge, session usage.
   Secondary info (throughput) only shows while streaming or on demand;
   thinking level lives in the composer. */

const { Icon } = window;

const _SB_BTN_STYLE = { height: 22, padding: "0 6px", fontSize: "var(--d-text-xs)" };

function StatusBar({ ctx, model, todoDone, todoTotal, onTodo, onModel, agentError, isStreaming = false }) {
  const t = window.t;
  const [usageOpen, setUsageOpen] = React.useState(false);
  const isConnected = !agentError;
  const showTps = isStreaming || usageOpen;

  const connectedLabel = t ? t("chrome.status.connected", null, "connected") : "connected";
  const disconnectedLabel = t ? t("chrome.status.disconnected", null, "disconnected") : "disconnected";
  const costLabel = t ? t("chrome.status.cost", null, "cost") : "cost";
  const usageTitle = t
    ? t("chrome.status.usage", { cost: ctx.cost, tps: ctx.tokensPerSec }, `session cost ${ctx.cost} · ${ctx.tokensPerSec} t/s`)
    : `session cost ${ctx.cost} · ${ctx.tokensPerSec} t/s`;
  const planKey = window.AppShortcuts ? window.AppShortcuts.displayFor("togglePlan") : "";
  const planTitle = (t ? t("activity.plan", null, "Plan") : "Plan") + (planKey ? ` (${planKey})` : "");

  return (
    <div className="status">
      <span className="status-cell" title={agentError || (isConnected ? connectedLabel : disconnectedLabel)}>
        <span className={`dot ${isConnected ? "live" : "error"}`} />
        {!isConnected && <span style={{ color: "var(--rose)" }}>{disconnectedLabel}</span>}
      </span>
      <span className="status-sep">·</span>
      <button className="status-cell btn ghost" onClick={onModel} style={_SB_BTN_STYLE}>
        <span style={{ color: "var(--accent)" }}>{model.name}</span>
        <Icon name="chev" size={9} color="var(--fg-4)" />
      </button>
      <span className="status-sep">·</span>
      <span className="status-cell">
        <span style={{ color: "var(--fg-3)" }}>{ctx.label}</span>
        <span className="status-bar-tube">
          <span className="status-bar-fill" style={{ width: `${ctx.pct}%` }} />
        </span>
        <span className="mono" style={{ color: "var(--fg-4)" }}>{(+ctx.pct).toFixed(1)}%</span>
      </span>
      <span className="status-sep">·</span>
      <button className="status-cell btn ghost" onClick={() => setUsageOpen(v => !v)} style={_SB_BTN_STYLE} title={usageTitle}>
        <span style={{ color: "var(--fg-3)" }}>{costLabel}</span>
        <span className="mono">{ctx.cost}</span>
        {showTps && (
          <span className="mono" style={{ color: isStreaming ? "var(--accent)" : "var(--fg-4)" }}>
            · {ctx.tokensPerSec} t/s
          </span>
        )}
      </button>
      <div style={{ flex: 1 }} />
      <button className="status-cell btn ghost" onClick={onTodo} style={_SB_BTN_STYLE} title={planTitle}>
        <Icon name="plan" size={11} color="var(--accent)" />
        <span style={{ color: "var(--accent)" }}>{t ? t("chrome.status.kanban", null, "kanban") : "kanban"} <span className="mono">{todoDone}/{todoTotal}</span></span>
      </button>
    </div>
  );
}

Object.assign(window, { StatusBar });
