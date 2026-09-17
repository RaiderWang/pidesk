/* ═════════════════════════════════════════════════════════════════════
   chrome.jsx — window chrome, tabs, status bar, ambient peripherals
   - WindowChrome (traffic lights, title)
   - TabBar
   - StatusBar
   - Ambient rail: TokenGauge, ActivityRadar, Minimap, Peer session
   ═════════════════════════════════════════════════════════════════════ */

const { Icon, TokenGauge, ActivityRadar, Sparkline, TOOL_META, AgentActivity } = window;

// ── Platform detection ────────────────────────────────────────────────
const IS_WIN = typeof navigator !== "undefined" &&
  (navigator.userAgent.includes("Windows") || navigator.platform.startsWith("Win"));

// ── Window chrome ─────────────────────────────────────────────────────
function WindowChrome({ project, peer, onCmd }) {
  return (
    <div className="chrome" data-tauri-drag-region>
      {/* macOS traffic lights — left side, hidden on Windows */}
      {!IS_WIN && (
        <div className="chrome-lights">
          <span className="light red" />
          <span className="light amber" />
          <span className="light green" />
        </div>
      )}

      <div className="chrome-title">
        <span className="mono" style={{ color: "var(--fg-3)" }}>OMP</span>
        <span className="mono" style={{ color: "var(--fg-5)" }}>·</span>
        <span style={{ color: "var(--fg-2)" }}>{project.name}</span>
        {project.branch && (
          <span className="chip muted" style={{ marginLeft: 6 }}>
            <Icon name="branch" size={9} color="var(--fg-3)" />
            <span className="mono" style={{ color: "var(--fg-3)" }}>{project.branch}</span>
          </span>
        )}
      </div>

      <div className="chrome-right">
        <button className="btn ghost outlined" onClick={onCmd}>
          <Icon name="command" size={11} /> {window.t ? window.t("chrome.bridge", null, "bridge") : "bridge"}{" "}
          <span className="kbd">{IS_WIN ? "^K" : "⌘K"}</span>
        </button>

        {/* Windows controls — right side, hidden on macOS/Linux */}
        {IS_WIN && (
          <div className="win-controls">
            <button className="win-ctrl win-min"   title="Minimize">&#8211;</button>
            <button className="win-ctrl win-max"   title="Maximize / Restore">&#9633;</button>
            <button className="win-ctrl win-close" title="Close">&#10005;</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Project tabs ─────────────────────────────────────────────────────
function TabBar({ projects, activeId, onSelect, onClose, peer, onNew, onNewProject, onNewStandalone, onHistory, onManageModels, appVersion, theme }) {
  const version = appVersion || window.PIDESK_APP_VERSION || window.OMP_APP_VERSION || "0.2.3";
  const themeName = theme || "daylight";
  const versionLabel = `v${version}-${themeName}`;

  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef(null);

  React.useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const handleOpenFolder = () => {
    setMenuOpen(false);
    (onNewProject || onNew)?.();
  };

  const handleOpenStandalone = () => {
    setMenuOpen(false);
    onNewStandalone?.();
  };

  return (
    <div className="tabs">
      {projects.map((p) => {
        const active = p.id === activeId;
        const hasPath = Boolean(p.path && p.path.trim());
        const tabIcon = hasPath ? "folder" : "agent";
        return (
          <div key={p.id}
            className={`tab ${active ? "active" : ""}`}
            onClick={() => onSelect(p.id)}>
            <span className="tab-bar-mark" style={{ background: active ? p.color : "transparent" }} />
            <Icon name={tabIcon} size={11} color={active ? p.color : "var(--fg-4)"} />
            <span className="tab-name">{p.name}</span>
            {p.id === peer?.projectId && (
              <span className="chip accent" style={{ padding: "1px 6px" }}>split</span>
            )}
            <button className="tab-close" onClick={e => { e.stopPropagation(); onClose?.(p.id); }}><Icon name="close" size={9} /></button>
          </div>
        );
      })}
      <div className="tab-add-wrap" ref={menuRef}>
        <button
          className={`tab-add ${menuOpen ? "active" : ""}`}
          title={window.t ? window.t("chrome.tabs.new", null, "New session / Open project") : "New session / Open project"}
          onClick={() => setMenuOpen(v => !v)}
        >
          <Icon name="plus" size={11} />
        </button>
        {menuOpen && (
          <div className="tab-dropdown-menu">
            <button
              className="tab-dropdown-item"
              onClick={handleOpenFolder}
            >
              <Icon name="folder" size={12} color="var(--accent)" />
              <span className="tab-dropdown-label">{window.t ? window.t("chrome.tabs.openFolder", null, "Open Project Folder...") : "Open Project Folder..."}</span>
              <span className="tab-dropdown-hotkey">Ctrl+O</span>
            </button>
            <button
              className="tab-dropdown-item"
              onClick={handleOpenStandalone}
            >
              <Icon name="agent" size={12} color="var(--lilac)" />
              <span className="tab-dropdown-label">{window.t ? window.t("chrome.tabs.newSession", null, "New Session (No Project)") : "New Session (No Project)"}</span>
              <span className="tab-dropdown-hotkey">Ctrl+T</span>
            </button>
          </div>
        )}
      </div>
      <button className="tab-add" title={window.t ? window.t("chrome.tabs.history", null, "conversation history (Ctrl+H)") : "conversation history (Ctrl+H)"} onClick={onHistory}>
        <Icon name="clock" size={11} />
      </button>
      <button className="tab-add" title={window.t ? window.t("chrome.tabs.models", null, "manage models (Ctrl+M)") : "manage models (Ctrl+M)"} onClick={onManageModels}>
        <Icon name="cpu" size={11} />
      </button>
      <div style={{ flex: 1 }} />
      <div className="tabs-right mono">
        <span style={{ color: "var(--fg-4)" }} title={`PiDesk v${version}`}>{versionLabel}</span>
      </div>
    </div>
  );
}

// ── Status bar (footer): connection, model, tokens, todos, extension ─
function StatusBar({ ctx, model, thinking, todoDone, todoTotal, onTodo, onModel, onTweaks, autosave, onAutosave }) {
  const thinkLabel = {
    off: window.t ? window.t("chrome.status.thinking.off", null, "off") : "off",
    minimal: window.t ? window.t("chrome.status.thinking.minimal", null, "min") : "min",
    low: window.t ? window.t("chrome.status.thinking.low", null, "low") : "low",
    medium: window.t ? window.t("chrome.status.thinking.medium", null, "med") : "med",
    high: window.t ? window.t("chrome.status.thinking.high", null, "high") : "high",
    xhigh: window.t ? window.t("chrome.status.thinking.xhigh", null, "max") : "max",
  }[thinking] ?? "—";
  return (
    <div className="status">
      <span className="status-cell"><span className="dot live" /> {window.t ? window.t("chrome.status.connected", null, "connected") : "connected"}</span>
      <span className="status-sep">·</span>
      <button className="status-cell btn ghost" onClick={onModel} style={{ height: 22, padding: "0 6px", fontSize: "var(--d-text-xs)" }}>
        <span style={{ color: "var(--accent)" }}>{model.name}</span>
        <Icon name="chev" size={9} color="var(--fg-4)" />
      </button>
      <span className="status-sep">·</span>
      <span className="status-cell"><Icon name="thinking" size={10} color="var(--lilac)" /> {thinkLabel}</span>
      <span className="status-sep">·</span>
      <span className="status-cell">
        <span style={{ color: "var(--fg-3)" }}>{ctx.label}</span>
        <span className="status-bar-tube">
          <span className="status-bar-fill" style={{ width: `${ctx.pct}%` }} />
        </span>
        <span className="mono" style={{ color: "var(--fg-4)" }}>{(+ctx.pct).toFixed(1)}%</span>
      </span>
      <span className="status-sep">·</span>
      <span className="status-cell"><span style={{ color: "var(--fg-3)" }}>{window.t ? window.t("chrome.status.cost", null, "cost") : "cost"}</span> <span className="mono">{ctx.cost}</span></span>
      <span className="status-sep">·</span>
      <span className="status-cell"><span className="mono" style={{ color: "var(--fg-3)" }}>{ctx.tokensPerSec}</span> t/s</span>
      <div style={{ flex: 1 }} />
      <button className="status-cell btn ghost" onClick={onTodo} style={{ height: 22, padding: "0 6px", fontSize: "var(--d-text-xs)" }}>
        <Icon name="plan" size={11} color="var(--accent)" />
        <span style={{ color: "var(--accent)" }}>{window.t ? window.t("chrome.status.todo", null, "todo") : "todo"} <span className="mono">{todoDone}/{todoTotal}</span></span>
      </button>
      <span className="status-sep">·</span>
      <button className="status-cell btn ghost" onClick={() => onAutosave?.(!autosave)}
        style={{ height: 22, padding: "0 6px", fontSize: "var(--d-text-xs)" }} title={window.t ? window.t("chrome.status.toggleAutosave", null, "toggle autosave") : "toggle autosave"}>
        <span style={{ color: autosave ? "var(--fg-3)" : "var(--fg-5)" }}>
          {window.t ? window.t("chrome.status.autosave", null, "autosave") : "autosave"} {autosave ? (window.t ? window.t("chrome.status.autosaveOn", null, "on") : "on") : (window.t ? window.t("chrome.status.autosaveOff", null, "off") : "off")}
        </span>
      </button>
      <span className="status-sep">·</span>
      <button className="status-cell btn ghost" onClick={onTweaks} title={window.t ? window.t("chrome.status.tweaks", null, "外观与布局调整") : "外观与布局调整"} style={{ height: 22, padding: "0 6px", fontSize: "var(--d-text-xs)" }}>
        <Icon name="cog" size={12} color="var(--fg-3)" />
      </button>
    </div>
  );
}

// ── Minimap of the session: dense grid, one cell per message ─────────
// Hue encodes role/tool color (same palette as the chat). For assistant
// messages, opacity is log-scaled by tokens used so expensive turns pop
// against cheap ones. Click scrolls the chat to that message; hover
// highlights it via shared hoveredIdx state.
function SessionMinimap({ messages, hoveredIdx, onHover, onClick }) {
  // Log-scaled max across assistant messages so heatmap variance is
  // visible even when one compaction turn dwarfs the rest.
  const maxTokens = React.useMemo(() => {
    let max = 0;
    for (const m of messages) {
      if (m.kind === "assistant" && m.tokens && m.tokens > max) max = m.tokens;
    }
    return max;
  }, [messages]);
  const logMax = Math.log10(maxTokens + 1) || 1;

  return (
    <div className="minimap">
      <div className="minimap-head">
        <Icon name="minimap" size={11} color="var(--fg-3)" />
        <span style={{ color: "var(--fg-3)", fontWeight: 500 }}>session</span>
        <span className="mono" style={{ marginLeft: "auto", color: "var(--fg-4)" }}>{messages.length}</span>
      </div>
      <div className="minimap-grid">
        {messages.map((m, i) => {
          let hue = "var(--fg-5)";
          if      (m.kind === "user")      hue = "var(--fg-3)";
          else if (m.kind === "assistant") hue = "var(--accent)";
          else if (m.kind === "ask")       hue = "var(--amber)";
          else if (m.kind === "tool")      hue = TOOL_META[m.tool]?.color || "var(--fg-4)";

          // Brightness: assistant cells modulate by log(tokens), others flat.
          let opacity = 0.7;
          if (m.kind === "assistant" && m.tokens && maxTokens > 0) {
            const t = Math.log10(m.tokens + 1) / logMax;
            opacity = 0.4 + 0.6 * Math.max(0, Math.min(1, t));
          }

          // Per-kind tooltip — tools don't carry their own tokens (the
          // LLM cost lives on the assistant message that invoked them),
          // so they get tool-specific info instead of a token chip.
          let title;
          if (m.kind === "assistant") {
            const tok  = m.tokens ? `${m.tokens.toLocaleString()} tok` : "—";
            const inOut = (m.tokensIn != null || m.tokensOut != null)
              ? ` (${(m.tokensIn ?? 0).toLocaleString()} in · ${(m.tokensOut ?? 0).toLocaleString()} out)`
              : "";
            title = `assistant · ${tok}${inOut}${m.time ? " · " + m.time : ""}`;
          } else if (m.kind === "tool") {
            const dur = m.duration ? ` · ${(m.duration / 1000).toFixed(1)}s` : "";
            const status = m.status === "running" ? " · running" : (m.status === "ok" ? "" : ` · ${m.status}`);
            title = `${m.tool ?? "tool"}${m.title ? " " + m.title : ""}${dur}${status}`;
          } else if (m.kind === "user") {
            const preview = m.text ? ` · ${m.text.slice(0, 80)}${m.text.length > 80 ? "…" : ""}` : "";
            title = `you${preview}`;
          } else {
            title = m.kind;
          }
          const cls = `minimap-cell ${m.kind} ${m.streaming ? "live" : ""} ${hoveredIdx === i ? "hot" : ""}`.trim();

          return (
            <div key={m._id ?? i}
              className={cls}
              style={{ background: hue, opacity }}
              title={title}
              onMouseEnter={() => onHover?.(i)}
              onMouseLeave={() => onHover?.(null)}
              onClick={() => onClick?.(i)} />
          );
        })}
      </div>
    </div>
  );
}

// ── Peer session widget — shows the OTHER agent, when split is on ────
function PeerSession({ peer, onFocus, onClear }) {
  const meta = TOOL_META[peer.activity?.split(" · ")[0]] || TOOL_META.edit;
  const todoPct = peer.todo.total > 0 ? (peer.todo.done / peer.todo.total) * 100 : 0;
  return (
    <div className="peer">
      <div className="peer-head">
        <span className={`dot ${peer.isStreaming ? "live" : ""}`}
          style={{ background: "var(--cyan)", boxShadow: peer.isStreaming ? undefined : "none" }} />
        <span style={{ color: "var(--cyan)", fontWeight: 500 }}>{peer.project}</span>
        <span className="mono" style={{ marginLeft: "auto", color: "var(--fg-4)" }}>{peer.tps} t/s</span>
      </div>
      <div className="peer-title selectable">{peer.title}</div>
      <div className="peer-row">
        <span className="chip accent" style={{ borderColor: `color-mix(in oklab, ${meta.color} 40%, var(--line))`, color: meta.color, background: `color-mix(in oklab, ${meta.color} 12%, transparent)` }}>
          <Icon name={meta.icon} size={9} color={meta.color} />
          {peer.activity}
        </span>
      </div>
      <div className="peer-row" style={{ color: "var(--fg-3)" }}>
        todo <span className="mono">{peer.todo.done}/{peer.todo.total}</span>
        <span className="status-bar-tube" style={{ marginLeft: 6, flex: 1 }}>
          <span className="status-bar-fill" style={{ width: `${todoPct}%`, background: "var(--cyan)" }} />
        </span>
        {onFocus && (
          <button className="btn ghost" onClick={onFocus}
            style={{ marginLeft: 6, height: 18, padding: "0 6px", fontSize: "var(--d-text-xs)" }}>
            {window.t ? window.t("chrome.rail.focus", null, "focus →") : "focus →"}
          </button>
        )}
        {onClear && (
          <button className="btn ghost" onClick={onClear}
            title={window.t ? window.t("chrome.rail.unpin", null, "unpin peer") : "unpin peer"}
            style={{ height: 18, padding: "0 4px", fontSize: "var(--d-text-xs)", color: "var(--fg-4)" }}>
            <Icon name="close" size={8} color="var(--fg-4)" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Peer picker — shown when no peer is pinned and ≥1 other session exists ─
function PeerPicker({ sessions, activeSessionId, onSetPeer }) {
  const others = sessions.filter(s => s.id !== activeSessionId);
  if (others.length === 0) {
    return (
      <div style={{ color: "var(--fg-5)", fontSize: "var(--d-text-xs)", padding: "8px 0" }}>
        {window.t ? window.t("chrome.rail.peerEmpty", null, "Open a second tab to monitor it here.") : "Open a second tab to monitor it here."}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ color: "var(--fg-4)", fontSize: "var(--d-text-xs)", marginBottom: 4 }}>
        {window.t ? window.t("chrome.rail.peerHint", null, "Pin a session to monitor here") : "Pin a session to monitor here"}
      </div>
      {others.map(s => (
        <button key={s.id} className="btn ghost"
          onClick={() => onSetPeer?.(s.id)}
          style={{ display: "flex", alignItems: "center", gap: 6, height: 24, padding: "0 6px",
                   fontSize: "var(--d-text-xs)", width: "100%", justifyContent: "flex-start" }}>
          <Icon name={s.path ? "folder" : "agent"} size={10} color={s.color} />
          <span style={{ color: "var(--fg-2)", flex: 1, textAlign: "left", overflow: "hidden",
                         textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
          <Icon name="link" size={9} color="var(--fg-4)" />
        </button>
      ))}
    </div>
  );
}

// ── Right rail: ambient peripherals stacked ──────────────────────────
function AmbientRail({ ctx, activity, peer, peerSessionId, sessions, activeSessionId,
    onSetPeer, onClearPeer, onFocusPeer,
    messages, microcopy, onClose, sparklineValues, hoveredMsgIdx, onMinimapHover, onMinimapClick,
    isStreaming, turnStartMs, runningTools, recentTools }) {
  // Use live tps samples. Before the first turn, sparklineValues is all zeros
  // which renders as a flat baseline — honest, not fake random data.
  const sparkVals = (sparklineValues && sparklineValues.length > 0)
    ? sparklineValues
    : Array(30).fill(0);
  const hasPeer = peerSessionId && peer && peer.project !== "—";
  return (
    <aside className="rail">
      <div className="rail-head">
        <span style={{ color: "var(--fg-3)" }}>{window.t ? window.t("chrome.rail.ambient", null, "ambient") : "ambient"}</span>
        <button className="btn icon ghost" onClick={onClose} title={window.t ? window.t("chrome.rail.hide", null, "hide rail") : "hide rail"}>
          <Icon name="close" size={10} />
        </button>
      </div>

      <div className="rail-card glass">
        <TokenGauge used={ctx.used} total={ctx.total} pct={ctx.pct}
          label={ctx.label} sub={`cost ${ctx.cost} · ${ctx.tokensPerSec} t/s`} />
        <div className="rail-spark">
          <Sparkline values={sparkVals} width={210} height={28} />
          <div className="rail-spark-foot">
            <span style={{ color: "var(--fg-4)" }}>{window.t ? window.t("chrome.rail.throughput", null, "throughput") : "throughput"}</span>
            <span className="mono" style={{ color: "var(--accent)" }}>{ctx.tokensPerSec} t/s</span>
          </div>
        </div>
      </div>

      <div className="rail-card glass">
        <AgentActivity isStreaming={isStreaming} turnStartMs={turnStartMs} runningTools={runningTools} recentTools={recentTools} />
      </div>

      <div className="rail-card glass">
        <div className="rail-card-head">
          <Icon name="radar" size={11} color="var(--accent)" />
          <span style={{ color: "var(--fg-2)" }}>{window.t ? window.t("chrome.rail.radar", null, "agent radar") : "agent radar"}</span>
          <span className="chip muted" style={{ marginLeft: "auto" }}>{window.t ? window.t("chrome.rail.last60s", null, "last 60s") : "last 60s"}</span>
        </div>
        <ActivityRadar activity={activity} tps={ctx.tokensPerSec} />
        <div className="legend">
          {Object.entries(TOOL_META).filter(([k]) => ["read","search","edit","bash"].includes(k)).map(([k, m]) => (
            <span key={k} className="legend-item">
              <span style={{ background: m.color }} /> {m.label}
            </span>
          ))}
        </div>
      </div>

      <div className="rail-card glass">
        <div className="rail-card-head">
          <Icon name="split" size={11} color="var(--cyan)" />
          <span style={{ color: "var(--fg-2)" }}>{window.t ? window.t("chrome.rail.peer", null, "peer session") : "peer session"}</span>
          {hasPeer ? (
            <span className="chip" style={{ marginLeft: "auto", color: "var(--cyan)",
              borderColor: "color-mix(in oklab, var(--cyan) 30%, var(--line))" }}>
              {peer.isStreaming
                ? (window.t ? window.t("chrome.rail.peerLive", null, "live") : "live")
                : (window.t ? window.t("chrome.rail.peerPinned", null, "pinned") : "pinned")}
            </span>
          ) : (
            <span className="chip muted" style={{ marginLeft: "auto" }}>—</span>
          )}
        </div>
        {hasPeer
          ? <PeerSession peer={peer} onFocus={onFocusPeer} onClear={onClearPeer} />
          : <PeerPicker sessions={sessions} activeSessionId={activeSessionId} onSetPeer={onSetPeer} />
        }
      </div>

      <div className="rail-card glass" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 120 }}>
        <div className="rail-card-head">
          <Icon name="minimap" size={11} color="var(--fg-3)" />
          <span style={{ color: "var(--fg-2)" }}>minimap</span>
        </div>
        <SessionMinimap messages={messages} hoveredIdx={hoveredMsgIdx} onHover={onMinimapHover} onClick={onMinimapClick} />
      </div>
    </aside>
  );
}

Object.assign(window, { WindowChrome, TabBar, StatusBar, AmbientRail, SessionMinimap, PeerSession, PeerPicker });
