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
});
