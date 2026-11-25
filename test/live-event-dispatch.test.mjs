/**
 * test/live-event-dispatch.test.mjs
 *
 * live.js `_handleEvent` is a type → handler table fed by wire data, so it
 * must (a) route every event type the three event modules own and (b) ignore
 * inherited-property names like "constructor" / "__proto__" instead of
 * calling or choking on them.
 *
 * Run: node --test test/live-event-dispatch.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import './helpers/shim.mjs';
import { loadLive } from './helpers/load-live.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');
for (const rel of ['peer-session.js', 'app/undo-message.js', 'undo-bridge.js', 'export-bridge.js']) {
  // eslint-disable-next-line no-new-func
  new Function(readFileSync(join(SRC, rel), 'utf-8'))();
}
loadLive();

const bridge = globalThis.OMP_BRIDGE;

describe('live.js — event dispatch table', () => {
  it('ignores prototype-chain event types without throwing', () => {
    for (const type of ['constructor', '__proto__', 'toString', 'hasOwnProperty', undefined, '', 'nope']) {
      assert.doesNotThrow(() => bridge._handleEvent({ type }), String(type));
    }
  });

  it('routes message / tool / ui events to their modules', () => {
    bridge._handleEvent({ type: 'turn_start' });
    assert.equal(bridge.getState().isStreaming, true);

    bridge._handleEvent({ type: 'tool_execution_start', toolCallId: 'd1', toolName: 'bash', args: { command: 'ls' } });
    assert.ok(bridge.getState().runningTools.some(t => t.id === 'd1'));

    bridge._handleEvent({
      type: 'custom', customType: 'todo_edit',
      data: { phases: [{ name: 'P', tasks: [{ content: 'a', status: 'pending' }] }] },
    });
    assert.ok(bridge.getState().kanban.length > 0);

    bridge._handleEvent({ type: 'tool_execution_end', toolCallId: 'd1', toolName: 'bash', result: { content: [{ text: 'ok' }] } });
    assert.equal(bridge.getState().runningTools.some(t => t.id === 'd1'), false);

    bridge._handleEvent({ type: 'session_settled' });
    assert.equal(bridge.getState().isSettled, true);
  });

  it('onUpdate snapshot carries availableThinkingLevels like notify() does', () => {
    let first;
    const off = bridge.onUpdate(snap => { first ??= snap; });
    off();
    assert.ok('availableThinkingLevels' in first);
  });
});
