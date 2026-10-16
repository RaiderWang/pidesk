/* palette/use-palette-items.jsx — builds the palette's item list from app
   state: slash commands, app actions, open tabs, saved sessions (loaded on
   open) and project files (lazily indexed in "@" mode). */

const { Icon: _UP_Icon, renderCommandGlyph: _UP_glyph } = window;

const _UP_HISTORY_CAP = 300;
const _UP_EMPTY = [];
// Slash commands that mirror a registered keyboard shortcut.
const _UP_COMMAND_SHORTCUT = { history: "history", models: "models", todo: "togglePlan", kanban: "togglePlan" };

function usePaletteItems({ open, mode, actions, sessions, activeSessionId, projectPath, currentModelName }) {
  const t = window.t;
  const [history, setHistory] = React.useState([]);
  const files = window.useFileIndex({ enabled: open && mode === "files", projectPath });

  // Saved sessions: refresh each time the palette opens.
  React.useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    Promise.resolve(window.OMP_BRIDGE?.listSavedSessions?.())
      .then((list) => { if (!cancelled) setHistory(Array.isArray(list) ? list.slice(0, _UP_HISTORY_CAP) : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open]);

  const items = React.useMemo(() => {
    if (!open) return _UP_EMPTY; // App re-renders often while streaming
    const S = window.AppShortcuts;
    const out = [];
    for (const c of (window.OMP_DATA?.commands || [])) {
      const sc = _UP_COMMAND_SHORTCUT[c.name];
      out.push({
        id: `cmd:${c.name}`, group: "commands", kind: "command", command: c,
        label: `/${c.name}`, labelClass: "mono", labelColor: "var(--accent)", hint: c.hint,
        keywords: [c.group].filter(Boolean),
        glyph: _UP_glyph(c.icon, 11),
        drill: c.name === "model" || c.name === "login",
        trailing: c.name === "model" ? <span className="mono">{currentModelName}</span> : null,
        shortcut: sc ? S.displayFor(sc) : undefined,
      });
    }
    for (const a of actions || []) {
      out.push({
        id: `act:${a.id}`, group: "actions", kind: "action", run: a.run,
        label: a.label, hint: a.hint, keywords: a.keywords,
        glyph: <_UP_Icon name={a.icon || "bolt"} size={11} />,
        shortcut: a.shortcutId ? S.displayFor(a.shortcutId) : undefined,
      });
    }
    for (const s of sessions || []) {
      out.push({
        id: `tab:${s.id}`, group: "tabs", kind: "tab", sessionId: s.id,
        label: s.name, hint: s.path || "",
        glyph: <_UP_Icon name={s.path ? "folder" : "agent"} size={11} color={s.color} />,
        trailing: s.id === activeSessionId
          ? <span className="chip accent">{t ? t("palette.tab.current", null, "current") : "current"}</span>
          : null,
      });
    }
    for (const s of history) {
      out.push({
        id: `hist:${s.path || s.id}`, group: "history", kind: "history", session: s,
        label: s.title || s.preview || String(s.id || ""), hint: s.project_name || "",
        glyph: <_UP_Icon name="clock" size={11} />,
      });
    }
    for (const f of files.list) {
      out.push({
        id: `file:${f.path}`, group: "files", kind: "file", rel: f.rel,
        label: f.rel, glyph: <_UP_Icon name="file" size={11} />,
      });
    }
    return out;
  }, [open, actions, sessions, activeSessionId, history, files.list, currentModelName, t]);

  return { items, filesLoading: files.loading };
}

Object.assign(window, { usePaletteItems });
