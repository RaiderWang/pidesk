import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { describeFailure } = require('../src/app/link-toast.js');
const { t } = await import('./helpers/shim.mjs');

// Echoes key + params so assertions don't depend on the active locale.
const echo = (key, params) => `${key}|${JSON.stringify(params)}`;

describe('describeFailure', () => {
  it('reports a missing file by its base name (POSIX and Windows paths)', () => {
    assert.equal(
      describeFailure({ path: '/p/docs/路由配置说明.md' }, 'not found: /p/docs/路由配置说明.md', echo),
      'link.fail.notFound|{"name":"路由配置说明.md"}',
    );
    assert.equal(
      describeFailure({ path: 'C:/proj/a.md' }, 'not found: C:\\proj\\a.md', echo),
      'link.fail.notFound|{"name":"a.md"}',
    );
  });

  it('falls back to the error path when the target has none', () => {
    assert.equal(
      describeFailure({ kind: 'external' }, 'not found: /x/y.md', echo),
      'link.fail.notFound|{"name":"y.md"}',
    );
  });

  it('uses the generic message for other errors, including Error objects', () => {
    assert.equal(
      describeFailure({ path: '/p/a.md' }, 'Cannot open /p/a.md: denied', echo),
      'link.fail.generic|{"error":"Cannot open /p/a.md: denied"}',
    );
    assert.equal(
      describeFailure({ url: 'x' }, new Error('boom'), echo),
      'link.fail.generic|{"error":"boom"}',
    );
  });

  it('renders through the real i18n dictionary', () => {
    const msg = describeFailure({ path: '/p/a.md' }, 'not found: /p/a.md', t);
    assert.ok(msg.includes('a.md'));
    assert.notEqual(msg, 'link.fail.notFound');
  });
});
