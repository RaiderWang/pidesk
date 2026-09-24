/**
 * test/adapter.test.mjs
 *
 * Unit tests for src/adapter.js — all 14 exported pure-transform functions.
 * Private helpers (_parseUnifiedDiff, _accumulateLines) are exercised
 * indirectly through finalizeToolCard / updateToolCard.
 *
 * Run: node --test test/adapter.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeToolName,
  todoStatusToDesign,
  phaseStyle,
  derivePlanPhase,
  buildKanban,
  buildPlanMeta,
  formatTokens,
  buildCtx,
  formatModelId,
  buildActivityFromLog,
  buildToolStartCard,
  finalizeToolCard,
  updateToolCard,
  adaptAgentMessages,
  timeNow,
} from './helpers/shim.mjs';

// ── helpers ────────────────────────────────────────────────────────────────

/** Build a minimal "running" tool card for finalize/update tests. */
function runningCard(tool, extra = {}) {
  return {
    kind: 'tool', tool, title: tool, target: '', summary: '',
    status: 'running', duration: null, time: '00:00:00',
    _toolCallId: 'tc-test', _startMs: Date.now(),
    ...extra,
  };
}

// ── normalizeToolName ──────────────────────────────────────────────────────

describe('normalizeToolName', () => {
  it('maps all known aliases', () => {
    assert.equal(normalizeToolName('read'),       'read');
    assert.equal(normalizeToolName('search'),     'search');
    assert.equal(normalizeToolName('edit'),       'edit');
    assert.equal(normalizeToolName('ast_edit'),   'edit');
    assert.equal(normalizeToolName('bash'),       'bash');
    assert.equal(normalizeToolName('write'),      'write');
    assert.equal(normalizeToolName('todo_write'), 'todo');
    assert.equal(normalizeToolName('find'),       'search');
    assert.equal(normalizeToolName('web_search'), 'search');
    assert.equal(normalizeToolName('lsp'),        'search');
    assert.equal(normalizeToolName('eval'),       'eval');
    assert.equal(normalizeToolName('task'),       'task');
    assert.equal(normalizeToolName('quick_task'), 'task');
    assert.equal(normalizeToolName('debug'),      'debug');
    assert.equal(normalizeToolName('ask'),        'ask');
  });

  it('passes through unknown names unchanged', () => {
    assert.equal(normalizeToolName('magic'),   'magic');
    assert.equal(normalizeToolName('UNKNOWN'), 'UNKNOWN');
    assert.equal(normalizeToolName(''),        '');
  });
});

// ── todoStatusToDesign ─────────────────────────────────────────────────────

describe('todoStatusToDesign', () => {
  it('maps all four known statuses', () => {
    assert.equal(todoStatusToDesign('pending'),     'pending');
    assert.equal(todoStatusToDesign('in_progress'), 'in_progress');
    assert.equal(todoStatusToDesign('completed'),   'done');
    assert.equal(todoStatusToDesign('abandoned'),   'done');
  });

  it('falls back to "pending" for unknown or empty values', () => {
    assert.equal(todoStatusToDesign('unknown'),   'pending');
    assert.equal(todoStatusToDesign(''),          'pending');
    assert.equal(todoStatusToDesign(undefined),   'pending');
  });
});

// ── phaseStyle ─────────────────────────────────────────────────────────────

describe('phaseStyle', () => {
  it('returns an object with tone and icon', () => {
    const s = phaseStyle(0);
    assert.ok(typeof s.tone === 'string' && s.tone.length > 0, 'tone must be non-empty string');
    assert.ok(typeof s.icon === 'string' && s.icon.length > 0, 'icon must be non-empty string');
  });

  it('cycles back to index 0 after 5 entries', () => {
    assert.deepEqual(phaseStyle(0), phaseStyle(5));
    assert.deepEqual(phaseStyle(1), phaseStyle(6));
    assert.deepEqual(phaseStyle(4), phaseStyle(9));
  });

  it('all 5 base styles are distinct', () => {
    const styles = Array.from({ length: 5 }, (_, i) => phaseStyle(i));
    const tones = styles.map(s => s.tone);
    const unique = new Set(tones);
    assert.equal(unique.size, 5, 'all 5 tones should be distinct');
  });
});

