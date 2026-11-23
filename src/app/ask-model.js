/* ═════════════════════════════════════════════════════════════════════
   ask-model.js — pure logic for ask-tool bubbles (no side effects).

   omp's `ask` tool drives the user through `extension_ui_request` frames
   (`select` / `input` / `editor`). The frame shape differs between omp
   versions, so everything here is detected from the frame itself:

     - otherRow:   an "Other (type your own)" row in `options`
     - doneRow:    a "Done selecting" row (multi-select terminator)
     - multi:      `selectionMarker === "checkbox"` or a doneRow is present
     - checked:    `checkedIndices` (index into the RAW options list) when the
                   frame carries it, otherwise tracked locally by the caller

   Bubble state machine (`state`): open → pending → open … → answered,
   or open/pending → cancelled. Multi-select rounds reuse one bubble.
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.AskModel = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const OTHER_RE = /^Other[\s\r]*\(type your own\)(\s\(\d+\))?$/i;
  // omp prints "<glyph> Done selecting" (U+F00C nerd-font check, ✔, or ASCII "[ok]"), plus an
  // optional " (N)" from label disambiguation. Anchored so an option merely containing the words
  // is never taken for the Done row.
  const DONE_RE = /^(?:(?:\[\w+\]|[^\w\s]+)\s*)?Done selecting(?:\s+\(\d+\))?$/i;
  const SELECTED_PREFIX_RE = /^\(\d+ selected\)\s+/;
  const PROGRESS_SUFFIX_RE = /\s\(\d+\/\d+\)$/;

  const isOtherRow = (label) => OTHER_RE.test(String(label));
  const isDoneRow = (label) => DONE_RE.test(String(label)) && !isOtherRow(label);

  /** First "Other (type your own)" row of `options`, or null. */
  function findOtherRow(options) {
    const row = (Array.isArray(options) ? options : []).find(isOtherRow);
    return row === undefined ? null : String(row);
  }

  /**
   * Title with the volatile decorations removed, so successive rounds of the
   * same question compare equal. 18.x prefixes "(N selected) " to the title;
   * 19.x puts it after the last "\n\n" (form context first); 18.x may append
   * a "(i/n)" progress suffix.
   */
  function normalizeTitle(title) {
    let t = String(title ?? "").replace(SELECTED_PREFIX_RE, "");
    const cut = t.lastIndexOf("\n\n");
    if (cut >= 0) t = t.slice(0, cut + 2) + t.slice(cut + 2).replace(SELECTED_PREFIX_RE, "");
    return t.replace(PROGRESS_SUFFIX_RE, "").trim();
  }

  /** True when the title carries omp's "(N selected) " decoration — only multi-selects get it. */
  function hasSelectedPrefix(title) {
    const t = String(title ?? "");
    const cut = t.lastIndexOf("\n\n");
    return SELECTED_PREFIX_RE.test(t) || (cut >= 0 && SELECTED_PREFIX_RE.test(t.slice(cut + 2)));
  }

  /** Lifecycle state of a bubble; tolerates bubbles without `state`. */
  function bubbleState(m) {
    if (m.state) return m.state;
    if (m.cancelled) return "cancelled";
    return m.answered ? "answered" : "open";
  }

  /**
   * Decode a `select` frame. Works on the RAW option list first (indices in
   * `checkedIndices` refer to it), and only then drops the otherRow/doneRow
   * rows from the list that gets displayed.
   */
  function parseSelect(ev) {
    const raw = (Array.isArray(ev.options) ? ev.options : []).map(String);
    const hasMarkable = Number.isInteger(ev.markableCount);
    const markable = hasMarkable ? ev.markableCount : raw.length;
    // 19.x rows: [opts, other?] are markable, the Done row (if any) follows them. 18.x has no
    // markableCount: [opts, done?, other] — the LAST match wins. A radio list never has a Done row.
    const otherIdx = raw.findLastIndex((l, i) => (!hasMarkable || i < markable) && isOtherRow(l));
    const doneIdx = ev.selectionMarker === "radio"
      ? -1
      : raw.findLastIndex((l, i) => (!hasMarkable || i >= markable) && isDoneRow(l));
    let checked = null;
    let otherChecked = false;
    if (Array.isArray(ev.checkedIndices)) {
      checked = [];
      for (const i of ev.checkedIndices) {
        if (!Number.isInteger(i) || i < 0 || i >= raw.length || i >= markable || i === doneIdx) continue;
        if (i === otherIdx) otherChecked = true;
        else checked.push(raw[i]);
      }
    }
    return {
      options: raw.filter((_, i) => i !== otherIdx && i !== doneIdx),
      otherRow: otherIdx >= 0 ? raw[otherIdx] : null,
      doneRow: doneIdx >= 0 ? raw[doneIdx] : null,
      // 18.x multi-question asks have no Done row; the "(N selected)" title decoration still gives it away.
      multi: ev.selectionMarker !== "radio"
        && (ev.selectionMarker === "checkbox" || doneIdx >= 0 || hasSelectedPrefix(ev.title)),
      checked: checked ?? [],
      checkedAuthoritative: checked !== null,
      otherChecked,
    };
  }

  const base = (ev, time, mode) => ({
    kind: "ask", mode, id: ev.id, time,
    title: ev.title ?? "", titleKey: normalizeTitle(ev.title),
    options: [], otherRow: null, doneRow: null, multi: false,
    checked: [], checkedAuthoritative: false, otherChecked: false, otherText: null,
    prefill: "", placeholder: "", promptStyle: false, secret: false,
    state: "open", answered: false, cancelled: false, answer: null,
    orphan: true, closed: false, round: 0,
  });

  function buildFromSelect(ev, time) {
    return { ...base(ev, time, "select"), ...parseSelect(ev) };
  }

  function buildFromInput(ev, time) {
    return {
      ...base(ev, time, "input"),
      placeholder: ev.placeholder ?? "", secret: ev.secret === true,
    };
  }

  function buildFromEditor(ev, time) {
    return {
      ...base(ev, time, "editor"),
      prefill: ev.prefill ?? "", promptStyle: ev.promptStyle === true,
    };
  }

  /** True when a running `ask` tool card exists in `messages`. */
  function hasRunningAskCard(messages) {
    return messages.some(m => m.kind === "tool" && m.tool === "ask" && m.status === "running");
  }

  /**
   * Add a freshly built bubble. A `select` whose normalized title matches the
   * trailing, still-live, already-answered select bubble is the next round of
   * the same question (multi-select loop, blank "Other" retry): reopen that
   * bubble in place instead of appending. input/editor never merge, so a
   * validation re-ask shows up as a new bubble carrying its error text.
   */
  function addBubble(messages, bubble) {
    if (bubble.mode === "select") {
      const at = messages.findLastIndex(m => m.kind === "ask");
      const prev = at >= 0 ? messages[at] : null;
      if (prev && prev.mode === "select" && !prev.closed && prev.titleKey === bubble.titleKey
          && ["answered", "pending"].includes(bubbleState(prev))) {
        const merged = mergeRound(prev, bubble);
        return { messages: messages.map((m, i) => (i === at ? merged : m)), merged: true };
      }
    }
    return { messages: [...messages, bubble], merged: false };
  }

  /** Reopen `prev` with the next round's frame `next`. */
  function mergeRound(prev, next) {
    let checked = next.checkedAuthoritative ? next.checked : prev.checked;
    if (!next.checkedAuthoritative && next.multi && !prev.multi
        && prev.answer && next.options.includes(prev.answer) && !prev.otherText
        && !checked.includes(prev.answer)) {
      // 18.x round 1 looked like a single-select, so the first click was never
      // recorded as a toggle; the server did record it. Only a real option click
      // qualifies — custom text (even one spelled like an option) is not a toggle.
      checked = [...checked, prev.answer];
    }
    return {
      ...prev,
      id: next.id, title: next.title, titleKey: next.titleKey,
      options: next.options, otherRow: next.otherRow, doneRow: next.doneRow,
      multi: next.multi || prev.multi, checked,
      checkedAuthoritative: next.checkedAuthoritative,
      otherChecked: next.otherChecked,
      otherText: next.otherChecked ? prev.otherText : null,
      state: "open", answered: false, cancelled: false, answer: null,
      round: (prev.round ?? 0) + 1,
    };
  }

  /**
   * omp emits an ask's select/input before `tool_execution_start`. Once the
   * ask tool card is at `cardIdx`, move it in front of the trailing orphan
   * bubbles so the chat order is always [tool_card, ask_bubble].
   */
  function hoistToolCard(messages, cardIdx) {
    const card = messages[cardIdx];
    if (!card || card.kind !== "tool" || card.tool !== "ask") return { messages, changed: false };
    let start = cardIdx;
    while (start > 0 && messages[start - 1].kind === "ask" && messages[start - 1].orphan) start--;
    if (start === cardIdx) return { messages, changed: false };
    const claimed = messages.slice(start, cardIdx).map(m => ({ ...m, orphan: false }));
    return {
      messages: [...messages.slice(0, start), card, ...claimed, ...messages.slice(cardIdx + 1)],
      changed: true,
    };
  }

  /** Apply `patch` to the live bubble `id` if it is still `open`. */
  function patchOpen(messages, id, patch) {
    let hit = false;
    const next = messages.map(m => {
      if (m.kind !== "ask" || m.id !== id || bubbleState(m) !== "open") return m;
      hit = true;
      return { ...m, ...patch };
    });
    return hit ? next : messages;
  }

  /** The `open` bubble answering request `id`, or null. */
  function findOpen(messages, id) {
    return messages.find(m => m.kind === "ask" && m.id === id && bubbleState(m) === "open") ?? null;
  }

  /** Mark a still-live bubble cancelled (server `cancel` frame for `targetId`). */
  function cancelById(messages, targetId) {
    let hit = false;
    const next = messages.map(m => {
      if (m.kind !== "ask" || m.id !== targetId || !["open", "pending"].includes(bubbleState(m))) return m;
      hit = true;
      return { ...m, state: "cancelled", cancelled: true };
    });
    return hit ? next : messages;
  }

  /**
   * The ask ended (tool end, abort, process exit). A bubble the user never
   * touched becomes cancelled; one with a click in flight counts as answered —
   * unless the ask was aborted (abort / process exit / tool error), when the
   * click never produced a result and it is cancelled too.
   * All live bubbles are closed so a later ask never merges into them.
   */
  function finalize(messages, { aborted = false } = {}) {
    let changed = false;
    const next = messages.map(m => {
      if (m.kind !== "ask" || m.closed) return m;
      changed = true;
      const st = bubbleState(m);
      if (st === "open" || (st === "pending" && aborted)) {
        return { ...m, closed: true, state: "cancelled", cancelled: true };
      }
      if (st === "pending") return { ...m, closed: true, state: "answered", answered: true };
      return { ...m, closed: true };
    });
    return changed ? next : messages;
  }

  /** "line" for single-line inputs, "area" for a multi-line editor. */
  function textInputKind(bubble) {
    return bubble.mode === "editor" && !bubble.promptStyle ? "area" : "line";
  }

  return {
    findOtherRow, normalizeTitle, bubbleState, parseSelect,
    buildFromSelect, buildFromInput, buildFromEditor,
    hasRunningAskCard, addBubble, mergeRound, hoistToolCard,
    patchOpen, findOpen, cancelById, finalize, textInputKind,
  };
});
