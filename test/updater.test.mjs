/**
 * test/updater.test.mjs
 *
 * Unit tests for src/app/updater.js: update-flow state machine, banner
 * visibility, "ignore this version" persistence, release-note summary, and
 * that every update-related i18n key exists in both locales.
 *
 * Run: node --test test/updater.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Updater as U, t, setLocale } from './helpers/shim.mjs';

const INFO = { version: '1.2.0', currentVersion: '1.1.0', notes: 'x', date: null };

const run = (actions, from) => actions.reduce((s, a) => U.reduce(s, a), from ?? U.initialState());

describe('Updater.reduce — check flow', () => {
  it('starts idle', () => {
    assert.equal(U.initialState().phase, 'idle');
  });

  it('check → found → available keeps info and manual flag', () => {
    const s = run([
      { type: 'check-start', manual: true },
      { type: 'check-found', info: INFO, ignored: false },
    ]);
    assert.equal(s.phase, 'available');
    assert.equal(s.info.version, '1.2.0');
    assert.equal(s.manual, true);
  });

  it('silent check on an ignored version stays idle', () => {
    const s = run([
      { type: 'check-start', manual: false },
      { type: 'check-found', info: INFO, ignored: true },
    ]);
    assert.equal(s.phase, 'idle');
    assert.equal(s.info, null);
  });

  it('manual check surfaces an ignored version anyway', () => {
    const s = run([
      { type: 'check-start', manual: true },
      { type: 'check-found', info: INFO, ignored: true },
    ]);
    assert.equal(s.phase, 'available');
  });

  it('check → none → uptodate', () => {
    const s = run([{ type: 'check-start', manual: true }, { type: 'check-none' }]);
    assert.equal(s.phase, 'uptodate');
  });

  it('check failure records message and source', () => {
    const s = run([{ type: 'check-start' }, { type: 'check-fail', error: 'offline' }]);
    assert.equal(s.phase, 'error');
    assert.equal(s.source, 'check');
    assert.equal(s.error, 'offline');
  });

  it('results are ignored unless a check is in flight', () => {
    const s = U.reduce(U.initialState(), { type: 'check-found', info: INFO, ignored: false });
    assert.equal(s.phase, 'idle');
  });

  it('a second check while checking only upgrades it to manual', () => {
    const auto = U.reduce(U.initialState(), { type: 'check-start', manual: false });
    const merged = U.reduce(auto, { type: 'check-start', manual: true });
    assert.equal(merged.phase, 'checking');
    assert.equal(merged.manual, true);
    // ...and a later silent check never downgrades it back.
    assert.equal(U.reduce(merged, { type: 'check-start', manual: false }).manual, true);
  });

  it('a silent check leaves an available update or install error untouched', () => {
    const available = run([{ type: 'check-start' }, { type: 'check-found', info: INFO }]);
    assert.equal(U.reduce(available, { type: 'check-start', manual: false }), available);
    assert.equal(U.reduce(available, { type: 'check-start', manual: true }).phase, 'checking');
    const failed = run([{ type: 'install-start' }, { type: 'install-fail', error: 'x' }], available);
    assert.equal(U.reduce(failed, { type: 'check-start', manual: false }), failed);
  });

  it('canCheck / canInstall gate requests by phase', () => {
    const phase = (p, source = null, info = null) => ({ ...U.initialState(), phase: p, source, info });
    assert.equal(U.canCheck(U.initialState(), false), true);
    assert.equal(U.canCheck(phase('uptodate'), false), true);
    assert.equal(U.canCheck(phase('error', 'check'), false), true);
    for (const p of ['checking', 'downloading', 'ready']) assert.equal(U.canCheck(phase(p), true), false);
    assert.equal(U.canCheck(phase('available', null, INFO), false), false);
    assert.equal(U.canCheck(phase('available', null, INFO), true), true);
    assert.equal(U.canCheck(phase('error', 'install', INFO), false), false);
    assert.equal(U.canInstall(phase('available', null, INFO)), true);
    assert.equal(U.canInstall(phase('error', 'install', INFO)), true);
    assert.equal(U.canInstall(phase('available')), false);
    assert.equal(U.canInstall(phase('downloading', null, INFO)), false);
    assert.equal(U.canInstall(phase('error', 'check', INFO)), false);
  });

  it('check-start is refused while downloading or ready', () => {
    const downloading = run([
      { type: 'check-start' },
      { type: 'check-found', info: INFO },
      { type: 'install-start' },
    ]);
    assert.equal(downloading.phase, 'downloading');
    assert.equal(U.reduce(downloading, { type: 'check-start' }), downloading);
    const ready = U.reduce(downloading, { type: 'installed' });
    assert.equal(U.reduce(ready, { type: 'check-start' }), ready);
  });
});

describe('Updater.reduce — install flow', () => {
  const available = run([{ type: 'check-start' }, { type: 'check-found', info: INFO }]);

  it('install-start needs an available update', () => {
    assert.equal(U.reduce(U.initialState(), { type: 'install-start' }).phase, 'idle');
    const s = U.reduce(available, { type: 'install-start' });
    assert.equal(s.phase, 'downloading');
    assert.equal(s.percent, 0);
  });

  it('progress is clamped, rounded and only applies while downloading', () => {
    const d = U.reduce(available, { type: 'install-start' });
    assert.equal(U.reduce(d, { type: 'progress', percent: 41.6 }).percent, 42);
    assert.equal(U.reduce(d, { type: 'progress', percent: 250 }).percent, 100);
    assert.equal(U.reduce(d, { type: 'progress', percent: -5 }).percent, 0);
    assert.equal(U.reduce(d, { type: 'progress', percent: null }).percent, 0);
    assert.equal(U.reduce(available, { type: 'progress', percent: 50 }), available);
  });

  it('installed → ready at 100%', () => {
    const s = run([{ type: 'install-start' }, { type: 'progress', percent: 80 }, { type: 'installed' }], available);
    assert.equal(s.phase, 'ready');
    assert.equal(s.percent, 100);
  });

  it('install failure keeps info so the user can retry', () => {
    const failed = run([{ type: 'install-start' }, { type: 'install-fail', error: 'sig' }], available);
    assert.equal(failed.phase, 'error');
    assert.equal(failed.source, 'install');
    assert.equal(failed.info.version, '1.2.0');
    const retry = U.reduce(failed, { type: 'install-start' });
    assert.equal(retry.phase, 'downloading');
    assert.equal(retry.error, null);
  });

  it('a failed check cannot be retried as an install', () => {
    const s = run([{ type: 'check-start' }, { type: 'check-fail', error: 'x' }]);
    assert.equal(U.reduce(s, { type: 'install-start' }), s);
  });

  it('dismiss only hides the banner: phase and info are kept', () => {
    const s = U.reduce(available, { type: 'dismiss' });
    assert.equal(s.phase, 'available');
    assert.equal(s.info.version, '1.2.0');
    assert.equal(s.dismissed, true);
    assert.equal(U.isBannerVisible(s), false);
    assert.equal(U.canInstall(s), true);
  });

  it('dismissing a ready update keeps the restart action and blocks re-checks', () => {
    const ready = run([{ type: 'install-start' }, { type: 'installed' }, { type: 'dismiss' }], available);
    assert.equal(ready.phase, 'ready');
    assert.equal(ready.dismissed, true);
    assert.equal(U.isBannerVisible(ready), false);
    assert.equal(U.reduce(ready, { type: 'check-start', manual: true }), ready);
    assert.equal(U.canCheck(ready, true), false);
  });

  it('dismiss never interrupts a download and ignores non-prompt phases', () => {
    const d = U.reduce(available, { type: 'install-start' });
    assert.equal(U.reduce(d, { type: 'dismiss' }), d);
    const idle = U.initialState();
    assert.equal(U.reduce(idle, { type: 'dismiss' }), idle);
  });

  it('a dismissed banner comes back on install progress outcomes', () => {
    const dismissed = U.reduce(available, { type: 'dismiss' });
    const retried = U.reduce(dismissed, { type: 'install-start' });
    assert.equal(retried.dismissed, false);
    assert.equal(U.isBannerVisible(U.reduce(retried, { type: 'installed' })), true);
    assert.equal(U.isBannerVisible(U.reduce(retried, { type: 'install-fail', error: 'x' })), true);
  });

  it('ignore forgets the update entirely', () => {
    const s = U.reduce(available, { type: 'ignore' });
    assert.deepEqual(s, U.initialState());
    const d = U.reduce(available, { type: 'install-start' });
    assert.equal(U.reduce(d, { type: 'ignore' }), d);
  });

  it('unknown actions are no-ops', () => {
    assert.equal(U.reduce(available, { type: 'nope' }), available);
  });
});

describe('Updater.isBannerVisible', () => {
  const phase = (p, source = null) => ({ ...U.initialState(), phase: p, source });

  it('shows for available, downloading, ready and install errors', () => {
    for (const p of ['available', 'downloading', 'ready']) assert.equal(U.isBannerVisible(phase(p)), true);
    assert.equal(U.isBannerVisible(phase('error', 'install')), true);
  });

  it('hides for idle, checking, uptodate and check errors', () => {
    for (const p of ['idle', 'checking', 'uptodate']) assert.equal(U.isBannerVisible(phase(p)), false);
    assert.equal(U.isBannerVisible(phase('error', 'check')), false);
    assert.equal(U.isBannerVisible(null), false);
  });
});

describe('Updater ignore persistence', () => {
  const memory = () => {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
  };

  it('round-trips the ignored version', () => {
    const s = memory();
    assert.equal(U.loadIgnored(s), '');
    U.saveIgnored(s, '1.2.0');
    assert.equal(U.loadIgnored(s), '1.2.0');
    assert.equal(U.isIgnored(INFO, U.loadIgnored(s)), true);
    assert.equal(U.isIgnored({ version: '1.3.0' }, U.loadIgnored(s)), false);
  });

  it('isIgnored is false without data', () => {
    assert.equal(U.isIgnored(null, '1.2.0'), false);
    assert.equal(U.isIgnored(INFO, ''), false);
  });

  it('survives a throwing storage', () => {
    const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    assert.equal(U.loadIgnored(bad), '');
    assert.doesNotThrow(() => U.saveIgnored(bad, '1.2.0'));
  });
});

describe('Updater.summarizeNotes', () => {
  it('returns empty for non-strings and blank input', () => {
    assert.equal(U.summarizeNotes(null), '');
    assert.equal(U.summarizeNotes('  \n \n'), '');
  });

  it('strips heading markers and blank lines', () => {
    assert.equal(U.summarizeNotes('### Added\n\n- one\n- two'), 'Added\n- one\n- two');
  });

  it('keeps only the changelog from a generated release body', () => {
    const body = [
      '## PiDesk v0.4.4\n',
      "### 🚀 What's Changed / 版本变更说明\n",
      '### Added\n',
      '- **In-app updates**: checks `GitHub` [Releases](https://example.com) daily.\n',
      '### Fixed\n',
      '- Windows omp cleanup.\n',
      '\n---\n',
      '### 📦 Installation Guide / 安装指南\n',
      '#### 🍎 macOS\n',
      '- **Homebrew**',
    ].join('\n');
    assert.equal(
      U.summarizeNotes(body),
      'Added\n- In-app updates: checks GitHub Releases daily.\nFixed\n- Windows omp cleanup.',
    );
  });

  it('ignores a leading separator and bare h1/h2 titles', () => {
    assert.equal(U.summarizeNotes('---\n## Title\n- one'), '- one');
    assert.equal(U.summarizeNotes('---\n## Title\n---'), '');
  });

  it('caps line count with an ellipsis', () => {
    const out = U.summarizeNotes('a\nb\nc\nd', 2);
    assert.equal(out, 'a\nb…');
  });

  it('caps characters with an ellipsis', () => {
    const out = U.summarizeNotes('x'.repeat(50), 6, 10);
    assert.equal(out, 'x'.repeat(10) + '…');
  });
});

describe('update i18n keys', () => {
  const KEYS = [
    'tweaks.update.version', 'tweaks.update.auto', 'tweaks.update.check', 'tweaks.update.checking',
    'tweaks.update.uptodate', 'tweaks.update.available', 'tweaks.update.error',
    'update.banner.title', 'update.banner.body', 'update.action.install', 'update.action.later',
    'update.action.ignore', 'update.action.restart', 'update.action.retry', 'update.action.manual',
    'update.status.downloading', 'update.status.ready', 'update.error.install',
  ];

  for (const locale of ['en', 'zh-CN']) {
    it(`defines every key in ${locale}`, () => {
      setLocale(locale);
      for (const k of KEYS) assert.notEqual(t(k), k, `${locale} missing ${k}`);
    });
  }

  it('interpolates parameters', () => {
    setLocale('en');
    assert.match(t('update.status.downloading', { percent: 37 }), /37%/);
    setLocale('en');
  });
});