// ── derivePlanPhase ────────────────────────────────────────────────────────

describe('derivePlanPhase', () => {
  it('returns "review" for empty phase list', () => {
    assert.equal(derivePlanPhase([]), 'review');
  });

  it('returns "review" when all tasks are pending', () => {
    const phases = [{ tasks: [{ status: 'pending' }, { status: 'pending' }] }];
    assert.equal(derivePlanPhase(phases), 'review');
  });

  it('returns "running" when any task is in_progress', () => {
    const phases = [{ tasks: [{ status: 'completed' }, { status: 'in_progress' }] }];
    assert.equal(derivePlanPhase(phases), 'running');
  });

  it('returns "done" when all tasks are completed', () => {
    const phases = [{ tasks: [{ status: 'completed' }, { status: 'completed' }] }];
    assert.equal(derivePlanPhase(phases), 'done');
  });

  it('returns "done" when all tasks are completed or abandoned', () => {
    const phases = [{ tasks: [{ status: 'completed' }, { status: 'abandoned' }] }];
    assert.equal(derivePlanPhase(phases), 'done');
  });

  it('spans multiple phases correctly', () => {
    const phases = [
      { tasks: [{ status: 'completed' }] },
      { tasks: [{ status: 'in_progress' }] },
    ];
    assert.equal(derivePlanPhase(phases), 'running');
  });
});

// ── buildKanban ────────────────────────────────────────────────────────────

describe('buildKanban', () => {
  it('returns empty array for empty input', () => {
    assert.deepEqual(buildKanban([]), []);
  });

  it('converts a single phase into a column', () => {
    const phases = [{
      name: 'Setup',
      tasks: [{ content: 'Install deps', status: 'completed', notes: ['fast'] }],
    }];
    const [col] = buildKanban(phases);
    assert.equal(col.id,    'setup');
    assert.equal(col.title, 'Setup');
    assert.ok(col.tone, 'tone must be set');
    assert.ok(col.icon, 'icon must be set');
    assert.equal(col.tasks.length, 1);
    assert.equal(col.tasks[0].text,   'Install deps');
    assert.equal(col.tasks[0].status, 'done');
    assert.equal(col.tasks[0].reason, 'fast');
    assert.equal(col.tasks[0].id,     '0-0');
  });

  it('slugifies phase names (spaces → dashes, lowercase)', () => {
    const phases = [{ name: 'Build Phase', tasks: [] }];
    assert.equal(buildKanban(phases)[0].id, 'build-phase');
  });

  it('sets reason to null when notes is absent', () => {
    const phases = [{ name: 'P', tasks: [{ content: 'x', status: 'pending' }] }];
    assert.equal(buildKanban(phases)[0].tasks[0].reason, null);
  });

  it('cycles phase style after 5 columns', () => {
    const phases = Array.from({ length: 6 }, (_, i) => ({ name: `P${i}`, tasks: [] }));
    const cols = buildKanban(phases);
    assert.equal(cols[0].tone, cols[5].tone);
    assert.equal(cols[0].icon, cols[5].icon);
  });

  it('assigns sequential task ids within a column', () => {
    const phases = [{ name: 'P', tasks: [{ content: 'a', status: 'pending' }, { content: 'b', status: 'pending' }] }];
    const tasks = buildKanban(phases)[0].tasks;
    assert.equal(tasks[0].id, '0-0');
    assert.equal(tasks[1].id, '0-1');
  });
});

// ── buildPlanMeta ──────────────────────────────────────────────────────────

