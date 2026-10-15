/* chrome/tab-bar.jsx — session tabs + new-session dropdown. */

const { Icon } = window;

// ── Project tabs ─────────────────────────────────────────────────────
function TabBar({ projects, activeId, onSelect, onClose, peer, onNew, onNewProject, onNewStandalone, onOpenRecentProject, appVersion, theme }) {
  const version = appVersion || window.PIDESK_APP_VERSION || window.OMP_APP_VERSION || "0.4.3";
  const themeName = theme || "daylight";
  const versionLabel = `v${version}-${themeName}`;

  const [menuOpen, setMenuOpen] = React.useState(false);
  const [recentProjects, setRecentProjects] = React.useState([]);
  const menuRef = React.useRef(null);

  React.useEffect(() => {
    if (!menuOpen) return;
    const initial = window.RecentProjects ? window.RecentProjects.getRecentProjects().slice(0, 10) : [];
    setRecentProjects(initial);
    window.OMP_BRIDGE?.listSavedSessions?.()
      .then(saved => {
        if (saved && saved.length > 0 && window.RecentProjects) {
          const merged = window.RecentProjects.syncFromSavedSessions(saved).slice(0, 10);
          setRecentProjects(merged);
        }
      })
      .catch(() => {});
  }, [menuOpen]);

  React.useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const handleOpenFolder = () => {
    setMenuOpen(false);
    (onNewProject || onNew)?.();
  };

  const handleOpenStandalone = () => {
    setMenuOpen(false);
    onNewStandalone?.();
  };

  const handleOpenRecent = (path) => {
    setMenuOpen(false);
    if (window.RecentProjects) {
      window.RecentProjects.addRecentProject(path);
    }
    (onOpenRecentProject || onNewProject || onNew)?.(path);
  };

  return (
    <div className="tabs">
      {projects.map((p) => {
        const active = p.id === activeId;
        const hasPath = Boolean(p.path && p.path.trim());
        const tabIcon = hasPath ? "folder" : "agent";
        return (
          <div key={p.id}
            className={`tab ${active ? "active" : ""}`}
            onClick={() => onSelect(p.id)}>
            <span className="tab-bar-mark" style={{ background: active ? p.color : "transparent" }} />
            <Icon name={tabIcon} size={11} color={active ? p.color : "var(--fg-4)"} />
            <span className="tab-name">{p.name}</span>
            {p.id === peer?.projectId && (
              <span className="chip accent" style={{ padding: "1px 6px" }}>split</span>
            )}
            <button className="tab-close" onClick={e => { e.stopPropagation(); onClose?.(p.id); }}><Icon name="close" size={9} /></button>
          </div>
        );
      })}
      <div className="tab-add-wrap" ref={menuRef}>
        <button
          className={`tab-add ${menuOpen ? "active" : ""}`}
          title={window.t ? window.t("chrome.tabs.new", null, "New session / Open project") : "New session / Open project"}
          onClick={() => setMenuOpen(v => !v)}
        >
          <Icon name="plus" size={11} />
        </button>
        {menuOpen && (
          <div className="tab-dropdown-menu">
            <button
              className="tab-dropdown-item"
              onClick={handleOpenFolder}
            >
              <Icon name="folder" size={12} color="var(--accent)" />
              <span className="tab-dropdown-label">{window.t ? window.t("chrome.tabs.openFolder", null, "Open Project Folder...") : "Open Project Folder..."}</span>
              <span className="tab-dropdown-hotkey">Ctrl+O</span>
            </button>
            <button
              className="tab-dropdown-item"
              onClick={handleOpenStandalone}
            >
              <Icon name="agent" size={12} color="var(--lilac)" />
              <span className="tab-dropdown-label">{window.t ? window.t("chrome.tabs.newSession", null, "New Session (No Project)") : "New Session (No Project)"}</span>
              <span className="tab-dropdown-hotkey">Ctrl+T</span>
            </button>
            <div className="tab-dropdown-divider" />
            <div className="tab-dropdown-header">
              {window.t ? window.t("chrome.tabs.recentProjects", null, "Recent Projects") : "Recent Projects"}
            </div>
            {recentProjects.length === 0 ? (
              <div className="tab-dropdown-empty">
                {window.t ? window.t("chrome.tabs.noRecentProjects", null, "No recent projects") : "No recent projects"}
              </div>
            ) : (
              recentProjects.map((rp) => (
                <button
                  key={rp.path}
                  className="tab-dropdown-item tab-dropdown-recent-item"
                  title={rp.path}
                  onClick={() => handleOpenRecent(rp.path)}
                >
                  <Icon name="folder" size={12} color="var(--accent)" />
                  <span className="tab-dropdown-label tab-dropdown-recent-name">{rp.name}</span>
                  <span className="tab-dropdown-path">{rp.path}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
      <div style={{ flex: 1 }} />
      <div className="tabs-right mono">
        <span style={{ color: "var(--fg-4)" }} title={`PiDesk v${version}`}>{versionLabel}</span>
      </div>
    </div>
  );
}


Object.assign(window, { TabBar });
