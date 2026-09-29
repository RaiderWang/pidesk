/**
 * test/live-events.test.mjs
 *
 * Unit tests for live.js RPC event lifecycle:
 *   - tool_execution_start: runningTools tracking, toolLogs initialization, hub arg parsing
 *   - tool_execution_update: streaming log buffer accumulation
 *   - tool_execution_end: recentTools transition, log finalization, duration tracking
 *
 * Run: node --test test/live-events.test.mjs
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import './helpers/shim.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '../src');

function loadScript(rel) {
  const code = readFileSync(join(SRC, rel), 'utf-8');
  new Function(code)();
}

// Load peer-session and live.js
loadScript('peer-session.js');
loadScript('live.js');

const bridge = globalThis.OMP_BRIDGE;

describe('live.js — tool execution events', () => {
  it('bridge is initialized', () => {
    assert.ok(bridge);
    assert.equal(typeof bridge._handleEvent, 'function');
    assert.equal(typeof bridge.getState, 'function');
  });

  it('tool_execution_start adds tool to runningTools without ReferenceError', () => {
    bridge._handleEvent({
      type: 'tool_execution_start',
      toolCallId: 'tc_bash_1',
      toolName: 'bash',
      args: { command: 'python train.py' },
    });

    const state = bridge.getState();
    const running = state.runningTools.find(t => t.id === 'tc_bash_1');
    assert.ok(running, 'running tool should exist in state.runningTools');
    assert.equal(running.tool, 'bash');
    assert.equal(running.target, 'python train.py');

    const log = bridge.getToolLog('tc_bash_1');
    assert.ok(log, 'tool log should exist');
    assert.equal(log.status, 'running');
    assert.equal(log.command, 'python train.py');
    assert.deepEqual(log.lines, ['$ python train.py']);

    const msgCard = state.messages.find(m => m._toolCallId === 'tc_bash_1');
    assert.ok(msgCard, 'tool card should exist in state.messages while running');
    assert.equal(msgCard.status, 'running');
  });

  it('tool_execution_start correctly extracts hub target (op + ids)', () => {
    bridge._handleEvent({
      type: 'tool_execution_start',
      toolCallId: 'tc_hub_1',
      toolName: 'hub',
      args: { op: 'wait', ids: ['bg_1', 'bg_2'] },
    });

    const state = bridge.getState();
    const running = state.runningTools.find(t => t.id === 'tc_hub_1');
    assert.ok(running, 'hub tool should exist in runningTools');
    assert.equal(running.tool, 'hub');
    assert.equal(running.target, 'wait bg_1, bg_2');

    const log = bridge.getToolLog('tc_hub_1');
    assert.ok(log, 'hub log should exist');
    assert.equal(log.tool, 'hub');
    assert.equal(log.target, 'wait bg_1, bg_2');
  });

  it('tool_execution_update streams lines into toolLogs', () => {
    bridge._handleEvent({
      type: 'tool_execution_update',
      toolCallId: 'tc_bash_1',
      partialResult: {
        content: [{ type: 'text', text: 'Step 1/100: loss=0.85\nStep 2/100: loss=0.72' }],
      },
    });

    const log = bridge.getToolLog('tc_bash_1');
    assert.ok(log);
    assert.equal(log.lines.length, 2);
    assert.equal(log.lines[0], 'Step 1/100: loss=0.85');
    assert.equal(log.lines[1], 'Step 2/100: loss=0.72');
  });

  it('tool_execution_end moves tool from runningTools to recentTools', () => {
    bridge._handleEvent({
      type: 'tool_execution_end',
      toolCallId: 'tc_bash_1',
      result: {
        details: { output: 'Step 100/100: complete\nDone in 5.2s' },
      },
    });

    const state = bridge.getState();
    assert.ok(!state.runningTools.some(t => t.id === 'tc_bash_1'), 'tc_bash_1 should not be running');
    const recent = state.recentTools.find(t => t.id === 'tc_bash_1');
    assert.ok(recent, 'tc_bash_1 should be in recentTools');
    assert.equal(recent.tool, 'bash');
    assert.ok(typeof recent.durationMs === 'number', 'durationMs should be a number');

    const log = bridge.getToolLog('tc_bash_1');
    assert.equal(log.status, 'completed');
    assert.equal(log.lines.length, 2);
    assert.equal(log.lines[1], 'Done in 5.2s');

    assert.ok(!state.messages.some(m => m._toolCallId === 'tc_bash_1'), 'finished tool card should be removed from state.messages');
  });

  it('tool_execution_end records error status on failure', () => {
    bridge._handleEvent({
      type: 'tool_execution_end',
      toolCallId: 'tc_hub_1',
      isError: true,
      result: {
        content: [{ type: 'text', text: 'Task failed: bg_1 crashed' }],
      },
    });

    const state = bridge.getState();
    assert.ok(!state.runningTools.some(t => t.id === 'tc_hub_1'));
    const recent = state.recentTools.find(t => t.id === 'tc_hub_1');
    assert.ok(recent, 'tc_hub_1 should be in recentTools');

    const log = bridge.getToolLog('tc_hub_1');
    assert.equal(log.status, 'failed');
    assert.equal(log.lines[0], 'Task failed: bg_1 crashed');
  });

  it('recentTools is capped at 3 items (sliding window)', () => {
    for (let i = 1; i <= 5; i++) {
      bridge._handleEvent({
        type: 'tool_execution_start',
        toolCallId: `tc_seq_${i}`,
        toolName: 'read',
        args: { path: `file_${i}.txt` },
      });
      bridge._handleEvent({
        type: 'tool_execution_end',
        toolCallId: `tc_seq_${i}`,
        result: {},
      });
    }

    const state = bridge.getState();
    assert.equal(state.recentTools.length, 3, 'recentTools should be strictly capped at 3 items');
    assert.deepEqual(
      state.recentTools.map(t => t.id),
      ['tc_seq_3', 'tc_seq_4', 'tc_seq_5'],
      'recentTools should keep only the latest 3 items'
    );
  });

  it('ephemeral tool cards: multiple concurrent tools maintain correct indexing and are removed on completion', () => {
    bridge._handleEvent({
      type: 'tool_execution_start',
      toolCallId: 'tc_concur_a',
      toolName: 'read',
      args: { path: 'fileA.txt' },
    });
    bridge._handleEvent({
      type: 'tool_execution_start',
      toolCallId: 'tc_concur_b',
      toolName: 'bash',
      args: { command: 'npm test' },
    });

    let state = bridge.getState();
    assert.ok(state.messages.some(m => m._toolCallId === 'tc_concur_a'), 'tc_concur_a should be in messages');
    assert.ok(state.messages.some(m => m._toolCallId === 'tc_concur_b'), 'tc_concur_b should be in messages');

    // End tool A first
    bridge._handleEvent({
      type: 'tool_execution_end',
      toolCallId: 'tc_concur_a',
      result: { details: { lines: 10 } },
    });

    state = bridge.getState();
    assert.ok(!state.messages.some(m => m._toolCallId === 'tc_concur_a'), 'tc_concur_a should be removed');
    assert.ok(state.messages.some(m => m._toolCallId === 'tc_concur_b'), 'tc_concur_b should still be in messages');

    // Update tool B (streaming line) - index should be shifted correctly
    bridge._handleEvent({
      type: 'tool_execution_update',
      toolCallId: 'tc_concur_b',
      partialResult: {
        content: [{ type: 'text', text: 'All 10 tests passed' }],
        details: {},
      },
    });

    state = bridge.getState();
    const cardB = state.messages.find(m => m._toolCallId === 'tc_concur_b');
    assert.ok(cardB, 'tc_concur_b should still be found in messages');
    assert.ok(cardB.output?.some(l => l.line === 'All 10 tests passed'), 'streaming line should be applied to tc_concur_b');

    // End tool B
    bridge._handleEvent({
      type: 'tool_execution_end',
      toolCallId: 'tc_concur_b',
      result: { details: { output: 'Done' } },
    });

    state = bridge.getState();
    assert.ok(!state.messages.some(m => m._toolCallId === 'tc_concur_b'), 'tc_concur_b should be removed');
  });

  it('ephemeral tool cards: unended running tool cards are cleaned up when isStreaming becomes false', () => {
    bridge._handleEvent({
      type: 'tool_execution_start',
      toolCallId: 'tc_aborted_1',
      toolName: 'read',
      args: { path: 'abandoned.txt' },
    });

    let state = bridge.getState();
    assert.ok(state.messages.some(m => m._toolCallId === 'tc_aborted_1'), 'running card is in messages');

    // Simulate turn termination (e.g. abort without tool_execution_end)
    bridge._handleResponse({
      id: 99999,
      command: 'get_state',
      success: true,
      data: { isStreaming: false },
    });

    state = bridge.getState();
    assert.ok(!state.messages.some(m => m.kind === 'tool'), 'running tool card should be cleaned up on turn termination');
    assert.equal(state.runningTools.length, 0, 'runningTools should be empty');
  });
});

describe('live.js — resumeSession duplicate tab prevention', () => {
  it('resumes a session into a tab and activates existing tab on duplicate resume', async () => {
    const sessionObj = {
      id: 'test-session-uuid-1234',
      title: 'My Project Chat',
      path: 'C:\\Users\\user\\.omp\\agent\\sessions\\proj\\session.jsonl',
      cwd: 'C:\\Projects\\MyApp',
    };

    // First resume creates a tab
    const tabId1 = await bridge.resumeSession(sessionObj);
    assert.ok(tabId1, 'First resume should return a valid tab id');

    const sessions1 = bridge.getSessions();
    const tab1 = sessions1.find(s => s.id === tabId1);
    assert.ok(tab1, 'Created tab should exist in sessions list');
    assert.equal(tab1.sessionPath, sessionObj.path);
    assert.equal(tab1.savedSessionId, sessionObj.id);

    // Second resume with same session (even with normalized slashes) should NOT create a new tab
    const sessionObjSlashVariant = {
      ...sessionObj,
      path: 'c:/users/user/.omp/agent/sessions/proj/session.jsonl',
    };
    const tabId2 = await bridge.resumeSession(sessionObjSlashVariant);
    assert.equal(tabId2, tabId1, 'Second resume should return the same tab ID without creating a duplicate');

    const sessions2 = bridge.getSessions();
    const matchingTabs = sessions2.filter(s => s.sessionPath === sessionObj.path || s.savedSessionId === sessionObj.id);
    assert.equal(matchingTabs.length, 1, 'Should have exactly one tab for this saved session');
  });
});

describe('live.js — streaming assistant message and thinking process lifecycle', () => {
  it('message_start initializes streaming assistant bubble with thinking if present', () => {
    bridge._handleEvent({
      type: 'message_start',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Pondering the query...' },
        ],
      },
    });

    const state = bridge.getState();
    const streaming = state.messages.find(m => m.streaming === true);
    assert.ok(streaming, 'streaming bubble should exist');
    assert.equal(streaming.thought, 'Pondering the query...');
    assert.equal(streaming.lead, 'thinking');
  });

  it('message_update preserves thought when subsequent delta contains only text', () => {
    // First update: thinking and some initial text
    bridge._handleEvent({
      type: 'message_update',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Deep thought: evaluating AST changes.' },
          { type: 'text', text: 'Here is' },
        ],
      },
    });

    let state = bridge.getState();
    let streaming = state.messages.find(m => m.streaming === true);
    assert.equal(streaming.thought, 'Deep thought: evaluating AST changes.');
    assert.equal(streaming.blocks[0].text, 'Here is');

    // Second update: text delta only, thinking block omitted in this delta
    bridge._handleEvent({
      type: 'message_update',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Here is the completed code.' },
        ],
      },
    });

    state = bridge.getState();
    streaming = state.messages.find(m => m.streaming === true);
    assert.ok(streaming, 'streaming bubble still exists');
    assert.equal(streaming.thought, 'Deep thought: evaluating AST changes.', 'thought must be preserved when new delta lacks thinking block');
    assert.equal(streaming.blocks[0].text, 'Here is the completed code.');
  });

  it('message_end finalizes assistant bubble, preserving thought and resetting streaming flag', () => {
    bridge._handleEvent({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Here is the completed code.' },
        ],
        usage: { input: 50, output: 80 },
      },
    });

    const state = bridge.getState();
    const lastMsg = state.messages[state.messages.length - 1];
    assert.equal(lastMsg.kind, 'assistant');
    assert.equal(lastMsg.streaming, false);
    assert.equal(lastMsg.thought, 'Deep thought: evaluating AST changes.', 'thought should be preserved on message_end');
    assert.equal(lastMsg.lead, 'thinking');
    assert.equal(lastMsg.tokens, 130);
  });

  it('abrupt turn end (_applyRpcState isStreaming:false) finalizes streaming bubble instead of dropping it', () => {
    // Start another streaming turn
    bridge._handleEvent({
      type: 'message_start',
      message: {
        role: 'assistant',
        content: [{ type: 'reasoning', reasoning: 'Interrupted thought.' }],
      },
    });

    let state = bridge.getState();
    assert.ok(state.messages.some(m => m.streaming === true));

    // Turn finishes abruptly via get_state RPC
    bridge._handleResponse({
      id: 88888,
      command: 'get_state',
      success: true,
      data: { isStreaming: false },
    });

    state = bridge.getState();
    assert.ok(!state.messages.some(m => m.streaming === true), 'no bubbles should remain with streaming: true');
    const finalBubble = state.messages[state.messages.length - 1];
    assert.equal(finalBubble.kind, 'assistant');
    assert.equal(finalBubble.thought, 'Interrupted thought.');
    assert.equal(finalBubble.streaming, false);
  });

  it('set_model response re-pushes state.thinkingLevel so newly selected models do not lose thinking', async () => {
    const sentLines = [];
    const prevTauri = globalThis.window.__TAURI__;
    globalThis.window.__TAURI__ = {
      core: {
        invoke: async (name, args) => {
          if (name === 'send_command' && args?.json) {
            sentLines.push(JSON.parse(args.json));
          }
          return null;
        },
      },
      event: {
        listen: async () => () => {},
      },
    };

    try {
      const tabId = await bridge.resumeSession({
        id: 'test-thinking-restore',
        title: 'Thinking Test',
        path: 'C:\\Users\\user\\.omp\\agent\\sessions\\test\\session.jsonl',
      });
      assert.ok(tabId);

      const state = bridge.getState();
      state.thinkingLevel = 'medium';

      bridge._handleResponse({
        id: 99999,
        command: 'set_model',
        success: true,
        data: {
          id: 'gemini-3.8-flash',
          provider: 'cursor',
          name: 'Gemini 3.8 Flash',
        },
      });

      assert.equal(state.model.id, 'gemini-3.8-flash');
      assert.equal(state.thinkingLevel, 'medium');

      // Verify that set_thinking_level was sent with the current level
      const thinkingCmd = sentLines.find(cmd => cmd.type === 'set_thinking_level');
      assert.ok(thinkingCmd, 'should have re-sent set_thinking_level RPC on model change');
      assert.equal(thinkingCmd.level, 'medium');
    } finally {
      globalThis.window.__TAURI__ = prevTauri;
    }
  });

  it('tool_execution_end for todo updates state.kanban even without prior tool_execution_start (Cursor agent)', () => {
    bridge._handleEvent({
      type: 'tool_execution_end',
      toolCallId: 'cursor_todo_call_1',
      toolName: 'todo',
      result: {
        details: {
          phases: [
            {
              name: 'Tasks',
              tasks: [
                { content: 'Build frontend', status: 'completed' },
                { content: 'Integration test', status: 'in_progress' },
              ],
            },
          ],
        },
      },
    });

    const state = bridge.getState();
    assert.ok(state.kanban && state.kanban.length > 0, 'state.kanban should be updated');
    const tasks = state.kanban[0].tasks;
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].status, 'done');
    assert.equal(tasks[1].status, 'in_progress');
  });
});



