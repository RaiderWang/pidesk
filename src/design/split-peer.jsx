/* split-peer.jsx — split pane showing a peer session's live tool stream.
   Rendered between <main> and <aside.rail> when layout=split and a peer
   session is pinned. Uses lightweight peer data from live.js — no full
   message history, just recent tool events and current thinking.

   Depends on: Icon, TOOL_META (ui/icons.jsx). */

const { Icon, TOOL_META } = window;

function SplitPeer({ peer, onFocus, onClear }) {
  const tools = peer.recentTools ?? [];
  const todoPct = peer.todo.total > 0
    ? (peer.todo.done / peer.todo.total) * 100 : 0;

  // Truncate long thought text for the split pane — full text lives in
  // the main chat view if the user switches to that tab.
  const thoughtSnippet = peer.thought
    ? (peer.thought.length > 200 ? peer.thought.slice(0, 200) + "…" : peer.thought)
    : null;

  return (
    <div className="split">
      <div className="split-head">
        <span className={`dot ${peer.isStreaming ? "live" : ""}`}
          style={{ background: "var(--cyan)", boxShadow: peer.isStreaming ? undefined : "none" }} />
        <span className="mono" style={{ color: "var(--cyan)" }}>{peer.project}</span>
        <span style={{ color: "var(--fg-3)", overflow: "hidden", textOverflow: "ellipsis",
                       whiteSpace: "nowrap", flex: 1 }}>· {peer.title}</span>
        {onFocus && (
          <button className="btn ghost" onClick={onFocus} style={{ fontSize: "var(--d-text-xs)" }}>
            <Icon name="arrow" size={11} /> {window.t ? window.t("chrome.rail.focus", null, "focus →") : "focus →"}
          </button>
        )}
        {onClear && (
          <button className="btn ghost" onClick={onClear}
            title={window.t ? window.t("chrome.rail.unpin", null, "unpin peer") : "unpin peer"}
            style={{ padding: "0 4px" }}>
            <Icon name="close" size={9} color="var(--fg-4)" />
          </button>
        )}
      </div>

      <div className="split-body">
        <div className="split-stream">
          {tools.length === 0 && !thoughtSnippet && (
            <div style={{ color: "var(--fg-5)", fontSize: "var(--d-text-xs)", padding: "12px 0" }}>
              {peer.isStreaming
                ? (window.t ? window.t("split.waiting", null, "waiting for tool activity…") : "waiting for tool activity…")
                : (window.t ? window.t("split.idle", null, "session idle") : "session idle")}
            </div>
          )}

          {tools.map((t, i) => {
            const meta = TOOL_META[t.tool] || TOOL_META.edit;
            const isRunning = t.status === "running";
            return (
              <div key={t.id ?? i} className="split-row mono">
                <span className="chip" style={{
                  color: meta.color,
                  borderColor: `color-mix(in oklab, ${meta.color} 30%, var(--line))`,
                  background: `color-mix(in oklab, ${meta.color} 8%, transparent)`,
                  minWidth: 42, textAlign: "center",
                }}>
                  <Icon name={meta.icon} size={9} color={meta.color} />
                  {t.tool}
                </span>
                <span style={{ color: "var(--fg-3)", overflow: "hidden", textOverflow: "ellipsis",
                               whiteSpace: "nowrap", flex: 1 }}>
                  {t.target || "—"}
                </span>
                {isRunning ? (
                  <span className="shimmer-text" style={{ marginLeft: "auto", fontSize: "var(--d-text-xs)" }}>
                    {window.t ? window.t("split.running", null, "running…") : "running…"}
                  </span>
                ) : t.duration != null ? (
                  <span className="chip muted" style={{ marginLeft: "auto" }}>
                    {t.duration < 1000 ? `${t.duration}ms` : `${(t.duration / 1000).toFixed(1)}s`}
                  </span>
                ) : null}
              </div>
            );
          })}

          {thoughtSnippet && (
            <div className="split-row split-thought">
              <span className="mono" style={{ color: "var(--fg-4)" }}>// </span>
              <span style={{ color: "var(--fg-3)", fontStyle: "italic" }}>
                {thoughtSnippet}
              </span>
            </div>
          )}
        </div>

        <div className="split-foot mono">
          <span className={`dot ${peer.isStreaming ? "live" : ""}`}
            style={{ background: peer.isStreaming ? "var(--cyan)" : "var(--fg-5)" }} />
          <span style={{ color: "var(--fg-3)" }}>{peer.project}</span>
          <span style={{ color: "var(--fg-4)" }}>
            · {peer.tps}t/s · todo {peer.todo.done}/{peer.todo.total}
          </span>
          {peer.todo.total > 0 && (
            <span className="status-bar-tube" style={{ flex: 1, maxWidth: 80, marginLeft: 4 }}>
              <span className="status-bar-fill" style={{ width: `${todoPct}%`, background: "var(--cyan)" }} />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { SplitPeer });
