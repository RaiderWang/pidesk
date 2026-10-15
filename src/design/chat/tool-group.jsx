/* chat/tool-group.jsx — one-line summary for a run of consecutive tool
   calls (see app/chat-grouping.js). Collapsed: header only. Expanded:
   header followed by the regular ToolCard rows. */

const { Icon: _TG_Icon, TOOL_META: _TG_TOOL_META, ToolCard: _TG_ToolCard } = window;

const _TG_ToolCard_M = React.memo(_TG_ToolCard);

function _tgFmtDuration(ms) {
  if (!ms) return null;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function ToolGroupImpl({ group, expanded, hoveredIdx, onToggle }) {
  const t = window.t;
  const { stats, items } = group;
  const hotInside = hoveredIdx != null && hoveredIdx >= group.startIdx && hoveredIdx <= group.endIdx;
  const hasProblem = stats.failed > 0 || stats.aborted > 0;
  const duration = _tgFmtDuration(stats.durationMs);

  const title = t
    ? t("chat.toolGroup.title", { count: stats.total }, `${stats.total} tool calls`)
    : `${stats.total} tool calls`;
  const toggleTitle = expanded
    ? (t ? t("chat.toolGroup.collapse", null, "Collapse tool calls") : "Collapse tool calls")
    : (t ? t("chat.toolGroup.expand", null, "Expand tool calls") : "Expand tool calls");

  return (
    <>
      <div
        className={`row tool tool-group fade-up${hotInside && !expanded ? " mm-hot" : ""}`}
        data-group-key={group.key}
        data-group-from={group.startIdx}
        data-group-to={group.endIdx}
      >
        <div className="ass-rail">
          <div className="tool-glyph" style={{ borderColor: "var(--fg-4)", color: "var(--fg-3)" }}>
            <_TG_Icon name="bolt" size={11} color="var(--fg-3)" />
          </div>
          <div className="ass-thread" />
        </div>
        <div className={`tool-card collapsible tool-group-card ${hasProblem ? "has-problem" : "ok"} ${expanded ? "expanded" : "collapsed"}`}>
          <div className="tool-card-head" onClick={() => onToggle(group.key)} title={toggleTitle}>
            <span className="tool-group-title">{title}</span>
            <span className="tool-group-counts">
              {Object.entries(stats.byTool).map(([tool, n]) => {
                const meta = _TG_TOOL_META[tool] || { color: "var(--fg-3)", label: tool };
                return (
                  <span key={tool} className="tool-tag" style={{
                    color: meta.color,
                    background: `color-mix(in oklab, ${meta.color} 14%, transparent)`,
                    borderColor: `color-mix(in oklab, ${meta.color} 30%, var(--line))`,
                  }}>
                    {meta.label} <span className="mono">{n}</span>
                  </span>
                );
              })}
            </span>
            <div className="tool-card-spacer" />
            {stats.failed > 0 && (
              <span className="chip danger">
                {t ? t("chat.toolGroup.failed", { n: stats.failed }, `${stats.failed} failed`) : `${stats.failed} failed`}
              </span>
            )}
            {stats.aborted > 0 && (
              <span className="chip warn">
                {t ? t("chat.toolGroup.aborted", { n: stats.aborted }, `${stats.aborted} aborted`) : `${stats.aborted} aborted`}
              </span>
            )}
            {duration && <span className="chip muted mono">{duration}</span>}
            <span className="tool-card-toggle" aria-label={toggleTitle}>
              <_TG_Icon name={expanded ? "chev" : "chevR"} size={10} color="var(--fg-4)" />
            </span>
          </div>
        </div>
      </div>
      {expanded && items.map(({ idx, msg }) => (
        <_TG_ToolCard_M key={msg._id ?? idx} idx={idx} highlighted={hoveredIdx === idx} msg={msg} />
      ))}
    </>
  );
}

// Group entries are rebuilt on every message update, so compare by content
// (item message identity) rather than by object reference.
function _tgSame(a, b) {
  // `locale` is not read by the component; it only forces a re-render so the
  // translated header text follows language switches.
  if (a.expanded !== b.expanded || a.hoveredIdx !== b.hoveredIdx || a.onToggle !== b.onToggle || a.locale !== b.locale) return false;
  const x = a.group;
  const y = b.group;
  if (x.key !== y.key || x.items.length !== y.items.length) return false;
  for (let i = 0; i < x.items.length; i++) {
    if (x.items[i].msg !== y.items[i].msg || x.items[i].idx !== y.items[i].idx) return false;
  }
  return true;
}

const ToolGroup = React.memo(ToolGroupImpl, _tgSame);

Object.assign(window, { ToolGroup });
