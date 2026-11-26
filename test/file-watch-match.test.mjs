/**
 * test/file-watch-match.test.mjs
 *
 * app/file-watch-match.js — does a `files://changed` payload concern the
 * panel's root? Run: node --test test/file-watch-match.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FileWatchMatch } from './helpers/shim.mjs';

const { normalize, isSameOrInside, matchesEvent } = FileWatchMatch;

describe('FileWatchMatch.normalize', () => {
  it('unifies separators and drops trailing slashes', () => {
    assert.equal(normalize('C:\\Proj\\app\\'), 'C:/Proj/app');
    assert.equal(normalize('/home/me/app///'), '/home/me/app');
  });

  it('keeps filesystem roots intact', () => {
    assert.equal(normalize('/'), '/');
    assert.equal(normalize('C:\\'), 'C:/');
    assert.equal(normalize('c:'), 'c:/');
  });

  it('returns "" for non-strings and empty input', () => {
    assert.equal(normalize(''), '');
    assert.equal(normalize(null), '');
    assert.equal(normalize(undefined), '');
  });
});

describe('FileWatchMatch.isSameOrInside', () => {
  it('matches the same dir and real children', () => {
    assert.equal(isSameOrInside('/p/app', '/p/app'), true);
    assert.equal(isSameOrInside('/p/app', '/p/app/src'), true);
    assert.equal(isSameOrInside('/p/app/', '/p/app'), true);
  });

  it('compares on directory boundaries: a sibling sharing a prefix is not inside', () => {
    assert.equal(isSameOrInside('c:/proj/app', 'c:/proj/app-v2'), false);
    assert.equal(isSameOrInside('/p/app', '/p/application/x'), false);
  });

  it('does not match a parent for a child base', () => {
    assert.equal(isSameOrInside('/p/app/src', '/p/app'), false);
  });

  it('works for filesystem roots', () => {
    assert.equal(isSameOrInside('/', '/anything'), true);
    assert.equal(isSameOrInside('C:\\', 'c:\\proj'), true);
  });

  it('is case-insensitive for Windows paths only', () => {
    assert.equal(isSameOrInside('C:\\Proj\\App', 'c:/proj/app/src'), true);
    assert.equal(isSameOrInside('/p/App', '/p/app'), false);
  });

  it('is false when either side is empty', () => {
    assert.equal(isSameOrInside('', '/p'), false);
    assert.equal(isSameOrInside('/p', ''), false);
  });
});

describe('FileWatchMatch.matchesEvent', () => {
  const root = 'C:\\Proj\\app';

  it('matches on watch id', () => {
    assert.equal(matchesEvent({ watchId: root, path: 'elsewhere' }, root, root), true);
  });

  it('matches on a covering path when the id differs', () => {
    assert.equal(matchesEvent({ watchId: 'old', path: 'C:/Proj' }, root, root), true);
  });

  it('does not match a sibling directory sharing a prefix', () => {
    assert.equal(matchesEvent({ watchId: 'old', path: 'C:\\Proj\\app-v2' }, root, root), false);
  });

  it('never matches an empty or missing payload', () => {
    assert.equal(matchesEvent(null, root, root), false);
    assert.equal(matchesEvent(undefined, root, root), false);
    assert.equal(matchesEvent({}, root, root), false);
    assert.equal(matchesEvent('files', root, root), false);
  });
});
