/* app/use-undo-message.jsx — UI state for "undo a sent message".
   Owns the confirm dialog and hands the undone text/images back to the
   composer (via the `composer-restore` event) once omp has rolled back. */

function useUndoMessage({ bridge, messages, streaming, hasPendingAsyncWork = false, onUndone }) {
  const [pending, setPending] = React.useState(null); // { id, counts }
  const [busy, setBusy] = React.useState(false);

  const messagesRef = React.useRef(messages);
  messagesRef.current = messages;

  // `hasPendingAsyncWork` is a prop only so a change re-renders and re-reads
  // `bridge.undoBlocked` (the single source of truth, shared with undoMessage).
  const compacting = messages.some(m => m.kind === "compact" && m.status === "pending");
  let blockReason = null; // null | "running" | "async"
  if (!bridge?.isConnected || busy || streaming || compacting) blockReason = "running";
  else blockReason = bridge.undoBlocked ?? (hasPendingAsyncWork ? "async" : null);
  const canUndo = blockReason === null;

  // Stable identity: UserBubble is memoised.
  const requestUndo = React.useCallback((idx) => {
    const msg = messagesRef.current[idx];
    if (!msg || msg.kind !== "user" || msg._id == null) return;
    setPending({ id: msg._id, counts: window.UndoMessage.countAffected(messagesRef.current, idx) });
  }, []);

  const cancel = React.useCallback(() => setPending(null), []);

  const confirm = React.useCallback(async () => {
    if (!pending || !bridge) return;
    // The list may have shifted (trim / new messages) while the dialog was open — re-find by id.
    const idx = messagesRef.current.findIndex(m => m._id === pending.id);
    setPending(null);
    if (idx < 0) return;
    setBusy(true);
    try {
      const r = await bridge.undoMessage(idx);
      if (r?.ok) {
        window.dispatchEvent(new CustomEvent("composer-restore", {
          detail: { text: r.text, images: r.images },
        }));
        onUndone?.(r);
      }
    } finally {
      setBusy(false);
    }
  }, [pending, bridge, onUndone]);

  return { canUndo, blockReason, requestUndo, undoDialog: { open: pending !== null, counts: pending?.counts ?? null, onConfirm: confirm, onCancel: cancel } };
}

Object.assign(window, { useUndoMessage });
