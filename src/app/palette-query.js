/* app/palette-query.js — pure query parsing / ranking / grouping for the
   command palette. Needs app/fuzzy.js (window.Fuzzy) to be loaded first.

   Query prefixes pick a mode:  "/" commands · "#" sessions & history ·
   "@" files · "?" shortcuts help · anything else searches everything
   except files.

   Item shape: { id, group, label, hint?, keywords?: string[], … }
   Groups render in GROUP_ORDER. */
(function () {
  const GROUP_ORDER = ["commands", "actions", "tabs", "history", "files"];
  const PREFIX_MODES = { "/": "commands", "#": "sessions", "@": "files", "?": "shortcuts" };

  function parsePaletteQuery(raw) {
    const s = String(raw || "");
    const head = s.replace(/^\s+/, "");
    const mode = PREFIX_MODES[head[0]];
    if (mode) return { mode, text: head.slice(1).trim() };
    return { mode: "all", text: s.trim() };
  }

  /** Which groups are visible for a mode (history/files only when relevant). */
  function groupsForMode(mode, text) {
    if (mode === "commands") return ["commands"];
    if (mode === "sessions") return ["tabs", "history"];
    if (mode === "files") return ["files"];
    if (mode === "shortcuts") return [];
    return text ? ["commands", "actions", "tabs", "history"] : ["commands", "actions", "tabs"];
  }

  /** Best weighted fuzzy match across label / hint / keywords. */
  function scoreItem(item, text) {
    const Fuzzy = window.Fuzzy;
    const byLabel = Fuzzy.fuzzyMatch(text, item.label);
    let best = byLabel ? { score: byLabel.score, ranges: byLabel.ranges } : null;
    const consider = (candidate, weight) => {
      if (!candidate) return;
      const score = candidate.score * weight;
      if (!best || score > best.score) best = { score, ranges: [] };
    };
    if (item.hint) consider(Fuzzy.fuzzyMatch(text, item.hint), 0.6);
    if (item.keywords && item.keywords.length) consider(Fuzzy.fuzzyMatch(text, item.keywords.join(" ")), 0.8);
    return best;
  }

  /**
   * @returns {{ mode, text, groups: Array<{group, entries: Array<{item, ranges}>}>, flat: Array<{item, ranges}> }}
   */
  function buildPaletteView(items, rawQuery) {
    const { mode, text } = parsePaletteQuery(rawQuery);
    const visible = groupsForMode(mode, text);
    const groups = [];
    for (const group of GROUP_ORDER) {
      if (!visible.includes(group)) continue;
      const pool = items.filter((it) => it.group === group);
      let entries;
      if (!text) {
        entries = pool.map((item) => ({ item, ranges: [] }));
      } else {
        const scored = [];
        pool.forEach((item, order) => {
          const m = scoreItem(item, text);
          if (m) scored.push({ item, ranges: m.ranges, score: m.score, order });
        });
        scored.sort((a, b) => b.score - a.score || a.order - b.order);
        entries = scored.map(({ item, ranges }) => ({ item, ranges }));
      }
      if (entries.length > 0) groups.push({ group, entries });
    }
    const flat = groups.flatMap((g) => g.entries);
    return { mode, text, groups, flat };
  }

  window.PaletteQuery = { GROUP_ORDER, parsePaletteQuery, groupsForMode, buildPaletteView };
})();