describe('buildPlanMeta', () => {
  it('extracts branch name from sessionFile (POSIX path)', () => {
    const state = { sessionFile: '/home/user/.omp/sessions/my-branch.jsonl', sessionName: 'task' };
    const meta = buildPlanMeta([], state);
    assert.equal(meta.branch, 'my-branch');
  });

  it('handles Windows backslash paths in sessionFile', () => {
    const state = { sessionFile: 'C:\\Users\\user\\.omp\\sessions\\win-branch.jsonl' };
    const meta = buildPlanMeta([], state);
    assert.equal(meta.branch, 'win-branch');
  });

  it('defaults branch to "session" when sessionFile is absent', () => {
    assert.equal(buildPlanMeta([], {}).branch, 'session');
    assert.equal(buildPlanMeta([], null).branch, 'session');
  });

  it('uses sessionName as ask field', () => {
    const meta = buildPlanMeta([], { sessionName: 'my task' });
    assert.equal(meta.ask, 'my task');
  });

  it('extracts file-like tokens from task content', () => {
    const phases = [{ tasks: [{ content: 'Edit src/adapter.js and test/foo.spec.ts to fix bug' }] }];
    const meta = buildPlanMeta(phases, {});
    assert.ok(meta.touches.includes('src/adapter.js'), 'should find adapter.js');
    assert.ok(meta.touches.includes('test/foo.spec.ts'), 'should find spec file');
  });

  it('caps touches at 6', () => {
    const content = 'a.js b.ts c.py d.rs e.go f.rb g.java h.cpp';
    const meta = buildPlanMeta([{ tasks: [{ content }] }], {});
    assert.ok(meta.touches.length <= 6);
  });

  it('de-duplicates file mentions across tasks', () => {
    const phases = [{
      tasks: [
        { content: 'edit src/adapter.js' },
        { content: 'test src/adapter.js again' },
      ],
    }];
    const meta = buildPlanMeta(phases, {});
    const count = meta.touches.filter(f => f === 'src/adapter.js').length;
    assert.equal(count, 1, 'duplicate file should appear only once');
  });

  it('returns correct structural defaults', () => {
    const meta = buildPlanMeta([], {});
    assert.equal(meta.strategy, '');
    assert.deepEqual(meta.risks, []);
    assert.deepEqual(meta.estimate, { tokens: '—', cost: '—', wall: '—' });
  });
});

// ── formatTokens ───────────────────────────────────────────────────────────

describe('formatTokens', () => {
  it('returns em-dash for null', () => {
    assert.equal(formatTokens(null), '—');
  });

  it('returns em-dash for undefined', () => {
    assert.equal(formatTokens(undefined), '—');
  });

  it('returns raw string for 0', () => {
    assert.equal(formatTokens(0), '0');
  });

  it('returns raw string for values under 1000', () => {
    assert.equal(formatTokens(999), '999');
    assert.equal(formatTokens(1),   '1');
  });

  it('formats exactly 1000 as "1.0k"', () => {
    assert.equal(formatTokens(1000), '1.0k');
  });

  it('formats large numbers with k suffix', () => {
    assert.equal(formatTokens(1500),   '1.5k');
    assert.equal(formatTokens(200000), '200.0k');
  });
});

// ── buildCtx ───────────────────────────────────────────────────────────────

describe('buildCtx', () => {
  it('handles null rpcState without throwing', () => {
    const ctx = buildCtx(null, null, null);
    assert.equal(ctx.used,         0);
    assert.equal(ctx.total,        200000);
    assert.equal(ctx.pct,          0);
    assert.equal(ctx.cost,         '$0.00');
    assert.equal(ctx.tokensPerSec, 0);
  });

  it('builds correct ctx from full rpc state', () => {
    const rpc = { contextUsage: { tokens: 5000, contextWindow: 100000, percent: 5 } };
    const ctx = buildCtx(rpc, 0.12, 25.6);
    assert.equal(ctx.used,         5000);
    assert.equal(ctx.total,        100000);
    assert.equal(ctx.pct,          5);
    assert.equal(ctx.label,        '5.0k / 100.0k');
    assert.equal(ctx.cost,         '$0.12');
    assert.equal(ctx.tokensPerSec, 26);
  });

  it('computes pct from tokens/contextWindow when percent is absent', () => {
    const rpc = { contextUsage: { tokens: 10000, contextWindow: 200000 } };
    const ctx = buildCtx(rpc, null, null);
    assert.equal(ctx.pct, 5);
  });

  it('defaults cost to "$0.00" when sessionCost is null', () => {
    assert.equal(buildCtx(null, null, 0).cost, '$0.00');
  });

  it('formats cost with two decimal places', () => {
    assert.equal(buildCtx(null, 1.5, 0).cost, '$1.50');
    assert.equal(buildCtx(null, 0.1, 0).cost, '$0.10');
  });
});

