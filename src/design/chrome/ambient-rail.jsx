/* chrome/ambient-rail.jsx — "Overview" content of the dock: token gauge,
   agent hub, peer session, session minimap. The dock owns head/close/resize. */

const { Icon, TokenGauge, Sparkline, TOOL_META, AgentHub } = window;

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
        <span style={{ color: "var(--fg-3)", fontWeight: 500 }}>{window.t ? window.t("rail.session", null, "session") : "session"}</span>
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
        <span style={{ color: "var(--cyan)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 }} title={peer.project}>{peer.project}</span>
        <span className="mono" style={{ marginLeft: 8, color: "var(--fg-4)", flexShrink: 0 }}>{peer.tps} t/s</span>
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
    messages, microcopy, sparklineValues, hoveredMsgIdx, onMinimapHover, onMinimapClick,
    isStreaming, turnStartMs, runningTools, recentTools,
    hubMode, hubAgents, hubHistory, hasPendingAsyncWork = false, onOpenToolLog }) {
  // Use live tps samples. Before the first turn, sparklineValues is all zeros
  // which renders as a flat baseline — honest, not fake random data.
  const sparkVals = (sparklineValues && sparklineValues.length > 0)
    ? sparklineValues
    : Array(30).fill(0);
  const hasPeer = peerSessionId && peer && peer.project !== "—";
  return (
    <div className="rail">
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
        <AgentHub
          hubMode={hubMode} hubAgents={hubAgents} hubHistory={hubHistory}
          runningTools={runningTools} recentTools={recentTools}
          isStreaming={isStreaming} turnStartMs={turnStartMs} activity={activity}
          hasPendingAsyncWork={hasPendingAsyncWork}
          onOpenToolLog={onOpenToolLog}
        />
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
          <span style={{ color: "var(--fg-2)" }}>{window.t ? window.t("rail.minimap", null, "minimap") : "minimap"}</span>
        </div>
        <SessionMinimap messages={messages} hoveredIdx={hoveredMsgIdx} onHover={onMinimapHover} onClick={onMinimapClick} />
      </div>
    </div>
  );
}


Object.assign(window, { AmbientRail, SessionMinimap, PeerSession, PeerPicker });
