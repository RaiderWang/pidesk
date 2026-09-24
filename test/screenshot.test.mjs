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
