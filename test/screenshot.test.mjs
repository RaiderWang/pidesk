/**
 * test/screenshot.test.mjs
 *
 * Unit tests for Quick Bar screenshot feature:
 *   - i18n translation keys (en & zh-CN)
 *   - Mode transitions (off -> auto -> off, Alt+S auto-cancel, region selection)
 *   - Submit payload construction (auto vs region vs normal)
 *
 * Run: node --test test/screenshot.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { t, setLocale } from './helpers/shim.mjs';

// ── i18n keys for Quick Bar Screenshot ─────────────────────────────────────

describe('Quick Bar Screenshot i18n keys', () => {
  it('resolves all screenshot keys in English', () => {
    setLocale('en');
    assert.equal(t('quickbar.screen.off'), 'screen off');
    assert.equal(t('quickbar.screen.auto'), 'screen on');
    assert.equal(t('quickbar.screen.region'), 'region captured');
    assert.equal(t('quickbar.placeholder.screen'), 'Ask about this screen…');
    assert.equal(t('quickbar.hint.region'), 'region capture');
    assert.equal(t('quickbar.removeImage'), 'remove screenshot');
    assert.ok(t('quickbar.screen.tooltip.auto').includes('Alt+S'));
  });

  it('resolves all screenshot keys in Chinese', () => {
    setLocale('zh-CN');
    assert.equal(t('quickbar.screen.off'), '关闭截屏');
    assert.equal(t('quickbar.screen.auto'), '依据屏幕提问');
    assert.equal(t('quickbar.screen.region'), '已选区域');
    assert.equal(t('quickbar.placeholder.screen'), '依据当前屏幕提问…');
    assert.equal(t('quickbar.hint.region'), '选区截屏');
    assert.equal(t('quickbar.removeImage'), '移除截屏');
    assert.ok(t('quickbar.screen.tooltip.auto').includes('Alt+S'));
    setLocale('en');
  });
});

// ── Quick Bar mode transitions ─────────────────────────────────────────────

describe('Quick Bar Screenshot mode transitions', () => {
  // Pure logic replicating handleToggleScreen:
  // off -> auto, auto -> off, region -> auto
  function nextScreenMode(currentMode) {
    if (currentMode === 'auto') return 'off';
    if (currentMode === 'region') return 'auto';
    return 'auto';
  }

  it('toggles from off to auto', () => {
    assert.equal(nextScreenMode('off'), 'auto');
  });

  it('toggles from auto to off', () => {
    assert.equal(nextScreenMode('auto'), 'off');
  });

  it('toggles from region to auto', () => {
    assert.equal(nextScreenMode('region'), 'auto');
  });

  // Pure logic replicating Alt+S shortcut handling:
  // If auto -> turns off auto. If off/region -> starts region capture.
  function handleAltS(currentMode) {
    if (currentMode === 'auto') {
      return { newMode: 'off', triggerRegion: false };
    }
    return { newMode: currentMode, triggerRegion: true };
  }

  it('Alt+S when in auto mode turns off auto-screenshot without triggering capture', () => {
    const res = handleAltS('auto');
    assert.equal(res.newMode, 'off');
    assert.equal(res.triggerRegion, false);
  });

  it('Alt+S when in off mode triggers region capture', () => {
    const res = handleAltS('off');
    assert.equal(res.triggerRegion, true);
  });

  it('Alt+S when in region mode triggers fresh region capture', () => {
    const res = handleAltS('region');
    assert.equal(res.triggerRegion, true);
  });
});

// ── Submit payload construction ───────────────────────────────────────────

describe('Quick Bar Submit payload construction', () => {
  // Pure helper simulating image payload resolution in handleSubmit:
  function buildSubmitPayload({ text, screenMode, screenThumb, capturedBase64 }) {
    const trimmed = (text || '').trim();
    const hasThumb = screenMode === 'region' && screenThumb;
    const isAuto = screenMode === 'auto';

    if (!trimmed && !hasThumb && !isAuto) {
      return null; // cannot send
    }

    let images = [];
    if (isAuto && capturedBase64) {
      images.push({
        type: 'image',
        data: capturedBase64,
        mimeType: 'image/jpeg',
      });
    } else if (hasThumb) {
      images.push({
        type: 'image',
        data: screenThumb.base64,
        mimeType: screenThumb.mimeType || 'image/jpeg',
      });
    }

    return {
      text: trimmed,
      images,
    };
  }

  it('returns null when text is empty and no screenshot is active', () => {
    const res = buildSubmitPayload({ text: '', screenMode: 'off', screenThumb: null });
    assert.equal(res, null);
  });

  it('allows sending when text is empty but region screenshot is attached', () => {
    const thumb = { base64: 'fake-b64-thumb', mimeType: 'image/jpeg', width: 200, height: 100 };
    const res = buildSubmitPayload({ text: '', screenMode: 'region', screenThumb: thumb });
    assert.ok(res !== null);
    assert.equal(res.text, '');
    assert.equal(res.images.length, 1);
    assert.equal(res.images[0].data, 'fake-b64-thumb');
  });

  it('attaches auto-captured screen image when screenMode is auto', () => {
    const res = buildSubmitPayload({
      text: 'what is on this screen?',
      screenMode: 'auto',
      screenThumb: null,
      capturedBase64: 'captured-full-screen-b64',
    });
    assert.ok(res !== null);
    assert.equal(res.text, 'what is on this screen?');
    assert.equal(res.images.length, 1);
    assert.equal(res.images[0].data, 'captured-full-screen-b64');
    assert.equal(res.images[0].mimeType, 'image/jpeg');
  });

  it('sends normal text without images when screenMode is off', () => {
    const res = buildSubmitPayload({
      text: 'hello world',
      screenMode: 'off',
      screenThumb: null,
    });
    assert.ok(res !== null);
    assert.equal(res.text, 'hello world');
    assert.equal(res.images.length, 0);
  });
});

// ── Composer Image Menu & Main Window Screenshot ───────────────────────────

describe('Composer Image Menu i18n keys', () => {
  it('resolves image menu keys in English', () => {
    setLocale('en');
    assert.equal(t('composer.imageMenu.trigger'), 'Add image or screenshot');
    assert.equal(t('composer.imageMenu.upload'), 'Upload image…');
    assert.equal(t('composer.imageMenu.screenshot'), 'Capture screen');
  });

  it('resolves image menu keys in Chinese', () => {
    setLocale('zh-CN');
    assert.equal(t('composer.imageMenu.trigger'), '添加图片或截屏');
    assert.equal(t('composer.imageMenu.upload'), '上传本地图片…');
    assert.equal(t('composer.imageMenu.screenshot'), '截取屏幕');
    setLocale('en');
  });
});

describe('Composer Screenshot Attachment mapper', () => {
  function mapScreenshotToAttachment(payload) {
    if (!payload?.base64) return null;
    const mime = payload.mimeType || 'image/jpeg';
    const dataUrl = `data:${mime};base64,${payload.base64}`;
    const approxSize = Math.round(payload.base64.length * 0.75);
    return {
      name: `screenshot-${payload.width}x${payload.height}.jpg`,
      size: approxSize,
      mimeType: mime,
      dataUrl,
      data: payload.base64,
    };
  }

  it('maps region screenshot payload to composer attachment item', () => {
    const item = mapScreenshotToAttachment({
      base64: 'abc123xyz',
      mimeType: 'image/jpeg',
      width: 1200,
      height: 800,
    });
    assert.ok(item);
    assert.equal(item.name, 'screenshot-1200x800.jpg');
    assert.equal(item.mimeType, 'image/jpeg');
    assert.equal(item.data, 'abc123xyz');
    assert.equal(item.dataUrl, 'data:image/jpeg;base64,abc123xyz');
    assert.equal(item.size, Math.round('abc123xyz'.length * 0.75));
  });

  it('returns null if payload has no base64', () => {
    assert.equal(mapScreenshotToAttachment(null), null);
    assert.equal(mapScreenshotToAttachment({}), null);
  });
});

describe('Screenshot Target routing', () => {
  function resolveScreenshotTarget({ qbVisible, mainVisible }) {
    if (qbVisible) return 'quick-bar';
    if (mainVisible) return 'main';
    return 'quick-bar';
  }

  it('routes to main window when main is visible and qb is not', () => {
    assert.equal(
      resolveScreenshotTarget({ qbVisible: false, mainVisible: true }),
      'main'
    );
  });

  it('routes to quick-bar when quick-bar is visible', () => {
    assert.equal(
      resolveScreenshotTarget({ qbVisible: true, mainVisible: true }),
      'quick-bar'
    );
    assert.equal(
      resolveScreenshotTarget({ qbVisible: true, mainVisible: false }),
      'quick-bar'
    );
  });

  it('defaults to quick-bar when neither window is visible', () => {
    assert.equal(
      resolveScreenshotTarget({ qbVisible: false, mainVisible: false }),
      'quick-bar'
    );
  });
});

describe('Composer Screenshot Deduplication', () => {
  function appendScreenshotDeduplicated(prevImages, payload) {
    if (!payload?.base64) return prevImages;
    if (prevImages.some((img) => img.data === payload.base64)) {
      return prevImages;
    }
    const mime = payload.mimeType || 'image/jpeg';
    return [
      ...prevImages,
      {
        id: 'img_' + Math.random(),
        name: `screenshot-${payload.width}x${payload.height}.jpg`,
        mimeType: mime,
        data: payload.base64,
      },
    ];
  }

  it('appends a screenshot when list is empty', () => {
    const list = appendScreenshotDeduplicated([], {
      base64: 'payload_aaa',
      width: 100,
      height: 100,
    });
    assert.equal(list.length, 1);
    assert.equal(list[0].data, 'payload_aaa');
  });

  it('rejects duplicate screenshot payload with identical base64', () => {
    const initial = appendScreenshotDeduplicated([], {
      base64: 'payload_aaa',
      width: 100,
      height: 100,
    });
    const next = appendScreenshotDeduplicated(initial, {
      base64: 'payload_aaa',
      width: 100,
      height: 100,
    });
    assert.equal(next.length, 1, 'duplicate must not increase image count');
    assert.equal(next, initial, 'returns identical array reference when duplicate');
  });

  it('appends different screenshots when base64 differs', () => {
    const first = appendScreenshotDeduplicated([], {
      base64: 'payload_aaa',
      width: 100,
      height: 100,
    });
    const second = appendScreenshotDeduplicated(first, {
      base64: 'payload_bbb',
      width: 200,
      height: 200,
    });
    assert.equal(second.length, 2);
  });
});

// ── Screenshot Annotation i18n & Logic ────────────────────────────────────

describe('Screenshot Annotation i18n keys', () => {
  it('resolves all annotation keys in English', () => {
    setLocale('en');
    assert.equal(t('screenshot.overlay.tool.rect'), 'Rectangle');
    assert.equal(t('screenshot.overlay.tool.circle'), 'Circle');
    assert.equal(t('screenshot.overlay.tool.arrow'), 'Arrow');
    assert.equal(t('screenshot.overlay.tool.pen'), 'Pen');
    assert.equal(t('screenshot.overlay.tool.mosaic'), 'Mosaic');
    assert.equal(t('screenshot.overlay.tool.text'), 'Text');
    assert.equal(t('screenshot.overlay.tool.undo'), 'Undo (Ctrl+Z)');
    assert.equal(t('screenshot.overlay.tool.redo'), 'Redo (Ctrl+Y)');
    assert.equal(t('screenshot.overlay.tool.save'), 'Save to file (Ctrl+S)');
    assert.equal(t('screenshot.overlay.tool.copy'), 'Copy to clipboard (Ctrl+C)');
    assert.equal(t('screenshot.overlay.tool.cancel'), 'Cancel (Esc)');
    assert.equal(t('screenshot.overlay.tool.done'), 'Done (Enter)');
    assert.equal(t('screenshot.overlay.copied'), 'Copied to clipboard');
    assert.equal(t('screenshot.overlay.saved'), 'Saved to file');
    assert.equal(t('screenshot.overlay.saveFailed'), 'Failed to save file');
  });

  it('resolves all annotation keys in Chinese', () => {
    setLocale('zh-CN');
    assert.equal(t('screenshot.overlay.tool.rect'), '矩形');
    assert.equal(t('screenshot.overlay.tool.circle'), '圆形');
    assert.equal(t('screenshot.overlay.tool.arrow'), '箭头');
    assert.equal(t('screenshot.overlay.tool.pen'), '画笔');
    assert.equal(t('screenshot.overlay.tool.mosaic'), '马赛克');
    assert.equal(t('screenshot.overlay.tool.text'), '文字');
    assert.equal(t('screenshot.overlay.tool.undo'), '撤销 (Ctrl+Z)');
    assert.equal(t('screenshot.overlay.tool.redo'), '重做 (Ctrl+Y)');
    assert.equal(t('screenshot.overlay.tool.save'), '保存到文件 (Ctrl+S)');
    assert.equal(t('screenshot.overlay.tool.copy'), '复制到剪贴板 (Ctrl+C)');
    assert.equal(t('screenshot.overlay.tool.cancel'), '取消 (Esc)');
    assert.equal(t('screenshot.overlay.tool.done'), '完成并发送 (Enter)');
    assert.equal(t('screenshot.overlay.copied'), '已复制到剪贴板');
    assert.equal(t('screenshot.overlay.saved'), '已保存到文件');
    assert.equal(t('screenshot.overlay.saveFailed'), '保存文件失败');
    setLocale('en');
  });
});

describe('Screenshot Annotation Undo/Redo State Machine', () => {
  function createHistoryManager() {
    let shapes = [];
    let undoStack = [];
    let redoStack = [];

    return {
      getShapes: () => shapes,
      addShape: (shape) => {
        undoStack.push(shapes.slice());
        redoStack = [];
        shapes = [...shapes, shape];
      },
      undo: () => {
        if (undoStack.length === 0) return false;
        redoStack.push(shapes.slice());
        shapes = undoStack.pop();
        return true;
      },
      redo: () => {
        if (redoStack.length === 0) return false;
        undoStack.push(shapes.slice());
        shapes = redoStack.pop();
        return true;
      },
      canUndo: () => undoStack.length > 0,
      canRedo: () => redoStack.length > 0,
    };
  }

  it('manages empty history initial state', () => {
    const mgr = createHistoryManager();
    assert.equal(mgr.canUndo(), false);
    assert.equal(mgr.canRedo(), false);
    assert.equal(mgr.undo(), false);
    assert.equal(mgr.redo(), false);
  });

  it('pushes shapes and supports undo/redo step-by-step', () => {
    const mgr = createHistoryManager();
    mgr.addShape({ type: 'rect', x: 10, y: 10, w: 50, h: 50 });
    assert.equal(mgr.getShapes().length, 1);
    assert.equal(mgr.canUndo(), true);
    assert.equal(mgr.canRedo(), false);

    mgr.addShape({ type: 'arrow', x1: 0, y1: 0, x2: 20, y2: 20 });
    assert.equal(mgr.getShapes().length, 2);

    // Undo arrow
    assert.equal(mgr.undo(), true);
    assert.equal(mgr.getShapes().length, 1);
    assert.equal(mgr.getShapes()[0].type, 'rect');
    assert.equal(mgr.canRedo(), true);

    // Redo arrow
    assert.equal(mgr.redo(), true);
    assert.equal(mgr.getShapes().length, 2);
    assert.equal(mgr.getShapes()[1].type, 'arrow');

    // Adding shape clears redo stack
    mgr.undo();
    mgr.addShape({ type: 'circle', x: 5, y: 5, w: 20, h: 20 });
    assert.equal(mgr.canRedo(), false);
    assert.equal(mgr.getShapes().length, 2);
    assert.equal(mgr.getShapes()[1].type, 'circle');
  });
});

describe('Screenshot Annotation Handle Resizing', () => {
  function resizeRect(init, handle, dx, dy) {
    let { x, y, w, h } = init;
    if (handle.includes('r')) w = Math.max(20, init.w + dx);
    if (handle.includes('b')) h = Math.max(20, init.h + dy);
    if (handle.includes('l')) {
      const newW = Math.max(20, init.w - dx);
      x = init.x + (init.w - newW);
      w = newW;
    }
    if (handle.includes('t')) {
      const newH = Math.max(20, init.h - dy);
      y = init.y + (init.h - newH);
      h = newH;
    }
    return { x, y, w, h };
  }

  it('resizes bottom-right handle smoothly', () => {
    const initial = { x: 100, y: 100, w: 200, h: 150 };
    const next = resizeRect(initial, 'br', 50, 30);
    assert.deepEqual(next, { x: 100, y: 100, w: 250, h: 180 });
  });

  it('resizes top-left handle adjusting position and size', () => {
    const initial = { x: 100, y: 100, w: 200, h: 150 };
    const next = resizeRect(initial, 'tl', 30, 20);
    assert.deepEqual(next, { x: 130, y: 120, w: 170, h: 130 });
  });

  it('clamps to minimum 20px size when shrinking past zero', () => {
    const initial = { x: 100, y: 100, w: 50, h: 50 };
    const next = resizeRect(initial, 'br', -100, -100);
    assert.deepEqual(next, { x: 100, y: 100, w: 20, h: 20 });
  });
});

