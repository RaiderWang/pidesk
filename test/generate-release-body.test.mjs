import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractChangelog, buildReleaseBody } from '../scripts/generate-release-body.mjs';

describe('extractChangelog', () => {
  const sampleChangelog = `
# Changelog

## [Unreleased]

## [0.3.2] - 2026-10-08

### Added
- Added cool feature A
- Added cool feature B

## [0.3.1] - 2026-09-30

### Fixed
- Fixed bug C
`;

  it('extracts target version block correctly with leading v', () => {
    const notes = extractChangelog(sampleChangelog, 'v0.3.2');
    assert.match(notes, /Added cool feature A/);
    assert.match(notes, /Added cool feature B/);
    assert.doesNotMatch(notes, /Fixed bug C/);
    assert.doesNotMatch(notes, /\[0\.3\.1\]/);
  });

  it('extracts target version block correctly without leading v', () => {
    const notes = extractChangelog(sampleChangelog, '0.3.1');
    assert.match(notes, /Fixed bug C/);
    assert.doesNotMatch(notes, /Added cool feature A/);
  });

  it('returns empty string if version not found', () => {
    const notes = extractChangelog(sampleChangelog, 'v0.9.9');
    assert.equal(notes, '');
  });
});

describe('buildReleaseBody', () => {
  it('includes title, changelog, and installation guide', () => {
    const body = buildReleaseBody('v0.3.2', '### Added\n- Feature X');
    assert.match(body, /## PiDesk v0.3.2/);
    assert.match(body, /### 🚀 What's Changed \/ 版本变更说明/);
    assert.match(body, /- Feature X/);
    assert.match(body, /### 📦 Installation Guide \/ 安装指南/);
  });

  it('still includes installation guide when changelog is empty', () => {
    const body = buildReleaseBody('v0.3.2', '');
    assert.match(body, /## PiDesk v0.3.2/);
    assert.doesNotMatch(body, /What's Changed/);
    assert.match(body, /### 📦 Installation Guide \/ 安装指南/);
  });
});
