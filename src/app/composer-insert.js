/* ═════════════════════════════════════════════════════════════════════
   composer-insert.js — Programmatically append text to the composer
   The composer <textarea> is React-controlled. Assigning `el.value`
   directly updates React's internal value tracker, so the following
   `input` event looks like "no change" and `onChange` never fires. We
   therefore call the prototype's native value setter first.
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ComposerInsert = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const COMPOSER_SELECTOR = ".composer-input textarea";

  /** Set `value` through the prototype setter so React's tracker sees the change. */
  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const desc = proto ? Object.getOwnPropertyDescriptor(proto, "value") : null;
    if (desc && typeof desc.set === "function") desc.set.call(el, value);
    else el.value = value;
  }

  function joinText(current, text) {
    return current ? `${current}\n\n${text}` : text;
  }

  /** Append `text` to a textarea element and notify React. Returns true on success. */
  function appendToElement(el, text) {
    if (!el || !text) return false;
    setNativeValue(el, joinText(el.value, text));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    if (typeof el.focus === "function") el.focus();
    return true;
  }

  /** Append `text` to the main composer. Returns false when it is not mounted. */
  function appendToComposer(text) {
    if (typeof document === "undefined") return false;
    return appendToElement(document.querySelector(COMPOSER_SELECTOR), text);
  }

  return { setNativeValue, joinText, appendToElement, appendToComposer };
});
