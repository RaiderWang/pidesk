/* ═════════════════════════════════════════════════════════════════════
   composer-image-menu.jsx — Dropdown menu for image attachment & screen capture
   ═════════════════════════════════════════════════════════════════════ */

(function () {
  const { Icon } = window;

  function ComposerImageMenu({
    onUploadClick,
    onCaptureClick,
    supportsImages = true,
    shortcutText = "Alt+S",
    title,
  }) {
    const [open, setOpen] = React.useState(false);
    const menuRef = React.useRef(null);
    const btnRef = React.useRef(null);

    // Close when clicking outside or pressing Escape
    React.useEffect(() => {
      if (!open) return;
      const handlePointerDown = (e) => {
        if (
          menuRef.current &&
          !menuRef.current.contains(e.target) &&
          btnRef.current &&
          !btnRef.current.contains(e.target)
        ) {
          setOpen(false);
        }
      };
      const handleKeyDown = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          setOpen(false);
          btnRef.current?.focus();
        }
      };

      document.addEventListener("pointerdown", handlePointerDown);
      document.addEventListener("keydown", handleKeyDown);
      return () => {
        document.removeEventListener("pointerdown", handlePointerDown);
        document.removeEventListener("keydown", handleKeyDown);
      };
    }, [open]);

    const handleUpload = () => {
      setOpen(false);
      onUploadClick?.();
    };

    const handleCapture = () => {
      setOpen(false);
      onCaptureClick?.();
    };

    const displayShortcut = window.ShortcutUtil
      ? window.ShortcutUtil.formatDisplayShortcut(shortcutText)
      : shortcutText;

    const uploadLabel = window.t
      ? window.t("composer.imageMenu.upload", null, "Upload image…")
      : "Upload image…";
    const captureLabel = window.t
      ? window.t("composer.imageMenu.screenshot", null, "Capture screen")
      : "Capture screen";
    const triggerTitle =
      title ||
      (window.t
        ? window.t("composer.imageMenu.trigger", null, "Add image or screenshot")
        : "Add image or screenshot");

    return (
      <div className="composer-image-menu-anchor">
        <button
          ref={btnRef}
          type="button"
          className={`btn icon ghost ${!supportsImages ? "unsupported-vision" : ""} ${open ? "active" : ""}`}
          title={triggerTitle}
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
        >
          <Icon
            name="image"
            size={13}
            color={!supportsImages ? "var(--fg-4)" : "currentColor"}
          />
        </button>

        {open && (
          <div className="composer-image-popover" ref={menuRef} role="menu">
            <button
              type="button"
              className="composer-image-popover-item"
              role="menuitem"
              onClick={handleUpload}
            >
              <Icon name="folder" size={13} />
              <span>{uploadLabel}</span>
            </button>
            <button
              type="button"
              className="composer-image-popover-item"
              role="menuitem"
              onClick={handleCapture}
            >
              <Icon name="camera" size={13} />
              <span>{captureLabel}</span>
              {displayShortcut && (
                <kbd className="composer-menu-kbd">{displayShortcut}</kbd>
              )}
            </button>
          </div>
        )}
      </div>
    );
  }

  window.ComposerImageMenu = ComposerImageMenu;
})();
