// overlay.js — Region selection canvas overlay for screenshots.
// Listens for the frozen screen image from Rust, draws dim layer,
// tracks mouse drag rectangle, and sends selection coords to Rust.

(function () {
  "use strict";

  const canvas = document.getElementById("screen-canvas");
  const ctx = canvas.getContext("2d");
  const hintBubble = document.getElementById("hint-bubble");
  const hintText = document.getElementById("hint-text");

  if (hintText) {
    const lang = (navigator.language || "").toLowerCase();
    if (lang.startsWith("zh")) {
      hintText.innerHTML = "拖动鼠标截取选区 &middot; 按 Esc 或右键取消";
    }
  }

  let bgImage = null;
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;
  let hasImage = false;

  function getDpr() {
    return window.devicePixelRatio || 1;
  }

  function resizeCanvas() {
    const dpr = getDpr();
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    render();
  }

  window.addEventListener("resize", resizeCanvas);

  function getSelectionRect() {
    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    const w = Math.abs(currentX - startX);
    const h = Math.abs(currentY - startY);
    return { x, y, w, h };
  }

  function render() {
    const dpr = getDpr();
    const cw = canvas.width;
    const ch = canvas.height;

    ctx.clearRect(0, 0, cw, ch);

    if (!hasImage || !bgImage) {
      // Solid dark fallback while image loads
      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      ctx.fillRect(0, 0, cw, ch);
      return;
    }

    // 1. Draw original screen image
    ctx.drawImage(bgImage, 0, 0, cw, ch);

    // 2. Dim whole screen
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    ctx.fillRect(0, 0, cw, ch);

    if (isDragging) {
      const { x, y, w, h } = getSelectionRect();
      if (w > 0 && h > 0) {
        const sx = x * dpr;
        const sy = y * dpr;
        const sw = w * dpr;
        const sh = h * dpr;

        // 3. Draw clear un-dimmed region
        ctx.save();
        ctx.beginPath();
        ctx.rect(sx, sy, sw, sh);
        ctx.clip();
        ctx.drawImage(bgImage, 0, 0, cw, ch);
        ctx.restore();

        // 4. Draw selection border
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = Math.max(1.5, Math.round(dpr));
        ctx.strokeRect(sx, sy, sw, sh);

        // 5. Draw dimensions pill
        const label = `${Math.round(w)} × ${Math.round(h)}`;
        ctx.font = `${Math.round(11 * dpr)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        const textMetrics = ctx.measureText(label);
        const textW = textMetrics.width;
        const textH = 14 * dpr;
        const padding = 4 * dpr;

        let badgeX = sx;
        let badgeY = sy - textH - padding * 2 - 4 * dpr;
        if (badgeY < 4 * dpr) {
          badgeY = sy + 6 * dpr;
        }

        ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
        ctx.fillRect(badgeX, badgeY, textW + padding * 2, textH + padding * 2);
        ctx.fillStyle = "#f8fafc";
        ctx.textBaseline = "top";
        ctx.fillText(label, badgeX + padding, badgeY + padding);
      }
    }
  }

  function setBackground(dataUrl) {
    if (!dataUrl) return;
    isDragging = false;
    startX = 0;
    startY = 0;
    currentX = 0;
    currentY = 0;
    const img = new Image();
    img.onload = () => {
      bgImage = img;
      hasImage = true;
      resizeCanvas();
      if (hintBubble) hintBubble.classList.remove("hidden");
    };
    img.src = dataUrl;
  }

  // ── Mouse interaction ──────────────────────────────────────────────────

  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return; // only left click
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    currentX = e.clientX;
    currentY = e.clientY;
    if (hintBubble) hintBubble.classList.add("hidden");
    render();
  });

  window.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    currentX = e.clientX;
    currentY = e.clientY;
    render();
  });

  window.addEventListener("mouseup", (e) => {
    if (!isDragging || e.button !== 0) return;
    isDragging = false;
    currentX = e.clientX;
    currentY = e.clientY;

    const { x, y, w, h } = getSelectionRect();
    const dpr = getDpr();

    // Minimum selection size: 20x20 logical px
    if (w >= 20 && h >= 20) {
      if (window.__TAURI__) {
        window.__TAURI__.core.invoke("finish_region_capture", {
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(w),
          height: Math.round(h),
          scaleFactor: dpr,
        }).catch((err) => {
          console.error("[overlay] finish_region_capture failed:", err);
        });
      }
    } else {
      // Too small, treat as cancellation
      if (window.__TAURI__) {
        window.__TAURI__.core.invoke("cancel_region_capture").catch(() => {});
      }
    }
  });

  // ── Keyboard / Cancel handling ─────────────────────────────────────────

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (window.__TAURI__) {
        window.__TAURI__.core.invoke("cancel_region_capture").catch(() => {});
      }
    }
  });

  window.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (window.__TAURI__) {
      window.__TAURI__.core.invoke("cancel_region_capture").catch(() => {});
    }
  });

  // ── Tauri Event Listeners & Fallback Proactive Pull ────────────────────

  if (window.__TAURI__) {
    // 1. Push notification from Rust
    window.__TAURI__.event.listen("screenshot://background", (ev) => {
      const data = ev.payload;
      if (data && data.dataUrl) {
        setBackground(data.dataUrl);
      }
    });

    // 2. Proactively pull in case the event was emitted while this webview was still mounting
    window.__TAURI__.core.invoke("get_screenshot_background").then((dataUrl) => {
      if (dataUrl) {
        setBackground(dataUrl);
      }
    }).catch(() => {});
  }

  resizeCanvas();
})();
