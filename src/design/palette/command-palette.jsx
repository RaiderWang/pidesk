/* palette/command-palette.jsx — Ctrl+K command palette.

   One Modal hosting three views:
     commands — search commands, app actions, open tabs, saved sessions and
                (with "@") project files. Prefixes: / # @ ?
     models   — drill-in model picker (palette-models-view.jsx)
     login    — drill-in OAuth provider picker (palette-login-view.jsx)
   Escape steps back from a drill-in view before closing. */

const {
  Icon: _CP_Icon, Modal: _CP_Modal, PaletteRow: _CP_Row, usePaletteCursor: _CP_useCursor,
  usePaletteItems: _CP_useItems, PaletteModelsView: _CP_ModelsView, PaletteLoginView: _CP_LoginView,
  ShortcutsList: _CP_ShortcutsList,
} = window;

function CommandPalette({
  open, onClose, initialView = "commands",
  onPick, onPickModel, currentModelId, onPickLogin, loginProviders, onManageModels, models: propModels,
  actions, sessions, activeSessionId, onSelectTab, onResumeSaved, projectPath, systemShortcuts,
}) {
  const t = window.t;
  const [q, setQ] = React.useState("");
  const [view, setView] = React.useState("commands");

  React.useEffect(() => {
    if (open) {
      setQ("");
      setView(initialView || "commands");
    }
  }, [open, initialView]);

  const models = (propModels && propModels.length > 0)
    ? propModels
    : (window.OMP_BRIDGE?.models?.length > 0 ? window.OMP_BRIDGE.models : window.OMP_DATA.models) || [];
  const currentModelName = models.find((m) => m.id === currentModelId)?.name ?? "–";

  const mode = window.PaletteQuery.parsePaletteQuery(q).mode;
  const { items, filesLoading } = _CP_useItems({
    open: open && view === "commands", mode, actions, sessions, activeSessionId, projectPath, currentModelName,
  });
  const result = React.useMemo(() => window.PaletteQuery.buildPaletteView(items, q), [items, q]);
  const nav = _CP_useCursor(result.flat.length, q);

  if (!open) return null;

  const goBack = () => { setView("commands"); setQ(""); };
  // Escape steps back from a drill-in view; closes when it was opened directly.
  const handleEscape = () => {
    if (view !== "commands" && initialView === "commands") goBack();
    else onClose();
  };

  const runEntry = (entry) => {
    if (!entry) return;
    const item = entry.item;
    if (item.kind === "command") {
      const c = item.command;
      if (c.name === "model") { setQ(""); setView("models"); return; }
      if (c.name === "login") { setQ(""); setView("login"); return; }
      if (c.name === "models") { onManageModels?.(); onClose(); return; }
      onPick(c);
      onClose();
    } else if (item.kind === "action") {
      onClose();
      item.run?.();
    } else if (item.kind === "tab") {
      onClose();
      onSelectTab?.(item.sessionId);
    } else if (item.kind === "history") {
      onClose();
      onResumeSaved?.(item.session);
    } else if (item.kind === "file") {
      onClose();
      // After the modal restores focus, drop an @reference into the composer.
      setTimeout(() => window.ComposerInsert?.appendToComposer(`@${item.rel}`), 60);
    }
  };

  let body;
  if (view === "models") {
    body = <_CP_ModelsView models={models} currentModelId={currentModelId} onPickModel={onPickModel}
      onClose={onClose} onBack={goBack} onManageModels={onManageModels} />;
  } else if (view === "login") {
    body = <_CP_LoginView loginProviders={loginProviders} onPickLogin={onPickLogin} onClose={onClose} onBack={goBack} />;
  } else {
    let offset = 0;
    const filesMode = mode === "files";
    body = (
      <>
        <div className="bridge-input-row">
          <_CP_Icon name="command" size={14} color="var(--accent)" />
          <input autoFocus className="bridge-input mono"
            placeholder={t ? t("composer.bridge.searchPlaceholder", null, "type a command or search…") : "type a command or search…"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => nav.onKeyDown(e, (i) => runEntry(result.flat[i]))} />
          <span className="kbd">esc</span>
        </div>
        <div className="bridge-body" ref={nav.bodyRef}>
          {mode === "shortcuts" && <_CP_ShortcutsList system={systemShortcuts} />}
          {result.groups.map((g) => {
            const start = offset;
            offset += g.entries.length;
            return (
              <div key={g.group} className="bridge-group">
                <div className="bridge-group-head mono">
                  {t ? t(`palette.group.${g.group}`, null, g.group) : g.group}
                </div>
                {g.entries.map((entry, i) => (
                  <_CP_Row key={entry.item.id} entry={entry}
                    cursor={start + i === nav.cursor}
                    onRun={() => runEntry(entry)}
                    onHover={() => nav.setCursor(start + i)} />
                ))}
              </div>
            );
          })}
          {mode !== "shortcuts" && result.flat.length === 0 && (
            <div className="bridge-empty">
              {filesMode && !projectPath
                ? (t ? t("palette.files.noProject", null, "Open a project to search its files.") : "Open a project to search its files.")
                : filesMode && filesLoading
                  ? (t ? t("palette.files.loading", null, "Indexing project files…") : "Indexing project files…")
                  : (t ? t("palette.empty", null, "No matches — try `plan`, `model`, `#history` or `@file`.") : "No matches — try `plan`, `model`, `#history` or `@file`.")}
            </div>
          )}
        </div>
        <div className="bridge-foot mono">
          <span className="kbd">↑↓</span> {t ? t("palette.foot.navigate", null, "navigate") : "navigate"}
          <span className="kbd">↵</span> {t ? t("palette.foot.run", null, "run") : "run"}
          <span className="kbd">esc</span> {t ? t("palette.foot.close", null, "close") : "close"}
          <span className="palette-prefixes">
            {t ? t("palette.hint.prefixes", null, "/ commands · # sessions · @ files · ? shortcuts") : "/ commands · # sessions · @ files · ? shortcuts"}
          </span>
        </div>
      </>
    );
  }

  return (
    <_CP_Modal onClose={onClose} onEscape={handleEscape} ariaLabel={t ? t("chrome.bridge", null, "bridge") : "bridge"}>
      {body}
    </_CP_Modal>
  );
}

Object.assign(window, { CommandPalette, CommandBridge: CommandPalette });
