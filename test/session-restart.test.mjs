/**
 * test/session-restart.test.mjs
 *
 * Decision logic for respawning the active tab's omp after models.yml changed
 * (omp only reads it at startup). History must survive, so a restart needs a
 * session file to --resume, and must never kill a running turn.
 *
 * Run: node --test test/session-restart.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/shim.mjs';

const { plan, hasConversation } = globalThis.SessionRestart;

const base = {
  hasSession: true,
  isStreaming: false,
  hasPendingAsyncWork: false,
  sessionFile: 'C:\\s\\a.jsonl',
  messages: [{ kind: 'user', text: 'hi' }, { kind: 'assistant', blocks: [] }],
};

describe('SessionRestart.plan', () => {
  it('resumes the session file when idle', () => {
    assert.deepEqual(plan(base), { ok: true, resume: 'C:\\s\\a.jsonl' });
  });

  it('refuses without an active session', () => {
    assert.deepEqual(plan({ ...base, hasSession: false }), { ok: false, reason: 'no-session' });
  });

  it('refuses while streaming or while background work is pending', () => {
    assert.deepEqual(plan({ ...base, isStreaming: true }), { ok: false, reason: 'busy' });
    assert.deepEqual(plan({ ...base, hasPendingAsyncWork: true }), { ok: false, reason: 'busy' });
  });

  it('busy wins over a missing session file', () => {
    assert.equal(plan({ ...base, isStreaming: true, sessionFile: null }).reason, 'busy');
  });

  it('refuses a conversation that has no session file (history would be lost)', () => {
    for (const sessionFile of [null, undefined, '', '   ']) {
      assert.deepEqual(plan({ ...base, sessionFile }), { ok: false, reason: 'no-session-file' });
    }
  });

  it('allows a plain restart of a still-empty tab', () => {
    assert.deepEqual(plan({ ...base, sessionFile: null, messages: [] }), { ok: true, resume: null });
  });

  it('notices and tool cards alone do not count as a conversation', () => {
    const messages = [{ kind: 'assistant', notice: true }, { kind: 'tool' }, { kind: 'compact' }];
    assert.equal(hasConversation(messages), false);
    assert.deepEqual(plan({ ...base, sessionFile: null, messages }), { ok: true, resume: null });
  });
});

describe('SessionRestart.hasConversation', () => {
  it('true for a user turn or a real assistant reply', () => {
    assert.equal(hasConversation([{ kind: 'user' }]), true);
    assert.equal(hasConversation([{ kind: 'assistant', blocks: [] }]), true);
  });

  it('tolerates non-array / nullish entries', () => {
    assert.equal(hasConversation(null), false);
    assert.equal(hasConversation([null, undefined]), false);
  });
});
