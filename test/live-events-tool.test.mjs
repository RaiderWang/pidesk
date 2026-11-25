/**
 * test/live-events-tool.test.mjs
 *
 * live/events-tool.js in isolation (collaborators injected): log truncation,
 * running/recent tool trail, hub task tracking, todo tools, activity-log
 * pruning and the ask-tool finalisation rule.
 *
 * Run: node --test test/live-events-tool.test.mjs
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import './helpers/shim.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');
for (const rel of ['live/defaults.js', 'live/runtime.js', 'live/todo-phases.js', 'live/events-tool.js']) {
  // eslint-disable-next-line no-new-func
  new Function(readFileSync(join(SRC, rel), 'utf-8'))();
}
globalThis.PeerSessionBridge = { build: () => null, id: null };

const { Runtime, TodoPhases, EventsTool, Defaults } = globalThis._Live;

let runtime, state, rt, notified, finalized, h;

beforeEach(() => {
  runtime = Runtime.create({
    defaults: Defaults, sessionRegistry: new Map(), sessionSnapshots: new Map(), pendingSetModel: [],
  });
  ({ state, rt } = runtime);
  notified = 0;
  finalized = [];
  h = EventsTool.create({
    state, rt, notify: () => { notified++; },
    todo: TodoPhases.create({ state, rt }),
    finalizeAsks: opts => finalized.push(opts),
    reindexToolCards: runtime.reindexToolCards,
  }).handlers;
});

const start = (id, toolName = 'bash', args = {}) =>
  h.tool_execution_start({ type: 'tool_execution_start', toolCallId: id, toolName, args });
const end = (id, extra = {}) =>
  h.tool_execution_end({ type: 'tool_execution_end', toolCallId: id, toolName: 'bash', ...extra });

describe('events-tool — start', () => {
  it('adds a card, a running entry, a log and notifies', () => {
    start('t1', 'bash', { command: 'ls -la' });
    assert.equal(state.messages.length, 1);
    assert.equal(rt.session.activeToolCards.get('t1'), 0);
    assert.equal(state.runningTools[0].target, 'ls -la');
    assert.deepEqual(state.toolLogs.t1.lines, ['$ ls -la']);
    assert.equal(notified, 1);
  });

  it('target is the last path segment for path-like args', () => {
    start('t2', 'read', { path: 'C:\\proj\\src\\main.rs' });
    assert.equal(state.runningTools[0].target, 'main.rs');
  });

  it('keeps a command ending in "2>/dev/null" intact (no path cut)', () => {
    const cmd = 'iconv -f gbk -t utf-8 file.txt 2>/dev/null';
    start('t2b', 'bash', { command: cmd });
    assert.equal(state.runningTools[0].target, cmd);
    assert.equal(state.toolLogs.t2b.target, cmd);
    assert.equal(state.toolLogs.t2b.command, cmd);
  });

  it('keeps a curl command with a URL intact', () => {
    const cmd = 'curl -s "http://qt.gtimg.cn/q=sh563020"';
    start('t2c', 'bash', { command: cmd });
    assert.equal(state.runningTools[0].target, cmd);
  });

  it('log command keeps the full path while target is the basename', () => {
    start('t2d', 'read', { path: 'C:\\proj\\src\\main.rs' });
    assert.equal(state.toolLogs.t2d.target, 'main.rs');
    assert.equal(state.toolLogs.t2d.command, 'C:\\proj\\src\\main.rs');
  });

  it('prunes activity-log entries older than 60s', () => {
    rt.session.activityLog = [{ ts: Date.now() - 120_000, toolName: 'old' }];
    start('t3');
    assert.equal(rt.session.activityLog.length, 1);
    assert.equal(rt.session.activityLog[0].toolName, 'bash');
  });

  it('a task tool switches the hub to tree mode and tracks its id', () => {
    state.hubAgents = [{ id: 'stale' }];
    start('task1', 'task', { tasks: [] });
    assert.equal(state.hubMode, 'tree');
    assert.equal(state.hubTaskId, 'task1');
    assert.deepEqual(state.hubAgents, []);
  });

  it('a todo tool feeds kanban and the inline plan', () => {
    state.messages = [{ kind: 'assistant', blocks: [{ type: 'text', text: 'hi' }] }];
    start('todo1', 'todo_write', { phases: [{ name: 'P', tasks: [{ content: 'a', status: 'pending' }] }] });
    assert.ok(state.kanban.length > 0);
    assert.ok(state.messages[0].blocks.some(b => b.type === 'plan'));
  });
});

describe('events-tool — update / end', () => {
  it('update keeps only the last 2000 lines of streamed output', () => {
    start('t1', 'bash', { command: 'x' });
    const text = Array.from({ length: 2500 }, (_, i) => `l${i}`).join('\n');
    h.tool_execution_update({ type: 'tool_execution_update', toolCallId: 't1', partialResult: { content: [{ text }] } });
    const lines = state.toolLogs.t1.lines;
    assert.equal(lines.length, 2000);
    assert.equal(lines[0], 'l500');
    assert.equal(lines[1999], 'l2499');
  });

  it('end truncates final output the same way and records status + duration', () => {
    start('t1');
    const output = Array.from({ length: 2100 }, (_, i) => `o${i}`).join('\n');
    end('t1', { result: { details: { output } } });
    const log = state.toolLogs.t1;
    assert.equal(log.status, 'completed');
    assert.equal(log.lines.length, 2000);
    assert.equal(log.lines.at(-1), 'o2099');
    assert.ok(log.durationMs >= 0);
  });

  it('isError marks the log failed', () => {
    start('t1');
    end('t1', { isError: true });
    assert.equal(state.toolLogs.t1.status, 'failed');
  });

  it('end removes the ephemeral card and the active-card entry', () => {
    start('t1');
    end('t1');
    assert.equal(state.messages.length, 0);
    assert.equal(rt.session.activeToolCards.size, 0);
    assert.equal(state.runningTools.length, 0);
  });

  it('keeps only the last 3 finished tools in the recent trail', () => {
    for (const id of ['a', 'b', 'c', 'd']) { start(id); end(id); }
    assert.deepEqual(state.recentTools.map(t => t.id), ['b', 'c', 'd']);
  });

  it('ending the tracked task moves the hub to summary and records history', () => {
    start('task1', 'task');
    end('task1', { toolName: 'task' });
    assert.equal(state.hubMode, 'summary');
    assert.equal(state.hubTaskId, null);
    assert.equal(state.hubHistory.length, 1);
    assert.equal(state.hubHistory[0].taskId, 'task1');
  });

  it('hub history keeps the last 3 tasks', () => {
    for (const id of ['t1', 't2', 't3', 't4']) { start(id, 'task'); end(id, { toolName: 'task' }); }
    assert.deepEqual(state.hubHistory.map(x => x.taskId), ['t2', 't3', 't4']);
  });

  it('a todo tool end without a start still updates kanban', () => {
    end('orphan', {
      toolName: 'todo_write',
      result: { details: { phases: [{ name: 'P', tasks: [{ content: 'a', status: 'pending' }] }] } },
    });
    assert.ok(state.kanban.length > 0);
  });
});

describe('events-tool — ask tool', () => {
  it('only the ask tool finalises asks; isError → aborted', () => {
    start('bash1');
    end('bash1');
    assert.equal(finalized.length, 0, 'another tool ending must not disturb an in-flight ask');

    start('ask1', 'ask');
    end('ask1', { toolName: 'ask' });
    assert.deepEqual(finalized, [{ aborted: false }]);

    start('ask2', 'ask');
    end('ask2', { toolName: 'ask', isError: true });
    assert.deepEqual(finalized.at(-1), { aborted: true });
  });

  it('end frame without toolName still finalises when the card was an ask', () => {
    start('ask3', 'ask');
    h.tool_execution_end({ type: 'tool_execution_end', toolCallId: 'ask3' });
    assert.equal(finalized.length, 1);
  });
});
