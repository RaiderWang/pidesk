/* chrome/update-banner.jsx — in-app update prompt (available / downloading /
   ready / install failed). State comes from useUpdater (app/use-updater.jsx). */

const { Icon: _UB_Icon } = window;

function UpdateBanner({ state, currentVersion, onInstall, onLater, onIgnore, onRestart, onManual }) {
  const t = window.t;
  const info = state.info || {};
  const failed = state.phase === "error";
  const tone = failed ? "var(--rose)" : "var(--accent)";
  const notes = window.Updater.summarizeNotes(info.notes);

  let title = t("update.banner.title", null, "Update available");
  let body = t("update.banner.body", { version: info.version || "", current: currentVersion || info.currentVersion || "" });
  if (state.phase === "downloading") {
    title = t("update.status.downloading", { percent: state.percent ?? 0 });
    body = "";
  } else if (state.phase === "ready") {
    title = t("update.status.ready");
    body = "";
  } else if (failed) {
    title = t("update.error.install", { error: state.error || "" });
    body = "";
  }

  const btn = { height: 26, fontSize: "var(--d-text-xs)" };

  return (
    <div className="update-banner" style={{
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
          <_UB_Icon name={failed ? "warn" : "arrowUp"} size={14} color={tone} />
          <span style={{ fontWeight: 600, fontSize: "var(--d-text-sm)", color: tone }}>{title}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {state.phase === "available" && (
            <>
              <button className="btn primary" style={btn} onClick={onInstall}>
                {t("update.action.install", null, "Update now")}
              </button>
              <button className="btn ghost" style={btn} onClick={onLater}>
                {t("update.action.later", null, "Later")}
              </button>
              <button className="btn ghost" style={{ ...btn, color: "var(--fg-4)" }} onClick={onIgnore}>
                {t("update.action.ignore", null, "Skip this version")}
              </button>
            </>
          )}
          {state.phase === "ready" && (
            <>
              <button className="btn primary" style={btn} onClick={onRestart}>
                {t("update.action.restart", null, "Restart to finish")}
              </button>
              <button className="btn ghost" style={btn} onClick={onLater}>
                {t("update.action.later", null, "Later")}
              </button>
            </>
          )}
          {failed && (
            <>
              <button className="btn primary" style={btn} onClick={onInstall}>
                {t("update.action.retry", null, "Retry")}
              </button>
              <button className="btn ghost" style={btn} onClick={onManual}>
                {t("update.action.manual", null, "Download manually")}
              </button>
              <button className="btn ghost" style={btn} onClick={onLater}>
                {t("update.action.later", null, "Later")}
              </button>
            </>
          )}
        </div>
      </div>

      {state.phase === "downloading" && (
        <div style={{ height: 4, borderRadius: 2, background: "var(--line)", overflow: "hidden" }}>
          <div style={{
            height: "100%", width: `${state.percent ?? 0}%`,
            background: "var(--accent)", transition: "width 0.2s linear",
          }} />
        </div>
      )}

      {body && (
        <div style={{ fontSize: "var(--d-text-xs)", color: "var(--fg-2)", lineHeight: 1.5 }}>{body}</div>
      )}
      {state.phase === "available" && notes && (
        <div style={{
          fontSize: "var(--d-text-xs)", color: "var(--fg-3)", lineHeight: 1.45,
          whiteSpace: "pre-wrap", maxHeight: 96, overflowY: "auto",
        }}>{notes}</div>
      )}
    </div>
  );
}

Object.assign(window, { UpdateBanner });
