/* ═════════════════════════════════════════════════════════════════════
   use-review-annotations.jsx — Line annotation state for the review drawer
   Notes are keyed `{ [filePath]: { [lineKey]: note } }` (see
   review-annotation-keys.js) and persisted per session + diff hash.
   ═════════════════════════════════════════════════════════════════════ */

function useReviewAnnotations({ sessionId, diffKey }) {
  const [annotations, setAnnotations] = React.useState({});
  const [editing, setEditing] = React.useState(null); // { filePath, lineKey }
  const annotationsRef = React.useRef({});
  const scopeRef = React.useRef({ sessionId, diffKey });
  scopeRef.current = { sessionId, diffKey };

  // Reload cached notes whenever the diff (or session) changes.
  React.useEffect(() => {
    const loaded =
      diffKey && window.ReviewStore ? window.ReviewStore.loadAnnotations(sessionId, diffKey) : {};
    annotationsRef.current = loaded;
    setAnnotations(loaded);
    setEditing(null);
  }, [sessionId, diffKey]);

  const commit = React.useCallback((next) => {
    annotationsRef.current = next;
    setAnnotations(next);
    const { sessionId: sid, diffKey: key } = scopeRef.current;
    if (key && window.ReviewStore) window.ReviewStore.saveAnnotations(sid, key, next);
  }, []);

  const startAnnotate = React.useCallback((filePath, lineKey) => {
    setEditing({ filePath, lineKey });
  }, []);

  const cancelAnnotate = React.useCallback(() => setEditing(null), []);

  // `isEdit` is the AnnotationRow "Edit" button: reopen the editor, don't re-save.
  const saveAnnotate = React.useCallback(
    (filePath, lineKey, note, isEdit) => {
      if (isEdit) {
        setEditing({ filePath, lineKey });
        return;
      }
      const prev = annotationsRef.current;
      commit({ ...prev, [filePath]: { ...(prev[filePath] || {}), [lineKey]: note } });
      setEditing(null);
    },
    [commit]
  );

  const deleteAnnotate = React.useCallback(
    (filePath, lineKey) => {
      const prev = annotationsRef.current;
      const fileNotes = { ...(prev[filePath] || {}) };
      delete fileNotes[lineKey];
      const next = { ...prev };
      if (Object.keys(fileNotes).length === 0) delete next[filePath];
      else next[filePath] = fileNotes;
      commit(next);
    },
    [commit]
  );

  /** Line currently being edited in `filePath` (null if another file / none). */
  const editingLineKeyFor = (filePath) =>
    editing && editing.filePath === filePath ? editing.lineKey : null;

  return {
    annotations,
    editingLineKeyFor,
    startAnnotate,
    saveAnnotate,
    cancelAnnotate,
    deleteAnnotate,
  };
}

window.useReviewAnnotations = useReviewAnnotations;
