/* chrome/window-chrome.jsx — frameless window title bar: traffic lights (macOS),
   project title + branch, bridge/search trigger, Windows controls. */

const { Icon } = window;

// ── Platform detection ────────────────────────────────────────────────
const IS_WIN = typeof navigator !== "undefined" &&
  (navigator.userAgent.includes("Windows") || navigator.platform.startsWith("Win"));

// ── Window chrome ─────────────────────────────────────────────────────
function WindowChrome({ project, peer, onCmd }) {
  return (
    <div className="chrome" data-tauri-drag-region>
      {/* macOS traffic lights — left side, hidden on Windows */}
      {!IS_WIN && (
        <div className="chrome-lights">
          <span className="light red" />
          <span className="light amber" />
          <span className="light green" />
        </div>
      )}

      <div className="chrome-title">
        <span className="mono" style={{ color: "var(--fg-3)", flexShrink: 0 }}>OMP</span>
        <span className="mono" style={{ color: "var(--fg-5)", flexShrink: 0 }}>·</span>
        <span
          className="chrome-title-text"
          style={{ color: "var(--fg-2)" }}
          title={project.path ? `${project.name} — ${project.path}` : project.name}
        >
          {project.name}
        </span>
        {project.branch && (
          <span className="chip muted" style={{ marginLeft: 6, flexShrink: 0 }}>
            <Icon name="branch" size={9} color="var(--fg-3)" />
            <span className="mono" style={{ color: "var(--fg-3)" }}>{project.branch}</span>
          </span>
        )}
      </div>

      <div className="chrome-right">
        <button className="btn ghost outlined" onClick={onCmd}>
          <Icon name="search" size={11} /> {window.t ? window.t("chrome.search", null, "search…") : "search…"}{" "}
          <span className="kbd">{window.AppShortcuts ? window.AppShortcuts.displayFor("palette") : (IS_WIN ? "Ctrl+K" : "⌘K")}</span>
        </button>

        {/* Windows controls — right side, hidden on macOS/Linux */}
        {IS_WIN && (
          <div className="win-controls">
            <button className="win-ctrl win-min"   title="Minimize">&#8211;</button>
            <button className="win-ctrl win-max"   title="Maximize / Restore">&#9633;</button>
            <button className="win-ctrl win-close" title="Close">&#10005;</button>
          </div>
        )}
      </div>
    </div>
  );
}


Object.assign(window, { WindowChrome });
