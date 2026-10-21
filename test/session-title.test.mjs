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

  it('safely clamps multi-byte surrogate pairs and emojis without producing lone surrogates', () => {
    const emojis = '😀😁😂😃😄';
    const clamped = SessionTitle.cleanSessionTitle(emojis, '', { maxLength: 3 });
    assert.equal(Array.from(clamped).length, 3);
    assert.equal(clamped, '😀😁😂');
  });
});

describe('SessionTitle.folderName', () => {
  it('extracts folder from Unix and Windows paths', () => {
    assert.equal(SessionTitle.folderName('/home/user/project'), 'project');
    assert.equal(SessionTitle.folderName('C:\\Users\\user\\project'), 'project');
  });

  it('ignores trailing slashes and backslashes', () => {
    assert.equal(SessionTitle.folderName('/home/user/project/'), 'project');
    assert.equal(SessionTitle.folderName('C:\\Users\\user\\project\\\\'), 'project');
  });

  it('handles empty and null inputs', () => {
    assert.equal(SessionTitle.folderName(''), '');
    assert.equal(SessionTitle.folderName(null), '');
    assert.equal(SessionTitle.folderName(undefined), '');
  });
});

describe('SessionTitle.isDefaultSessionName', () => {
  it('recognizes default PiDesk titles and resumed', () => {
    assert.equal(SessionTitle.isDefaultSessionName('PiDesk'), true);
    assert.equal(SessionTitle.isDefaultSessionName('PiDesk (2)'), true);
    assert.equal(SessionTitle.isDefaultSessionName('PiDesk(10)'), true);
    assert.equal(SessionTitle.isDefaultSessionName('pidesk'), true);
    assert.equal(SessionTitle.isDefaultSessionName('resumed'), true);
    assert.equal(SessionTitle.isDefaultSessionName(''), true);
    assert.equal(SessionTitle.isDefaultSessionName(null), true);
  });

  it('rejects customized or project titles', () => {
    assert.equal(SessionTitle.isDefaultSessionName('session'), false);
    assert.equal(SessionTitle.isDefaultSessionName('new session'), false);
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
    assert.equal(SessionTitle.isInitialSessionName('omp-desktop', 'F:/Project/omp-desktop/'), true);
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

  it('extracts folder from full path and trailing slashes', () => {
    assert.equal(SessionTitle.formatSessionTitle('优化查询性能', 'F:/Project/omp-desktop'), 'omp-desktop: 优化查询性能');
    assert.equal(SessionTitle.formatSessionTitle('优化查询性能', 'F:/Project/omp-desktop/'), 'omp-desktop: 优化查询性能');
  });

  it('does not duplicate existing folder prefix', () => {
    assert.equal(SessionTitle.formatSessionTitle('omp-desktop: 优化查询性能', 'omp-desktop'), 'omp-desktop: 优化查询性能');
  });

  it('is idempotent on already formatted titles', () => {
    const formatted = SessionTitle.formatSessionTitle('优化查询性能', 'omp-desktop');
    assert.equal(formatted, 'omp-desktop: 优化查询性能');
    const formattedAgain = SessionTitle.formatSessionTitle(formatted, 'omp-desktop');
    assert.equal(formattedAgain, 'omp-desktop: 优化查询性能');
    const fullPathAgain = SessionTitle.formatSessionTitle(formatted, 'F:/Project/omp-desktop/');
    assert.equal(fullPathAgain, 'omp-desktop: 优化查询性能');
  });

  it('strips Plan framing when formatting', () => {
    const framing = t('plan.intentFraming', { intent: '编写贪吃蛇游戏' }, undefined, 'zh-CN');
    const res = SessionTitle.formatSessionTitle(framing, 'game-proj', { undoMessage: UndoMessage, t });
    assert.equal(res, 'game-proj: 编写贪吃蛇游戏');
  });

  it('returns bare folderName when prompt is empty', () => {
    assert.equal(SessionTitle.formatSessionTitle('', 'omp-desktop'), 'omp-desktop');
    assert.equal(SessionTitle.formatSessionTitle('   ', 'omp-desktop'), 'omp-desktop');
    assert.equal(SessionTitle.formatSessionTitle('', 'F:/Project/omp-desktop/'), 'omp-desktop');
  });
});

describe('SessionTitle.cleanSessionTitle — file mentions', () => {
  it('strips leading @file mention tokens', () => {
    assert.equal(SessionTitle.cleanSessionTitle('@src/live.js Fix memory leak'), 'Fix memory leak');
    assert.equal(SessionTitle.cleanSessionTitle('@"path with spaces/file.js" Refactor UI'), 'Refactor UI');
    assert.equal(SessionTitle.cleanSessionTitle("@'single/quoted.js' Add unit tests"), 'Add unit tests');
  });

  it('returns empty string when prompt contains only file mentions', () => {
    assert.equal(SessionTitle.cleanSessionTitle('@src/live.js'), '');
    assert.equal(SessionTitle.cleanSessionTitle('@src/live.js @"docs/spec.md"'), '');
  });

  it('preserves email addresses', () => {
    assert.equal(SessionTitle.cleanSessionTitle('Contact support@example.com for help'), 'Contact support@example.com for help');
  });
});

describe('SessionTitle.resolveFolderTitle', () => {
  it('prioritizes folder name for project paths', () => {
    assert.equal(SessionTitle.resolveFolderTitle('/home/user/my-app', 'PiDesk'), 'my-app');
    assert.equal(SessionTitle.resolveFolderTitle('C:\\Projects\\billing-api\\', 'PiDesk'), 'billing-api');
  });

  it('resolves standalone workspace path to workspace', () => {
    assert.equal(SessionTitle.resolveFolderTitle('C:/Users/user/AppData/Local/com.raiderwang.pidesk/workspace', 'PiDesk'), 'workspace');
  });

  it('falls back to projectName when rootPath is empty or null', () => {
    assert.equal(SessionTitle.resolveFolderTitle('', 'PiDesk'), 'PiDesk');
    assert.equal(SessionTitle.resolveFolderTitle(null, 'Custom Name'), 'Custom Name');
    assert.equal(SessionTitle.resolveFolderTitle(undefined, ''), 'Files');
    assert.equal(SessionTitle.resolveFolderTitle(null, null), 'Files');
  });
});

describe('SessionTitle.nextTitle', () => {
  const initialStandalone = { name: 'PiDesk', path: '' };
  const initialProject = { name: 'omp-desktop', path: 'F:/Project/omp-desktop' };

  it('generates prompt title for initial standalone session', () => {
    const next = SessionTitle.nextTitle(initialStandalone, 'Write a quick python script');
    assert.equal(next, 'Write a quick python script');
  });

  it('generates folder-prefixed title for initial project session', () => {
    const next = SessionTitle.nextTitle(initialProject, 'Refactor session tab titles');
    assert.equal(next, 'omp-desktop: Refactor session tab titles');
  });

  it('skips slash commands (/plan, /compact, /review)', () => {
    assert.equal(SessionTitle.nextTitle(initialStandalone, '/plan design compiler'), null);
    assert.equal(SessionTitle.nextTitle(initialProject, '/compact'), null);
    assert.equal(SessionTitle.nextTitle(initialProject, '/review check changes'), null);
  });

  it('skips prompts consisting only of @file mentions', () => {
    assert.equal(SessionTitle.nextTitle(initialStandalone, '@src/live.js'), null);
    assert.equal(SessionTitle.nextTitle(initialProject, '@"docs/spec.md" @src/app.js'), null);
  });

  it('strips @file mentions when prompt includes text', () => {
    const next = SessionTitle.nextTitle(initialProject, '@src/live.js Fix memory leak in listeners');
    assert.equal(next, 'omp-desktop: Fix memory leak in listeners');
  });

  it('rejects update when titleLocked or userTitled is true (unless force: true)', () => {
    const lockedEntry = { name: 'omp-desktop: Existing task', path: 'F:/Project/omp-desktop', titleLocked: true };
    assert.equal(SessionTitle.nextTitle(lockedEntry, 'Another follow up question'), null);

    const legacyLockedEntry = { name: 'Existing task', path: '', userTitled: true };
    assert.equal(SessionTitle.nextTitle(legacyLockedEntry, 'Another follow up question'), null);
  });

  it('allows overwrite when force: true (e.g. omp session_info_update)', () => {
    const lockedEntry = { name: 'omp-desktop: Existing task', path: 'F:/Project/omp-desktop', titleLocked: true };
    const next = SessionTitle.nextTitle(lockedEntry, 'Renamed from slash command', { force: true });
    assert.equal(next, 'omp-desktop: Renamed from slash command');
  });

  it('returns null if formatted title equals existing name', () => {
    const projectEntry = { name: 'omp-desktop', path: 'F:/Project/omp-desktop' };
    assert.equal(SessionTitle.nextTitle(projectEntry, 'omp-desktop'), null);
  });
});


