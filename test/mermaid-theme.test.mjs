import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const T = require('../src/app/mermaid-theme.js');

const HEX = /^#[0-9a-f]{6}$/i;

describe('resolveTheme', () => {
  it('reads the theme-* class', () => {
    assert.equal(T.resolveTheme('theme-aurora density-compact'), 'aurora');
    assert.equal(T.resolveTheme('density-dense theme-phosphor mono-chat'), 'phosphor');
    assert.equal(T.resolveTheme('theme-clarity'), 'clarity');
  });
  it('falls back to daylight', () => {
    assert.equal(T.resolveTheme(''), 'daylight');
    assert.equal(T.resolveTheme('theme-unknown'), 'daylight');
    assert.equal(T.resolveTheme(undefined), 'daylight');
  });
});

describe('variables', () => {
  for (const theme of ['aurora', 'phosphor', 'daylight', 'clarity']) {
    it(`${theme}: every colour is a concrete hex (no var()/color-mix)`, () => {
      const out = T.variables(theme, '#2563EB');
      assert.equal(out.theme, 'base');
      for (const [k, v] of Object.entries(out.themeVariables)) {
        if (k === 'darkMode' || k === 'fontFamily') continue;
        assert.match(v, HEX, `${k}=${v}`);
      }
    });
  }
  it('flags dark themes via darkMode', () => {
    assert.equal(T.variables('aurora').themeVariables.darkMode, true);
    assert.equal(T.variables('phosphor').themeVariables.darkMode, true);
    assert.equal(T.variables('daylight').themeVariables.darkMode, false);
    assert.equal(T.variables('clarity').themeVariables.darkMode, false);
  });
  it('derives tints from the accent', () => {
    const a = T.variables('daylight', '#2563EB').themeVariables.primaryColor;
    const b = T.variables('daylight', '#BE123C').themeVariables.primaryColor;
    assert.notEqual(a, b);
  });
  it('ignores non-hex accents (e.g. css vars) and unknown themes', () => {
    const bad = T.variables('daylight', 'var(--accent)');
    const def = T.variables('daylight', '#1F8A5B');
    assert.deepEqual(bad, def);
    assert.deepEqual(T.variables('nope', '#2563EB'), T.variables('daylight', '#2563EB'));
  });
});

describe('styleKey', () => {
  it('includes the full theme name and accent', () => {
    assert.notEqual(T.styleKey('aurora', '#78E8BE'), T.styleKey('phosphor', '#78E8BE'));
    assert.notEqual(T.styleKey('aurora', '#78E8BE'), T.styleKey('aurora', '#FF7AC6'));
    assert.equal(T.styleKey('aurora', '#78E8BE'), T.styleKey('aurora', '#78e8be'));
  });
});

describe('mix', () => {
  it('blends endpoints', () => {
    assert.equal(T.mix('#000000', '#ffffff', 0), '#000000');
    assert.equal(T.mix('#000000', '#ffffff', 1), '#ffffff');
    assert.equal(T.mix('#000000', '#ffffff', 0.5), '#808080');
  });
});
