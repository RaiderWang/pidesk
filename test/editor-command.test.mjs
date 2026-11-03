/**
 * test/editor-command.test.mjs
 *
 * Unit tests for src/app/editor-command.js: quoting a browsed editor path
 * and detecting a configured (non-blank) editor command.
 *
 * Run: node --test test/editor-command.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import './helpers/shim.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
new Function(readFileSync(join(__dirname, '../src/app/editor-command.js'), 'utf-8'))();
const { quoteIfNeeded, isConfigured } = window.EditorCommand;

describe('quoteIfNeeded', () => {
  it('quotes a Windows path with spaces', () => {
    const p = 'C:\\Users\\x\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe';
    assert.equal(quoteIfNeeded(p), `"${p}"`);
  });

  it('quotes a macOS app bundle path with spaces', () => {
    assert.equal(
      quoteIfNeeded('/Applications/Visual Studio Code.app'),
      '"/Applications/Visual Studio Code.app"'
    );
  });

  it('leaves a path without whitespace unchanged', () => {
    assert.equal(quoteIfNeeded('/usr/local/bin/code'), '/usr/local/bin/code');
  });

  it('is idempotent for an already quoted path', () => {
    assert.equal(quoteIfNeeded('"C:\\A B\\x.exe"'), '"C:\\A B\\x.exe"');
  });

  it('trims and returns empty for blank or non-string input', () => {
    assert.equal(quoteIfNeeded('   '), '');
    assert.equal(quoteIfNeeded(null), '');
    assert.equal(quoteIfNeeded(undefined), '');
  });
});

describe('isConfigured', () => {
  it('is true only for non-blank strings', () => {
    assert.equal(isConfigured('code -g'), true);
    assert.equal(isConfigured('  '), false);
    assert.equal(isConfigured(''), false);
    assert.equal(isConfigured(undefined), false);
  });
});
