/* palette/palette-models-view.jsx — "switch model" drill-in view of the
   command palette. Rendered inside the palette's Modal. */

const { Icon: _PM_Icon, modelSupportsImages: _PM_supportsImages, PaletteHighlight: _PM_Highlight, usePaletteCursor: _PM_useCursor } = window;

function PaletteModelsView({ models, currentModelId, onPickModel, onClose, onBack, onManageModels }) {
  const t = window.t;
  const [q, setQ] = React.useState("");
  const [refreshing, setRefreshing] = React.useState(false);

  // Refresh the registry whenever the view opens.
  React.useEffect(() => { window.OMP_BRIDGE?.refreshModels(); }, []);

  const hits = React.useMemo(
    () => window.Fuzzy.fuzzyRank(models, q, (m) => `${m.name} ${m.id}`).map((r) => r.item),
    [models, q],
  );
  const nav = _PM_useCursor(hits.length, q);

  const pick = (m) => { onPickModel(m); onClose(); };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await window.OMP_BRIDGE?.refreshModels();
    } finally {
      setTimeout(() => setRefreshing(false), 500);
    }
  };

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
          onKeyDown={(e) => nav.onKeyDown(e, (i) => pick(hits[i]))} />
        <span className="kbd">esc</span>
      </div>
      <div className="bridge-body" ref={nav.bodyRef}>
        <div className="bridge-group">
          <div className="bridge-group-head mono" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {t ? t("palette.models.title", null, "switch model") : "switch model"}
            <span style={{ color: "var(--fg-4)" }}>· {models.length}</span>
            <button className="btn ghost" disabled={refreshing}
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
          {hits.map((m, i) => {
            const current = m.id === currentModelId;
            return (
              <button key={m.id}
                className={`bridge-row ${current ? "active" : ""}${i === nav.cursor ? " is-cursor" : ""}`}
                data-cursor={i === nav.cursor ? "true" : undefined}
                onMouseMove={() => nav.setCursor(i)}
                onClick={() => pick(m)}>
                <span className="bridge-glyph">
                  {current
                    ? <_PM_Icon name="check" size={10} color="var(--accent)" />
                    : <_PM_Icon name="bolt" size={10} color="var(--cyan)" />}
                </span>
                <span style={{ color: current ? "var(--accent)" : "var(--fg)" }}>{m.name}</span>
                <span className="mono" style={{ color: "var(--fg-4)" }}>{m.id}</span>
                {m.note && <span style={{ color: "var(--fg-3)" }}>· {m.note}</span>}
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
          {hits.length === 0 && (
            <div className="bridge-empty">{t ? t("palette.models.none", null, "no models found") : "no models found"}</div>
          )}
        </div>
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
