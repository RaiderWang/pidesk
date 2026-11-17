/* palette/palette-models-view.jsx — "switch model" drill-in view of the
   command palette. Rendered inside the palette's Modal.
   Models are grouped by provider; each group can be collapsed (search results
   included). Ranking/grouping lives in app/model-groups.js. */

const { Icon: _PM_Icon, modelSupportsImages: _PM_supportsImages, usePaletteCursor: _PM_useCursor } = window;

const _PM_NO_COLLAPSED = new Set();
// Keep the search input focused when clicking a button (arrow keys / Enter keep working).
const _PM_keepFocus = (e) => e.preventDefault();

function PaletteModelsView({
  models, currentModelId, currentModelProvider, onPickModel, onClose, onBack, onManageModels,
}) {
  const t = window.t;
  const MG = window.ModelGroups;
  const [q, setQ] = React.useState("");
  const [refreshing, setRefreshing] = React.useState(false);
  // Collapsed provider keys. Searches use their own set, tied to the query it
  // was made for, so every query starts with all matching groups expanded.
  const [collapsed, setCollapsed] = React.useState(_PM_NO_COLLAPSED);
  const [searchCollapsed, setSearchCollapsed] = React.useState({ q: "", set: _PM_NO_COLLAPSED });

  // Refresh the registry whenever the view opens.
  React.useEffect(() => { window.OMP_BRIDGE?.refreshModels(); }, []);

  const searching = q.trim() !== "";
  const activeCollapsed = searching
    ? (searchCollapsed.q === q ? searchCollapsed.set : _PM_NO_COLLAPSED)
    : collapsed;

  const current = React.useMemo(
    () => ({ id: currentModelId, provider: currentModelProvider }),
    [currentModelId, currentModelProvider],
  );
  const groups = React.useMemo(() => MG.rankAndGroupModels(models, q, current), [MG, models, q, current]);
  const visible = React.useMemo(() => MG.visibleEntries(groups, activeCollapsed), [MG, groups, activeCollapsed]);
  const nav = _PM_useCursor(visible.length, q);

  const pick = (m) => { onPickModel(m); onClose(); };

  const toggleGroup = (g) => {
    const next = new Set(activeCollapsed);
    if (!next.delete(g.key)) next.add(g.key);
    const cursorRow = visible[nav.cursor]?.rowKey;
    if (searching) setSearchCollapsed({ q, set: next });
    else setCollapsed(next);
    nav.setCursor(MG.cursorAfterToggle(groups, next, cursorRow));
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await window.OMP_BRIDGE?.refreshModels();
    } finally {
      setTimeout(() => setRefreshing(false), 500);
    }
  };

  let flat = 0;
  return (
    <>
      <div className="bridge-input-row">
        <button className="btn icon ghost" title={t ? t("palette.foot.back", null, "back") : "back"}
          onClick={onBack} style={{ marginRight: 4 }}>
          <_PM_Icon name="chevR" size={12} color="var(--fg-3)" style={{ transform: "rotate(180deg)", display: "block" }} />
        </button>
        <input autoFocus className="bridge-input mono"
          placeholder={t ? t("palette.models.filter", null, "filter models…") : "filter models…"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => nav.onKeyDown(e, (i) => pick(visible[i].item))} />
        <span className="kbd">esc</span>
      </div>
      <div className="bridge-body" ref={nav.bodyRef}>
        <div className="bridge-group-head mono" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "4px 16px" }}>
          {t ? t("palette.models.title", null, "switch model") : "switch model"}
          <span style={{ color: "var(--fg-4)" }}>· {models.length}</span>
          <button className="btn ghost" disabled={refreshing} onMouseDown={_PM_keepFocus}
            style={{ marginLeft: "auto", height: 18, fontSize: "var(--d-text-xs)", padding: "0 6px" }}
            onClick={handleRefresh}>
            {refreshing ? (t ? t("palette.models.refreshing", null, "refreshing…") : "refreshing…") : (t ? t("palette.models.refresh", null, "refresh") : "refresh")}
          </button>
          <button className="btn ghost outlined"
            style={{ height: 18, fontSize: "var(--d-text-xs)", padding: "0 6px", display: "flex", alignItems: "center", gap: 4 }}
            onClick={() => { onClose(); onManageModels?.(); }}>
            <_PM_Icon name="cpu" size={10} color="var(--accent)" />
            {t ? t("palette.models.manage", null, "manage") : "manage"}
          </button>
        </div>
        {groups.map((g) => {
          const isCollapsed = activeCollapsed.has(g.key);
          const title = g.provider || (t ? t("palette.models.otherProvider", null, "other") : "other");
          const toggleKey = isCollapsed ? "palette.models.expandGroup" : "palette.models.collapseGroup";
          const toggleFallback = isCollapsed ? `expand ${title}` : `collapse ${title}`;
          return (
            <div className="bridge-group" key={g.key}>
              <button type="button" className="palette-group-toggle mono"
                aria-expanded={!isCollapsed}
                title={t ? t(toggleKey, { name: title }, toggleFallback) : toggleFallback}
                onMouseDown={_PM_keepFocus}
                onClick={() => toggleGroup(g)}>
                <_PM_Icon name="chevR" size={10} color="var(--fg-4)"
                  style={{ transform: isCollapsed ? "none" : "rotate(90deg)", transition: "transform 0.12s", display: "block" }} />
                <span className="palette-group-name">{title}</span>
                <span className="palette-group-count">{g.entries.length}</span>
                {isCollapsed && g.hasCurrent && <_PM_Icon name="check" size={10} color="var(--accent)" />}
              </button>
              {!isCollapsed && g.entries.map(({ item: m, rowKey }) => {
                const i = flat++;
                const isCurrent = MG.isCurrentModel(m, current);
                return (
                  <button key={rowKey}
                    className={`bridge-row ${isCurrent ? "active" : ""}${i === nav.cursor ? " is-cursor" : ""}`}
                    data-cursor={i === nav.cursor ? "true" : undefined}
                    onMouseMove={() => nav.setCursor(i)}
                    onClick={() => pick(m)}>
                    <span className="bridge-glyph">
                      {isCurrent
                        ? <_PM_Icon name="check" size={10} color="var(--accent)" />
                        : <_PM_Icon name="bolt" size={10} color="var(--cyan)" />}
                    </span>
                    <span style={{ color: isCurrent ? "var(--accent)" : "var(--fg)" }}>{m.name}</span>
                    <span className="mono" style={{ color: "var(--fg-4)" }}>{m.id}</span>
                    {m.note && m.note !== m.provider && <span style={{ color: "var(--fg-3)" }}>· {m.note}</span>}
                    {_PM_supportsImages(m) && (
                      <span className="chip" style={{ color: "var(--cyan)", borderColor: "color-mix(in oklab, var(--cyan) 30%, transparent)", fontSize: "10px", padding: "1px 5px", display: "inline-flex", alignItems: "center", gap: 3 }}>
                        <_PM_Icon name="image" size={9} color="var(--cyan)" />
                        {t ? t("palette.models.vision", null, "vision") : "vision"}
                      </span>
                    )}
                    <span className="chip muted" style={{ marginLeft: "auto" }}>{m.latency}ms</span>
                  </button>
                );
              })}
            </div>
          );
        })}
        {groups.length === 0 && (
          <div className="bridge-empty">{t ? t("palette.models.none", null, "no models found") : "no models found"}</div>
        )}
      </div>
      <div className="bridge-foot mono">
        <span className="kbd">↑↓</span> {t ? t("palette.foot.navigate", null, "navigate") : "navigate"}
        <span className="kbd">↵</span> {t ? t("palette.foot.switch", null, "switch") : "switch"}
        <span className="kbd">esc</span> {t ? t("palette.foot.back", null, "back") : "back"}
      </div>
    </>
  );
}

Object.assign(window, { PaletteModelsView });
