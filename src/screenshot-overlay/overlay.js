// overlay.js — Full region selection and annotation overlay for screenshots.
// Supports: Rect, Circle, Arrow, Pen, Mosaic, Text, Undo/Redo, Color & Stroke selection,
// and export via send, copy to clipboard, or save to disk.

(function () {
  "use strict";

  const canvas = document.getElementById("screen-canvas");
  const ctx = canvas.getContext("2d");
  const hintBubble = document.getElementById("hint-bubble");
  const hintText = document.getElementById("hint-text");
  const dimBadge = document.getElementById("dim-badge");
  const selectionBox = document.getElementById("selection-box");
  const toolbar = document.getElementById("annotation-toolbar");
  const toast = document.getElementById("toast");
  const textInputWrap = document.getElementById("text-input-wrap");
  const textarea = document.getElementById("annotation-textarea");

  // Multi-language helper
  function t(key, fallback) {
    if (window.t) {
      const val = window.t(key);
      if (val && val !== key) return val;
    }
    return fallback;
  }

  // Localize toolbar button tooltips and hints
  function localizeUI() {
    if (hintText) {
      hintText.textContent = t("screenshot.overlay.hint", "Drag to select region · Esc to cancel");
    }
    const toolTips = {
      "tool-rect": t("screenshot.overlay.tool.rect", "Rectangle"),
      "tool-circle": t("screenshot.overlay.tool.circle", "Circle"),
      "tool-arrow": t("screenshot.overlay.tool.arrow", "Arrow"),
      "tool-pen": t("screenshot.overlay.tool.pen", "Pen"),
      "tool-mosaic": t("screenshot.overlay.tool.mosaic", "Mosaic"),
      "tool-text": t("screenshot.overlay.tool.text", "Text"),
      "tool-undo": t("screenshot.overlay.tool.undo", "Undo (Ctrl+Z)"),
      "tool-redo": t("screenshot.overlay.tool.redo", "Redo (Ctrl+Y)"),
      "tool-save": t("screenshot.overlay.tool.save", "Save to file (Ctrl+S)"),
      "tool-copy": t("screenshot.overlay.tool.copy", "Copy to clipboard (Ctrl+C)"),
      "tool-cancel": t("screenshot.overlay.tool.cancel", "Cancel (Esc)"),
      "tool-done": t("screenshot.overlay.tool.done", "Done (Enter)"),
    };
    for (const [id, title] of Object.entries(toolTips)) {
      const el = document.getElementById(id);
      if (el) el.title = title;
    }
  }

  // ── State variables ────────────────────────────────────────────────────

  let bgImage = null;
  let hasImage = false;

  // Stages: "idle" -> "selecting" -> "selected"
  let stage = "idle";
  let isDragging = false;
  let isResizing = false;
  let resizeHandle = null;
  let isMoving = false;

  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;

  // Selection rectangle in CSS logical coordinates { x, y, w, h }
  let selection = null;
  let moveOffset = { x: 0, y: 0 };
  let initialSelection = null;

  // Annotation Tool state
  let activeTool = null; // null | "rect" | "circle" | "arrow" | "pen" | "mosaic" | "text"
  let activeColor = "#ef4444";
  let activeStroke = 4; // 2 (thin), 4 (medium), 7 (thick)

  let isDrawing = false;
  let currentShape = null;
  let shapes = [];
  let undoStack = [];
  let redoStack = [];

  // Text editor state
  let textEditorOpen = false;
  let textEditorPos = { x: 0, y: 0 };

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

  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.remove("hidden");
    setTimeout(() => {
      toast.classList.add("hidden");
    }, 1800);
  }

  function getSelectionRect() {
    if (stage === "selecting") {
      const x = Math.min(startX, currentX);
      const y = Math.min(startY, currentY);
      const w = Math.abs(currentX - startX);
      const h = Math.abs(currentY - startY);
      return { x, y, w, h };
    }
    return selection;
  }

  // ── Drawing Math & Shape Rendering ─────────────────────────────────────

  function drawArrow(targetCtx, x1, y1, x2, y2, color, lineWidth) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 2) return;

    const angle = Math.atan2(dy, dx);

    // Streamlined arrow head proportion (proportional to line width and total length)
    const baseHeadLen = Math.max(16, lineWidth * 4.2);
    const headLen = Math.min(len * 0.65, baseHeadLen);

    // Wing angle (~26°)
    const wingAngle = Math.PI * 0.145;
    const wing1X = x2 - headLen * Math.cos(angle - wingAngle);
    const wing1Y = y2 - headLen * Math.sin(angle - wingAngle);
    const wing2X = x2 - headLen * Math.cos(angle + wingAngle);
    const wing2Y = y2 - headLen * Math.sin(angle + wingAngle);

    // Inward notch (swallowtail back depth ~72% of head length)
    const notchDepth = headLen * 0.72;
    const notchX = x2 - notchDepth * Math.cos(angle);
    const notchY = y2 - notchDepth * Math.sin(angle);

    targetCtx.save();
    targetCtx.strokeStyle = color;
    targetCtx.fillStyle = color;
    targetCtx.lineWidth = lineWidth;
    targetCtx.lineCap = "round";
    targetCtx.lineJoin = "round";

    // 1. Draw shaft from start up to the inner notch (with slight overlap to avoid gap)
    const shaftOverlap = Math.min(notchDepth * 0.4, Math.max(2, lineWidth * 0.5));
    const shaftEndX = notchX + shaftOverlap * Math.cos(angle);
    const shaftEndY = notchY + shaftOverlap * Math.sin(angle);

    targetCtx.beginPath();
    targetCtx.moveTo(x1, y1);
    targetCtx.lineTo(shaftEndX, shaftEndY);
    targetCtx.stroke();

    // 2. Draw solid swallowtail arrow head (sharp tip -> wing1 -> notch -> wing2 -> close)
    targetCtx.beginPath();
    targetCtx.moveTo(x2, y2);
    targetCtx.lineTo(wing1X, wing1Y);
    targetCtx.lineTo(notchX, notchY);
    targetCtx.lineTo(wing2X, wing2Y);
    targetCtx.closePath();
    targetCtx.fill();

    targetCtx.restore();
  }

  function drawMosaicRegion(targetCtx, sx, sy, sw, sh, dpr) {
    if (!bgImage || sw <= 0 || sh <= 0) return;
    const blockSize = Math.max(8, Math.round(10 * dpr));
    const smallW = Math.max(1, Math.round(sw / blockSize));
    const smallH = Math.max(1, Math.round(sh / blockSize));

    const off = document.createElement("canvas");
    off.width = smallW;
    off.height = smallH;
    const offCtx = off.getContext("2d");
    if (!offCtx) return;
    offCtx.imageSmoothingEnabled = false;
    offCtx.drawImage(bgImage, sx, sy, sw, sh, 0, 0, smallW, smallH);

    targetCtx.save();
    targetCtx.imageSmoothingEnabled = false;
    targetCtx.drawImage(off, 0, 0, smallW, smallH, sx, sy, sw, sh);
    targetCtx.restore();
  }

  function renderShape(targetCtx, shape, dpr, originX = 0, originY = 0) {
    targetCtx.save();
    const lw = shape.lineWidth * dpr;

    if (shape.type === "rect") {
      targetCtx.strokeStyle = shape.color;
      targetCtx.lineWidth = lw;
      targetCtx.strokeRect(
        (shape.x - originX) * dpr,
        (shape.y - originY) * dpr,
        shape.w * dpr,
        shape.h * dpr
      );
    } else if (shape.type === "circle") {
      targetCtx.strokeStyle = shape.color;
      targetCtx.lineWidth = lw;
      targetCtx.beginPath();
      const cx = (shape.x + shape.w / 2 - originX) * dpr;
      const cy = (shape.y + shape.h / 2 - originY) * dpr;
      const rx = Math.max(0.1, (Math.abs(shape.w) / 2) * dpr);
      const ry = Math.max(0.1, (Math.abs(shape.h) / 2) * dpr);
      targetCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      targetCtx.stroke();
    } else if (shape.type === "arrow") {
      drawArrow(
        targetCtx,
        (shape.x1 - originX) * dpr,
        (shape.y1 - originY) * dpr,
        (shape.x2 - originX) * dpr,
        (shape.y2 - originY) * dpr,
        shape.color,
        lw
      );
    } else if (shape.type === "pen") {
      if (shape.points.length > 1) {
        targetCtx.strokeStyle = shape.color;
        targetCtx.lineWidth = lw;
        targetCtx.lineCap = "round";
        targetCtx.lineJoin = "round";
        targetCtx.beginPath();
        targetCtx.moveTo(
          (shape.points[0].x - originX) * dpr,
          (shape.points[0].y - originY) * dpr
        );
        for (let i = 1; i < shape.points.length; i++) {
          targetCtx.lineTo(
            (shape.points[i].x - originX) * dpr,
            (shape.points[i].y - originY) * dpr
          );
        }
        targetCtx.stroke();
      }
    } else if (shape.type === "mosaic") {
      drawMosaicRegion(
        targetCtx,
        (shape.x - originX) * dpr,
        (shape.y - originY) * dpr,
        shape.w * dpr,
        shape.h * dpr,
        dpr
      );
    } else if (shape.type === "text") {
      targetCtx.fillStyle = shape.color;
      const fontSize = Math.round(shape.fontSize * dpr);
      targetCtx.font = `600 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Microsoft YaHei", sans-serif`;
      targetCtx.textBaseline = "top";

      const lines = shape.text.split("\n");
      const lineHeight = fontSize * 1.35;
      for (let i = 0; i < lines.length; i++) {
        targetCtx.fillText(
          lines[i],
          (shape.x - originX) * dpr,
          (shape.y - originY) * dpr + i * lineHeight
        );
      }
    }

    targetCtx.restore();
  }

  // ── Canvas Main Render Loop ────────────────────────────────────────────

  function render() {
    const dpr = getDpr();
    const cw = canvas.width;
    const ch = canvas.height;

    ctx.clearRect(0, 0, cw, ch);

    if (!hasImage || !bgImage) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      ctx.fillRect(0, 0, cw, ch);
      return;
    }

    // 1. Draw base screen image
    ctx.drawImage(bgImage, 0, 0, cw, ch);

    // 2. Dim whole screen
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    ctx.fillRect(0, 0, cw, ch);

    const rect = getSelectionRect();
    if (rect && rect.w > 0 && rect.h > 0) {
      const sx = rect.x * dpr;
      const sy = rect.y * dpr;
      const sw = rect.w * dpr;
      const sh = rect.h * dpr;

      // 3. Clear un-dimmed region (clip and draw original image)
      ctx.save();
      ctx.beginPath();
      ctx.rect(sx, sy, sw, sh);
      ctx.clip();
      ctx.drawImage(bgImage, 0, 0, cw, ch);

      // 4. Render all saved annotation shapes inside selection
      for (const shape of shapes) {
        renderShape(ctx, shape, dpr);
      }

      // 5. Render currently active in-progress shape
      if (isDrawing && currentShape) {
        renderShape(ctx, currentShape, dpr);
      }
      ctx.restore();

      // Update HTML UI overlays (handles, badge, toolbar)
      updateOverlayElements(rect);
    } else {
      hideOverlayElements();
    }
  }

  // ── Overlay UI Positioning ─────────────────────────────────────────────

  function updateOverlayElements(rect) {
    if (stage === "selecting") {
      // While dragging to select: show dimension badge, hide toolbar & handles
      if (dimBadge) {
        dimBadge.classList.remove("hidden");
        dimBadge.textContent = `${Math.round(rect.w)} × ${Math.round(rect.h)}`;
        let badgeY = rect.y - 28;
        if (badgeY < 8) badgeY = rect.y + rect.h + 8;
        dimBadge.style.left = `${Math.max(8, rect.x)}px`;
        dimBadge.style.top = `${badgeY}px`;
      }
      if (selectionBox) selectionBox.classList.add("hidden");
      if (toolbar) toolbar.classList.add("hidden");
    } else if (stage === "selected") {
      // Selected: show 8 resize handles & position toolbar
      if (dimBadge) {
        dimBadge.classList.remove("hidden");
        dimBadge.textContent = `${Math.round(rect.w)} × ${Math.round(rect.h)}`;
        let badgeY = rect.y - 28;
        if (badgeY < 8) badgeY = rect.y + 8;
        dimBadge.style.left = `${Math.max(8, rect.x)}px`;
        dimBadge.style.top = `${badgeY}px`;
      }

      if (selectionBox) {
        selectionBox.classList.remove("hidden");
        selectionBox.style.left = `${rect.x}px`;
        selectionBox.style.top = `${rect.y}px`;
        selectionBox.style.width = `${rect.w}px`;
        selectionBox.style.height = `${rect.h}px`;
      }

      if (toolbar) {
        toolbar.classList.remove("hidden");
        positionToolbar(rect);
      }
    }
  }

  function hideOverlayElements() {
    if (dimBadge) dimBadge.classList.add("hidden");
    if (selectionBox) selectionBox.classList.add("hidden");
    if (toolbar) toolbar.classList.add("hidden");
  }

  function positionToolbar(rect) {
    if (!toolbar) return;
    const tbWidth = toolbar.offsetWidth || 480;
    const tbHeight = toolbar.offsetHeight || 38;

    // Prefer below the selection
    let top = rect.y + rect.h + 10;
    // If not enough room below, place above
    if (top + tbHeight > window.innerHeight - 8) {
      top = rect.y - tbHeight - 10;
      if (top < 8) {
        // If neither above nor below fits, place inside bottom of selection
        top = Math.max(8, rect.y + rect.h - tbHeight - 8);
      }
    }

    // Align to the right edge of selection, clamped to viewport
    let left = rect.x + rect.w - tbWidth;
    if (left < 8) left = 8;
    if (left + tbWidth > window.innerWidth - 8) {
      left = window.innerWidth - tbWidth - 8;
    }

    toolbar.style.top = `${top}px`;
    toolbar.style.left = `${left}px`;
  }

  function setBackground(dataUrl) {
    if (!dataUrl) return;
    stage = "idle";
    isDragging = false;
    isResizing = false;
    isMoving = false;
    selection = null;
    shapes = [];
    undoStack = [];
    redoStack = [];
    updateUndoRedoButtons();

    const img = new Image();
    img.onload = () => {
      bgImage = img;
      hasImage = true;
      resizeCanvas();
      localizeUI();
      if (hintBubble) hintBubble.classList.remove("hidden");
    };
    img.src = dataUrl;
  }

  // ── History: Undo / Redo ───────────────────────────────────────────────

  function pushHistory() {
    undoStack.push(shapes.slice());
    redoStack = [];
    updateUndoRedoButtons();
  }

  function updateUndoRedoButtons() {
    const undoBtn = document.getElementById("tool-undo");
    const redoBtn = document.getElementById("tool-redo");
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
  }

  function handleUndo() {
    if (undoStack.length === 0) return;
    redoStack.push(shapes.slice());
    shapes = undoStack.pop();
    updateUndoRedoButtons();
    render();
  }

  function handleRedo() {
    if (redoStack.length === 0) return;
    undoStack.push(shapes.slice());
    shapes = redoStack.pop();
    updateUndoRedoButtons();
    render();
  }

  // ── Text Annotation Editor ─────────────────────────────────────────────

  function startTextEditor(x, y) {
    if (!textInputWrap || !textarea) return;
    textEditorOpen = true;
    textEditorPos = { x, y };

    textarea.value = "";
    textarea.style.color = activeColor;
    textarea.style.fontSize = `${activeStroke * 4 + 10}px`;
    textarea.placeholder = t("screenshot.overlay.textPlaceholder", "Type here…");

    textInputWrap.style.left = `${x}px`;
    textInputWrap.style.top = `${y}px`;
    textInputWrap.classList.remove("hidden");

    setTimeout(() => textarea.focus(), 20);
  }

  function commitTextEditor() {
    if (!textEditorOpen) return;
    const text = (textarea.value || "").trim();
    if (text) {
      pushHistory();
      shapes.push({
        type: "text",
        x: textEditorPos.x,
        y: textEditorPos.y,
        text,
        color: activeColor,
        fontSize: activeStroke * 4 + 10,
      });
      render();
    }
    cancelTextEditor();
  }

  function cancelTextEditor() {
    textEditorOpen = false;
    if (textInputWrap) textInputWrap.classList.add("hidden");
    if (textarea) textarea.value = "";
  }

  if (textarea) {
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        cancelTextEditor();
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        commitTextEditor();
      }
    });

    textarea.addEventListener("blur", () => {
      commitTextEditor();
    });
  }

  // ── Mouse & Interaction Handling ───────────────────────────────────────

  function pointInRect(px, py, rect) {
    return (
      px >= rect.x &&
      px <= rect.x + rect.w &&
      py >= rect.y &&
      py <= rect.y + rect.h
    );
  }

  // Handle mousedown on resize handles
  if (selectionBox) {
    selectionBox.addEventListener("mousedown", (e) => {
      const handleEl = e.target.closest(".resize-handle");
      if (handleEl && stage === "selected") {
        e.stopPropagation();
        isResizing = true;
        resizeHandle = handleEl.dataset.handle;
        startX = e.clientX;
        startY = e.clientY;
        initialSelection = { ...selection };
      }
    });
  }

  // Main canvas interaction
  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return; // Left-click only

    // If text editor is active, commit it
    if (textEditorOpen) {
      commitTextEditor();
      return;
    }

    const mx = e.clientX;
    const my = e.clientY;

    if (stage === "idle") {
      // 1. Start region selection
      stage = "selecting";
      isDragging = true;
      startX = mx;
      startY = my;
      currentX = mx;
      currentY = my;
      if (hintBubble) hintBubble.classList.add("hidden");
      render();
    } else if (stage === "selected") {
      const rect = selection;
      const inside = pointInRect(mx, my, rect);

      if (inside) {
        if (activeTool) {
          // Inside selection with an active tool: draw annotation
          if (activeTool === "text") {
            startTextEditor(mx, my);
          } else {
            isDrawing = true;
            startX = mx;
            startY = my;
            currentX = mx;
            currentY = my;

            if (activeTool === "pen") {
              currentShape = {
                type: "pen",
                points: [{ x: mx, y: my }],
                color: activeColor,
                lineWidth: activeStroke,
              };
            }
          }
        } else {
          // Inside selection with no tool: move selection
          isMoving = true;
          moveOffset = { x: mx - rect.x, y: my - rect.y };
        }
      } else {
        // Clicked outside selection: restart fresh selection
        stage = "selecting";
        isDragging = true;
        startX = mx;
        startY = my;
        currentX = mx;
        currentY = my;
        selection = null;
        shapes = [];
        undoStack = [];
        redoStack = [];
        updateUndoRedoButtons();
        render();
      }
    }
  });

  window.addEventListener("mousemove", (e) => {
    const mx = e.clientX;
    const my = e.clientY;

    if (isDragging) {
      currentX = mx;
      currentY = my;
      render();
    } else if (isResizing && initialSelection) {
      let { x, y, w, h } = initialSelection;
      const dx = mx - startX;
      const dy = my - startY;

      if (resizeHandle.includes("r")) w = Math.max(20, initialSelection.w + dx);
      if (resizeHandle.includes("b")) h = Math.max(20, initialSelection.h + dy);
      if (resizeHandle.includes("l")) {
        const newW = Math.max(20, initialSelection.w - dx);
        x = initialSelection.x + (initialSelection.w - newW);
        w = newW;
      }
      if (resizeHandle.includes("t")) {
        const newH = Math.max(20, initialSelection.h - dy);
        y = initialSelection.y + (initialSelection.h - newH);
        h = newH;
      }

      selection = { x, y, w, h };
      render();
    } else if (isMoving && selection) {
      let newX = mx - moveOffset.x;
      let newY = my - moveOffset.y;
      newX = Math.max(0, Math.min(newX, window.innerWidth - selection.w));
      newY = Math.max(0, Math.min(newY, window.innerHeight - selection.h));
      selection.x = newX;
      selection.y = newY;
      render();
    } else if (isDrawing && selection) {
      // Clamp drawing cursor inside selection
      const cx = Math.max(selection.x, Math.min(mx, selection.x + selection.w));
      const cy = Math.max(selection.y, Math.min(my, selection.y + selection.h));

      if (activeTool === "rect") {
        currentShape = {
          type: "rect",
          x: Math.min(startX, cx),
          y: Math.min(startY, cy),
          w: Math.abs(cx - startX),
          h: Math.abs(cy - startY),
          color: activeColor,
          lineWidth: activeStroke,
        };
      } else if (activeTool === "circle") {
        currentShape = {
          type: "circle",
          x: Math.min(startX, cx),
          y: Math.min(startY, cy),
          w: Math.abs(cx - startX),
          h: Math.abs(cy - startY),
          color: activeColor,
          lineWidth: activeStroke,
        };
      } else if (activeTool === "arrow") {
        currentShape = {
          type: "arrow",
          x1: startX,
          y1: startY,
          x2: cx,
          y2: cy,
          color: activeColor,
          lineWidth: activeStroke,
        };
      } else if (activeTool === "pen") {
        currentShape.points.push({ x: cx, y: cy });
      } else if (activeTool === "mosaic") {
        currentShape = {
          type: "mosaic",
          x: Math.min(startX, cx),
          y: Math.min(startY, cy),
          w: Math.abs(cx - startX),
          h: Math.abs(cy - startY),
        };
      }
      render();
    }
  });

  window.addEventListener("mouseup", (e) => {
    if (e.button !== 0) return;

    if (isDragging) {
      isDragging = false;
      const rect = getSelectionRect();
      if (rect && rect.w >= 20 && rect.h >= 20) {
        stage = "selected";
        selection = rect;
        render();
      } else {
        stage = "idle";
        selection = null;
        if (hintBubble) hintBubble.classList.remove("hidden");
        render();
      }
    } else if (isResizing) {
      isResizing = false;
      resizeHandle = null;
      initialSelection = null;
    } else if (isMoving) {
      isMoving = false;
    } else if (isDrawing) {
      isDrawing = false;
      if (currentShape) {
        pushHistory();
        shapes.push(currentShape);
        currentShape = null;
        render();
      }
    }
  });

  // ── Keyboard Shortcuts ─────────────────────────────────────────────────

  window.addEventListener("keydown", (e) => {
    // If text editor is typing, don't trigger global shortcuts
    if (textEditorOpen) return;

    if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (stage === "selected") {
        handleFinish();
      }
    } else if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      if (e.shiftKey) {
        handleRedo();
      } else {
        handleUndo();
      }
    } else if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y")) {
      e.preventDefault();
      handleRedo();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C")) {
      if (stage === "selected") {
        e.preventDefault();
        handleCopy();
      }
    } else if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
      if (stage === "selected") {
        e.preventDefault();
        handleSave();
      }
    }
  });

  window.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (stage === "selected" && activeTool) {
      // Right click cancels active tool
      setActiveTool(null);
    } else {
      handleCancel();
    }
  });

  // ── Toolbar UI Bindings ────────────────────────────────────────────────

  function setActiveTool(tool) {
    activeTool = tool;
    document.querySelectorAll(".tool-btn[data-tool]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tool === tool);
    });
  }

  // Tool selection clicks
  document.querySelectorAll(".tool-btn[data-tool]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tool = btn.dataset.tool;
      if (activeTool === tool) {
        setActiveTool(null);
      } else {
        setActiveTool(tool);
      }
    });
  });

  // Color clicks
  document.querySelectorAll(".color-dot").forEach((dot) => {
    dot.addEventListener("click", () => {
      document.querySelectorAll(".color-dot").forEach((d) => d.classList.remove("active"));
      dot.classList.add("active");
      activeColor = dot.dataset.color;
    });
  });

  // Stroke size clicks
  document.querySelectorAll(".stroke-dot").forEach((dot) => {
    dot.addEventListener("click", () => {
      document.querySelectorAll(".stroke-dot").forEach((d) => d.classList.remove("active"));
      dot.classList.add("active");
      activeStroke = parseInt(dot.dataset.size, 10) || 4;
    });
  });

  // Undo / Redo clicks
  const undoBtn = document.getElementById("tool-undo");
  if (undoBtn) undoBtn.addEventListener("click", handleUndo);
  const redoBtn = document.getElementById("tool-redo");
  if (redoBtn) redoBtn.addEventListener("click", handleRedo);

  // Stop mousedown on toolbar from bubbling to canvas
  if (toolbar) {
    toolbar.addEventListener("mousedown", (e) => {
      e.stopPropagation();
    });
  }

  // Action clicks
  const saveBtn = document.getElementById("tool-save");
  if (saveBtn) saveBtn.addEventListener("click", handleSave);
  const copyBtn = document.getElementById("tool-copy");
  if (copyBtn) copyBtn.addEventListener("click", handleCopy);
  const cancelBtn = document.getElementById("tool-cancel");
  if (cancelBtn) cancelBtn.addEventListener("click", handleCancel);
  const doneBtn = document.getElementById("tool-done");
  if (doneBtn) doneBtn.addEventListener("click", handleFinish);

  // ── High-DPI Offscreen Compositing & Output ────────────────────────────

  function composeExportCanvas() {
    if (!bgImage || !selection) return null;
    const dpr = getDpr();
    const sw = Math.round(selection.w * dpr);
    const sh = Math.round(selection.h * dpr);

    const off = document.createElement("canvas");
    off.width = sw;
    off.height = sh;
    const offCtx = off.getContext("2d");
    if (!offCtx) return null;

    // 1. Draw base cropped screen image
    const sx = Math.round(selection.x * dpr);
    const sy = Math.round(selection.y * dpr);
    offCtx.drawImage(bgImage, sx, sy, sw, sh, 0, 0, sw, sh);

    // 2. Render all shapes with origin offset
    for (const shape of shapes) {
      renderShape(offCtx, shape, dpr, selection.x, selection.y);
    }

    return off;
  }

  function handleFinish() {
    if (textEditorOpen) commitTextEditor();
    const offCanvas = composeExportCanvas();
    if (!offCanvas) {
      handleCancel();
      return;
    }

    const dataUrl = offCanvas.toDataURL("image/png");
    if (window.__TAURI__) {
      window.__TAURI__.core.invoke("finish_annotated_capture", {
        base64Data: dataUrl,
        width: offCanvas.width,
        height: offCanvas.height,
      }).catch((err) => {
        console.error("[overlay] finish_annotated_capture failed:", err);
      });
    }
  }

  async function handleCopy() {
    if (textEditorOpen) commitTextEditor();
    const offCanvas = composeExportCanvas();
    if (!offCanvas) return;

    try {
      offCanvas.toBlob(async (blob) => {
        if (!blob) return;
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob }),
          ]);
          showToast(t("screenshot.overlay.copied", "Copied to clipboard"));
          // Keep overlay open so user can continue annotating or perform further actions
        } catch (clipErr) {
          console.error("[overlay] clipboard write failed:", clipErr);
          showToast("Clipboard copy failed");
        }
      }, "image/png");
    } catch (err) {
      console.error("[overlay] copy to blob failed:", err);
    }
  }

  async function handleSave() {
    if (textEditorOpen) commitTextEditor();
    const offCanvas = composeExportCanvas();
    if (!offCanvas) return;

    const dataUrl = offCanvas.toDataURL("image/png");
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .slice(0, 19);
    const defaultFilename = `screenshot-${timestamp}.png`;

    if (window.__TAURI__) {
      try {
        const savedPath = await window.__TAURI__.core.invoke("save_screenshot_to_disk", {
          base64Data: dataUrl,
          defaultFilename,
        });
        if (savedPath) {
          showToast(t("screenshot.overlay.saved", "Saved to file"));
          // Keep overlay open so user can continue annotating or perform further actions
        }
      } catch (err) {
        console.error("[overlay] save_screenshot_to_disk failed:", err);
        showToast(t("screenshot.overlay.saveFailed", "Failed to save file"));
      }
    }
  }

  function handleCancel() {
    if (window.__TAURI__) {
      window.__TAURI__.core.invoke("cancel_region_capture").catch(() => {});
    }
  }

  // ── Tauri Event Listeners & Proactive Pull ─────────────────────────────

  if (window.__TAURI__) {
    window.__TAURI__.event.listen("screenshot://background", (ev) => {
      const data = ev.payload;
      if (data && data.dataUrl) {
        setBackground(data.dataUrl);
      }
    });

    window.__TAURI__.core.invoke("get_screenshot_background").then((dataUrl) => {
      if (dataUrl) {
        setBackground(dataUrl);
      }
    }).catch(() => {});
  }

  resizeCanvas();
})();