// ── formatModelId ──────────────────────────────────────────────────────────

describe('formatModelId', () => {
  it('strips claude- prefix and date suffix', () => {
    assert.equal(formatModelId('claude-3-5-sonnet-20241022'), '3 5 Sonnet');
    assert.equal(formatModelId('claude-3-5-haiku-20241022'),  '3 5 Haiku');
  });

  it('strips gpt- prefix', () => {
    assert.equal(formatModelId('gpt-4o-mini'), '4o Mini');
  });

  it('strips gemini- prefix', () => {
    assert.equal(formatModelId('gemini-2-0-flash'), '2 0 Flash');
  });

  it('strips deepseek- prefix', () => {
    assert.equal(formatModelId('deepseek-chat'), 'Chat');
  });

  it('strips -latest suffix', () => {
    assert.equal(formatModelId('claude-3-opus-latest'), '3 Opus');
  });

  it('strips -preview suffix', () => {
    assert.equal(formatModelId('gpt-4-turbo-preview'), '4 Turbo');
  });

  it('title-cases each word', () => {
    const result = formatModelId('gpt-4o');
    assert.equal(result, '4o');  // starts with digit, no capital change expected
  });
});

// ── buildActivityFromLog ───────────────────────────────────────────────────

describe('buildActivityFromLog', () => {
  it('returns empty array for empty log', () => {
    assert.deepEqual(buildActivityFromLog([]), []);
  });

  it('filters out entries older than 60 seconds', () => {
    const now = Date.now();
    const log = [
      { ts: now - 10_000, toolName: 'read' },
      { ts: now - 70_000, toolName: 'edit' },  // too old
    ];
    const result = buildActivityFromLog(log);
    assert.equal(result.length, 1);
    assert.equal(result[0].k, 'read');
  });

  it('normalizes tool names through normalizeToolName', () => {
    const log = [{ ts: Date.now() - 100, toolName: 'ast_edit' }];
    assert.equal(buildActivityFromLog(log)[0].k, 'edit');
  });

  it('sets t to elapsed seconds (±1s tolerance)', () => {
    const log = [{ ts: Date.now() - 5000, toolName: 'bash' }];
    const t = buildActivityFromLog(log)[0].t;
    assert.ok(t >= 4 && t <= 6, `expected ~5, got ${t}`);
  });

  it('keeps all entries within the 60s window', () => {
    const now = Date.now();
    const log = Array.from({ length: 5 }, (_, i) => ({ ts: now - i * 10_000, toolName: 'search' }));
    assert.equal(buildActivityFromLog(log).length, 5);
  });
});

// ── buildToolStartCard ─────────────────────────────────────────────────────

describe('buildToolStartCard', () => {
  it('extracts path arg as target', () => {
    const ev = { toolName: 'read', toolCallId: 'tc1', args: { path: 'src/foo.js' } };
    const card = buildToolStartCard(ev, '12:00:00');
    assert.equal(card.tool,   'read');
    assert.equal(card.target, 'src/foo.js');
    assert.equal(card.status, 'running');
    assert.equal(card.time,   '12:00:00');
    assert.equal(card.kind,   'tool');
  });

  it('extracts command arg for bash', () => {
    const ev = { toolName: 'bash', toolCallId: 'tc2', args: { command: 'npm test' } };
    assert.equal(buildToolStartCard(ev, '').target, 'npm test');
  });

  it('extracts query arg for search', () => {
    const ev = { toolName: 'web_search', toolCallId: 'tc3', args: { query: 'node test runner' } };
    assert.equal(buildToolStartCard(ev, '').target, 'node test runner');
  });

  it('prefers intent over derived title', () => {
    const ev = { toolName: 'bash', toolCallId: 'tc4', args: { command: 'npm test' }, intent: 'Run tests' };
    assert.equal(buildToolStartCard(ev, '').title, 'Run tests');
  });

  it('derives title as "toolName · target" when intent absent and target present', () => {
    const ev = { toolName: 'read', toolCallId: 'tc5', args: { path: 'src/foo.js' } };
    assert.equal(buildToolStartCard(ev, '').title, 'read · src/foo.js');
  });

  it('falls back to toolName when no intent and no target', () => {
    const ev = { toolName: 'eval', toolCallId: 'tc6', args: {} };
    assert.equal(buildToolStartCard(ev, '').title, 'eval');
  });

  it('handles null args gracefully', () => {
    const ev = { toolName: 'bash', toolCallId: 'tc7', args: null };
    assert.equal(buildToolStartCard(ev, '').target, '');
  });

  it('normalizes tool name in the card', () => {
    const ev = { toolName: 'ast_edit', toolCallId: 'tc8', args: { path: 'f.js' } };
    assert.equal(buildToolStartCard(ev, '').tool, 'edit');
  });
});

