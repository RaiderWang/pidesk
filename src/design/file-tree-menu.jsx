/* ═════════════════════════════════════════════════════════════════════
   file-tree-menu.jsx — right-click menu for FileTreePanel.
   Pure presentation: every action is a callback supplied by the panel.
   FILE_TREE_MENU_SIZE is the estimated box used to keep the menu inside
   the viewport — bump `height` when adding items.
   ═════════════════════════════════════════════════════════════════════ */

const { Icon } = window;

const FILE_TREE_MENU_SIZE = { width: 210, height: 275 };

function FileTreeMenuItem({ icon, color, labelKey, fallback, onClick, danger }) {
  return (
    <button className={`files-context-item${danger ? " danger" : ""}`} onClick={onClick}>
      <Icon name={icon} size={11} color={color} />
      <span className="files-context-label">
        {window.t ? window.t(labelKey, null, fallback) : fallback}
      </span>
    </button>
  );
}

function FileTreeContextMenu({
  menu, hasEditor,
  onReference, onRename, onCopyPath, onCopyRelativePath,
  onOpenDefault, onOpenEditor, onReveal, onDelete,
}) {
  const item = menu.item;
  return (
    <div
      className="files-context-menu"
      style={{ top: menu.y, left: menu.x }}
      onClick={(e) => e.stopPropagation()}
    >
      {!item.is_dir && (
        <>
          <FileTreeMenuItem icon="at" color="var(--accent)" labelKey="files.menu.reference"
            fallback="Reference File" onClick={() => onReference(item)} />
          <div className="files-context-sep" />
        </>
      )}

      <FileTreeMenuItem icon="edit" color="var(--accent)" labelKey="files.menu.rename"
        fallback="Rename" onClick={() => onRename(item)} />
      <FileTreeMenuItem icon="copy" color="var(--cyan)" labelKey="files.menu.copyPath"
        fallback="Copy Path" onClick={() => onCopyPath(item)} />
      <FileTreeMenuItem icon="link" color="var(--lilac)" labelKey="files.menu.copyRelativePath"
        fallback="Copy Relative Path" onClick={() => onCopyRelativePath(item)} />

      <div className="files-context-sep" />

      {!item.is_dir && (
        <FileTreeMenuItem icon="external" color="var(--fg-3)" labelKey="files.menu.openDefault"
          fallback="Open with Default Application" onClick={() => onOpenDefault(item)} />
      )}
      {!item.is_dir && hasEditor && (
        <FileTreeMenuItem icon="edit" color="var(--fg-3)" labelKey="files.menu.openEditor"
          fallback="Open with External Editor" onClick={() => onOpenEditor(item)} />
      )}
      <FileTreeMenuItem icon="folder" color="var(--fg-3)" labelKey="files.menu.reveal"
        fallback="Reveal in File Explorer" onClick={() => onReveal(item)} />

      <div className="files-context-sep" />

      <FileTreeMenuItem icon="trash" color="var(--rose, #ff5f57)" labelKey="files.menu.delete"
        fallback="Delete" danger onClick={() => onDelete(item)} />
    </div>
  );
}

Object.assign(window, { FileTreeContextMenu, FILE_TREE_MENU_SIZE });
