/* tweaks/update-control.jsx — "Version / Check for updates" row for the
   Tweaks panel. Pure presentation over the useUpdater() result. */

const { TweakRow: _UC_TweakRow, TweakButton: _UC_TweakButton } = window;

function TweakUpdate({ updater, version }) {
  const t = window.t;
  const { state } = updater;
  const busy = state.phase === "checking" || state.phase === "downloading";

  let status = "";
  if (state.phase === "checking") status = t("tweaks.update.checking", null, "Checking…");
  else if (state.phase === "uptodate") status = t("tweaks.update.uptodate", null, "You're up to date");
  else if (state.phase === "available") status = t("tweaks.update.available", { version: state.info?.version || "" });
  else if (state.phase === "downloading") status = t("update.status.downloading", { percent: state.percent ?? 0 });
  else if (state.phase === "ready") status = t("update.status.ready");
  else if (state.phase === "error") {
    status = state.source === "install"
      ? t("update.error.install", { error: state.error || "" })
      : t("tweaks.update.error", { error: state.error || "" });
  }

  let action = <_UC_TweakButton label={t("tweaks.update.check", null, "Check for updates")} onClick={() => updater.check(true)} secondary />;
  if (state.phase === "available") {
    action = <_UC_TweakButton label={t("update.action.install", null, "Update now")} onClick={updater.install} />;
  } else if (state.phase === "ready") {
    action = <_UC_TweakButton label={t("update.action.restart", null, "Restart to finish")} onClick={updater.restart} />;
  } else if (state.phase === "error" && state.source === "install") {
    // Self-update can fail for good (e.g. a .deb install), so also offer the manual route.
    action = (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <_UC_TweakButton label={t("update.action.retry", null, "Retry")} onClick={updater.install} />
        <_UC_TweakButton label={t("update.action.manual", null, "Download manually")} onClick={updater.openReleases} secondary />
      </div>
    );
  }

  return (
    <_UC_TweakRow label={t("tweaks.update.version", null, "Version")} value={version ? `v${version}` : null}>
      {status && <div style={{ fontSize: 11.5, color: "var(--fg-3)", lineHeight: 1.4, wordBreak: "break-word" }}>{status}</div>}
      <div style={{ opacity: busy ? 0.55 : 1, pointerEvents: busy ? "none" : "auto" }}>{action}</div>
    </_UC_TweakRow>
  );
}

Object.assign(window, { TweakUpdate });