// ── finalizeToolCard ───────────────────────────────────────────────────────

describe('finalizeToolCard', () => {
  it('sets status to "ok"', () => {
    const done = finalizeToolCard(runningCard('read'), { result: { details: {} } });
    assert.equal(done.status, 'ok');
  });

  it('sets a numeric duration', () => {
    const done = finalizeToolCard(runningCard('read'), { result: { details: {} } });
    assert.ok(typeof done.duration === 'number', 'duration should be a number');
  });

  // read tool
  it('read: populates summary from details.lines', () => {
    const done = finalizeToolCard(runningCard('read'), { result: { details: { lines: 42 } } });
    assert.equal(done.summary, '42 lines');
  });

  // search tool
  it('search: populates preview from details.matches', () => {
    const event = { result: { details: { matches: { 'src/a.js': [1, 2, 3], 'src/b.js': 2 } } } };
    const done = finalizeToolCard(runningCard('search'), event);
    assert.ok(Array.isArray(done.preview));
    const a = done.preview.find(p => p.file === 'src/a.js');
    assert.equal(a.hits, 3, 'array value → length');
    const b = done.preview.find(p => p.file === 'src/b.js');
    assert.equal(b.hits, 2, 'numeric value → direct');
  });

  it('search: caps preview at 5 entries', () => {
    const matches = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`f${i}.js`, i]));
    const done = finalizeToolCard(runningCard('search'), { result: { details: { matches } } });
    assert.ok(done.preview.length <= 5);
  });

  // edit tool — indirectly exercises _parseUnifiedDiff
  it('edit: parses unified diff and counts adds/rems', () => {
    const diffStr = [
      '--- a/src/foo.js',
      '+++ b/src/foo.js',
      '@@ -1,2 +1,3 @@',
      ' const x = 1;',
      '-const y = 2;',
      '+const y = 3;',
      '+const z = 4;',
    ].join('\n');
    const done = finalizeToolCard(runningCard('edit'), { result: { details: { diff: diffStr } } });
    assert.ok(Array.isArray(done.diff));
    assert.equal(done.adds, 2);
    assert.equal(done.rems, 1);
    const addLines = done.diff.filter(l => l.kind === 'add');
    assert.equal(addLines.length, 2);
    const remLines = done.diff.filter(l => l.kind === 'rem');
    assert.equal(remLines.length, 1);
    const ctxLines = done.diff.filter(l => l.kind === 'ctx');
    assert.equal(ctxLines.length, 1);
  });

  it('edit: diff lines carry correct line numbers', () => {
    const diffStr = [
      '@@ -1,1 +1,2 @@',
      '+// header',
      ' const x = 1;',
    ].join('\n');
    const done = finalizeToolCard(runningCard('edit'), { result: { details: { diff: diffStr } } });
    const add = done.diff.find(l => l.kind === 'add');
    const ctx = done.diff.find(l => l.kind === 'ctx');
    assert.equal(add.line, 1);
    assert.equal(ctx.line, 2);
  });

  it('edit: sets adds/rems to 0 when no diff present', () => {
    const done = finalizeToolCard(runningCard('edit'), { result: { details: {} } });
    assert.equal(done.adds, 0);
    assert.equal(done.rems, 0);
  });

  // bash tool
  it('bash: colorizes output lines by content pattern', () => {
    const output = '✓ All tests passed\nError: something failed\ninfo line';
    const done = finalizeToolCard(runningCard('bash'), { result: { details: { output } } });
    assert.ok(Array.isArray(done.output));
    assert.equal(done.output[0].color, 'accent');
    assert.equal(done.output[1].color, 'rose');
    assert.equal(done.output[2].color, 'fg-3');
  });

  it('bash: PASS line gets accent color', () => {
    const done = finalizeToolCard(runningCard('bash'), { result: { details: { output: 'PASS test suite' } } });
    assert.equal(done.output[0].color, 'accent');
  });

  it('bash: FAIL line gets rose color', () => {
    const done = finalizeToolCard(runningCard('bash'), { result: { details: { output: 'FAIL: assertion error' } } });
    assert.equal(done.output[0].color, 'rose');
  });

  // eval tool
  it('eval: maps cells from details', () => {
    const cells = [{ code: '1+1', language: 'js', output: '2', status: 'done', title: 't', durationMs: 5 }];
    const done = finalizeToolCard(runningCard('eval'), { result: { details: { cells, language: 'js' } } });
    assert.equal(done.cells.length, 1);
    assert.equal(done.cells[0].code, '1+1');
    assert.equal(done.cells[0].output, '2');
    assert.equal(done.evalLanguage, 'js');
  });

  // task tool — indirectly exercises _accumulateLines
  it('task: merges progress and results, accumulates output stream', () => {
    const card = runningCard('task', {
      subagents: [{
        index: 0, id: 's0', agent: 'worker', status: 'running', task: 'do stuff',
        lastIntent: null, currentTool: null, toolCount: 1, tokens: 50, durationMs: 200,
        recentOutput: ['line1'], _stream: ['line1'], output: null, error: null,
      }],
    });
    const event = {
      result: {
        details: {
          progress: [{
            index: 0, id: 's0', agent: 'worker', status: 'completed', task: 'do stuff',
            lastIntent: null, currentTool: null, toolCount: 2, tokens: 100, durationMs: 500,
            recentOutput: ['line1', 'line2'], _stream: ['line1'],
          }],
          results: [{
            // exitCode: 0 must be explicit — undefined !== 0 is true, which marks the task failed
            index: 0, id: 's0', tokens: 100, durationMs: 500, exitCode: 0,
            output: 'line1\nline2\nline3', error: null,
          }],
        },
      },
    };
    const done = finalizeToolCard(card, event);
    assert.equal(done.subagents[0].status, 'completed');
    assert.equal(done.subagents[0].tokens, 100);
    // _accumulateLines(['line1'], ['line1','line2','line3']) → ['line1','line2','line3']
    assert.deepEqual(done.subagents[0]._stream, ['line1', 'line2', 'line3']);
  });

  it('task: marks aborted subagent as "aborted"', () => {
    const card = runningCard('task', { subagents: [] });
    const event = {
      result: {
        details: {
          progress: [],
          results: [{ index: 0, id: 's0', tokens: 0, durationMs: 0, output: null, error: null, aborted: true }],
        },
      },
    };
    const done = finalizeToolCard(card, event);
    assert.equal(done.subagents[0].status, 'aborted');
  });
});

