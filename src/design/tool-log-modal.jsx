/* ═════════════════════════════════════════════════════════════════════
   tool-log-modal.jsx — Real-time terminal output & tool log viewer modal
   Shows live or completed stdout/stderr for runningTools and recentTools
   ═════════════════════════════════════════════════════════════════════ */

const { Icon, TOOL_META } = window;

const _ANSI_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

function _tlCleanLine(raw) {
  if (!raw) return "";
  let line = raw;
  if (line.includes("\r")) {
    const parts = line.split("\r").filter(Boolean);
    line = parts[parts.length - 1] || "";
  }
  return line.replace(_ANSI_REGEX, "");
}

function _tlFmtElapsed(ms) {
  if (!ms || ms < 0) return "0s";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s < 10 ? "0" : ""}${s}s`;
}

function ToolLogModal({ tool, toolLogs, onClose }) {
  if (!tool) return null;

  const [filter, setFilter]         = React.useState("");
  const [autoScroll, setAutoScroll] = React.useState(true);
  const [copied, setCopied]         = React.useState(false);
  const [tick, setTick]             = React.useState(Date.now());
  const terminalRef                 = React.useRef(null);
  const t                           = window.t;

  const logEntry  = toolLogs?.[tool.id];
  const isRunning = tool.status === "running" || (logEntry && logEntry.status === "running") || (!tool.durationMs && tool.startMs);

  // Tick every second if running for live elapsed time
  React.useEffect(() => {
    if (!isRunning) return undefined;
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  // Close on Escape
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rawLines = logEntry?.lines ?? [];
  const lines = React.useMemo(() => {
    const src = (!rawLines.length && tool.command) ? [`$ ${tool.command}`] : rawLines;
    return src.map(_tlCleanLine);
  }, [rawLines, tool.command]);

  const filteredLines = React.useMemo(() => {
    if (!filter.trim()) return lines;
    const q = filter.toLowerCase();
    return lines.filter(line => line.toLowerCase().includes(q));
  }, [lines, filter]);

  // Auto-scroll to bottom when new lines arrive
  React.useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [filteredLines.length, autoScroll]);

  const handleCopy = React.useCallback(async () => {
    const text = lines.join("\n");
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("Failed to copy log:", e);
    }
  }, [lines]);

  const meta = (TOOL_META && TOOL_META[tool.tool]) || { color: "var(--fg-3)", icon: "bash", label: tool.tool || "tool" };
  const elapsed = tool.durationMs ?? (tool.startMs ? tick - tool.startMs : 0);
  const commandOrTarget = logEntry?.command || tool.command || tool.target || tool.title || tool.tool;

  return (
    <div className="bridge-scrim" onClick={onClose} style={{ zIndex: 120 }}>
      <div
        className="bridge slide-in tool-log-modal"
        onClick={e => e.stopPropagation()}
        style={{
          width: "min(920px, calc(100vw - 40px))",
          height: "min(680px, calc(100vh - 80px))",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-elevated)",
          border: "1px solid var(--line-bright)",
          borderRadius: 14,
          boxShadow: "var(--shadow-window)",
          overflow: "hidden",
        }}
      >
        {/* Modal Header */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 16px",
          borderBottom: "1px solid var(--line)",
          background: `linear-gradient(180deg, color-mix(in oklab, ${meta.color} 8%, transparent), transparent)`,
        }}>
          <span className="tool-glyph" style={{ borderColor: meta.color, color: meta.color, display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 5, border: "1px solid" }}>
            <Icon name={meta.icon || "bash"} size={12} color={meta.color} />
          </span>
          <span className="chip mono" style={{
            color: meta.color,
            borderColor: `color-mix(in oklab, ${meta.color} 30%, var(--line))`,
            background: `color-mix(in oklab, ${meta.color} 10%, transparent)`,
            textTransform: "uppercase",
            fontSize: "11px",
            fontWeight: 600,
          }}>
            {meta.label}
          </span>
          <span className="mono selectable" style={{
            color: "var(--fg)",
            fontWeight: 500,
            fontSize: "var(--d-text-sm)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }} title={commandOrTarget}>
            {commandOrTarget}
          </span>

          {isRunning ? (
            <span className="chip accent" style={{ animation: "pulseDot 1.4s infinite" }}>
              <span className="dot live" /> {t ? t("chat.running", null, "running") : "running"} · {_tlFmtElapsed(elapsed)}
            </span>
          ) : (
            <span className="chip muted mono">
              {_tlFmtElapsed(elapsed)}
            </span>
          )}

          <button className="btn icon ghost" onClick={onClose} title={t ? t("hub.logs.close", null, "close (esc)") : "close (esc)"}>
            <Icon name="close" size={12} color="var(--fg-3)" />
          </button>
        </div>

        {/* Toolbar */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 14px",
          borderBottom: "1px solid var(--line)",
          background: "var(--bg-surface)",
          fontSize: "var(--d-text-xs)",
        }}>
          {/* Search/filter */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, background: "var(--bg-card)", border: "1px solid var(--line)", borderRadius: 6, padding: "3px 8px" }}>
            <Icon name="search" size={11} color="var(--fg-4)" />
            <input
              className="mono"
              style={{ background: "transparent", border: 0, outline: "none", color: "var(--fg)", fontSize: "12px", width: "100%" }}
              placeholder={t ? t("hub.logs.filterPlaceholder", null, "Filter logs…") : "Filter logs…"}
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
            {filter && (
              <button className="btn icon ghost" style={{ padding: 0, height: "auto" }} onClick={() => setFilter("")}>
                <Icon name="close" size={10} color="var(--fg-4)" />
              </button>
            )}
          </div>

          <span className="mono" style={{ color: "var(--fg-4)" }}>
            {t ? t("hub.logs.lineCount", { n: filteredLines.length }, `${filteredLines.length} lines`) : `${filteredLines.length} lines`}
          </span>

          <button
            className={`btn ${autoScroll ? "accent outlined" : "ghost"}`}
            style={{ fontSize: "11px", height: 26, padding: "0 8px" }}
            onClick={() => setAutoScroll(!autoScroll)}
            title={t ? t("hub.logs.autoscroll", null, "Auto-scroll") : "Auto-scroll"}
          >
            <Icon name="arrow" size={10} color={autoScroll ? "var(--accent)" : "var(--fg-4)"} style={{ transform: "rotate(90deg)" }} />
            {t ? t("hub.logs.autoscroll", null, "Auto-scroll") : "Auto-scroll"}
          </button>

          <button
            className="btn ghost"
            style={{ fontSize: "11px", height: 26, padding: "0 8px" }}
            onClick={handleCopy}
            title={t ? t("hub.logs.copy", null, "Copy Log") : "Copy Log"}
          >
            <Icon name={copied ? "check" : "copy"} size={10} color={copied ? "var(--accent)" : "var(--fg-3)"} />
            {copied ? (t ? t("hub.logs.copied", null, "Copied!") : "Copied!") : (t ? t("hub.logs.copy", null, "Copy") : "Copy")}
          </button>
        </div>

        {/* Terminal output container */}
        <div
          ref={terminalRef}
          className="tool-log-terminal mono selectable"
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "12px 14px",
            background: "color-mix(in oklab, var(--bg-window) 92%, black)",
            fontSize: "12px",
            lineHeight: 1.5,
            fontFamily: "var(--font-mono, monospace)",
          }}
        >
          {filteredLines.length === 0 ? (
            <div style={{ color: "var(--fg-5)", padding: "40px 0", textAlign: "center" }}>
              {isRunning
                ? (t ? t("hub.logs.waiting", null, "Waiting for terminal output…") : "Waiting for terminal output…")
                : (t ? t("hub.logs.empty", null, "No terminal output produced.") : "No terminal output produced.")}
            </div>
          ) : (
            filteredLines.map((line, idx) => {
              let color = "var(--fg-2)";
              if (line.startsWith("$")) color = "var(--accent)";
              else if (/^[✓✔]|^PASS|\bpassed\b|\bsuccess\b/i.test(line)) color = "var(--cyan)";
              else if (/^[✗✘]|^FAIL|^Error|\bfailed\b|\berror\b/i.test(line)) color = "var(--rose)";
              else if (/^WARN|\bwarning\b/i.test(line)) color = "var(--amber)";

              return (
                <div key={idx} style={{ color, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                  {line}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ToolLogModal });
