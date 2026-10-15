/* app/modal-stack.js — tracks which modal is on top so that Escape (and
   Tab trapping) only ever affects the topmost one. Pure logic, no DOM.

   Usage: `const stack = ModalStack.shared; stack.push(id); … stack.remove(id)`.
   Re-pushing an id that is already open moves it to the top. */
(function () {
  // Base layer sits above the app chrome; nested layer sits above other modals.
  const Z = { base: 100, nested: 110 };

  function create() {
    let ids = [];
    return {
      push(id) {
        ids = ids.filter((x) => x !== id);
        ids.push(id);
      },
      remove(id) {
        ids = ids.filter((x) => x !== id);
      },
      top() {
        return ids.length > 0 ? ids[ids.length - 1] : null;
      },
      isTop(id) {
        return ids.length > 0 && ids[ids.length - 1] === id;
      },
      size() {
        return ids.length;
      },
    };
  }

  function zIndexFor(layer) {
    return Z[layer] ?? Z.base;
  }

  window.ModalStack = { create, shared: create(), Z, zIndexFor };
})();