// ── updateToolCard ─────────────────────────────────────────────────────────

describe('updateToolCard', () => {
  it('returns original card reference when partialResult has no details', () => {
    const card = runningCard('read');
    const result = updateToolCard(card, { partialResult: {} });
    assert.equal(result, card, 'should return the exact same object reference');
  });

  it('keeps status as "running" after update', () => {
    const card = runningCard('eval');
    const cells = [{ code: 'x', language: 'py', output: 'y', status: 'running', title: 'c' }];
    const updated = updateToolCard(card, { partialResult: { details: { cells } } });
    assert.equal(updated.status, 'running');
  });

  // eval streaming
  it('eval: updates cells from details', () => {
    const card = runningCard('eval');
    const cells = [
      { code: 'print(1)', language: 'py', output: '1', status: 'done',    title: 'step1' },
      { code: 'print(2)', language: 'py', output: '',  status: 'running', title: 'step2' },
    ];
    const updated = updateToolCard(card, { partialResult: { details: { cells } } });
    assert.equal(updated.cells.length, 2);
    assert.equal(updated.cells[0].code, 'print(1)');
    assert.equal(updated.cells[1].status, 'running');
  });

  // bash streaming
  it('bash: updates output from content text', () => {
    const card = runningCard('bash');
    const text = '✓ PASS\nnormal line\nError: boom';
    const updated = updateToolCard(card, {
      partialResult: { content: [{ text }], details: {} },
    });
    assert.ok(Array.isArray(updated.output));
    assert.equal(updated.output[0].color, 'accent');  // ✓ PASS
    assert.equal(updated.output[1].color, 'fg-3');    // normal
    assert.equal(updated.output[2].color, 'rose');    // Error:
  });

  it('bash: keeps last 20 lines when output exceeds 20', () => {
    const card = runningCard('bash');
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const text = lines.join('\n');
    const updated = updateToolCard(card, {
      partialResult: { content: [{ text }], details: {} },
    });
    assert.equal(updated.output.length, 20);
    assert.equal(updated.output[0].line, 'line 10', 'should be last 20 lines');
  });

  // task streaming — indirectly exercises _accumulateLines prefix-growth
  it('task: accumulates streaming lines with prefix overlap', () => {
    const card = runningCard('task', {
      subagents: [{
        index: 0, id: 's0', agent: 'w', status: 'running', task: 't',
        lastIntent: null, currentTool: null, toolCount: 0, tokens: 0, durationMs: 0,
        recentOutput: ['line1'], _stream: ['line1'], output: null, error: null,
      }],
    });
    // New snapshot contains ['line1', 'line2'] — extends previous ['line1']
    const progress = [{
      index: 0, id: 's0', agent: 'w', status: 'running', task: 't',
      lastIntent: null, currentTool: null, toolCount: 1, tokens: 10, durationMs: 100,
      recentOutput: ['line1', 'line2'],
    }];
    const updated = updateToolCard(card, { partialResult: { details: { progress } } });
    // _accumulateLines(['line1'], ['line1','line2']) → ['line1','line2']
    assert.deepEqual(updated.subagents[0]._stream, ['line1', 'line2']);
  });
});

