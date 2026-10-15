/* app/fuzzy.js — small subsequence fuzzy matcher for the command palette.

   fuzzyMatch(query, text) -> null | { score, ranges }
     - case-insensitive subsequence match (whitespace in the query ignored)
     - best alignment found by DP: word-start / camelCase hits and
       consecutive runs score higher, gaps and late starts score lower
     - ranges are [start, end) pairs of matched characters, for highlighting
   fuzzyRank(items, query, getText) -> [{ item, score, ranges }]
     - empty query keeps the original order (score 0)
     - ties keep the original order
   highlightSegments(text, ranges) -> [{ text, hit }] */
(function () {
  const MAX_TEXT = 200;
  const GAP = 0.3;
  const CONSECUTIVE = 4;
  const LEADING = 0.05;

  function boundaryBonus(s, j) {
    if (j === 0) return 8;
    const prev = s[j - 1];
    if (!/[A-Za-z0-9]/.test(prev)) return 6;
    if (prev === prev.toLowerCase() && prev !== prev.toUpperCase() && s[j] === s[j].toUpperCase() && s[j] !== s[j].toLowerCase()) return 5;
    return 0;
  }

  function fuzzyMatch(query, text) {
    const q = String(query || "").toLowerCase().replace(/\s+/g, "");
    if (!q) return { score: 0, ranges: [] };
    const s = String(text || "").slice(0, MAX_TEXT);
    const t = s.toLowerCase();
    const n = q.length;
    const m = t.length;
    if (n > m) return null;

    const NEG = -Infinity;
    let prevBest = null;
    const froms = [];
    for (let i = 0; i < n; i++) {
      const best = new Array(m).fill(NEG);
      const from = new Array(m).fill(-1);
      let gVal = NEG;
      let gArg = -1;
      for (let j = 0; j < m; j++) {
        if (i > 0) {
          gVal -= GAP;
          if (j >= 2 && prevBest[j - 2] > NEG && prevBest[j - 2] - GAP > gVal) {
            gVal = prevBest[j - 2] - GAP;
            gArg = j - 2;
          }
        }
        if (t[j] !== q[i]) continue;
        const own = 1 + boundaryBonus(s, j);
        if (i === 0) {
          best[j] = own - j * LEADING;
        } else {
          let cand = NEG;
          let arg = -1;
          if (j >= 1 && prevBest[j - 1] > NEG) {
            cand = prevBest[j - 1] + CONSECUTIVE;
            arg = j - 1;
          }
          if (gVal > cand) {
            cand = gVal;
            arg = gArg;
          }
          if (cand === NEG) continue;
          best[j] = cand + own;
          from[j] = arg;
        }
      }
      froms.push(from);
      prevBest = best;
    }

    let end = -1;
    let score = NEG;
    for (let j = 0; j < m; j++) {
      if (prevBest[j] > score) {
        score = prevBest[j];
        end = j;
      }
    }
    if (end === -1) return null;

    const positions = [];
    let j = end;
    for (let i = n - 1; i >= 0; i--) {
      positions.unshift(j);
      j = froms[i][j];
    }
    const ranges = [];
    for (const p of positions) {
      const last = ranges[ranges.length - 1];
      if (last && last[1] === p) last[1] = p + 1;
      else ranges.push([p, p + 1]);
    }
    return { score, ranges };
  }

  function fuzzyRank(items, query, getText) {
    const read = getText || ((x) => String(x));
    if (!String(query || "").trim()) {
      return items.map((item) => ({ item, score: 0, ranges: [] }));
    }
    const out = [];
    items.forEach((item, order) => {
      const m = fuzzyMatch(query, read(item));
      if (m) out.push({ item, score: m.score, ranges: m.ranges, order });
    });
    out.sort((a, b) => b.score - a.score || a.order - b.order);
    return out.map(({ item, score, ranges }) => ({ item, score, ranges }));
  }

  function highlightSegments(text, ranges) {
    const str = String(text || "");
    if (!ranges || ranges.length === 0) return [{ text: str, hit: false }];
    const segs = [];
    let pos = 0;
    for (const [a, b] of ranges) {
      if (a > pos) segs.push({ text: str.slice(pos, a), hit: false });
      segs.push({ text: str.slice(a, b), hit: true });
      pos = b;
    }
    if (pos < str.length) segs.push({ text: str.slice(pos), hit: false });
    return segs;
  }

  window.Fuzzy = { fuzzyMatch, fuzzyRank, highlightSegments };
})();
