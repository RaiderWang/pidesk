/* palette/shortcuts-help.jsx — keyboard shortcut overview.
   ShortcutsList is embedded in the palette ("?" mode); ShortcutsHelp wraps
   it in a Modal (Ctrl+/). Data comes from app/shortcuts.js. */

const { Modal: _SH_Modal, Icon: _SH_Icon } = window;

function ShortcutsList({ system }) {
  const t = window.t;
  const S = window.AppShortcuts;
  const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform || "");
  const rows = S.listForDisplay(system);
  return (
    <>
      {S.GROUP_ORDER.map((g) => {
        const inGroup = rows.filter((r) => r.group === g);
        if (inGroup.length === 0) return null;
        return (
          <div key={g} className="shortcut-group">
            <div className="bridge-group-head mono">
              {t ? t(`shortcut.group.${g}`, null, g) : g}
            </div>
            {inGroup.map((r) => (
              <div key={r.id} className="shortcut-row">
                <span>{t ? t(r.labelKey, null, r.fallback) : r.fallback}</span>
                <span className="kbd">{S.formatKeys(r.keys, isMac)}</span>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

function ShortcutsHelp({ open, onClose, system }) {
  const t = window.t;
  if (!open) return null;
  const title = t ? t("shortcut.help.title", null, "Keyboard shortcuts") : "Keyboard shortcuts";
  return (
    <_SH_Modal onClose={onClose} size="sm" ariaLabel={title}>
      <div className="bridge-input-row">
        <_SH_Icon name="command" size={14} color="var(--accent)" />
        <span className="bridge-input mono" style={{ cursor: "default", lineHeight: "normal" }}>{title}</span>
        <span className="kbd">esc</span>
      </div>
      <div className="bridge-body">
        <ShortcutsList system={system} />
      </div>
    </_SH_Modal>
  );
}

Object.assign(window, { ShortcutsList, ShortcutsHelp });
