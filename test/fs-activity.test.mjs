/**
 * test/fs-activity.test.mjs
 *
 * app/fs-activity.js — which tool calls may have changed files (drives the
 * file tree's agent-side refresh). The `rt.seq.fsEpoch` bumps themselves are
 * covered in live-events-tool / live-events-message tests.
 * Run: node --test test/fs-activity.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FsActivity } from './helpers/shim.mjs';

const { mayChangeFiles } = FsActivity;

describe('FsActivity.mayChangeFiles', () => {
  it('treats look-only tools as read-only (raw and normalized names)', () => {
    for (const n of ['read', 'grep', 'find', 'glob', 'ls', 'search', 'web_search', 'fetch', 'todo', 'todo_write', 'ask', 'hub']) {
      assert.equal(mayChangeFiles(n), false, n);
    }
  });

  it('counts writers and unknown tools', () => {
    for (const n of ['bash', 'edit', 'write', 'ast_edit', 'lsp', 'eval', 'task', 'some_new_tool']) {
      assert.equal(mayChangeFiles(n), true, n);
    }
  });

  it('is case-insensitive and treats a missing name as a possible write', () => {
    assert.equal(mayChangeFiles('READ'), false);
    assert.equal(mayChangeFiles(undefined), true);
    assert.equal(mayChangeFiles(''), true);
  });
});
