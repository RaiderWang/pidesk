/* quick-bar.jsx — React component for the Quick Bar overlay.
   This runs in its own webview; it does NOT load live.js.
   Communication with the main window goes through Tauri events:
     quickbar://submit  → main window (text, newSession)
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
  const inputRef = useRef(null);

  // Reset state when the Quick Bar is freshly shown via toggle_quick_bar.
  // Rust emits "quickbar://show" right before win.show(), so the frontend
  // clears previous input/result and focuses the input.
  // Also re-applies appearance in case tweaks changed while QB was hidden.
  useEffect(() => {
    if (!window.__TAURI__) return;
    let unsub;
    window.__TAURI__.event.listen("quickbar://show", () => {
      setText("");
      setResult(EMPTY_RESULT);
      setStreaming(false);
      setSubmitted(false);
      setCopied(false);
      setTimeout(() => inputRef.current?.focus(), 50);
      // Belt-and-suspenders: re-read from localStorage on every open.
      const t = window.loadTweaksFromStorage?.();
      if (t && window.applyAppearance) window.applyAppearance(t);
    }).then(u => { unsub = u; });
    setTimeout(() => inputRef.current?.focus(), 50);
    return () => unsub?.();
  }, []);

  // Listen for streaming deltas and done signal from the main window.
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

    return () => unsubs.forEach(u => u());
  }, []);

  const handleSubmit = useCallback((opts) => {
    const trimmed = text.trim();
    if (!trimmed || !window.__TAURI__) return;
    setSubmitted(true);
    setResult(EMPTY_RESULT);
    setCopied(false);
    setStreaming(true);
    setText("");
    window.__TAURI__.event.emitTo("main", "quickbar://submit", {
      text: trimmed,
      newSession: opts?.newSession ?? false,
    });
  }, [text]);

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

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Escape") {
      if (streaming) {
        handleAbort();
      } else {
        window.__TAURI__?.core.invoke("hide_quick_bar").catch(() => {});
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
  }, [text, streaming, handleSubmit, handleAbort]);

  // Dynamically sync window height to actual content height so the
  // transparent window never shows empty bordered space.
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
  }, [submitted, result]);

  const placeholder = submitted
    ? (window.t?.("quickbar.placeholder.followup") ?? "Follow up…")
    : (window.t?.("quickbar.placeholder") ?? "Ask omp…");

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
        })
      ),
      submitted && React.createElement("div", { className: "qb-result-wrap" },
        React.createElement("div", {
          // "md-content" pulls in the same markdown typography/code-block
          // styles as the main chat view (see quick-bar.html + platform.css)
          // — the HTML in `result.html` was already rendered via marked/hljs
          // in the main window (quickbar-host.js) before it got here.
          className: "qb-result md-content" + (streaming ? " qb-streaming" : ""),
          dangerouslySetInnerHTML: result.html ? { __html: result.html } : undefined,
        }, result.html ? undefined : (streaming ? (window.t?.("quickbar.thinking") ?? "thinking…") : "")),
        // Copy button — only visible when there is text to copy.
        result.markdown && React.createElement("button", {
          className: "qb-copy-btn",
          title: copied
            ? (window.t?.("quickbar.copied") ?? "copied!")
            : (window.t?.("quickbar.copy") ?? "copy"),
          onClick: handleCopy,
        },
          copied
            // Check icon when recently copied
            ? React.createElement("svg", {
                width: 12, height: 12, viewBox: "0 0 12 12", fill: "none",
                stroke: "currentColor", strokeWidth: "2",
                strokeLinecap: "round", strokeLinejoin: "round",
              },
                React.createElement("polyline", { points: "2,6 5,9 10,3" })
              )
            // Copy icon (two overlapping squares)
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
