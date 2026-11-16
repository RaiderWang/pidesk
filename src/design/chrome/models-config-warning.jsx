/* chrome/models-config-warning.jsx — shown when omp rejected models.yml and
   therefore ignores every custom provider/model (the detail is omp's own
   schema error from `omp models`). Distinct from AgentErrorBanner: the agent
   is running, only the custom model list is unavailable. */

const { Icon: _MCW_Icon } = window;

function ModelsConfigWarning({ detail, onOpenModels, onDismiss }) {
  const t = window.t;
  const tone = "var(--amber)";
  const btn = { height: 26, fontSize: "var(--d-text-xs)" };

  return (
    <div className="models-config-warning" style={{
      margin: "12px 16px 0 16px",
      padding: "10px 14px",
      borderRadius: "var(--r-2)",
      background: `linear-gradient(135deg, color-mix(in oklab, ${tone} 12%, var(--bg-surface)), color-mix(in oklab, var(--bg-surface) 95%, transparent))`,
      border: `1px solid color-mix(in oklab, ${tone} 40%, var(--line))`,
      boxShadow: "0 4px 16px rgba(0, 0, 0, 0.2)",
      display: "flex", flexDirection: "column", gap: 8, flexShrink: 0,
      animation: "fadeUp 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <_MCW_Icon name="warn" size={14} color={tone} />
          <span style={{ fontWeight: 600, fontSize: "var(--d-text-sm)", color: tone }}>
            {t("models.configInvalid.title")}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button className="btn primary" style={btn} onClick={onOpenModels}>
            {t("models.configInvalid.fix")}
          </button>
          <button className="btn ghost" style={btn} onClick={onDismiss}>
            {t("models.configInvalid.dismiss")}
          </button>
        </div>
      </div>
      <div style={{ fontSize: "var(--d-text-xs)", color: "var(--fg-2)", lineHeight: 1.5 }}>
        {t("models.configInvalid.body")}
      </div>
      <div style={{
        fontFamily: "var(--font-mono)", fontSize: "var(--d-text-xs)", color: "var(--fg-2)",
        background: "color-mix(in oklab, #000 40%, var(--bg-input))",
        border: "1px solid color-mix(in oklab, var(--amber) 25%, var(--line-soft))",
        borderRadius: "var(--r-1)", padding: "8px 12px",
        whiteSpace: "pre-wrap", wordBreak: "break-all", userSelect: "text",
      }}>
        {detail}
      </div>
    </div>
  );
}

Object.assign(window, { ModelsConfigWarning });
