/**
 * test/live-empty-bubble.test.mjs
 *
 * live.js: tool-call-only assistant turns must not leave a blank bubble.
 *   - message_end drops a content-less bubble (and keeps real / failed ones)
 *   - message_end of other roles never closes the in-flight assistant bubble
 *   - interrupted turns (no message_end) are cleaned up when settled
 *
 * Run: node --test test/live-empty-bubble.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import './helpers/shim.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');
const loadScript = (rel) => new Function(readFileSync(join(SRC, rel), 'utf-8'))();

loadScript('peer-session.js');
loadScript('app/undo-message.js');
loadScript('undo-bridge.js');
loadScript('live.js');

const bridge = globalThis.OMP_BRIDGE;
const asstMsgs = () => bridge.getState().messages.filter((m) => m.kind === 'assistant');
const start = () => bridge._handleEvent({ type: 'message_start', message: { role: 'assistant', content: [] } });
const end = (message) => bridge._handleEvent({ type: 'message_end', message: { role: 'assistant', ...message } });
const toolCallOnly = [{ type: 'toolCall', id: 'c1', name: 'edit', arguments: {} }];

describe('live.js — content-less assistant bubbles', () => {
  it('drops tool-call-only assistant turns on message_end', () => {
    const before = asstMsgs().length;
    for (let i = 0; i < 5; i++) {
      start();
      assert.equal(asstMsgs().length, before + 1, 'placeholder shows while streaming');
      end({ content: toolCallOnly });
      assert.equal(asstMsgs().length, before, `turn ${i} leaves no assistant row`);
    }
  });

  it('keeps turns with text and drops whitespace-only text', () => {
    const before = asstMsgs().length;
    start();
    end({ content: [{ type: 'text', text: 'done' }] });
    assert.equal(asstMsgs().length, before + 1);

    start();
    bridge._handleEvent({
      type: 'message_update',
      message: { role: 'assistant', content: [{ type: 'text', text: '\n\n' }] },
    });
    end({ content: [{ type: 'text', text: '\n\n' }] });
    assert.equal(asstMsgs().length, before + 1, 'whitespace-only turn removed');
  });

  it('whitespace-only errorMessage is not a failure: the blank bubble is dropped', () => {
    const before = asstMsgs().length;
    start();
    end({ content: toolCallOnly, errorMessage: '   ' });
    assert.equal(asstMsgs().length, before);
  });

  it('shows errorMessage on a turn that failed after streaming some text', () => {
    start();
    end({ content: [{ type: 'text', text: 'partial' }], stopReason: 'error', errorMessage: 'stream cut' });
    const last = asstMsgs().at(-1);
    assert.equal(last.blocks[0].text, 'partial');
    assert.equal(last.error.message, 'stream cut');
  });

  it('message_end without a message payload drops a blank bubble and never the tail', () => {
    const before = asstMsgs().length;
    start();
    bridge._handleEvent({ type: 'message_end' });
    assert.equal(asstMsgs().length, before);

    // Out-of-sync list (no streaming entry): leave the last message alone.
    start();
    const st = bridge.getState();
    st.messages = st.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m));
    st.messages = [...st.messages, { kind: 'user', time: '00:00', text: 'tail', images: [] }];
    const count = st.messages.length;
    bridge._handleEvent({ type: 'message_end' });
    assert.equal(bridge.getState().messages.length, count);
    assert.equal(bridge.getState().messages.at(-1).text, 'tail');
  });

  it('keeps a failed turn and exposes errorMessage on it', () => {
    const before = asstMsgs().length;
    start();
    end({ content: [], stopReason: 'error', errorMessage: 'rate limited', provider: 'acme', model: 'm1' });
    const msgs = asstMsgs();
    assert.equal(msgs.length, before + 1);
    assert.equal(msgs.at(-1).error.message, 'rate limited');
    assert.equal(msgs.at(-1).error.provider, 'acme');

    // prompt_result overwrites that bubble's error (no extra bubble).
    bridge._handleEvent({ type: 'prompt_result', status: 'error', error: { message: 'detailed', retryable: true } });
    assert.equal(asstMsgs().length, before + 1);
    assert.equal(asstMsgs().at(-1).error.message, 'detailed');
  });

  it('ignores message_end of other roles while an assistant bubble streams', () => {
    start();
    bridge._handleEvent({ type: 'message_end', message: { role: 'user', content: [] } });
    bridge._handleEvent({ type: 'message_end', message: { role: 'toolResult', content: [] } });
    const streaming = bridge.getState().messages.find((m) => m.streaming === true);
    assert.ok(streaming, 'assistant bubble still streaming');
    end({ content: toolCallOnly });
    assert.ok(!bridge.getState().messages.some((m) => m.streaming === true));
  });

  it('never removes the last message when no streaming entry is found', () => {
    start();
    const st = bridge.getState();
    st.messages = st.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m));
    st.messages = [...st.messages, { kind: 'user', time: '00:00', text: 'keep me', images: [] }];
    const count = st.messages.length;
    end({ content: toolCallOnly });
    const after = bridge.getState().messages;
    assert.equal(after.length, count);
    assert.equal(after.at(-1).text, 'keep me');
  });

  it('keeps activeToolCards indices valid when the bubble before a running tool is dropped', () => {
    start();
    bridge._handleEvent({
      type: 'tool_execution_start', toolCallId: 'tc_idx', toolName: 'bash', args: { command: 'ls' },
    });
    end({ content: toolCallOnly });
    assert.equal(asstMsgs().some((m) => m.streaming), false);

    bridge._handleEvent({
      type: 'tool_execution_update',
      toolCallId: 'tc_idx',
      partialResult: { content: [{ type: 'text', text: 'file-a' }], details: {} },
    });
    const card = bridge.getState().messages.find((m) => m._toolCallId === 'tc_idx');
    assert.ok(card?.output?.some((l) => l.line === 'file-a'), 'update reached the right card');
    bridge._handleEvent({ type: 'tool_execution_end', toolCallId: 'tc_idx', toolName: 'bash', result: {} });
  });

  it('abort() drops a blank placeholder and keeps one that has a thought', () => {
    const before = asstMsgs().length;
    start();
    bridge.abort();
    assert.equal(asstMsgs().length, before);
    assert.ok(!bridge.getState().messages.some((m) => m.streaming === true));

    bridge._handleEvent({
      type: 'message_start',
      message: { role: 'assistant', content: [{ type: 'reasoning', reasoning: 'Aborted thought.' }] },
    });
    bridge.abort();
    assert.equal(asstMsgs().length, before + 1);
    assert.equal(asstMsgs().at(-1).thought, 'Aborted thought.');
  });

  it('turn_end removes a placeholder that never got message_end; keeps one with a thought', () => {
    const before = asstMsgs().length;
    start();
    bridge._handleEvent({ type: 'turn_end', message: {} });
    assert.equal(asstMsgs().length, before, 'empty placeholder removed');

    bridge._handleEvent({
      type: 'message_start',
      message: { role: 'assistant', content: [{ type: 'reasoning', reasoning: 'Interrupted thought.' }] },
    });
    bridge._handleEvent({ type: 'turn_end', message: {} });
    const last = asstMsgs().at(-1);
    assert.equal(asstMsgs().length, before + 1);
    assert.equal(last.thought, 'Interrupted thought.');
    assert.equal(last.streaming, false);
  });
});
