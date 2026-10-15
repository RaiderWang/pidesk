/**
 * test/welcome-state.test.mjs
 *
 * Unit tests for src/app/welcome-state.js: when the empty-tab welcome card
 * shows, and that its tips stay in sync with the i18n dictionary.
 *
 * Run: node --test test/welcome-state.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WelcomeState, t, setLocale } from './helpers/shim.mjs';

describe('shouldShowWelcome', () => {
  it('is true for an empty message list', () => {
    assert.equal(WelcomeState.shouldShowWelcome([]), true);
  });

  it('is false once any message exists', () => {
    assert.equal(WelcomeState.shouldShowWelcome([{ kind: 'user', text: 'hi' }]), false);
  });

  it('treats missing/invalid messages as empty instead of throwing', () => {
    assert.equal(WelcomeState.shouldShowWelcome(undefined), true);
    assert.equal(WelcomeState.shouldShowWelcome(null), true);
  });
});

describe('TIPS', () => {
  it('has unique welcome.tip.* keys', () => {
    const keys = WelcomeState.TIPS.map((x) => x.key);
    assert.equal(new Set(keys).size, keys.length);
    for (const k of keys) assert.match(k, /^welcome\.tip\./);
  });

  it('every tip resolves in en and zh-CN (never falls back to the raw key)', () => {
    for (const locale of ['en', 'zh-CN']) {
      setLocale(locale);
      for (const { key } of WelcomeState.TIPS) {
        assert.notEqual(t(key), key, `${key} missing in ${locale}`);
      }
    }
    setLocale('en');
  });

  it('English fallback text matches the en dictionary entry', () => {
    setLocale('en');
    for (const { key, fallback } of WelcomeState.TIPS) {
      assert.equal(t(key), fallback, `fallback drifted from dictionary for ${key}`);
    }
  });
});
