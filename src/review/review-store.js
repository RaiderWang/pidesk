/* ═════════════════════════════════════════════════════════════════════
   review-store.js — Review Annotations Local Storage & Session State
   Maintains user line/file annotations across drawer toggles,
   scoped by sessionId and diff hash. Entries are tracked in a small
   LRU index so localStorage cannot grow without bound.
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ReviewStore = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORAGE_PREFIX = "pidesk_review_notes_";
  const INDEX_KEY = "pidesk_review_notes_index";
  const MAX_ENTRIES = 40;

  function storage() {
    return typeof localStorage !== "undefined" ? localStorage : null;
  }

  /** FNV-1a over the whole diff (+ length) — cheap, stable, no 5000-char blind spot. */
  function computeDiffHash(rawDiff) {
    if (!rawDiff) return "empty";
    let hash = 0x811c9dc5;
    for (let i = 0; i < rawDiff.length; i++) {
      hash ^= rawDiff.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return `${rawDiff.length.toString(36)}-${(hash >>> 0).toString(36)}`;
  }

  function getStorageKey(sessionId, diffHash) {
    const sId = sessionId || "default";
    const dHash = diffHash || "live";
    return `${STORAGE_PREFIX}${sId}_${dHash}`;
  }

  function readIndex(ls) {
    try {
      const parsed = JSON.parse(ls.getItem(INDEX_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.filter((k) => typeof k === "string") : [];
    } catch {
      return [];
    }
  }

  /** Mark `key` most-recently-used and evict the oldest entries beyond the cap. */
  function touchIndex(ls, key) {
    const index = readIndex(ls).filter((k) => k !== key);
    index.push(key);
    while (index.length > MAX_ENTRIES) {
      ls.removeItem(index.shift());
    }
    ls.setItem(INDEX_KEY, JSON.stringify(index));
  }

  function dropFromIndex(ls, key) {
    const index = readIndex(ls);
    if (!index.includes(key)) return;
    ls.setItem(INDEX_KEY, JSON.stringify(index.filter((k) => k !== key)));
  }

  function loadAnnotations(sessionId, diffHash) {
    const ls = storage();
    if (!ls) return {};
    try {
      const raw = ls.getItem(getStorageKey(sessionId, diffHash));
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
      console.warn("[ReviewStore] Failed to load annotations:", e);
      return {};
    }
  }

  function saveAnnotations(sessionId, diffHash, annotations) {
    const ls = storage();
    if (!ls) return;
    try {
      const key = getStorageKey(sessionId, diffHash);
      if (!annotations || Object.keys(annotations).length === 0) {
        ls.removeItem(key);
        dropFromIndex(ls, key);
      } else {
        ls.setItem(key, JSON.stringify(annotations));
        touchIndex(ls, key);
      }
    } catch (e) {
      console.warn("[ReviewStore] Failed to save annotations:", e);
    }
  }

  function clearAnnotations(sessionId, diffHash) {
    const ls = storage();
    if (!ls) return;
    try {
      const key = getStorageKey(sessionId, diffHash);
      ls.removeItem(key);
      dropFromIndex(ls, key);
    } catch {
      // ignore
    }
  }

  return {
    computeDiffHash,
    loadAnnotations,
    saveAnnotations,
    clearAnnotations,
    MAX_ENTRIES,
  };
});
