/* ═════════════════════════════════════════════════════════════════════
   composer.jsx — input area + slash palette
   ═════════════════════════════════════════════════════════════════════ */

const { Icon, useComposerRestore: _useComposerRestore } = window;

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

function renderCommandGlyph(icon, size = 11) {
  if (!icon) return null;
  const isNamedIcon = (typeof Icon !== "undefined" && typeof Icon?.has === "function")
    ? Icon.has(icon)
    : ["clock", "cog", "bolt", "cpu", "diff2", "diff", "plan"].includes(icon);
  return isNamedIcon ? <Icon name={icon} size={size} /> : icon;
}

// ── The composer (input + plan/steer modes + send) ────────────────────
function Composer({ onSend, onPick, planMode, onTogglePlan, onOpenCmd, onOpenModel, currentModel, thinking, onCycleThinking, isStreaming, onAbort, onApprove, annotationCount = 0, microcopy, screenshotShortcut: screenshotShortcutProp, agentError, availableThinkingLevels }) {
  const [text, setText]             = React.useState("");
  const [activeIdx, setActiveIdx]   = React.useState(0);
  const [images, setImages]         = React.useState([]);
  const [modelWarning, setModelWarning] = React.useState(null);
  const [fallbackShortcut, setFallbackShortcut] = React.useState(() => {
    const t = window.loadTweaksFromStorage?.();
    return t?.screenshotShortcut || "Alt+S";
  });
  const effectiveShortcut = screenshotShortcutProp || fallbackShortcut || "Alt+S";

  const taRef        = React.useRef(null);
  const listRef      = React.useRef(null);
  const fileInputRef = React.useRef(null);
  // paste blocks: id → raw content; collapsed in textarea as [paste #N +K lines]
  const pasteBlocksRef   = React.useRef(new Map());
  const pasteCounterRef  = React.useRef(0);

  // "Undo message" hands the original text/images back through this event.
  _useComposerRestore({ setText, setImages, taRef });

  const cmds = window.OMP_DATA?.commands || [];
  const supportsImages = React.useMemo(() => modelSupportsImages(currentModel), [currentModel]);
  const isThinkingSupported = React.useMemo(() => {
    if (Array.isArray(availableThinkingLevels)) {
      return availableThinkingLevels.length > 1;
    }
    return Boolean(currentModel?.reasoning || currentModel?.thinking);
  }, [availableThinkingLevels, currentModel]);

  const supportsImagesRef = React.useRef(supportsImages);
  supportsImagesRef.current = supportsImages;
  const currentModelRef = React.useRef(currentModel);
  currentModelRef.current = currentModel;

  // Clear warning if user switches to a model that supports vision
  React.useEffect(() => {
    if (supportsImages && modelWarning) {
      setModelWarning(null);
    }
  }, [supportsImages, modelWarning]);

  // Listen for screenshot results delivered to the main window (mounted once)
  React.useEffect(() => {
    if (!window.__TAURI__) return;
    let cancelled = false;
    let unlistenResult = null;
    let unlistenShortcut = null;

    window.__TAURI__.event.listen("main://screenshot-result", (ev) => {
      const payload = ev.payload;
      if (!payload?.base64) return;
      const mime = payload.mimeType || "image/jpeg";
      const dataUrl = `data:${mime};base64,${payload.base64}`;
      const approxSize = Math.round(payload.base64.length * 0.75);

      setImages(prev => {
        // Prevent duplicate screenshot thumbnails if identical image payload is received
        if (prev.some(img => img.data === payload.base64)) {
          return prev;
        }
        return [
          ...prev,
          {
            id: 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            name: `screenshot-${payload.width}x${payload.height}.jpg`,
            size: approxSize,
            mimeType: mime,
            dataUrl,
            data: payload.base64,
          }
        ];
      });

      const curSupports = supportsImagesRef.current;
      const curModel = currentModelRef.current;
      if (!curSupports) {
        setModelWarning(
          window.t
            ? window.t("composer.warn.vision", { model: curModel?.name || curModel?.id || "model" })
            : `Current model "${curModel?.name || curModel?.id || "model"}" may not natively support images — omp will use tools to read them.`
        );
      }
      requestAnimationFrame(() => taRef.current?.focus());
    }).then(u => {
      if (cancelled) {
        u();
      } else {
        unlistenResult = u;
      }
    });

    if (!screenshotShortcutProp) {
      window.__TAURI__.event.listen("shortcuts://updated", (ev) => {
        if (ev.payload?.screenshot) {
          setFallbackShortcut(ev.payload.screenshot);
        }
      }).then(u => {
        if (cancelled) {
          u();
        } else {
          unlistenShortcut = u;
        }
      });

      window.__TAURI__.core.invoke("get_screenshot_shortcut").then((sc) => {
        if (!cancelled && sc) setFallbackShortcut(sc);
      }).catch(() => {});
    }

    return () => {
      cancelled = true;
      if (unlistenResult) unlistenResult();
      if (unlistenShortcut) unlistenShortcut();
    };
  }, [screenshotShortcutProp]);

  // Derive slash state inline — no useEffect, no stale flicker
  const slashQ = text.startsWith("/") ? text.slice(1).split(" ")[0].toLowerCase() : null;
  const filtered = slashQ !== null
    ? cmds.filter(c => !slashQ || c.name.startsWith(slashQ) || c.name.includes(slashQ) || c.hint?.toLowerCase().includes(slashQ))
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
      setModelWarning(window.t ? window.t("composer.warn.vision", { model: currentModel?.name || currentModel?.id || "model" }) : `Current model "${currentModel?.name || currentModel?.id || "model"}" may not natively support images — omp will use tools to read them.`);
    }
  };

  const send = () => {
    // If the slash popup is open, Enter executes the highlighted command
    if (showSlash) { execCmd(filtered[clampedIdx]); return; }
    const canSend = text.trim() || images.length > 0 || (planMode && annotationCount > 0);
    if (!canSend) return;

    // Intercept bare /review command (without PR URL)
    const trimmed = text.trim();
    if (/^\/review(\s|$)/.test(trimmed)) {
      const rest = trimmed.slice(7).trim();
      const hasUrl = /https?:\/\//i.test(rest);
      if (!hasUrl) {
        // Anything after `/review` becomes the drawer's "review focus" text.
        window.OMP_BRIDGE?.openReviewDrawer?.({ focus: rest });
        setText("");
        setImages([]);
        return;
      }
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
    // Ctrl/Cmd+K is handled by the global shortcut hook (app/use-global-shortcuts).
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
              <span className="slash-glyph">{renderCommandGlyph(c.icon, 11)}</span>
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
            {modelWarning || (window.t ? window.t("composer.warn.vision", { model: currentModel?.name || currentModel?.id || "model" }) : `Current model "${currentModel?.name || currentModel?.id || "model"}" does not support image input. Consider switching models.`)}
          </span>
          <button type="button" className="btn ghost warning-action" onClick={onOpenModel}>
            <Icon name="bolt" size={11} color="var(--amber)" />
            {window.t ? window.t("composer.warn.switchModel", null, "switch model") : "switch model"}
          </button>
          <button
            type="button"
            className="btn icon ghost warning-close"
            onClick={() => setModelWarning(null)}
            title={window.t ? window.t("composer.warn.dismiss", null, "dismiss") : "dismiss"}
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
        {window.ComposerImageMenu ? (
          <window.ComposerImageMenu
            onUploadClick={() => {
              if (!supportsImages) {
                setModelWarning(
                  window.t
                    ? window.t("composer.warn.vision", { model: currentModel?.name || currentModel?.id || "model" })
                    : `Current model "${currentModel?.name || currentModel?.id || "model"}" may not natively support images — omp will use tools to read them.`
                );
              }
              fileInputRef.current?.click();
            }}
            onCaptureClick={() => {
              if (!supportsImages) {
                setModelWarning(
                  window.t
                    ? window.t("composer.warn.vision", { model: currentModel?.name || currentModel?.id || "model" })
                    : `Current model "${currentModel?.name || currentModel?.id || "model"}" may not natively support images — omp will use tools to read them.`
                );
              }
              if (window.__TAURI__) {
                window.__TAURI__.core.invoke("start_region_capture", { target: "main" }).catch((err) => {
                  console.error("[composer] region capture failed:", err);
                });
              }
            }}
            supportsImages={supportsImages}
            shortcutText={effectiveShortcut}
            title={
              supportsImages
                ? (window.t ? window.t("composer.imageMenu.trigger", null, "Add image or screenshot") : "Add image or screenshot")
                : (window.t ? window.t("composer.unsupportedVision", { model: currentModel?.name || "" }) : `Current model "${currentModel?.name || ""}" may not natively support images — omp can use tools to read them`)
            }
          />
        ) : (
          <button
            type="button"
            className={`btn icon ghost ${!supportsImages ? "unsupported-vision" : ""}`}
            title={supportsImages
              ? (window.t ? window.t("composer.attach", null, "attach image (paste screenshot or drag & drop)") : "attach image (paste screenshot or drag & drop)")
              : (window.t ? window.t("composer.unsupportedVision", { model: currentModel?.name || "" }) : `Current model "${currentModel?.name || ""}" may not natively support images — omp can use tools to read them`)}
            onClick={() => {
              if (!supportsImages) {
                setModelWarning(window.t ? window.t("composer.warn.vision", { model: currentModel?.name || currentModel?.id || "model" }) : `Current model "${currentModel?.name || currentModel?.id || "model"}" may not natively support images — omp will use tools to read them.`);
              }
              fileInputRef.current?.click();
            }}
          >
            <Icon name="image" size={13} color={!supportsImages ? "var(--fg-4)" : "currentColor"} />
          </button>
        )}
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
        <button
          type="button"
          className="btn icon ghost"
          title={window.t ? window.t("review.title", null, "Code Review") : "Code Review"}
          onClick={() => window.OMP_BRIDGE?.openReviewDrawer?.()}
        >
          <Icon name="diff2" size={13} />
        </button>
        <div className="composer-input">
          <textarea
            ref={taRef}
            rows="1"
            placeholder={
              agentError
                ? (window.t ? window.t("composer.placeholder.agentError", null, "Agent process is not running. Check the error above or click Retry to reconnect.") : "Agent process is not running. Check the error above or click Retry to reconnect.")
                : planMode && !isStreaming
                  ? (window.t ? window.t("composer.placeholder.plan", null, microcopy?.planTip) : (microcopy?.planTip ?? "describe what to build, or give feedback on the plan…"))
                  : isStreaming
                    ? (window.t ? window.t("composer.placeholder.streaming", null, microcopy?.streamingTip) : microcopy?.streamingTip)
                    : (window.t ? window.t("composer.placeholder.default", null, microcopy?.paletteTip) : (microcopy?.paletteTip ?? "what should we ship?  ·  / for commands  ·  ⌘K for the bridge"))
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            onPaste={onPaste}
            className="selectable"
          />
        </div>
        <button className="btn outlined" title={window.t ? window.t("composer.bridgeKbd", null, "open command bridge (⌘K)") : "open command bridge (⌘K)"} onClick={onOpenCmd}>
          <Icon name="command" size={11} />
          <span className="kbd" style={{ marginLeft: 2 }}>K</span>
        </button>
        {isStreaming ? (
          <>
            {text.trim() && (
              <button className="btn outlined" onClick={send}
                style={{ color: "var(--amber)", borderColor: "color-mix(in oklab, var(--amber) 40%, var(--line))" }}>
                <Icon name="arrow" size={10} color="var(--amber)" /> {window.t ? window.t("composer.steer", null, "steer") : "steer"}
              </button>
            )}
            <button className="btn danger" onClick={onAbort}>
              <Icon name="stop" size={10} /> {window.t ? window.t("composer.abort", null, "abort") : "abort"} <span className="kbd">⎋</span>
            </button>
          </>
        ) : (
          <>
            {planMode && (
              <button className="btn outlined" onClick={onApprove}
                style={{ color: "var(--amber)", borderColor: "color-mix(in oklab, var(--amber) 40%, var(--line))" }}>
                <Icon name="play" size={10} color="var(--amber)" /> {window.t ? window.t("composer.approve", null, "approve") : "approve"}
              </button>
            )}
            <button className="btn primary" onClick={send}
              disabled={!(text.trim() || images.length > 0 || (planMode && annotationCount > 0))}>
              {planMode
                ? `${window.t ? window.t("composer.sendFeedback", null, "send feedback") : "send feedback"}${annotationCount > 0 ? ` · ${window.t ? window.t(annotationCount === 1 ? "composer.comment" : "composer.comments", { count: annotationCount }, `${annotationCount} comment${annotationCount !== 1 ? "s" : ""}`) : `${annotationCount} comments`}` : ""}`
                : (window.t ? window.t("composer.send", null, "send") : "send")}
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
        <button
          className={`composer-pill ${!isThinkingSupported ? "disabled" : ""}`}
          onClick={isThinkingSupported ? onCycleThinking : undefined}
          disabled={!isThinkingSupported}
          title={
            !isThinkingSupported
              ? (window.t ? window.t("composer.thinkingUnsupported", null, "Thinking mode is not supported by current model") : "Thinking mode is not supported by current model")
              : (window.t ? window.t("composer.thinking", { level: thinking || "off" }, `thinking · ${thinking || "off"}`) : `thinking · ${thinking || "off"}`)
          }
        >
          <Icon name="thinking" size={11} color={!isThinkingSupported ? "var(--fg-4)" : "var(--lilac)"} />
          <span style={{ color: !isThinkingSupported ? "var(--fg-4)" : "var(--fg-2)" }}>
            {window.t ? window.t("composer.thinking", { level: thinking || "off" }, `thinking · ${thinking || "off"}`) : `thinking · ${thinking || "off"}`}
          </span>
        </button>
        <button className={`composer-pill ${planMode ? "on" : ""}`} onClick={onTogglePlan}>
          <Icon name="plan" size={11} color={planMode ? "var(--amber)" : "var(--fg-3)"} />
          <span style={{ color: planMode ? "var(--amber)" : "var(--fg-2)" }}>
            {window.t ? window.t("composer.planMode", null, "plan mode") : "plan mode"}
          </span>
        </button>
        <div style={{ flex: 1 }} />
        <span className="mono" style={{ color: "var(--fg-4)", fontSize: "var(--d-text-xs)" }}>
          {isStreaming && text.trim()
            ? (window.t ? window.t("composer.hints.steer", null, "↵ steer · ⎋ abort") : "↵ steer · ⎋ abort")
            : (window.t ? window.t("composer.hints.normal", null, "↵ send · ⇧↵ newline · ⎋ abort") : "↵ send · ⇧↵ newline · ⎋ abort")}
        </span>
      </div>
    </div>
  );
}

Object.assign(window, { Composer, modelSupportsImages, renderCommandGlyph });
