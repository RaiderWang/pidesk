/**
 * test/appearance.test.mjs
 *
 * Unit tests for src/app/appearance.js and theme tokens / i18n:
 *   - VALID_THEMES contains 'clarity'
 *   - applyAppearance applies 'theme-clarity'
 *   - fallback on invalid theme
 *   - i18n resolution for tweaks.theme.clarity in en and zh-CN
 *
 * Run: node --test test/appearance.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { t, setLocale } from './helpers/shim.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '../src');

describe('appearance and clarity theme', () => {
  it('defines tweaks.theme.clarity in English dictionary', () => {
    setLocale('en');
    assert.equal(t('tweaks.theme.clarity'), 'clarity (modern light)');
  });

  it('defines tweaks.theme.clarity in zh-CN dictionary', () => {
    setLocale('zh-CN');
    assert.equal(t('tweaks.theme.clarity'), '澄澈白 (现代灰)');
    setLocale('en');
  });

  it('declares clarity in VALID_THEMES in appearance.js', () => {
    const code = readFileSync(join(SRC, 'app/appearance.js'), 'utf-8');
    assert.match(code, /"clarity"/, 'appearance.js should list clarity in VALID_THEMES');
    assert.match(code, /theme-clarity/, 'appearance.js should clean up theme-clarity class');
  });

  it('declares theme-clarity tokens and button contrast in styles.css', () => {
    const css = readFileSync(join(SRC, 'design/styles.css'), 'utf-8');
    assert.match(css, /\.theme-clarity/, 'styles.css should declare .theme-clarity');
    assert.match(css, /--bg-app:\s*#F0F2F5/, 'styles.css should define clarity light gray background');
    assert.match(css, /--accent:\s*#2563EB/, 'styles.css should define clarity cobalt blue accent');
    assert.match(css, /\.theme-clarity\s+\.btn\.primary/, 'styles.css should define clarity button text color');
  });

  it('gives clarity an elevated background distinct from surface', () => {
    const css = readFileSync(join(SRC, 'design/styles.css'), 'utf-8');
    const block = css.match(/:root\.theme-clarity[^{]*\{([\s\S]*?)\n\}/);
    assert.ok(block, 'clarity block should exist');
    const surface = block[1].match(/--bg-surface:\s*(#[0-9A-Fa-f]{3,8})/)[1].toLowerCase();
    const elevated = block[1].match(/--bg-elevated:\s*(#[0-9A-Fa-f]{3,8})/)[1].toLowerCase();
    assert.notEqual(elevated, surface, 'elevated must differ from surface');
  });

  it('keeps the tweaks <select> arrow visible on light backgrounds', () => {
    const js = readFileSync(join(SRC, 'design/tweaks/style.js'), 'utf-8');
    const line = js.split('\n').find(l => l.includes('background-image:url('));
    assert.ok(line, 'select arrow background-image should exist');
    assert.doesNotMatch(line, /rgba\(255,\s*255,\s*255/, 'arrow must not be white-on-white');
  });

  it('labels all four themes with a descriptor in English and Chinese', () => {
    const keys = ['aurora', 'phosphor', 'daylight', 'clarity'].map(n => `tweaks.theme.${n}`);
    for (const locale of ['en', 'zh-CN']) {
      setLocale(locale);
      for (const k of keys) {
        const label = t(k);
        assert.notEqual(label, k, `${k} missing in ${locale}`);
        assert.match(label, /\(.+\)/, `${k} in ${locale} should have a parenthesised descriptor: ${label}`);
      }
    }
    setLocale('en');
    assert.equal(t('tweaks.theme.aurora'), 'aurora (dark)');
    assert.equal(t('tweaks.theme.daylight'), 'daylight (light)');
  });

  it('applies theme-clarity to document root when applyAppearance is executed', () => {
    const classes = new Set(['theme-aurora']);
    const mockRoot = {
      classList: {
        add: (c) => classes.add(c),
        remove: (...cs) => { cs.forEach(c => classes.delete(c)); },
        contains: (c) => classes.has(c),
      },
      style: {
        setProperty: () => {},
      },
    };

    const prevDoc = globalThis.document;
    globalThis.document = { documentElement: mockRoot };

    try {
      const code = readFileSync(join(SRC, 'app/appearance.js'), 'utf-8');
      // Execute in isolated function scope
      new Function(code)();

      assert.equal(typeof globalThis.applyAppearance, 'function');

      // Apply clarity theme
      globalThis.applyAppearance({ theme: 'clarity' });
      assert.equal(mockRoot.classList.contains('theme-clarity'), true);
      assert.equal(mockRoot.classList.contains('theme-aurora'), false);

      // Invalid theme falls back to daylight
      globalThis.applyAppearance({ theme: 'unknown-bogus-theme' });
      assert.equal(mockRoot.classList.contains('theme-daylight'), true);
      assert.equal(mockRoot.classList.contains('theme-clarity'), false);
    } finally {
      globalThis.document = prevDoc;
    }
  });

  it('provides dark, high-contrast accent options for clarity light theme', () => {
    const code = readFileSync(join(SRC, 'app/appearance.js'), 'utf-8');
    new Function(code)();

    assert.ok(globalThis.THEME_ACCENTS, 'THEME_ACCENTS should exist');
    assert.ok(globalThis.THEME_ACCENTS.clarity, 'THEME_ACCENTS.clarity should exist');
    assert.equal(globalThis.THEME_ACCENTS.clarity.length, 8, 'should provide 8 options');

    function lum(hex) {
      const rgb = [1, 3, 5]
        .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
      return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    }
    function contrastRatio(c1, c2) {
      const l1 = lum(c1), l2 = lum(c2);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    }

    // Every accent color in clarity must meet WCAG AA (>= 4.5:1) against white
    for (const accent of globalThis.THEME_ACCENTS.clarity) {
      const cr = contrastRatio(accent, '#FFFFFF');
      assert.ok(
        cr >= 4.5,
        `accent ${accent} in clarity must have contrast >= 4.5:1 vs white, got ${cr.toFixed(2)}:1`
      );
    }

    assert.equal(globalThis.getThemeAccents('clarity'), globalThis.THEME_ACCENTS.clarity);
    assert.equal(globalThis.normalizeThemeAccent('clarity', '#78E8BE'), '#047857');
    assert.equal(globalThis.normalizeThemeAccent('clarity', '#2563EB'), '#2563EB');
  });
});
