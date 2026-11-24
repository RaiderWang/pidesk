/* ═════════════════════════════════════════════════════════════════════
   file-tree-toast.jsx — transient toast for FileTreePanel.
   `showToast(msg, type)`; type "success" (default) shows a check, "error"
   shows a warning icon with error styling and stays a little longer.
   No top-level destructures (Babel scripts share the document scope).
   ═════════════════════════════════════════════════════════════════════ */

const FILE_TREE_TOAST_MS = { success: 2400, error: 4000 };

function useFileTreeToast() {
  const [toast, setToast] = React.useState(null);
  const timerRef = React.useRef(null);

  const showToast = React.useCallback((message, type = "success") => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ message, type });
    timerRef.current = setTimeout(() => {
      setToast(null);
    }, FILE_TREE_TOAST_MS[type] ?? FILE_TREE_TOAST_MS.success);
  }, []);

  // Don't fire setState on an unmounted panel.
  React.useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { toast, showToast };
}

function FileTreeToast({ toast }) {
  if (!toast) return null;
  const isError = toast.type === "error";
  return (
    <div
      className={`files-toast${isError ? " files-toast--error" : ""}`}
      role={isError ? "alert" : "status"}
    >
      {isError
        ? <window.Icon name="warn" size={11} color="var(--rose)" dotColor="var(--rose)" />
        : <window.Icon name="check" size={11} color="var(--accent)" />}
      <span>{toast.message}</span>
    </div>
  );
}

Object.assign(window, { useFileTreeToast, FileTreeToast });
