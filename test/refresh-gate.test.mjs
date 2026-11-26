/**
 * test/refresh-gate.test.mjs
 *
 * app/refresh-gate.js — shared cooldown for every auto-refresh source.
 * Run: node --test test/refresh-gate.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RefreshGate } from './helpers/shim.mjs';

/** Manual clock + timer queue so no real time passes. */
function fakeEnv() {
  let t = 1000;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => t,
    setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { fn, at: t + ms }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    advance(ms) {
      t += ms;
      for (const [id, tm] of [...timers]) {
        if (tm.at <= t) { timers.delete(id); tm.fn(); }
      }
    },
    pending: () => timers.size,
  };
}

describe('RefreshGate', () => {
  it('runs the first request immediately', () => {
    const env = fakeEnv();
    let runs = 0;
    const gate = RefreshGate.create({ run: () => { runs++; }, ...env });
    gate.request();
    assert.equal(runs, 1);
  });

  it('merges requests inside the cooldown into one trailing run', () => {
    const env = fakeEnv();
    let runs = 0;
    const gate = RefreshGate.create({ run: () => { runs++; }, cooldownMs: 400, ...env });
    gate.request();
    env.advance(50);
    gate.request();
    gate.request();
    gate.request();
    assert.equal(runs, 1);
    assert.equal(env.pending(), 1);
    env.advance(349);
    assert.equal(runs, 1);
    env.advance(1);
    assert.equal(runs, 2, 'the last change is not lost');
    assert.equal(env.pending(), 0);
  });

  it('runs immediately again once the cooldown has elapsed', () => {
    const env = fakeEnv();
    let runs = 0;
    const gate = RefreshGate.create({ run: () => { runs++; }, cooldownMs: 400, ...env });
    gate.request();
    env.advance(401);
    gate.request();
    assert.equal(runs, 2);
  });

  it('drops requests while the window is hidden', () => {
    const env = fakeEnv();
    let runs = 0;
    let hidden = true;
    const gate = RefreshGate.create({ run: () => { runs++; }, isHidden: () => hidden, ...env });
    gate.request();
    assert.equal(runs, 0);
    assert.equal(env.pending(), 0);
    hidden = false;
    gate.request();
    assert.equal(runs, 1);
  });

  it('skips a queued trailing run when the window got hidden meanwhile, without eating the cooldown', () => {
    const env = fakeEnv();
    let runs = 0;
    let hidden = false;
    const gate = RefreshGate.create({ run: () => { runs++; }, isHidden: () => hidden, cooldownMs: 400, ...env });
    gate.request();            // runs at t=0
    env.advance(100);
    gate.request();            // queued for t=400
    hidden = true;
    env.advance(300);          // timer fires while hidden
    assert.equal(runs, 1, 'no background refresh');
    assert.equal(env.pending(), 0);

    hidden = false;            // window comes back, focus asks again
    gate.request();
    assert.equal(runs, 2, 'refreshes at once: the skipped run did not reset the cooldown');
  });

  it('cancel clears a queued trailing run', () => {
    const env = fakeEnv();
    let runs = 0;
    const gate = RefreshGate.create({ run: () => { runs++; }, cooldownMs: 400, ...env });
    gate.request();
    gate.request();
    gate.cancel();
    env.advance(1000);
    assert.equal(runs, 1);
  });
});
