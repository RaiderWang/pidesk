/* ═════════════════════════════════════════════════════════════════════
   composer-restore.jsx — put an undone message back into the composer.

   The bridge/app dispatches `composer-restore` with { text, images }.
   The composer owns its text/image state, so it subscribes here. An
   existing draft is never discarded: restored text is appended
   (blank-line separated) and images are added to the attachments.
   ═════════════════════════════════════════════════════════════════════ */

function useComposerRestore({ setText, setImages, taRef }) {
  React.useEffect(() => {
    const onRestore = (e) => {
      const detail = e?.detail || {};
      const text = typeof detail.text === "string" ? detail.text : "";
      const images = window.UndoMessage ? window.UndoMessage.toComposerImages(detail.images) : [];
      if (!text && images.length === 0) return;

      if (text) {
        const join = window.ComposerInsert?.joinText ?? ((cur, add) => (cur ? `${cur}\n\n${add}` : add));
        setText(prev => join(prev, text));
      }
      if (images.length > 0) setImages(prev => [...prev, ...images]);

      // Wait for React to commit the new value, then focus with the caret at the end.
      requestAnimationFrame(() => {
        const ta = taRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      });
    };
    window.addEventListener("composer-restore", onRestore);
    return () => window.removeEventListener("composer-restore", onRestore);
  }, [setText, setImages, taRef]);
}

Object.assign(window, { useComposerRestore });
