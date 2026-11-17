/* app/model-groups.js — pure ranking + provider grouping for the palette's
   "switch model" list (design/palette/palette-models-view.jsx).

   rankAndGroupModels(models, query, current) -> [{ key, provider, entries, hasCurrent }]
     - entries: [{ item, rowKey }] in display order
     - empty query keeps the original order; groups follow first appearance
     - otherwise models are fuzzy-ranked (name+id at full weight, provider on
       its own at 0.8 so provider length never skews a model-name match) and
       groups follow their best-ranked model
     - models without a provider share one group (provider "", key "__other__");
       the UI supplies the translated title
   isCurrentModel(m, current)      current = { id, provider }; provider optional
   visibleEntries(groups, collapsed) rows of the groups not in the Set
   cursorAfterToggle(groups, collapsed, rowKey) cursor index that keeps pointing at
     the same row after a toggle (or the next visible row if it was hidden) */
(function () {
  const OTHER_KEY = "__other__";
  const PROVIDER_WEIGHT = 0.8;

  const groupKey = (provider) => (provider ? `p:${provider}` : OTHER_KEY);
  const rowKeyOf = (m) => `${m.provider || ""}/${m.id}`;

  function isCurrentModel(m, current) {
    if (!m || !current || !current.id) return false;
    return m.id === current.id
      && (!current.provider || !m.provider || m.provider === current.provider);
  }

  function weighted(score, weight) {
    return score >= 0 ? score * weight : score / weight;
  }

  /** Best fuzzy score of a model for `query`, or null when nothing matches. */
  function scoreModel(m, query) {
    const { fuzzyMatch } = window.Fuzzy;
    const byName = fuzzyMatch(query, `${m.name || ""} ${m.id || ""}`);
    let best = byName ? byName.score : null;
    if (m.provider) {
      const byProvider = fuzzyMatch(query, m.provider);
      if (byProvider) {
        const s = weighted(byProvider.score, PROVIDER_WEIGHT);
        if (best === null || s > best) best = s;
      }
    }
    return best;
  }

  function rankModels(models, query) {
    if (!String(query || "").trim()) return models.slice();
    const scored = [];
    models.forEach((m, order) => {
      const score = scoreModel(m, query);
      if (score !== null) scored.push({ m, score, order });
    });
    scored.sort((a, b) => b.score - a.score || a.order - b.order);
    return scored.map((s) => s.m);
  }

  function rankAndGroupModels(models, query, current) {
    const groups = new Map();
    for (const m of rankModels(models || [], query)) {
      const key = groupKey(m.provider);
      let g = groups.get(key);
      if (!g) {
        g = { key, provider: m.provider || "", entries: [], hasCurrent: false };
        groups.set(key, g);
      }
      g.entries.push({ item: m, rowKey: rowKeyOf(m) });
      if (isCurrentModel(m, current)) g.hasCurrent = true;
    }
    return Array.from(groups.values());
  }

  function visibleEntries(groups, collapsed) {
    return groups.flatMap((g) => (collapsed.has(g.key) ? [] : g.entries));
  }

  function cursorAfterToggle(groups, collapsed, rowKey) {
    const visible = visibleEntries(groups, collapsed);
    if (visible.length === 0) return 0;
    const idx = visible.findIndex((e) => e.rowKey === rowKey);
    if (idx >= 0) return idx;
    // The row's group was just collapsed: land on the first row after it.
    let before = 0;
    for (const g of groups) {
      if (g.entries.some((e) => e.rowKey === rowKey)) return Math.min(before, visible.length - 1);
      if (!collapsed.has(g.key)) before += g.entries.length;
    }
    return 0;
  }

  window.ModelGroups = {
    OTHER_KEY, isCurrentModel, rankAndGroupModels, visibleEntries, cursorAfterToggle,
  };
})();
