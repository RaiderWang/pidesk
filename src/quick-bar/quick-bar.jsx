/* quick-bar.jsx — React component for the Quick Bar overlay.
   This runs in its own webview; it does NOT load live.js.
   Communication with the main window goes through Tauri events:
     quickbar://submit  → main window (text, newSession, images)
     quickbar://abort   → main window
     quickbar://delta   ← main window { html, markdown } streaming snapshot
     quickbar://done    ← main window (stream finished)
*/

const { useState, useRef, useEffect, useCallback } = React;

const EMPTY_RESULT = { html: "", markdown: "" };

function QuickBarApp() {
  const [text, setText] = useState("");
  const [result, setResult] = useState(EMPTY_RESULT);
  const [streaming, setStreaming] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [screenMode, setScreenMode] = useState("off"); // "off" | "auto" | "region"
  const [screenThumb, setScreenThumb] = useState(null); // { base64, mimeType, width, height, dataUrl }
  const [capturing, setCapturing] = useState(false);
  const [screenshotShortcut, setScreenshotShortcut] = useState(() => {
    const t = window.loadTweaksFromStorage?.();
    return t?.screenshotShortcut || "Alt+S";
  });
  const inputRef = useRef(null);

  const triggerRegionCapture = useCallback(() => {
    if (window.__TAURI__) {
      window.__TAURI__.core.invoke("start_region_capture", { target: "quick-bar" }).catch((err) => {
        console.error("[quickbar] region capture failed:", err);
      });
    }
  }, []);

  // Reset state when the Quick Bar is freshly shown via toggle_quick_bar.
  useEffect(() => {
    if (!window.__TAURI__) return;
    let unsub;
    window.__TAURI__.event.listen("quickbar://show", () => {
      setText("");
      setResult(EMPTY_RESULT);
      setStreaming(false);
      setSubmitted(false);
      setCopied(false);
      setScreenMode("off");
      setScreenThumb(null);
      setCapturing(false);
      setTimeout(() => inputRef.current?.focus(), 50);

      const t = window.loadTweaksFromStorage?.();
      if (t) {
        if (window.applyAppearance) window.applyAppearance(t);
        if (t.screenshotShortcut) setScreenshotShortcut(t.screenshotShortcut);
      }
    }).then(u => { unsub = u; });
    setTimeout(() => inputRef.current?.focus(), 50);
    return () => unsub?.();
  }, []);

  // Listen for streaming deltas, done signal, and shortcut events.
  useEffect(() => {
    if (!window.__TAURI__) return;
    const { listen } = window.__TAURI__.event;
    const unsubs = [];

    listen("quickbar://delta", (ev) => {
      setResult(ev.payload ?? EMPTY_RESULT);
      setStreaming(true);
    }).then(u => unsubs.push(u));

    listen("quickbar://done", () => {
      setStreaming(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }).then(u => unsubs.push(u));

    // Listen for manual region screenshot result
    listen("quickbar://region-result", (ev) => {
      const payload = ev.payload;
      if (!payload?.base64) return;
      const mime = payload.mimeType || "image/jpeg";
      setScreenThumb({
        base64: payload.base64,
        mimeType: mime,
        dataUrl: `data:${mime};base64,${payload.base64}`,
        width: payload.width,
        height: payload.height,
      });
      setScreenMode("region");
      setTimeout(() => inputRef.current?.focus(), 50);
    }).then(u => unsubs.push(u));

    // Listen for shortcut update pushed by Tauri backend
    listen("shortcuts://updated", (ev) => {
      if (ev.payload?.screenshot) {
        setScreenshotShortcut(ev.payload.screenshot);
      }
    }).then(u => unsubs.push(u));

    // Listen for global screenshot hotkey pressed when Quick Bar is visible
    listen("quickbar://shortcut-screen", () => {
      setScreenMode(prev => {
        if (prev === "auto") {
          setScreenThumb(null);
          return "off";
        }
        triggerRegionCapture();
        return prev;
      });
    }).then(u => unsubs.push(u));

    // Initial query for persisted shortcuts
    window.__TAURI__.core.invoke("get_shortcuts").then((sc) => {
      if (sc?.screenshot) setScreenshotShortcut(sc.screenshot);
    }).catch(() => {});

    return () => unsubs.forEach(u => u());
  }, [triggerRegionCapture]);

  const handleSubmit = useCallback(async (opts) => {
    const trimmed = text.trim();
    const hasThumb = screenMode === "region" && screenThumb;
    const isAuto = screenMode === "auto";

    if (!trimmed && !hasThumb && !isAuto) return;
    if (!window.__TAURI__ || capturing) return;

    setSubmitted(true);
    setResult(EMPTY_RESULT);
    setCopied(false);
    setStreaming(true);
    setText("");

    let images = [];
    if (isAuto) {
      setCapturing(true);
      try {
        const b64 = await window.__TAURI__.core.invoke("capture_screen");
        if (b64) {
          images.push({ type: "image", data: b64, mimeType: "image/jpeg" });
        }
      } catch (err) {
        console.error("[quickbar] auto capture failed:", err);
      } finally {
        setCapturing(false);
      }
    } else if (hasThumb) {
      images.push({
        type: "image",
        data: screenThumb.base64,
        mimeType: screenThumb.mimeType || "image/jpeg",
      });
      setScreenThumb(null);
      setScreenMode("off");
    }

    window.__TAURI__.event.emitTo("main", "quickbar://submit", {
      text: trimmed,
      newSession: opts?.newSession ?? false,
      images,
    });
  }, [text, screenMode, screenThumb, capturing]);

  const handleAbort = useCallback(() => {
    if (window.__TAURI__) {
      window.__TAURI__.event.emitTo("main", "quickbar://abort", {});
    }
    setStreaming(false);
  }, []);

  const handleCopy = useCallback(() => {
    if (!result.markdown) return;
    navigator.clipboard?.writeText(result.markdown).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [result.markdown]);

  const handleToggleScreen = useCallback(() => {
    if (screenMode === "auto") {
      setScreenMode("off");
      setScreenThumb(null);
    } else if (screenMode === "region") {
      setScreenThumb(null);
      setScreenMode("auto");
    } else {
      setScreenMode("auto");
    }
  }, [screenMode]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Escape") {
      if (streaming) {
        handleAbort();
      } else {
        window.__TAURI__?.core.invoke("hide_quick_bar").catch(() => {});
      }
      return;
    }

    // Configured screenshot shortcut (e.g. Alt+S)
    const isScreenshotMatch = window.ShortcutUtil
      ? window.ShortcutUtil.matchesShortcut(e, screenshotShortcut)
      : (e.altKey && (e.key === "s" || e.key === "S" || e.code === "KeyS"));

    if (isScreenshotMatch) {
      e.preventDefault();
      if (screenMode === "auto") {
        setScreenMode("off");
        setScreenThumb(null);
      } else {
        triggerRegionCapture();
      }
      return;
    }

    // Ctrl+Enter → escalate to full PiDesk (show main, hide bar)
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (window.__TAURI__) {
        window.__TAURI__.event.emitTo("main", "quickbar://escalate", { text: text.trim() });
        window.__TAURI__.core.invoke("hide_quick_bar").catch(() => {});
      }
      return;
    }

    // Shift+Enter → send to a new session
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      handleSubmit({ newSession: true });
      return;
    }

    // Enter → send to current session
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  }, [text, streaming, screenMode, screenshotShortcut, handleSubmit, handleAbort, triggerRegionCapture]);

  useEffect(() => {
    if (!window.__TAURI__) return;
    const root = document.querySelector(".qb-root");
    if (!root) return;
    const observer = new ResizeObserver(() => {
      const h = Math.ceil(root.getBoundingClientRect().height) + 2;
      window.__TAURI__.core.invoke("set_quick_bar_height", { height: h }).catch(() => {});
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [submitted, result, screenThumb]);

  const placeholder = submitted
    ? (window.t?.("quickbar.placeholder.followup") ?? "Follow up…")
    : (screenMode === "auto"
        ? (window.t?.("quickbar.placeholder.screen") ?? "Ask about this screen…")
        : (window.t?.("quickbar.placeholder") ?? "Ask omp…"));

  const displayScreenshotKey = window.ShortcutUtil
    ? window.ShortcutUtil.formatDisplayShortcut(screenshotShortcut)
    : screenshotShortcut;

  return (
    React.createElement("div", { className: "qb-root" },
      React.createElement("div", { className: "qb-input-row" },
        React.createElement("svg", {
          className: "qb-icon", viewBox: "0 0 20 20", fill: "none",
          stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round"
        },
          React.createElement("circle", { cx: "9", cy: "9", r: "6" }),
          React.createElement("line", { x1: "13.5", y1: "13.5", x2: "17", y2: "17" })
        ),
        React.createElement("input", {
          ref: inputRef,
          className: "qb-input",
          type: "text",
          placeholder,
          value: text,
          onChange: (e) => setText(e.target.value),
          onKeyDown: handleKeyDown,
          autoFocus: true,
        }),
        React.createElement("button", {
          type: "button",
          className: `qb-screen-btn qb-screen-${screenMode}` + (capturing ? " qb-capturing" : ""),
          title: screenMode === "auto"
            ? (window.t?.("quickbar.screen.tooltip.auto") ?? "Auto-screenshot on send (Alt+S for region)")
            : screenMode === "region"
              ? (window.t?.("quickbar.screen.tooltip.region") ?? "Region captured")
              : (window.t?.("quickbar.screen.tooltip.off") ?? "Ask about screen"),
          onClick: handleToggleScreen,
        },
          React.createElement("svg", {
            width: 16, height: 16, viewBox: "0 0 20 20", fill: "none",
            stroke: "currentColor", strokeWidth: "1.75", strokeLinecap: "round", strokeLinejoin: "round",
          },
            React.createElement("path", { d: "M3 7a2 2 0 0 1 2-2h2l1.5-2h3L13 5h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" }),
            React.createElement("circle", { cx: "10", cy: "11.5", r: "3" })
          )
        )
      ),
      screenThumb && React.createElement("div", { className: "qb-thumb-row" },
        React.createElement("div", { className: "qb-thumb-wrap" },
          React.createElement("img", {
            src: screenThumb.dataUrl,
            alt: "Screen selection",
            className: "qb-thumb-img",
          }),
          React.createElement("button", {
            type: "button",
            className: "qb-thumb-remove",
            title: window.t?.("quickbar.removeImage") ?? "remove screenshot",
            onClick: () => {
              setScreenThumb(null);
              setScreenMode("off");
              inputRef.current?.focus();
            },
          },
            React.createElement("svg", {
              width: 10, height: 10, viewBox: "0 0 10 10", fill: "none",
              stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round",
            },
              React.createElement("line", { x1: "2", y1: "2", x2: "8", y2: "8" }),
              React.createElement("line", { x1: "8", y1: "2", x2: "2", y2: "8" })
            )
          )
        ),
        React.createElement("span", { className: "qb-thumb-label" },
          `${screenThumb.width} × ${screenThumb.height}`
        )
      ),
      submitted && React.createElement("div", { className: "qb-result-wrap" },
        React.createElement("div", {
          className: "qb-result md-content" + (streaming ? " qb-streaming" : ""),
          dangerouslySetInnerHTML: result.html ? { __html: result.html } : undefined,
        }, result.html ? undefined : (streaming ? (window.t?.("quickbar.thinking") ?? "thinking…") : "")),
        result.markdown && React.createElement("button", {
          className: "qb-copy-btn",
          title: copied
            ? (window.t?.("quickbar.copied") ?? "copied!")
            : (window.t?.("quickbar.copy") ?? "copy"),
          onClick: handleCopy,
        },
          copied
            ? React.createElement("svg", {
                width: 12, height: 12, viewBox: "0 0 12 12", fill: "none",
                stroke: "currentColor", strokeWidth: "2",
                strokeLinecap: "round", strokeLinejoin: "round",
              },
                React.createElement("polyline", { points: "2,6 5,9 10,3" })
              )
            : React.createElement("svg", {
                width: 12, height: 12, viewBox: "0 0 12 12", fill: "none",
                stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round",
              },
                React.createElement("rect", { x: "3.5", y: "0.5", width: "8", height: "8", rx: "1.5" }),
                React.createElement("rect", { x: "0.5", y: "3.5", width: "8", height: "8", rx: "1.5" })
              )
        )
      ),
      !streaming && React.createElement("div", { className: "qb-hint" },
        React.createElement("span", null,
          React.createElement("kbd", null, "Enter"), " ",
          window.t?.("quickbar.hint.send") ?? "send",
          "  ",
          React.createElement("kbd", null, displayScreenshotKey), " ",
          window.t?.("quickbar.hint.region") ?? "region capture",
          "  ",
          React.createElement("kbd", null, "Shift+Enter"), " ",
          window.t?.("quickbar.hint.newSession") ?? "new session",
        ),
        React.createElement("span", null,
          React.createElement("kbd", null, "Ctrl+Enter"), " ",
          window.t?.("quickbar.hint.escalate") ?? "open in PiDesk",
          "  ",
          React.createElement("kbd", null, "Esc"), " ",
          window.t?.("quickbar.hint.close") ?? "close",
        )
      )
    )
  );
}

Object.assign(window, { QuickBarApp });
