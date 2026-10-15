/* dock/activity-bar.jsx — slim left icon strip: the single entry point for
   panels (files, plan, review, overview, history, models) and settings.
   Tooltips carry the shortcut from app/shortcuts.js. */

const { Icon: _AB_Icon } = window;

function ActivityButton({ item }) {
  const t = window.t;
  const key = item.shortcutId && window.AppShortcuts ? window.AppShortcuts.displayFor(item.shortcutId) : "";
  const label = t ? t(item.labelKey, null, item.fallback) : item.fallback;
  const title = key ? `${label} (${key})` : label;
  return (
    <button
      className={`activity-btn ${item.active ? "active" : ""}`}
      data-activity-id={item.id}
      title={title}
      aria-label={label}
      aria-pressed={Boolean(item.active)}
      onClick={item.onClick}
    >
      <_AB_Icon name={item.icon} size={15} color={item.active ? "var(--accent)" : "currentColor"} />
      {item.badge > 0 && <span className="activity-badge mono">{item.badge > 99 ? "99+" : item.badge}</span>}
      {item.dot && <span className="activity-dot" />}
    </button>
  );
}

function ActivityBar({
  hasProject, filesActive, dockOpen, dockTab, planBadge = 0, planFlashing = false,
  onFiles, onPlan, onReview, onOverview, onHistory, onModels, onSettings,
}) {
  const top = [
    hasProject && { id: "files", icon: "sidebar", labelKey: "activity.files", fallback: "Files", shortcutId: "toggleFiles", active: filesActive, onClick: onFiles },
    { id: "plan", icon: "plan", labelKey: "activity.plan", fallback: "Plan", shortcutId: "togglePlan",
      active: dockOpen && dockTab === "plan", badge: planBadge, dot: planFlashing, onClick: onPlan },
    { id: "review", icon: "diff2", labelKey: "activity.review", fallback: "Code review", onClick: onReview },
    { id: "overview", icon: "radar", labelKey: "activity.overview", fallback: "Overview",
      active: dockOpen && dockTab === "overview", onClick: onOverview },
    { id: "history", icon: "clock", labelKey: "activity.history", fallback: "History", shortcutId: "history", onClick: onHistory },
    { id: "models", icon: "cpu", labelKey: "activity.models", fallback: "Models", shortcutId: "models", onClick: onModels },
  ].filter(Boolean);
  const bottom = [
    { id: "settings", icon: "cog", labelKey: "activity.settings", fallback: "Appearance & layout", onClick: onSettings },
  ];

  return (
    <nav className="activity">
      <div className="activity-group">{top.map((it) => <ActivityButton key={it.id} item={it} />)}</div>
      <div className="activity-group">{bottom.map((it) => <ActivityButton key={it.id} item={it} />)}</div>
    </nav>
  );
}

Object.assign(window, { ActivityBar });
