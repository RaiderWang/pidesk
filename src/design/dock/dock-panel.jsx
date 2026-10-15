/* dock/dock-panel.jsx — right-hand dock: tab strip, drag-to-resize edge,
   close button, and the active tab's content as children.
   tabs: [{ id, label, icon, badge?, dot? }] */

const { Icon: _DP_Icon, useDockResize: _DP_useResize } = window;

function DockPanel({ tabs, activeTab, onTab, onClose, width, onWidthChange, children }) {
  const t = window.t;
  const resize = _DP_useResize({ width, onChange: onWidthChange });

  return (
    <aside className="dock">
      <div
        className={`dock-resizer ${resize.dragging ? "is-dragging" : ""}`}
        onMouseDown={resize.onMouseDown}
        onDoubleClick={resize.onDoubleClick}
        title={t ? t("dock.resizeHint", null, "Drag to resize · Double-click to reset") : "Drag to resize · Double-click to reset"}
      />
      <div className="dock-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeTab}
            className={`dock-tab ${tab.id === activeTab ? "active" : ""}`}
            onClick={() => onTab(tab.id)}
          >
            <_DP_Icon name={tab.icon} size={11} color={tab.id === activeTab ? "var(--accent)" : "var(--fg-3)"} />
            <span>{tab.label}</span>
            {tab.badge > 0 && <span className="dock-tab-badge mono">{tab.badge}</span>}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="btn icon ghost" onClick={onClose}
          title={t ? t("dock.close", null, "Hide panel") : "Hide panel"}>
          <_DP_Icon name="close" size={10} />
        </button>
      </div>
      <div className="dock-body">{children}</div>
    </aside>
  );
}

Object.assign(window, { DockPanel });
