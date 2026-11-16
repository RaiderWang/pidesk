/**
 * test/models-config-check.test.mjs
 *
 * ModelsConfigCheck decides when omp has ignored the custom models declared in
 * models.yml (which triggers the `omp models` diagnostic).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ModelsConfigCheck } from './helpers/shim.mjs';

const { missingCustomModels, missingKey, createRunner } = ModelsConfigCheck;
const custom = [
  { provider: 'arkcode', id: 'deepseek-v4.1-flash' },
  { provider: 'arkcode', id: 'glm-5.2' },
  { provider: 'local-qwen', id: 'qwen' },
];

describe('missingCustomModels', () => {
  it('is empty when omp lists every custom model', () => {
    assert.deepEqual(missingCustomModels(custom.map((m) => ({ ...m })), custom), []);
  });

  it('lists all custom models when omp dropped the providers (the reported bug)', () => {
    const rpc = [{ provider: 'anthropic', id: 'claude' }];
    assert.deepEqual(missingCustomModels(rpc, custom), [
      'arkcode/deepseek-v4.1-flash',
      'arkcode/glm-5.2',
      'local-qwen/qwen',
    ]);
  });

  it('matches on provider AND id, not id alone', () => {
    const rpc = [{ provider: 'other', id: 'glm-5.2' }];
    assert.ok(missingCustomModels(rpc, [{ provider: 'arkcode', id: 'glm-5.2' }]).includes('arkcode/glm-5.2'));
  });

  it('reports only the models that are absent', () => {
    const rpc = [{ provider: 'arkcode', id: 'glm-5.2' }, { provider: 'local-qwen', id: 'qwen' }];
    assert.deepEqual(missingCustomModels(rpc, custom), ['arkcode/deepseek-v4.1-flash']);
  });

  it('tolerates nullish input', () => {
    assert.deepEqual(missingCustomModels(null, undefined), []);
    assert.deepEqual(missingCustomModels(undefined, custom).length, 3);
  });
});

describe('missingKey', () => {
  it('is empty for no missing models and stable otherwise', () => {
    assert.equal(missingKey([]), '');
    assert.equal(missingKey(null), '');
    assert.equal(missingKey(['a/b', 'c/d']), missingKey(['a/b', 'c/d']));
    assert.notEqual(missingKey(['a/b']), missingKey(['a/b', 'c/d']));
  });
});

/** A `run` whose promises the test resolves by hand, in any order. */
function manualRun() {
  const calls = [];
  const run = () => new Promise((resolve) => calls.push(resolve));
  return { run, calls };
}
const flush = () => new Promise((r) => setImmediate(r));

describe('createRunner', () => {
  it('runs once per key and reports the trimmed text', async () => {
    const { run, calls } = manualRun();
    const seen = [];
    const runner = createRunner(run, (m) => seen.push(m));
    runner.request('a/b');
    runner.request('a/b'); // in flight: ignored
    await flush();
    assert.equal(calls.length, 1);
    calls[0]('  schema error \n');
    await flush();
    assert.deepEqual(seen, ['schema error']);
    runner.request('a/b'); // already diagnosed: ignored
    await flush();
    assert.equal(calls.length, 1);
  });

  it('reports null for an empty or non-string answer', async () => {
    const { run, calls } = manualRun();
    const seen = [];
    const runner = createRunner(run, (m) => seen.push(m));
    runner.request('a/b');
    await flush();
    calls[0]('   ');
    await flush();
    assert.deepEqual(seen, [null]);
  });

  it('an empty key clears the warning immediately', () => {
    const seen = [];
    createRunner(() => Promise.resolve('x'), (m) => seen.push(m)).request('');
    assert.deepEqual(seen, [null]);
  });

  it('discards the in-flight result once invalidated, then diagnoses again', async () => {
    const { run, calls } = manualRun();
    const seen = [];
    const runner = createRunner(run, (m) => seen.push(m));
    runner.request('a/b'); // old models.yml
    await flush();
    runner.invalidate(); // user saved models.yml
    runner.request(''); // fixed: nothing missing any more
    calls[0]('old schema error'); // the slow first run finally answers
    await flush();
    assert.deepEqual(seen, [null], 'stale answer must not bring the banner back');

    runner.request('a/b'); // same key again after a refresh is re-diagnosed
    await flush();
    assert.equal(calls.length, 2);
  });

  it('invalidate lets the same key start a fresh run while the old one is in flight', async () => {
    const { run, calls } = manualRun();
    const seen = [];
    const runner = createRunner(run, (m) => seen.push(m));
    runner.request('a/b');
    await flush();
    runner.invalidate();
    runner.request('a/b');
    await flush();
    assert.equal(calls.length, 2);
    calls[0]('stale');
    calls[1]('fresh');
    await flush();
    assert.deepEqual(seen, ['fresh']);
  });

  it('a newer key supersedes an older in-flight run', async () => {
    const { run, calls } = manualRun();
    const seen = [];
    const runner = createRunner(run, (m) => seen.push(m));
    runner.request('a/b');
    runner.request('a/b\nc/d');
    await flush();
    assert.equal(calls.length, 2);
    calls[1]('new');
    calls[0]('old');
    await flush();
    assert.deepEqual(seen, ['new']);
  });

  it('a failing run can be retried', async () => {
    let n = 0;
    const runner = createRunner(() => (++n === 1 ? Promise.reject(new Error('boom')) : Promise.resolve('ok')), () => {});
    runner.request('a/b');
    await flush();
    runner.request('a/b');
    await flush();
    assert.equal(n, 2);
  });
});
