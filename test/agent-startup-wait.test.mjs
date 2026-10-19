/**
 * test/agent-startup-wait.test.mjs
 *
 * Unit tests for src/app/agent-startup-wait.js: classifying a session status
 * and the poll loop used while omp is still starting after an update.
 *
 * Run: node --test test/agent-startup-wait.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import './helpers/shim.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
new Function(readFileSync(join(__dirname, '../src/app/agent-startup-wait.js'), 'utf-8'))();
const {
  decide, waitUntilStarted, enqueue, drain, POLL_MS, MAX_WAIT_MS, QUEUE_MAX,
} = globalThis.AgentStartupWait;

describe('AgentStartupWait command queue', () => {
  it('drains in order and forgets what it returned', () => {
    const q = new Map();
    enqueue(q, 'a', { type: 'prompt', message: '1' });
    enqueue(q, 'a', { type: 'prompt', message: '2' });
    assert.deepEqual(drain(q, 'a').map((c) => c.message), ['1', '2']);
    assert.deepEqual(drain(q, 'a'), []);
    assert.equal(q.has('a'), false);
  });

  it('keeps sessions separate', () => {
    const q = new Map();
    enqueue(q, 'a', { n: 1 });
    enqueue(q, 'b', { n: 2 });
    assert.deepEqual(drain(q, 'b'), [{ n: 2 }]);
    assert.deepEqual(drain(q, 'a'), [{ n: 1 }]);
  });

  it('refuses commands past the cap without losing queued ones', () => {
    const q = new Map();
    for (let i = 0; i < QUEUE_MAX; i++) assert.equal(enqueue(q, 'a', { i }), true);
    assert.equal(enqueue(q, 'a', { i: 'overflow' }), false);
    assert.equal(drain(q, 'a').length, QUEUE_MAX);
  });

  it('drain of an unknown session is empty', () => {
    assert.deepEqual(drain(new Map(), 'nope'), []);
  });
});

describe('AgentStartupWait.decide', () => {
  it('a cached error wins over everything', () => {
    assert.equal(decide({ error: 'boom', running: true, starting: true }), 'failed');
  });
  it('blank error is ignored', () => {
    assert.equal(decide({ error: '  ', running: true, starting: false }), 'running');
  });
  it('running beats starting (grace thread has not cleared its flag yet)', () => {
    assert.equal(decide({ error: null, running: true, starting: true }), 'running');
  });
  it('starting means keep waiting', () => {
    assert.equal(decide({ error: null, running: false, starting: true }), 'wait');
  });
  it('nothing pending and not running is stopped', () => {
    assert.equal(decide({ error: null, running: false, starting: false }), 'stopped');
    assert.equal(decide(undefined), 'stopped');
  });
});

/** Virtual clock + sleep so the loop runs instantly and deterministically. */
function harness(statuses, { current = () => true } = {}) {
  let clock = 0;
  let calls = 0;
  const log = { running: 0, failed: [] };
  const opts = {
    query: async () => statuses[Math.min(calls++, statuses.length - 1)],
    isCurrent: current,
    onRunning: () => { log.running++; },
    onFailed: (e) => { log.failed.push(e); },
    sleep: async (ms) => { clock += ms; },
    now: () => clock,
  };
  return { opts, log, calls: () => calls };
}

const WAIT = { error: null, running: false, starting: true };

describe('AgentStartupWait.waitUntilStarted', () => {
  it('resolves running once the process appears', async () => {
    const h = harness([WAIT, WAIT, { error: null, running: true, starting: false }]);
    const res = await waitUntilStarted(h.opts);
    assert.equal(res.outcome, 'running');
    assert.equal(h.calls(), 3);
    assert.deepEqual(h.log, { running: 1, failed: [] });
  });

  it('reports the cached error when the grace period ends in failure', async () => {
    const h = harness([WAIT, { error: ' failed to spawn omp ', running: false, starting: false }]);
    const res = await waitUntilStarted(h.opts);
    assert.deepEqual(res, { outcome: 'failed', error: 'failed to spawn omp' });
    assert.deepEqual(h.log.failed, ['failed to spawn omp']);
  });

  it('stopped without an error is a generic failure', async () => {
    const h = harness([{ error: null, running: false, starting: false }]);
    const res = await waitUntilStarted(h.opts);
    assert.deepEqual(res, { outcome: 'failed', error: '' });
  });

  it('gives up after MAX_WAIT_MS of polling', async () => {
    const h = harness([WAIT]);
    const res = await waitUntilStarted(h.opts);
    assert.deepEqual(res, { outcome: 'failed', error: '' });
    assert.equal(h.calls(), Math.ceil(MAX_WAIT_MS / POLL_MS));
    assert.equal(h.log.failed.length, 1);
  });

  it('stops silently when the tab is no longer current', async () => {
    let calls = 0;
    const h = harness([WAIT], { current: () => ++calls < 2 });
    const res = await waitUntilStarted(h.opts);
    assert.equal(res.outcome, 'cancelled');
    assert.deepEqual(h.log, { running: 0, failed: [] });
  });

  it('treats a failing query as still starting', async () => {
    let n = 0;
    const h = harness([WAIT]);
    h.opts.query = async () => {
      if (n++ === 0) throw new Error('ipc hiccup');
      return { error: null, running: true, starting: false };
    };
    const res = await waitUntilStarted(h.opts);
    assert.equal(res.outcome, 'running');
  });
});
