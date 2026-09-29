/* ═════════════════════════════════════════════════════════════════════
   file-tree-panel.jsx — Project Files & Folder Panel with Context Menu
   ═════════════════════════════════════════════════════════════════════ */

const { Icon } = window;

function getRelativePath(root, full) {
  if (!root || !full) return full || "";
  const normRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const normFull = full.replace(/\\/g, "/");
  if (normFull.startsWith(normRoot)) {
    let rel = normFull.slice(normRoot.length);
    return rel.replace(/^\/+/, "");
  }
  return full;
}

function getFileIconColor(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  switch (ext) {
    case "rs":
      return "var(--amber, #f59e0b)";
    case "js":
    case "jsx":
    case "ts":
    case "tsx":
      return "var(--cyan, #06b6d4)";
    case "json":
    case "yml":
    case "yaml":
    case "toml":
      return "var(--lilac, #a855f7)";
    case "css":
    case "scss":
    case "html":
      return "var(--rose, #f43f5e)";
    case "md":
    case "txt":
      return "var(--fg-3)";
    case "png":
    case "jpg":
    case "jpeg":
    case "svg":
    case "webp":
    case "ico":
      return "var(--accent, #10b981)";
    default:
      return "var(--fg-4)";
  }
}

function FileTreeNode({
  item,
  depth,
  expandedPaths,
  childrenMap,
  loadingPaths,
  selectedPath,
  renamingPath,
  renameValue,
  contextMenuItem,
  onSelect,
  onDoubleClick,
  onToggleExpand,
  onContextMenu,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
}) {
  const isExpanded = expandedPaths.has(item.path);
  const isSelected = selectedPath === item.path;
  const isRenaming = renamingPath === item.path;
  const isContextActive = contextMenuItem?.path === item.path;
  const isLoading = loadingPaths.has(item.path);
  const children = childrenMap.get(item.path) || [];

  const handleItemClick = (e) => {
    e.stopPropagation();
    onSelect(item);
    if (item.is_dir) {
      onToggleExpand(item);
    }
  };

  const handleItemDoubleClick = (e) => {
    e.stopPropagation();
    onDoubleClick?.(item);
  };

  const handleExpandArrowClick = (e) => {
    e.stopPropagation();
    if (item.is_dir) {
      onToggleExpand(item);
    }
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(e, item);
  };

  const itemClass = `files-tree-item ${isSelected ? "selected" : ""} ${
    isContextActive ? "context-active" : ""
  }`.trim();

  return (
    <div className="files-tree-node">
      <div
        className={itemClass}
        style={{ paddingLeft: depth * 14 + 6 }}
        onClick={handleItemClick}
        onDoubleClick={handleItemDoubleClick}
        onContextMenu={handleContextMenu}
        title={item.name}
      >
        <span
          className="files-tree-expand"
          onClick={handleExpandArrowClick}
        >
          {item.is_dir ? (
            <Icon
              name={isExpanded ? "chev" : "chevR"}
              size={9}
              color={isLoading ? "var(--accent)" : "var(--fg-4)"}
            />
          ) : (
            <span style={{ width: 9 }} />
          )}
        </span>

        <span className="files-tree-icon">
          {item.is_dir ? (
            <Icon
              name="folder"
              size={12}
              color={isExpanded ? "var(--accent)" : "var(--fg-3)"}
            />
          ) : (
            <Icon
              name="file"
              size={12}
              color={getFileIconColor(item.name)}
            />
          )}
        </span>

        {isRenaming ? (
          <input
            className="files-tree-rename-input"
            value={renameValue}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onRenameSubmit();
              else if (e.key === "Escape") onRenameCancel();
            }}
            onBlur={onRenameSubmit}
          />
        ) : (
          <span className="files-tree-name">{item.name}</span>
        )}
      </div>

      {item.is_dir && isExpanded && (
        <div className="files-tree-children">
          {children.length === 0 && !isLoading ? (
            <div
              className="files-empty"
              style={{ paddingLeft: (depth + 1) * 14 + 18, textAlign: "left", padding: "4px 8px" }}
            >
              {window.t ? window.t("files.panel.empty", null, "Empty directory") : "Empty directory"}
            </div>
          ) : (
            children.map((child) => (
              <FileTreeNode
                key={child.path}
                item={child}
                depth={depth + 1}
                expandedPaths={expandedPaths}
                childrenMap={childrenMap}
                loadingPaths={loadingPaths}
                selectedPath={selectedPath}
                renamingPath={renamingPath}
                renameValue={renameValue}
                contextMenuItem={contextMenuItem}
                onSelect={onSelect}
                onDoubleClick={onDoubleClick}
                onToggleExpand={onToggleExpand}
                onContextMenu={onContextMenu}
                onRenameChange={onRenameChange}
                onRenameSubmit={onRenameSubmit}
                onRenameCancel={onRenameCancel}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function FileTreePanel({ rootPath, projectName, onClose, bridge, width, onWidthChange }) {
  const [rootEntries, setRootEntries] = React.useState([]);
  const [expandedPaths, setExpandedPaths] = React.useState(new Set());
  const [childrenMap, setChildrenMap] = React.useState(new Map());
  const [loadingPaths, setLoadingPaths] = React.useState(new Set());
  const [selectedItem, setSelectedItem] = React.useState(null);
  const selectedPath = selectedItem?.path ?? null;
  const panelRef = React.useRef(null);

  // Context menu state
  const [contextMenu, setContextMenu] = React.useState(null);

  // Rename state
  const [renamingPath, setRenamingPath] = React.useState(null);
  const [renameValue, setRenameValue] = React.useState("");

  // Delete modal state
  const [deleteTarget, setDeleteTarget] = React.useState(null);

  // Toast notification state
  const [toastMessage, setToastMessage] = React.useState(null);
  const toastTimeoutRef = React.useRef(null);

  // Auto-refresh and watching state
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const isRefreshingRef = React.useRef(false);
  const pendingRefreshRef = React.useRef(false);
  const expandedPathsRef = React.useRef(expandedPaths);
  expandedPathsRef.current = expandedPaths;
  const renamingRef = React.useRef(renamingPath);
  renamingRef.current = renamingPath;

  const showToast = React.useCallback((msg) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(msg);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2400);
  }, []);

  // Fetch directory contents
  const loadDirectory = React.useCallback(
    async (path) => {
      if (!bridge?.listDirectory) return [];
      try {
        return await bridge.listDirectory(path);
      } catch (err) {
        console.error("Failed to list directory:", path, err);
        showToast(window.t ? window.t("files.error.load", null, "Failed to load directory") : "Failed to load directory");
        return [];
      }
    },
    [bridge, showToast]
  );

  // Initial load or when rootPath changes
  const refreshRoot = React.useCallback(async () => {
    if (!rootPath) {
      setRootEntries([]);
      return;
    }
    const entries = await loadDirectory(rootPath);
    setRootEntries(entries);
  }, [rootPath, loadDirectory]);

  React.useEffect(() => {
    refreshRoot();
  }, [refreshRoot]);

  // Refresh an entire subfolder
  const refreshFolder = React.useCallback(
    async (folderPath) => {
      if (!folderPath) return;
      if (folderPath === rootPath) {
        await refreshRoot();
        return;
      }
      const children = await loadDirectory(folderPath);
      setChildrenMap((prev) => {
        const next = new Map(prev);
        next.set(folderPath, children);
        return next;
      });
    },
    [rootPath, refreshRoot, loadDirectory]
  );

  // Toggle expand / collapse folder
  const handleToggleExpand = React.useCallback(
    async (item) => {
      const path = item.path;
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
          return next;
        } else {
          next.add(path);
          return next;
        }
      });

      // If expanding and not yet loaded
      if (!expandedPaths.has(path) && !childrenMap.has(path)) {
        setLoadingPaths((prev) => new Set(prev).add(path));
        const children = await loadDirectory(path);
        setChildrenMap((prev) => new Map(prev).set(path, children));
        setLoadingPaths((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      }
    },
    [expandedPaths, childrenMap, loadDirectory]
  );

  // Full Refresh (manual or automated)
  const handleRefreshAll = React.useCallback(
    async (silent = false) => {
      if (isRefreshingRef.current) {
        pendingRefreshRef.current = true;
        return;
      }

      isRefreshingRef.current = true;
      setIsRefreshing(true);

      try {
        do {
          pendingRefreshRef.current = false;

          // If currently editing/renaming inline, skip to avoid clobbering input focus
          if (renamingRef.current) {
            break;
          }

          if (rootPath) {
            try {
              const rootItems = await (bridge?.listDirectory ? bridge.listDirectory(rootPath) : []);
              setRootEntries(rootItems);
            } catch (err) {
              console.error("Refresh root directory failed:", err);
              if (!silent) {
                showToast(
                  window.t
                    ? window.t("files.error.load", null, "Failed to load directory")
                    : "Failed to load directory"
                );
              }
            }
          }

          const currentExpanded = Array.from(expandedPathsRef.current);
          if (currentExpanded.length > 0 && bridge?.listDirectory) {
            const updates = [];
            for (const p of currentExpanded) {
              try {
                const children = await bridge.listDirectory(p);
                updates.push([p, children]);
              } catch (err) {
                console.error("Refresh subfolder failed:", p, err);
              }
            }
            if (updates.length > 0) {
              setChildrenMap((prev) => {
                const next = new Map(prev);
                for (const [p, ch] of updates) {
                  next.set(p, ch);
                }
                return next;
              });
            }
          }
        } while (pendingRefreshRef.current);
      } finally {
        isRefreshingRef.current = false;
        setIsRefreshing(false);
      }
    },
    [rootPath, bridge, showToast]
  );

  // Auto-watch filesystem changes for rootPath
  React.useEffect(() => {
    if (!rootPath) return;

    const watchId = rootPath;
    let unlisten = null;
    let active = true;

    // Start watching directory via Tauri backend
    bridge?.startFilesWatch?.(watchId, rootPath);

    if (window.__TAURI__?.event?.listen) {
      window.__TAURI__.event
        .listen("files://changed", (event) => {
          if (!active) return;
          const payload = event.payload;
          const normRoot = rootPath.replace(/\\/g, "/").toLowerCase();
          const eventRoot = (payload?.path || "").replace(/\\/g, "/").toLowerCase();
          const eventId = payload?.watchId;

          // Check if the change corresponds to this rootPath
          if (
            !payload ||
            eventId === watchId ||
            (eventRoot && (eventRoot === normRoot || normRoot.startsWith(eventRoot)))
          ) {
            handleRefreshAll(true);
          }
        })
        .then((fn) => {
          if (active) {
            unlisten = fn;
          } else {
            fn();
          }
        })
        .catch((err) => {
          console.error("Failed to listen for files://changed:", err);
        });
    }

    return () => {
      active = false;
      if (unlisten) unlisten();
      bridge?.stopFilesWatch?.(watchId);
    };
  }, [rootPath, bridge, handleRefreshAll]);

  // Close context menu on outside click or escape
  React.useEffect(() => {
    if (!contextMenu) return;
    const handleClose = () => setContextMenu(null);
    const handleKeyDown = (e) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("click", handleClose);
    window.addEventListener("contextmenu", handleClose);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", handleClose);
      window.removeEventListener("contextmenu", handleClose);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  // Context Menu trigger
  const handleContextMenu = (e, item) => {
    const menuWidth = 210;
    const menuHeight = 240;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 10);
    setSelectedItem(item);
    setContextMenu({ x, y, item });
  };

  // Rename handlers
  const startRename = (item) => {
    setContextMenu(null);
    setRenamingPath(item.path);
    setRenameValue(item.name);
  };

  const handleRenameCancel = () => {
    setRenamingPath(null);
    setRenameValue("");
  };

  const handleRenameSubmit = async () => {
    if (!renamingPath) return;
    const targetPath = renamingPath;
    const newName = renameValue.trim();
    setRenamingPath(null);

    if (!newName) return;

    // Extract parent directory
    const isWindows = targetPath.includes("\\");
    const sep = isWindows ? "\\" : "/";
    const parts = targetPath.split(/[\\/]/);
    const oldName = parts.pop();
    if (newName === oldName) return;

    const parentDir = parts.join(sep);
    const newPath = parentDir ? `${parentDir}${sep}${newName}` : newName;

    try {
      await bridge?.renameFile(targetPath, newPath);
      // Refresh parent folder
      await refreshFolder(parentDir || rootPath);
      if (selectedItem?.path === targetPath) {
        setSelectedItem((prev) => (prev ? { ...prev, path: newPath, name: newName } : null));
      }
    } catch (err) {
      console.error("Rename failed:", err);
      const errMsg = err?.message || String(err);
      showToast(
        window.t
          ? window.t("files.error.rename", { error: errMsg }, `Failed to rename: ${errMsg}`)
          : `Failed to rename: ${errMsg}`
      );
    }
  };

  // Delete handlers
  const confirmDelete = (item) => {
    setContextMenu(null);
    setDeleteTarget(item);
  };

  const handleDeleteExecute = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);

    const isWindows = target.path.includes("\\");
    const sep = isWindows ? "\\" : "/";
    const parts = target.path.split(/[\\/]/);
    parts.pop();
    const parentDir = parts.join(sep);

    try {
      await bridge?.deleteFileOrDir(target.path);
      await refreshFolder(parentDir || rootPath);
      if (selectedItem?.path === target.path) setSelectedItem(null);
    } catch (err) {
      console.error("Delete failed:", err);
      const errMsg = err?.message || String(err);
      showToast(
        window.t
          ? window.t("files.error.delete", { error: errMsg }, `Failed to delete: ${errMsg}`)
          : `Failed to delete: ${errMsg}`
      );
    }
  };

  // Copy Path handlers
  const handleCopyPath = async (item) => {
    setContextMenu(null);
    try {
      await navigator.clipboard.writeText(item.path);
      showToast(
        window.t
          ? window.t("files.toast.copiedPath", null, "Full path copied to clipboard")
          : "Full path copied to clipboard"
      );
    } catch (err) {
      console.error("Copy path error:", err);
    }
  };

  const handleCopyRelativePath = async (item) => {
    setContextMenu(null);
    try {
      const rel = getRelativePath(rootPath, item.path);
      await navigator.clipboard.writeText(rel);
      showToast(
        window.t
          ? window.t("files.toast.copiedRelative", null, "Relative path copied to clipboard")
          : "Relative path copied to clipboard"
      );
    } catch (err) {
      console.error("Copy relative path error:", err);
    }
  };

  // Open with system default application
  const handleOpenDefault = React.useCallback(
    async (item) => {
      setContextMenu(null);
      try {
        await bridge?.openPathDefault(item.path);
      } catch (err) {
        console.error("Open default error:", err);
      }
    },
    [bridge]
  );

  // Reveal in File Explorer / Finder
  const handleRevealInExplorer = async (item) => {
    setContextMenu(null);
    try {
      await bridge?.revealInExplorer(item.path);
    } catch (err) {
      console.error("Reveal in explorer error:", err);
    }
  };

  // Double-click handler: open files with default application, toggle folders
  const handleDoubleClick = React.useCallback(
    (item) => {
      if (!item.is_dir) {
        handleOpenDefault(item);
      } else {
        handleToggleExpand(item);
      }
    },
    [handleOpenDefault, handleToggleExpand]
  );

  // Keyboard shortcut: Del key deletes selected file/folder
  React.useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key !== "Delete" && e.key !== "Del") return;
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable)) {
        return;
      }
      if (renamingPath) return;

      const isPanelFocused =
        panelRef.current &&
        (panelRef.current === document.activeElement || panelRef.current.contains(document.activeElement));

      if (isPanelFocused && selectedItem) {
        e.preventDefault();
        confirmDelete(selectedItem);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedItem, renamingPath]);

  const handlePanelKeyDown = (e) => {
    if (e.key === "Delete" || e.key === "Del") {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      if (renamingPath) return;
      if (selectedItem) {
        e.preventDefault();
        confirmDelete(selectedItem);
      }
    }
  };

  // Delete confirmation modal keyboard shortcuts (Enter to delete, Esc to cancel)
  React.useEffect(() => {
    if (!deleteTarget) return;
    const handleModalKeyDown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleDeleteExecute();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setDeleteTarget(null);
      }
    };
    window.addEventListener("keydown", handleModalKeyDown);
    return () => window.removeEventListener("keydown", handleModalKeyDown);
  }, [deleteTarget, handleDeleteExecute]);

  const displayName = projectName || (rootPath ? rootPath.replace(/\\/g, "/").split("/").pop() : "Files");

  const [isDragging, setIsDragging] = React.useState(false);

  const handleResizerMouseDown = React.useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
    const startX = e.clientX;
    const initialWidth = width || panelRef.current?.getBoundingClientRect().width || 240;

    const onMouseMove = (ev) => {
      const delta = ev.clientX - startX;
      const minW = 160;
      const maxW = Math.max(minW, Math.min(600, Math.floor(window.innerWidth * 0.5)));
      const nextW = Math.round(Math.max(minW, Math.min(maxW, initialWidth + delta)));
      if (onWidthChange) {
        onWidthChange(nextW);
      }
    };

    const onMouseUp = () => {
      setIsDragging(false);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [width, onWidthChange]);

  const handleResetWidth = React.useCallback((e) => {
    e.preventDefault();
    if (onWidthChange) {
      onWidthChange(240);
    }
  }, [onWidthChange]);

  return (
    <aside
      ref={panelRef}
      tabIndex={0}
      className="files-panel"
      onKeyDown={handlePanelKeyDown}
    >
      {/* Resizer Handle */}
      <div
        className={`files-resizer ${isDragging ? "is-dragging" : ""}`}
        onMouseDown={handleResizerMouseDown}
        onDoubleClick={handleResetWidth}
        title={window.t ? window.t("files.panel.resizeHint", null, "Drag to resize · Double-click to reset") : "Drag to resize · Double-click to reset"}
      />
      {/* Panel Header */}
      <div className="files-panel-head">
        <Icon name="folder" size={12} color="var(--accent)" />
        <span className="files-panel-title" title={rootPath}>
          {displayName}
        </span>
        <div className="files-panel-actions">
          <button
            className={`files-action-btn ${isRefreshing ? "is-refreshing" : ""}`}
            title={window.t ? window.t("files.panel.refresh", null, "Refresh") : "Refresh"}
            onClick={() => handleRefreshAll(false)}
          >
            <Icon name="refresh" size={10} />
          </button>
          <button
            className="files-action-btn"
            title={window.t ? window.t("files.panel.collapse", null, "Collapse") : "Collapse"}
            onClick={onClose}
          >
            <Icon name="close" size={10} />
          </button>
        </div>
      </div>

      {/* Directory Tree */}
      <div className="files-tree">
        {rootEntries.length === 0 ? (
          <div className="files-empty">
            {window.t ? window.t("files.panel.empty", null, "Empty directory") : "Empty directory"}
          </div>
        ) : (
          rootEntries.map((item) => (
            <FileTreeNode
              key={item.path}
              item={item}
              depth={0}
              expandedPaths={expandedPaths}
              childrenMap={childrenMap}
              loadingPaths={loadingPaths}
              selectedPath={selectedPath}
              renamingPath={renamingPath}
              renameValue={renameValue}
              contextMenuItem={contextMenu?.item}
              onSelect={(it) => {
                setSelectedItem(it);
                panelRef.current?.focus();
              }}
              onDoubleClick={handleDoubleClick}
              onToggleExpand={handleToggleExpand}
              onContextMenu={handleContextMenu}
              onRenameChange={setRenameValue}
              onRenameSubmit={handleRenameSubmit}
              onRenameCancel={handleRenameCancel}
            />
          ))
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="files-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="files-context-item"
            onClick={() => startRename(contextMenu.item)}
          >
            <Icon name="edit" size={11} color="var(--accent)" />
            <span className="files-context-label">
              {window.t ? window.t("files.menu.rename", null, "Rename") : "Rename"}
            </span>
          </button>

          <button
            className="files-context-item"
            onClick={() => handleCopyPath(contextMenu.item)}
          >
            <Icon name="copy" size={11} color="var(--cyan)" />
            <span className="files-context-label">
              {window.t ? window.t("files.menu.copyPath", null, "Copy Path") : "Copy Path"}
            </span>
          </button>

          <button
            className="files-context-item"
            onClick={() => handleCopyRelativePath(contextMenu.item)}
          >
            <Icon name="link" size={11} color="var(--lilac)" />
            <span className="files-context-label">
              {window.t ? window.t("files.menu.copyRelativePath", null, "Copy Relative Path") : "Copy Relative Path"}
            </span>
          </button>

          <div className="files-context-sep" />

          {!contextMenu.item.is_dir && (
            <button
              className="files-context-item"
              onClick={() => handleOpenDefault(contextMenu.item)}
            >
              <Icon name="external" size={11} color="var(--fg-3)" />
              <span className="files-context-label">
                {window.t ? window.t("files.menu.openDefault", null, "Open with Default Application") : "Open with Default Application"}
              </span>
            </button>
          )}

          <button
            className="files-context-item"
            onClick={() => handleRevealInExplorer(contextMenu.item)}
          >
            <Icon name="folder" size={11} color="var(--fg-3)" />
            <span className="files-context-label">
              {window.t ? window.t("files.menu.reveal", null, "Reveal in File Explorer") : "Reveal in File Explorer"}
            </span>
          </button>

          <div className="files-context-sep" />

          <button
            className="files-context-item danger"
            onClick={() => confirmDelete(contextMenu.item)}
          >
            <Icon name="trash" size={11} color="var(--rose, #ff5f57)" />
            <span className="files-context-label">
              {window.t ? window.t("files.menu.delete", null, "Delete") : "Delete"}
            </span>
          </button>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div
          className="files-modal-scrim"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="files-modal-box"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="files-modal-title">
              <Icon name="trash" size={14} color="var(--rose, #ff5f57)" />
              <span>
                {window.t ? window.t("files.delete.title", null, "Delete Item") : "Delete Item"}
              </span>
            </div>
            <div className="files-modal-body">
              {window.t
                ? window.t(
                    "files.delete.confirm",
                    { name: deleteTarget.name },
                    `Are you sure you want to delete ${deleteTarget.name}?`
                  )
                : `Are you sure you want to delete ${deleteTarget.name}?`}
            </div>
            <div className="files-modal-foot">
              <button
                className="btn ghost"
                onClick={() => setDeleteTarget(null)}
              >
                {window.t ? window.t("files.delete.cancel", null, "Cancel") : "Cancel"}
              </button>
              <button
                className="btn danger"
                onClick={handleDeleteExecute}
              >
                {window.t ? window.t("files.delete.delete", null, "Delete") : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="files-toast">
          <Icon name="check" size={11} color="var(--accent)" />
          <span>{toastMessage}</span>
        </div>
      )}
    </aside>
  );
}

Object.assign(window, { FileTreePanel });
