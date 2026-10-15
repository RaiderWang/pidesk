/* chrome/agent-error-banner.jsx — shown when omp is not running or failed to spawn. */

const { Icon } = window;

// ── Agent error banner: shown when omp is not running or failed to spawn ───
function AgentErrorBanner({ error, onRetry, onConfigureModels }) {
  const [copied, setCopied] = React.useState(false);
  const [retrying, setRetrying] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);

  const t = window.t;
  const isNoModels = typeof error === "string" && error.includes("No models available");
  const isSpawnErr = typeof error === "string" && (error.includes("failed to spawn omp") || error.includes("Make sure omp is installed"));

  const handleCopy = () => {
    if (!error) return;
    navigator.clipboard?.writeText(error).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await onRetry?.();
    } finally {
      setRetrying(false);
    }
  };

  const title = t
    ? t("agent.ompNotFoundTitle", null, "Agent Process (omp) Not Found or Failed to Start")
    : "Agent Process (omp) Not Found or Failed to Start";

  const desc = isNoModels
    ? (t ? t("agent.noModelsAdvice", null, "No models available. Please open Settings -> Models to configure a model (such as auto/best-free), then save to restart the session.") : "No models available. Please open Settings -> Models to configure a model (such as auto/best-free), then save to restart the session.")
    : (t ? t("agent.ompNotFoundDesc", null, "PiDesk cannot connect to the omp agent process. Please check whether omp is installed and configured in PATH.") : "PiDesk cannot connect to the omp agent process. Please check whether omp is installed and configured in PATH.");

  return (
    <div className="agent-error-banner" style={{
      margin: "12px 16px 0 16px",
      padding: "12px 16px",
      borderRadius: "var(--r-2)",
      background: "linear-gradient(135deg, color-mix(in oklab, var(--rose) 14%, var(--bg-surface)), color-mix(in oklab, var(--bg-surface) 95%, transparent))",
      border: "1px solid color-mix(in oklab, var(--rose) 45%, var(--line))",
      boxShadow: "0 4px 16px rgba(0, 0, 0, 0.25), 0 0 0 1px color-mix(in oklab, var(--rose) 20%, transparent)",
      display: "flex",
      flexDirection: "column",
      gap: 10,
      flexShrink: 0,
      animation: "fadeUp 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <div style={{
            width: 24, height: 24, borderRadius: 6,
            background: "color-mix(in oklab, var(--rose) 20%, transparent)",
            border: "1px solid color-mix(in oklab, var(--rose) 50%, transparent)",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
          }}>
            <Icon name="warn" size={14} color="var(--rose)" />
          </div>
          <span style={{ fontWeight: 600, fontSize: "var(--d-text-sm)", color: "var(--rose)", letterSpacing: "0.01em" }}>
            {title}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {isNoModels && (
            <button className="btn outlined" onClick={onConfigureModels}
              style={{ height: 26, fontSize: "var(--d-text-xs)", color: "var(--accent)", borderColor: "color-mix(in oklab, var(--accent) 40%, var(--line))" }}>
              <Icon name="cog" size={12} color="var(--accent)" />
              {t ? t("agent.configureModels", null, "Configure Models") : "Configure Models"}
            </button>
          )}
          <button className="btn primary" onClick={handleRetry} disabled={retrying}
            style={{
              height: 26, fontSize: "var(--d-text-xs)", gap: 5,
              background: "var(--rose)", borderColor: "var(--rose)", color: "#fff",
              opacity: retrying ? 0.7 : 1,
            }}>
            <Icon name="refresh" size={12} color="#fff" />
            {retrying
              ? (t ? t("agent.retrying", null, "Connecting…") : "Connecting…")
              : (t ? t("agent.retry", null, "Retry") : "Retry")}
          </button>
          <button className="btn ghost" onClick={handleCopy}
            title={t ? t("agent.copyError", null, "Copy error details") : "Copy error details"}
            style={{ height: 26, padding: "0 8px", fontSize: "var(--d-text-xs)", border: "1px solid var(--line)" }}>
            <Icon name={copied ? "check" : "copy"} size={12} color={copied ? "var(--accent)" : "var(--fg-3)"} />
            {copied ? (t ? t("agent.copied", null, "Copied!") : "Copied!") : null}
          </button>
        </div>
      </div>

      <div style={{ fontSize: "var(--d-text-xs)", color: "var(--fg-2)", lineHeight: 1.5 }}>
        {desc}
      </div>

      {error && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--d-text-xs)",
            color: "var(--fg-2)",
            background: "color-mix(in oklab, #000 40%, var(--bg-input))",
            border: "1px solid color-mix(in oklab, var(--rose) 25%, var(--line-soft))",
            borderRadius: "var(--r-1)",
            padding: "8px 12px",
            maxHeight: expanded ? 300 : 80,
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            lineHeight: 1.45,
            userSelect: "text",
          }}>
            {error}
          </div>
          {error.length > 120 && (
            <button className="btn ghost" onClick={() => setExpanded(!expanded)}
              style={{ alignSelf: "flex-start", height: 20, padding: "0 4px", fontSize: "11px", color: "var(--fg-4)" }}>
              {expanded
                ? (t ? t("agent.collapseDetails", null, "Collapse details") : "Collapse details")
                : (t ? t("agent.expandDetails", null, "Show full error") : "Show full error")}
            </button>
          )}
        </div>
      )}

      {isSpawnErr && (
        <div style={{ fontSize: "11px", color: "var(--fg-4)", fontStyle: "italic" }}>
          {t ? t("agent.ompInstallHint", null, "Tip: Verify that omp is installed and available in your shell PATH.") : "Tip: Verify that omp is installed and available in your shell PATH."}
        </div>
      )}
    </div>
  );
}


Object.assign(window, { AgentErrorBanner });
