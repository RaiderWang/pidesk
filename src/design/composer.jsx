/* ═════════════════════════════════════════════════════════════════════
   composer.jsx — input area + slash palette + ⌘K command bridge
   ═════════════════════════════════════════════════════════════════════ */

const { Icon } = window;

// ── Model vision capability detection ──────────────────────────────────
function modelSupportsImages(m) {
  if (!m) return false;
  if (Array.isArray(m.input)) {
    return m.input.includes("image");
  }
  const id = (m.id || "").toLowerCase();
  const name = (m.name || "").toLowerCase();
  return (
    id.includes("claude-3") || id.includes("claude-4") || id.includes("claude-sonnet") ||
    id.includes("claude-opus") || id.includes("claude-haiku") || id.includes("gpt-4o") ||
    id.includes("gemini") || id.includes("vision") || id.includes("vl") ||
    name.includes("vision") || name.includes("gpt-4o") || name.includes("gemini")
  );
}

// ── The composer (input + plan/steer modes + send) ────────────────────
function Composer({ onSend, onPick, planMode, onTogglePlan, onOpenCmd, onOpenModel, currentModel, thinking, onCycleThinking, isStreaming, onAbort, onApprove, annotationCount = 0, microcopy }) {
  const [text, setText]             = React.useState("");
  const [activeIdx, setActiveIdx]   = React.useState(0);
  const [images, setImages]         = React.useState([]);
  const [modelWarning, setModelWarning] = React.useState(null);
  const taRef        = React.useRef(null);
  const listRef      = React.useRef(null);
  const fileInputRef = React.useRef(null);
  // paste blocks: id → raw content; collapsed in textarea as [paste #N +K lines]
  const pasteBlocksRef   = React.useRef(new Map());
  const pasteCounterRef  = React.useRef(0);

  const cmds = window.OMP_DATA?.commands || [];
  const supportsImages = React.useMemo(() => modelSupportsImages(currentModel), [currentModel]);

  // Clear warning if user switches to a model that supports vision
  React.useEffect(() => {
    if (supportsImages && modelWarning) {
      setModelWarning(null);
    }
  }, [supportsImages, modelWarning]);

  // Derive slash state inline — no useEffect, no stale flicker
  const slashQ = text.startsWith("/") ? text.slice(1).split(" ")[0].toLowerCase() : null;
  const filtered = slashQ !== null
    ? cmds.filter(c => !slashQ || c.name.startsWith(slashQ) || c.name.includes(slashQ))
    : [];
  const showSlash = filtered.length > 0;

  // Keep activeIdx in bounds; auto-select when single result
  const clampedIdx = showSlash ? Math.min(activeIdx, filtered.length - 1) : 0;

  // Scroll active item into view
  React.useEffect(() => {
    if (!showSlash || !listRef.current) return;
    const el = listRef.current.children[clampedIdx];
    el?.scrollIntoView({ block: "nearest" });
  }, [clampedIdx, showSlash]);

  React.useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 320)}px`;
  }, [text]);

  // Restore focus when the agent finishes streaming and the textarea re-enables.
  React.useEffect(() => {
    if (!isStreaming) requestAnimationFrame(() => taRef.current?.focus());
  }, [isStreaming]);

  const execCmd = (cmd) => {
    setText("");
    setActiveIdx(0);
    pasteBlocksRef.current.clear();
    pasteCounterRef.current = 0;
    onPick?.(cmd);
  };

  // Expand [paste #N +K lines] tokens back to their real content before sending.
  const expandPastes = (txt) =>
    txt.replace(/\[paste #(\d+) \+\d+ lines?\]/g, (match, id) =>
      pasteBlocksRef.current.get(Number(id)) ?? match);

  const handleFiles = (fileList) => {
    if (!fileList || fileList.length === 0) return;
    const valid = Array.from(fileList).filter(f => f.type && f.type.startsWith("image/"));
    if (valid.length === 0) {
      alert("Please select valid image files (PNG, JPG, JPEG, WEBP, GIF).");
      return;
    }

    valid.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target.result;
        const base64Data = typeof dataUrl === "string" && dataUrl.includes(",")
          ? dataUrl.split(",")[1]
          : dataUrl;
        setImages(prev => [
          ...prev,
          {
            id: 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            name: file.name || "image.png",
            size: file.size,
            mimeType: file.type || "image/png",
            dataUrl,
            data: base64Data,
          }
        ]);
      };
      reader.readAsDataURL(file);
    });

    if (!supportsImages) {
      setModelWarning(`Current model "${currentModel?.name || currentModel?.id || "model"}" does not support image input. Please switch to a vision-capable model (e.g. Claude 3.5/3.7 Sonnet).`);
    }
  };

  const send = () => {
    // If the slash popup is open, Enter executes the highlighted command
    if (showSlash) { execCmd(filtered[clampedIdx]); return; }
    const canSend = text.trim() || images.length > 0 || (planMode && annotationCount > 0);
    if (!canSend) return;

    if (!supportsImages && images.length > 0) {
      setModelWarning(`Current model "${currentModel?.name || currentModel?.id || "model"}" does not support image input. Please switch models or remove the image before sending.`);
      return;
    }

    const payloadImages = images.map(img => ({
      type: "image",
      data: img.data,
      mimeType: img.mimeType,
    }));

    onSend(expandPastes(text.trim()), payloadImages);
    setText("");
    setImages([]);
    setModelWarning(null);
    pasteBlocksRef.current.clear();
    pasteCounterRef.current = 0;
    requestAnimationFrame(() => taRef.current?.focus());
  };

  // Collapse long pastes into a token so the textarea stays navigable.
  // Intercept images from clipboard (e.g. Win+Shift+S / screenshots).
  const onPaste = (e) => {
    const items = e.clipboardData?.items;
    if (items) {
      const imageItems = Array.from(items).filter(item => item.type && item.type.startsWith("image/"));
      if (imageItems.length > 0) {
        e.preventDefault();
        const files = imageItems.map(it => it.getAsFile()).filter(Boolean);
        handleFiles(files);
        return;
      }
    }
    const raw = e.clipboardData?.getData("text/plain") ?? "";
    const lines = raw.split("\n");
    if (lines.length <= 5 && raw.length <= 500) return; // short — let browser handle normally
    e.preventDefault();
    const id    = ++pasteCounterRef.current;
    pasteBlocksRef.current.set(id, raw);
    const token = `[paste #${id} +${lines.length} line${lines.length === 1 ? "" : "s"}]`;
    const ta    = taRef.current;
    const start = ta ? ta.selectionStart : text.length;
    const end   = ta ? ta.selectionEnd   : text.length;
    const next  = text.slice(0, start) + token + text.slice(end);
    setText(next);
    // Reposition cursor after the token on next frame (state not flushed yet).
    requestAnimationFrame(() => {
      if (!taRef.current) return;
      const pos = start + token.length;
      taRef.current.selectionStart = taRef.current.selectionEnd = pos;
    });
  };

  const onKey = (e) => {
    if (showSlash) {
      if (e.key === "ArrowDown")  { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)); return; }
      if (e.key === "ArrowUp")    { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === "Escape")     { e.preventDefault(); setText(""); return; }
      if (e.key === "Tab")        { e.preventDefault(); setActiveIdx(i => (i + 1) % filtered.length); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); return; }
    if (e.key === "Escape" && isStreaming) { onAbort(); return; }
    if (e.key === "k" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onOpenCmd(); }
  };

  const hasAttachments = images.length > 0;
  const showWarningBanner = !!(modelWarning || (!supportsImages && hasAttachments));

  return (
    <div
      className={`composer ${planMode ? "plan-on" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes("Files")) {
          e.preventDefault();
        }
      }}
      onDrop={(e) => {
        if (e.dataTransfer?.files?.length > 0) {
          const imageFiles = Array.from(e.dataTransfer.files).filter(f => f.type && f.type.startsWith("image/"));
          if (imageFiles.length > 0) {
            e.preventDefault();
            handleFiles(imageFiles);
          }
        }
      }}
    >
      {planMode && (
        <div className="plan-strip">
          <Icon name="plan" size={12} color="var(--amber)" />
          <span style={{ color: "var(--amber)" }}>plan mode</span>
          <span style={{ color: "var(--fg-3)" }}>· I'll draft before I write</span>
          <button className="btn ghost" onClick={onTogglePlan} style={{ marginLeft: "auto", height: 22 }}>exit</button>
        </div>
      )}

      {showSlash && (
        <div className="slash-pop" ref={listRef}>
          {filtered.map((c, i) => (
            <button key={c.name}
              className={`slash-row${i === clampedIdx ? " active" : ""}`}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={(e) => { e.preventDefault(); execCmd(c); }}>
              <span className="slash-glyph">{c.icon}</span>
              <span className="mono" style={{ color: "var(--accent)" }}>/{c.name}</span>
              <span style={{ color: "var(--fg-3)" }}>{c.hint}</span>
              <span className="chip muted" style={{ marginLeft: "auto" }}>{c.group}</span>
            </button>
          ))}
        </div>
      )}

      {/* Model vision warning banner */}
      {showWarningBanner && (
        <div className="composer-model-warning">
          <Icon name="warn" size={13} color="var(--amber)" />
          <span className="warning-text">
            {modelWarning || `Current model "${currentModel?.name || currentModel?.id || "model"}" does not support image input. Consider switching models.`}
          </span>
          <button type="button" className="btn ghost warning-action" onClick={onOpenModel}>
            <Icon name="bolt" size={11} color="var(--amber)" />
            switch model
          </button>
          {!supportsImages && images.length === 0 && (
            <button
              type="button"
              className="btn ghost warning-action"
              style={{ color: "var(--fg-3)" }}
              onClick={() => fileInputRef.current?.click()}
            >
              upload anyway
            </button>
          )}
          <button
            type="button"
            className="btn icon ghost warning-close"
            onClick={() => setModelWarning(null)}
            title="dismiss"
          >
            <Icon name="close" size={10} />
          </button>
        </div>
      )}

      {/* Attached images preview strip */}
      {hasAttachments && (
        <div className="composer-attachments">
          {images.map(img => (
            <div key={img.id} className="composer-thumb-wrap" title={`${img.name} (${Math.round(img.size / 1024)} KB)`}>
              <img src={img.dataUrl} alt={img.name} className="composer-thumb" />
              <button
                type="button"
                className="composer-thumb-remove"
                title="remove image"
                onClick={(e) => {
                  e.stopPropagation();
                  setImages(prev => prev.filter(item => item.id !== img.id));
                }}
              >
                <Icon name="close" size={9} />
              </button>
              <span className="composer-thumb-size mono">{Math.round(img.size / 1024)}k</span>
            </div>
          ))}
          <button
            type="button"
            className="composer-add-more"
            title="add more images"
            onClick={() => fileInputRef.current?.click()}
          >
            <Icon name="plus" size={12} />
          </button>
        </div>
      )}

      <div className="composer-row">
        <button
          type="button"
          className={`btn icon ghost ${!supportsImages ? "unsupported-vision" : ""}`}
          title={supportsImages ? "attach image (paste screenshot or drag & drop)" : `Current model "${currentModel?.name || ""}" does not support images (click to switch)`}
          onClick={() => {
            if (!supportsImages) {
              setModelWarning(`Current model "${currentModel?.name || currentModel?.id || "model"}" does not support image input. Please switch to a vision-capable model (e.g. Claude 3.5/3.7 Sonnet).`);
            } else {
              fileInputRef.current?.click();
            }
          }}
        >
          <Icon name="image" size={13} color={!supportsImages ? "var(--fg-4)" : "currentColor"} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button type="button" className="btn icon ghost" title="dictate">
          <Icon name="voice" size={13} />
        </button>
        <div className="composer-input">
          <textarea
            ref={taRef}
            rows="1"
            placeholder={
              planMode && !isStreaming
                ? (microcopy?.planTip ?? "describe what to build, or give feedback on the plan…")
                : isStreaming
                  ? microcopy?.streamingTip
                  : (microcopy?.paletteTip ?? "what should we ship?  ·  / for commands  ·  ⌘K for the bridge")
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            onPaste={onPaste}
            className="selectable"
          />
        </div>
        <button className="btn outlined" title="open command bridge (⌘K)" onClick={onOpenCmd}>
          <Icon name="command" size={11} />
          <span className="kbd" style={{ marginLeft: 2 }}>K</span>
        </button>
        {isStreaming ? (
          <>
            {text.trim() && (
              <button className="btn outlined" onClick={send}
                style={{ color: "var(--amber)", borderColor: "color-mix(in oklab, var(--amber) 40%, var(--line))" }}>
                <Icon name="arrow" size={10} color="var(--amber)" /> steer
              </button>
            )}
            <button className="btn danger" onClick={onAbort}>
              <Icon name="stop" size={10} /> abort <span className="kbd">⎋</span>
            </button>
          </>
        ) : (
          <>
            {planMode && (
              <button className="btn outlined" onClick={onApprove}
                style={{ color: "var(--amber)", borderColor: "color-mix(in oklab, var(--amber) 40%, var(--line))" }}>
                <Icon name="play" size={10} color="var(--amber)" /> approve
              </button>
            )}
            <button className="btn primary" onClick={send}
              disabled={!(text.trim() || images.length > 0 || (planMode && annotationCount > 0))}>
              {planMode
                ? `send feedback${annotationCount > 0 ? ` · ${annotationCount} comment${annotationCount !== 1 ? "s" : ""}` : ""}`
                : "send"}
              {" "}<Icon name="arrow" size={11} />
            </button>
          </>
        )}
      </div>

      <div className="composer-foot">
        <button className="composer-pill" onClick={onOpenModel}>
          <span className="dot live" />
          <span style={{ color: "var(--fg-2)" }}>{currentModel?.name}</span>
          <Icon name="chev" size={10} color="var(--fg-4)" />
        </button>
        <button className="composer-pill" onClick={onCycleThinking}>
          <Icon name="thinking" size={11} color="var(--lilac)" />
          <span style={{ color: "var(--fg-2)" }}>thinking · {thinking}</span>
        </button>
        <button className={`composer-pill ${planMode ? "on" : ""}`} onClick={onTogglePlan}>
          <Icon name="plan" size={11} color={planMode ? "var(--amber)" : "var(--fg-3)"} />
          <span style={{ color: planMode ? "var(--amber)" : "var(--fg-2)" }}>plan mode</span>
        </button>
        <div style={{ flex: 1 }} />
        <span className="mono" style={{ color: "var(--fg-4)", fontSize: "var(--d-text-xs)" }}>
          {isStreaming && text.trim() ? "↵ steer · ⎋ abort" : "↵ send · ⇧↵ newline · ⎋ abort"}
        </span>
      </div>
    </div>
  );
}

// ── ⌘K Command bridge — two views: commands → model picker ────────────
//
//  commands view  — lists all slash-commands; /model drills into picker
//  models view    — filterable model list; Esc returns to commands
//
function CommandBridge({
  open,
  onClose,
  onPick,
  onPickModel,
  currentModelId,
  onPickLogin,
  loginProviders,
  initialView = "commands",
  onManageModels,
  models: propModels,
}) {
  const [q, setQ]                   = React.useState("");
  const [view, setView]             = React.useState("commands");
  const [refreshing, setRefreshing] = React.useState(false);
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    if (open) {
      setQ("");
      setView(initialView);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // When model view opens, automatically trigger a background refresh
  React.useEffect(() => {
    if (open && view === "models") {
      window.OMP_BRIDGE?.refreshModels();
    }
  }, [open, view]);

  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape" || !open) return;
      if (view === "models") { if (initialView === "models") onClose(); else { setView("commands"); setQ(""); } }
      else if (view === "login") { if (initialView === "login") onClose(); else { setView("commands"); setQ(""); } }
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, view]);

  if (!open) return null;

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await window.OMP_BRIDGE?.refreshModels();
    } finally {
      setTimeout(() => setRefreshing(false), 500);
    }
  };

  const fil    = (s) => s.toLowerCase().includes(q.toLowerCase());
  const models = (propModels && propModels.length > 0)
    ? propModels
    : (window.OMP_BRIDGE?.models?.length > 0 ? window.OMP_BRIDGE.models : window.OMP_DATA.models) || [];

  // ── Model picker view ──────────────────────────────────────────────
  if (view === "models") {
    const modelHits = models.filter((m) => !q || fil(m.name) || fil(m.id));
    return (
      <div className="bridge-scrim" onClick={onClose}>
        <div className="bridge slide-in" onClick={(e) => e.stopPropagation()}>
          <div className="bridge-input-row">
            <button className="btn icon ghost" title="back"
              onClick={() => { setView("commands"); setQ(""); }}
              style={{ marginRight: 4 }}>
              <Icon name="chevR" size={12} color="var(--fg-3)"
                style={{ transform: "rotate(180deg)", display: "block" }} />
            </button>
            <input ref={inputRef} className="bridge-input mono"
              placeholder="filter models…" value={q}
              onChange={(e) => setQ(e.target.value)} />
            <span className="kbd">esc</span>
          </div>
          <div className="bridge-body">
            <div className="bridge-group">
              <div className="bridge-group-head mono" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                switch model
                <span style={{ color: "var(--fg-4)" }}>
                  tauri:{window.__TAURI__ ? "✓" : "✗"}
                  · connected:{window.OMP_BRIDGE?.isConnected ? "✓" : "✗"}
                  · models:{models.length}
                </span>
                <button className="btn ghost" disabled={refreshing} style={{ marginLeft: "auto", height: 18, fontSize: "var(--d-text-xs)", padding: "0 6px" }}
                  onClick={handleRefresh}>
                  {refreshing ? "refreshing…" : "refresh"}
                </button>
                <button className="btn ghost outlined" style={{ height: 18, fontSize: "var(--d-text-xs)", padding: "0 6px", display: "flex", alignItems: "center", gap: 4 }}
                  onClick={() => { onClose(); onManageModels?.(); }}>
                  <Icon name="cpu" size={10} color="var(--accent)" />
                  manage
                </button>
              </div>
              {modelHits.map((m) => {
                const hasVision = modelSupportsImages(m);
                return (
                  <button key={m.id}
                    className={`bridge-row ${m.id === currentModelId ? "active" : ""}`}
                    onClick={() => { onPickModel(m); onClose(); }}>
                    <span className="bridge-glyph">
                      {m.id === currentModelId
                        ? <Icon name="check" size={10} color="var(--accent)" />
                        : <Icon name="bolt"  size={10} color="var(--cyan)" />}
                    </span>
                    <span style={{ color: m.id === currentModelId ? "var(--accent)" : "var(--fg)" }}>{m.name}</span>
                    <span className="mono" style={{ color: "var(--fg-4)" }}>{m.id}</span>
                    <span style={{ color: "var(--fg-3)" }}>· {m.note}</span>
                    {hasVision && (
                      <span className="chip" style={{ color: "var(--cyan)", borderColor: "color-mix(in oklab, var(--cyan) 30%, transparent)", fontSize: "10px", padding: "1px 5px", display: "inline-flex", alignItems: "center", gap: 3 }}>
                        <Icon name="image" size={9} color="var(--cyan)" />
                        vision
                      </span>
                    )}
                    <span className="chip muted" style={{ marginLeft: "auto" }}>{m.latency}ms</span>
                  </button>
                );
              })}
              {modelHits.length === 0 && <div className="bridge-empty">no models found</div>}
            </div>
          </div>
          <div className="bridge-foot mono">
            <span className="kbd">↑↓</span> navigate
            <span className="kbd">↵</span> switch
            <span className="kbd">esc</span> back
          </div>
        </div>
      </div>
    );
  }

  // ── Login view ───────────────────────────────────────────────────────────
  if (view === "login") {
    return (
      <div className="bridge-scrim" onClick={onClose}>
        <div className="bridge slide-in" onClick={(e) => e.stopPropagation()}>
          <div className="bridge-input-row">
            <button className="btn icon ghost" title="back"
              onClick={() => { setView("commands"); setQ(""); }}
              style={{ marginRight: 4 }}>
              <Icon name="chevR" size={12} color="var(--fg-3)"
                style={{ transform: "rotate(180deg)", display: "block" }} />
            </button>
            <span className="bridge-input mono" style={{ cursor: "default", lineHeight: "normal" }}>
              login
            </span>
            <span className="kbd">esc</span>
          </div>
          <div className="bridge-body">
            <div className="bridge-group">
              <div className="bridge-group-head mono">select provider</div>
              {loginProviders === null && (
                <div className="bridge-empty" style={{ padding: "16px 32px" }}>loading providers…</div>
              )}
              {loginProviders !== null && loginProviders.length === 0 && (
                <div className="bridge-empty">no providers available</div>
              )}
              {loginProviders !== null && loginProviders.map((p) => (
                <button key={p.id}
                  className={`bridge-row ${p.authenticated ? "active" : ""}`}
                  onClick={() => { if (p.available) { onPickLogin(p); onClose(); } }}>
                  <span className="bridge-glyph">
                    {p.authenticated
                      ? <Icon name="check" size={10} color="var(--accent)" />
                      : <Icon name="bolt"  size={10} color={p.available ? "var(--cyan)" : "var(--fg-5)"} />}
                  </span>
                  <span style={{ color: p.authenticated ? "var(--accent)" : p.available ? "var(--fg)" : "var(--fg-4)" }}>
                    {p.name}
                  </span>
                  <span className="mono" style={{ color: "var(--fg-4)" }}>{p.id}</span>
                  <span className="chip muted" style={{ marginLeft: "auto" }}>
                    {p.authenticated ? "logged in" : p.available ? "available" : "unavailable"}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="bridge-foot mono">
            <span className="kbd">↵</span> authenticate
            <span className="kbd">esc</span> back
          </div>
        </div>
      </div>
    );
  }

  // ── Commands view ──────────────────────────────────────────────────
  const cmds    = window.OMP_DATA.commands;
  const cmdHits = cmds.filter((c) => !q || fil(c.name) || fil(c.hint));
  const groups  = {};
  cmdHits.forEach((c) => { (groups[c.group] = groups[c.group] || []).push(c); });
  const activeModelName = models.find((m) => m.id === currentModelId)?.name ?? "–";

  return (
    <div className="bridge-scrim" onClick={onClose}>
      <div className="bridge slide-in" onClick={(e) => e.stopPropagation()}>
        <div className="bridge-input-row">
          <Icon name="command" size={14} color="var(--accent)" />
          <input ref={inputRef} className="bridge-input mono"
            placeholder="cross the bridge — type to filter…" value={q}
            onChange={(e) => setQ(e.target.value)} />
          <span className="kbd">esc</span>
        </div>
        <div className="bridge-body">
          {Object.entries(groups).map(([g, list]) => (
            <div key={g} className="bridge-group">
              <div className="bridge-group-head mono">{g.toLowerCase()}</div>
              {list.map((c) => {
                const isModel = c.name === "model";
                const isLogin = c.name === "login";
                const drillsIn = isModel || isLogin;
                return (
                  <button key={c.name} className="bridge-row"
                    onClick={() => {
                      if (isModel) { setQ(""); setView("models"); }
                      else if (isLogin) { setQ(""); setView("login"); }
                      else if (c.name === "models") { onManageModels?.(); onClose(); }
                      else { onPick(c); onClose(); }
                    }}>
                    <span className="bridge-glyph">
                      {["clock", "cog", "bolt", "cpu"].includes(c.icon) ? <Icon name={c.icon} size={11} /> : c.icon}
                    </span>
                    <span className="mono" style={{ color: "var(--accent)" }}>/{c.name}</span>
                    <span style={{ color: "var(--fg-3)" }}>{c.hint}</span>
                    {isModel && (
                      <span className="mono" style={{ color: "var(--fg-4)", marginLeft: "auto" }}>
                        {activeModelName}
                      </span>
                    )}
                    <Icon name={drillsIn ? "chevR" : "arrow"} size={11} color="var(--fg-4)"
                      style={{ marginLeft: drillsIn ? 8 : "auto" }} />
                  </button>
                );
              })}
            </div>
          ))}
          {cmdHits.length === 0 && (
            <div className="bridge-empty">no luck — try `plan`, `branch`, `model`…</div>
          )}
        </div>
        <div className="bridge-foot mono">
          <span className="kbd">↑↓</span> navigate
          <span className="kbd">↵</span> run
          <span className="kbd">esc</span> close
          <span style={{ marginLeft: "auto", color: "var(--fg-4)" }}>{window.OMP_DATA.microcopy.paletteTip}</span>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Composer, CommandBridge });
