/**
 * test/session-title.test.mjs
 *
 * Unit tests for src/app/session-title.js:
 *   - Normalizes newlines, tabs, and multiple spaces into single space
 *   - Strips leading Markdown heading prefixes (#, ##, etc.)
 *   - Strips Plan mode intent framing templates (en and zh-CN)
 *   - Clamps max length to default or custom maxLength
 *   - Handles empty / undefined / null inputs with fallback
 *
 * Run: node --test test/session-title.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/shim.mjs';
import { SessionTitle, UndoMessage, t } from './helpers/shim.mjs';

describe('SessionTitle.cleanSessionTitle', () => {
  it('returns clean short titles unmodified', () => {
    const res = SessionTitle.cleanSessionTitle('Refactor login flow');
    assert.equal(res, 'Refactor login flow');
  });

  it('handles empty or whitespace-only inputs with fallback', () => {
    assert.equal(SessionTitle.cleanSessionTitle('', 'resumed'), 'resumed');
    assert.equal(SessionTitle.cleanSessionTitle('   ', 'PiDesk'), 'PiDesk');
    assert.equal(SessionTitle.cleanSessionTitle(null, 'default'), 'default');
    assert.equal(SessionTitle.cleanSessionTitle(undefined, 'fallback'), 'fallback');
  });

  it('normalizes newlines, carriage returns, and tabs to single spaces', () => {
    const input = 'First line\nSecond line\r\nThird line\twith tabs';
    const expected = 'First line Second line Third line with tabs';
    assert.equal(SessionTitle.cleanSessionTitle(input), expected);
  });

  it('collapses multiple consecutive spaces and trims edges', () => {
    const input = '   Analyze    frontend    architecture   ';
    assert.equal(SessionTitle.cleanSessionTitle(input), 'Analyze frontend architecture');
  });

  it('strips Markdown heading markers at start of string', () => {
    assert.equal(SessionTitle.cleanSessionTitle('# Urgent Bugfix'), 'Urgent Bugfix');
    assert.equal(SessionTitle.cleanSessionTitle('### Task Summary'), 'Task Summary');
    assert.equal(SessionTitle.cleanSessionTitle('###### Deep Analysis'), 'Deep Analysis');
  });

  it('strips Plan mode framing in English', () => {
    // English plan intent framing template from i18n
    const framing = t('plan.intentFraming', { intent: 'Optimize sqlite queries' }, undefined, 'en');
    const cleaned = SessionTitle.cleanSessionTitle(framing, '', { undoMessage: UndoMessage, t });
    assert.equal(cleaned, 'Optimize sqlite queries');
  });

  it('strips Plan mode framing in Chinese', () => {
    // Chinese plan intent framing template from i18n
    const framing = t('plan.intentFraming', { intent: '优化数据库查询' }, undefined, 'zh-CN');
    const cleaned = SessionTitle.cleanSessionTitle(framing, '', { undoMessage: UndoMessage, t });
    assert.equal(cleaned, '优化数据库查询');
  });

  it('caps string length to maxLength (default 100 characters)', () => {
    const longText = 'A'.repeat(150);
    const cleaned = SessionTitle.cleanSessionTitle(longText);
    assert.equal(cleaned.length, 100);
    assert.equal(cleaned, 'A'.repeat(100));
  });

  it('respects custom maxLength option', () => {
    const text = 'This is a somewhat long prompt that needs truncation';
    const cleaned = SessionTitle.cleanSessionTitle(text, '', { maxLength: 20 });
    assert.equal(cleaned.length, 20);
    assert.equal(cleaned, 'This is a somewhat l');
  });
});

describe('SessionTitle.isDefaultSessionName', () => {
  it('recognizes default PiDesk titles with and without numbers', () => {
    assert.equal(SessionTitle.isDefaultSessionName('PiDesk'), true);
    assert.equal(SessionTitle.isDefaultSessionName('PiDesk (2)'), true);
    assert.equal(SessionTitle.isDefaultSessionName('PiDesk(10)'), true);
    assert.equal(SessionTitle.isDefaultSessionName('pidesk'), true);
  });

  it('recognizes generic fallback names', () => {
    assert.equal(SessionTitle.isDefaultSessionName('new session'), true);
    assert.equal(SessionTitle.isDefaultSessionName('resumed'), true);
    assert.equal(SessionTitle.isDefaultSessionName('session'), true);
    assert.equal(SessionTitle.isDefaultSessionName(''), true);
    assert.equal(SessionTitle.isDefaultSessionName(null), true);
  });

  it('rejects customized or project titles', () => {
    assert.equal(SessionTitle.isDefaultSessionName('omp-desktop'), false);
    assert.equal(SessionTitle.isDefaultSessionName('Fix tab title truncation'), false);
    assert.equal(SessionTitle.isDefaultSessionName('贪吃蛇小游戏'), false);
  });
});

describe('SessionTitle.isInitialSessionName', () => {
  it('treats default standalone names as initial', () => {
    assert.equal(SessionTitle.isInitialSessionName('PiDesk', ''), true);
    assert.equal(SessionTitle.isInitialSessionName('PiDesk (2)', ''), true);
  });

  it('treats bare folder name as initial before user prompt', () => {
    assert.equal(SessionTitle.isInitialSessionName('omp-desktop', 'omp-desktop'), true);
    assert.equal(SessionTitle.isInitialSessionName('omp-desktop', 'F:/Project/omp-desktop'), true);
  });

  it('rejects once title has been formatted with prompt', () => {
    assert.equal(SessionTitle.isInitialSessionName('omp-desktop: 优化查询', 'omp-desktop'), false);
    assert.equal(SessionTitle.isInitialSessionName('贪吃蛇小游戏', ''), false);
  });
});

describe('SessionTitle.formatSessionTitle', () => {
  it('formats standalone prompt without prefix', () => {
    assert.equal(SessionTitle.formatSessionTitle('优化查询性能', ''), '优化查询性能');
  });

  it('formats project session as folderName: prompt', () => {
    assert.equal(SessionTitle.formatSessionTitle('优化查询性能', 'omp-desktop'), 'omp-desktop: 优化查询性能');
  });

  it('extracts folder from full path', () => {
    assert.equal(SessionTitle.formatSessionTitle('优化查询性能', 'F:/Project/omp-desktop'), 'omp-desktop: 优化查询性能');
  });

  it('does not duplicate existing folder prefix', () => {
    assert.equal(SessionTitle.formatSessionTitle('omp-desktop: 优化查询性能', 'omp-desktop'), 'omp-desktop: 优化查询性能');
  });

  it('strips Plan framing when formatting', () => {
    const framing = t('plan.intentFraming', { intent: '编写贪吃蛇游戏' }, undefined, 'zh-CN');
    const res = SessionTitle.formatSessionTitle(framing, 'game-proj', { undoMessage: UndoMessage, t });
    assert.equal(res, 'game-proj: 编写贪吃蛇游戏');
  });

  it('returns bare folderName when prompt is empty', () => {
    assert.equal(SessionTitle.formatSessionTitle('', 'omp-desktop'), 'omp-desktop');
    assert.equal(SessionTitle.formatSessionTitle('   ', 'omp-desktop'), 'omp-desktop');
  });
});


