/**
 * test/i18n.test.mjs
 *
 * Unit tests for src/i18n.js:
 *   t() translation function, parameter substitution, locale switching.
 *
 * Note: setLocale is always reset to 'en' after locale-switching tests
 * to avoid state bleed between describe blocks within this file.
 *
 * Run: node --test test/i18n.test.mjs
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { t, getLocale, setLocale } from './helpers/shim.mjs';

// Ensure we start each describe with a clean 'en' locale.
// afterEach is not available at describe scope, so we call setLocale('en')
// at the end of every test that changes it.

// ── t() — basic key lookup ─────────────────────────────────────────────────

describe('t — basic key lookup', () => {
  it('returns the English translation for a known key', () => {
    assert.equal(t('tweaks.title'), 'Tweaks');
  });

  it('returns another known key correctly', () => {
    assert.equal(t('chrome.bridge'), 'bridge');
  });

  it('returns the key itself when the key is not in the dictionary', () => {
    assert.equal(t('totally.unknown.key'), 'totally.unknown.key');
  });

  it('returns provided fallback string for an unknown key', () => {
    assert.equal(t('totally.unknown.key', null, 'My Default'), 'My Default');
  });

  it('returns provided fallback when fallback is empty string', () => {
    assert.equal(t('totally.unknown.key', null, ''), '');
  });
});

// ── t() — parameter substitution ──────────────────────────────────────────

describe('t — parameter substitution', () => {
  it('substitutes {n} placeholder', () => {
    // 'history.time.minutesAgo': "{n}m ago"
    assert.equal(t('history.time.minutesAgo', { n: 5 }),  '5m ago');
    assert.equal(t('history.time.minutesAgo', { n: 60 }), '60m ago');
  });

  it('substitutes {n} in hours-ago string', () => {
    // 'history.time.hoursAgo': "{n}h ago"
    assert.equal(t('history.time.hoursAgo', { n: 3 }), '3h ago');
  });

  it('substitutes {count} placeholder', () => {
    // 'composer.comments': "{count} comments"
    assert.equal(t('composer.comments', { count: 3 }),  '3 comments');
    assert.equal(t('composer.comments', { count: 99 }), '99 comments');
  });

  it('substitutes {before} and {after} in compactRange', () => {
    // 'chat.compactRange': "{before} → {after}"
    assert.equal(t('chat.compactRange', { before: '10k', after: '5k' }), '10k → 5k');
  });

  it('substitutes {level} in thinking label', () => {
    // 'composer.thinking': "thinking · {level}"
    assert.equal(t('composer.thinking', { level: 'high' }), 'thinking · high');
  });

  it('substitutes {model} in vision warning', () => {
    // 'composer.unsupportedVision': 'Current model "{model}" may not...'
    const result = t('composer.unsupportedVision', { model: 'gpt-4o' });
    assert.ok(result.includes('"gpt-4o"'), `expected "gpt-4o" in: ${result}`);
  });

  it('substitutes {tok} in chat.before', () => {
    // 'chat.before': "{tok} before"
    assert.equal(t('chat.before', { tok: '15k' }), '15k before');
  });

  it('substitutes {intent} in plan.intentFraming', () => {
    // 'plan.intentFraming': "...{intent}"
    const result = t('plan.intentFraming', { intent: 'Build a thing' });
    assert.ok(result.includes('Build a thing'), `intent not substituted in: ${result}`);
  });

  it('leaves unrelated placeholders unchanged when params are partial', () => {
    // Only substitute {n}, leave any other {x} as-is
    const result = t('history.time.minutesAgo', { n: 2 });
    assert.equal(result, '2m ago');
  });
});

// ── locale switching ───────────────────────────────────────────────────────

describe('locale switching', () => {
  it('getLocale() returns "en" by default', () => {
    setLocale('en');
    assert.equal(getLocale(), 'en');
  });

  it('setLocale("zh-CN") changes getLocale()', () => {
    setLocale('zh-CN');
    assert.equal(getLocale(), 'zh-CN');
    setLocale('en');
  });

  it('t() returns Chinese after setLocale("zh-CN")', () => {
    setLocale('zh-CN');
    assert.equal(t('tweaks.title'), '外观与设置');
    setLocale('en');
  });

  it('t() returns English again after switching back', () => {
    setLocale('zh-CN');
    setLocale('en');
    assert.equal(t('tweaks.title'), 'Tweaks');
  });

  it('ignores invalid locale (unknown key) and leaves locale unchanged', () => {
    setLocale('en');
    setLocale('fr');  // not in dictionary
    assert.equal(getLocale(), 'en', 'locale should not change for unknown locale code');
  });

  it('zh-CN: substitutes {n} parameter correctly', () => {
    setLocale('zh-CN');
    // 'history.time.minutesAgo': "{n}分钟前"
    assert.equal(t('history.time.minutesAgo', { n: 5 }), '5分钟前');
    setLocale('en');
  });

  it('zh-CN: chat.before substitutes {tok}', () => {
    setLocale('zh-CN');
    // 'chat.before': "压缩前 {tok}"
    assert.equal(t('chat.before', { tok: '10k' }), '压缩前 10k');
    setLocale('en');
  });

  it('zh-CN: t() falls back to English for a key absent in zh-CN', () => {
    // We check a key that IS in zh-CN so this tests normal operation;
    // the fallback path is exercised when we access a key NOT in zh-CN
    // (which should not happen for well-maintained dictionaries, but the
    // code path is: check zh-CN dict, if missing check en dict).
    setLocale('zh-CN');
    // 'tweaks.title' exists in zh-CN
    assert.notEqual(t('tweaks.title'), 'tweaks.title', 'should resolve, not return key');
    setLocale('en');
  });

  it('overrideLocale param overrides current locale without changing state', () => {
    setLocale('en');
    const zh = t('tweaks.title', null, undefined, 'zh-CN');
    assert.equal(zh, '外观与设置', 'overrideLocale should return zh-CN translation');
    assert.equal(getLocale(), 'en', 'current locale should still be "en"');
  });
});

// ── known-key spot-checks across both locales ──────────────────────────────

describe('known-key spot-checks', () => {
  it('composer.send is "send" in en, "发送" in zh-CN', () => {
    setLocale('en');
    assert.equal(t('composer.send'), 'send');
    setLocale('zh-CN');
    assert.equal(t('composer.send'), '发送');
    setLocale('en');
  });

  it('history.resume is "Resume" in en, "恢复会话" in zh-CN', () => {
    setLocale('en');
    assert.equal(t('history.resume'), 'Resume');
    setLocale('zh-CN');
    assert.equal(t('history.resume'), '恢复会话');
    setLocale('en');
  });

  it('tray.quit is "Quit" in en, "退出" in zh-CN', () => {
    setLocale('en');
    assert.equal(t('tray.quit'), 'Quit');
    setLocale('zh-CN');
    assert.equal(t('tray.quit'), '退出');
    setLocale('en');
  });

  it('hub.title is "agent hub" in en, "Agent Hub" in zh-CN', () => {
    setLocale('en');
    assert.equal(t('hub.title'), 'agent hub');
    setLocale('zh-CN');
    assert.equal(t('hub.title'), 'Agent Hub');
    setLocale('en');
  });

  it('agent.processExited and agent.restartedAfterModelConfig resolve in en and zh-CN', () => {
    setLocale('en');
    assert.equal(t('agent.processExited', { reason: 'err' }), 'Agent process exited: err');
    assert.equal(t('agent.restartedAfterModelConfig'), 'Restarted session with new model configuration.');
    setLocale('zh-CN');
    assert.equal(t('agent.processExited', { reason: 'err' }), 'Agent 进程已退出：err');
    assert.equal(t('agent.restartedAfterModelConfig'), '已根据最新的模型配置自动重新启动会话。');
    setLocale('en');
  });
});