// ── adaptAgentMessages ─────────────────────────────────────────────────────

describe('adaptAgentMessages', () => {
  it('returns [] for null input', () => {
    assert.deepEqual(adaptAgentMessages(null), []);
  });

  it('returns [] for empty array', () => {
    assert.deepEqual(adaptAgentMessages([]), []);
  });

  it('skips non-object entries silently', () => {
    assert.deepEqual(adaptAgentMessages([null, undefined, 'string', 42]), []);
  });

  // user messages
  it('converts a user text message', () => {
    const msgs = [{ role: 'user', content: [{ type: 'text', text: 'Hello!' }] }];
    const [msg] = adaptAgentMessages(msgs);
    assert.equal(msg.kind,  'user');
    assert.equal(msg.text,  'Hello!');
    assert.deepEqual(msg.images, []);
  });

  it('skips user messages that contain only tool_result blocks', () => {
    const msgs = [{ role: 'user', content: [{ type: 'tool_result', content: 'data' }] }];
    assert.deepEqual(adaptAgentMessages(msgs), []);
  });

  it('joins multiple text blocks for user message', () => {
    const msgs = [{ role: 'user', content: [{ type: 'text', text: 'Part A' }, { type: 'text', text: 'Part B' }] }];
    const [msg] = adaptAgentMessages(msgs);
    assert.equal(msg.text, 'Part A\nPart B');
  });

  it('includes image blocks in user message', () => {
    const msgs = [{
      role: 'user',
      content: [
        { type: 'text',  text: 'Look at this' },
        { type: 'image', data: 'base64abc', mimeType: 'image/png' },
      ],
    }];
    const [msg] = adaptAgentMessages(msgs);
    assert.equal(msg.images.length, 1);
    assert.equal(msg.images[0].data,     'base64abc');
    assert.equal(msg.images[0].mimeType, 'image/png');
  });

  it('defaults image mimeType to "image/png" when absent', () => {
    const msgs = [{
      role: 'user',
      content: [
        { type: 'text',  text: 'img' },
        { type: 'image', data: 'abc' },
      ],
    }];
    assert.equal(adaptAgentMessages(msgs)[0].images[0].mimeType, 'image/png');
  });

  // assistant messages
  it('converts an assistant text message', () => {
    const msgs = [{ role: 'assistant', content: [{ type: 'text', text: 'Here is my answer.' }] }];
    const [msg] = adaptAgentMessages(msgs);
    assert.equal(msg.kind, 'assistant');
    assert.equal(msg.blocks[0].text, 'Here is my answer.');
    assert.equal(msg.streaming, false);
    assert.equal(msg.thought, null);
  });

  it('extracts thinking block as thought, sets lead to "thinking"', () => {
    const msgs = [{
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Let me think...' },
        { type: 'text',     text:     'My answer.' },
      ],
    }];
    const [msg] = adaptAgentMessages(msgs);
    assert.equal(msg.thought, 'Let me think...');
    assert.equal(msg.lead,    'thinking');
  });

  it('skips empty/whitespace thinking blocks', () => {
    const msgs = [{
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '   ' },
        { type: 'text',     text:     'Answer' },
      ],
    }];
    const [msg] = adaptAgentMessages(msgs);
    assert.equal(msg.thought, null);
    assert.equal(msg.lead,    null);
  });

  it('skips tool_use blocks from assistant content', () => {
    const msgs = [{
      role: 'assistant',
      content: [
        { type: 'text',     text: 'I will edit the file.' },
        { type: 'tool_use', id: 'tc1', name: 'edit', input: {} },
      ],
    }];
    const [msg] = adaptAgentMessages(msgs);
    assert.equal(msg.blocks.length, 1);
    assert.equal(msg.blocks[0].text, 'I will edit the file.');
  });

  it('skips assistant messages with no text or thinking blocks', () => {
    const msgs = [{ role: 'assistant', content: [{ type: 'tool_use', id: 'tc1', name: 'edit', input: {} }] }];
    assert.deepEqual(adaptAgentMessages(msgs), []);
  });

  // usage shapes
  it('handles RPC usage shape {input, output}', () => {
    const msgs = [{
      role: 'assistant',
      content: [{ type: 'text', text: 'R' }],
      usage: { input: 100, output: 200 },
    }];
    const [msg] = adaptAgentMessages(msgs);
    assert.equal(msg.tokensIn,  100);
    assert.equal(msg.tokensOut, 200);
    assert.equal(msg.tokens,    300);
  });

  it('handles Anthropic raw usage shape {input_tokens, output_tokens}', () => {
    const msgs = [{
      role: 'assistant',
      content: [{ type: 'text', text: 'R' }],
      usage: { input_tokens: 150, output_tokens: 250 },
    }];
    const [msg] = adaptAgentMessages(msgs);
    assert.equal(msg.tokens, 400);
  });

  it('sets tokens to null when no usage field present', () => {
    const msgs = [{ role: 'assistant', content: [{ type: 'text', text: 'R' }] }];
    const [msg] = adaptAgentMessages(msgs);
    assert.equal(msg.tokens, null);
  });
});

// ── timeNow ────────────────────────────────────────────────────────────────

describe('timeNow', () => {
  it('returns a HH:MM:SS formatted string', () => {
    assert.match(timeNow(), /^\d{2}:\d{2}:\d{2}$/);
  });

  it('returns valid hour/minute/second values', () => {
    const [h, m, s] = timeNow().split(':').map(Number);
    assert.ok(h >= 0 && h <= 23, `hour ${h} out of range`);
    assert.ok(m >= 0 && m <= 59, `minute ${m} out of range`);
    assert.ok(s >= 0 && s <= 59, `second ${s} out of range`);
  });
});
