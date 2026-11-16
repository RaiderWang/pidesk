/**
 * test/models-config-check.test.mjs
 *
 * ModelsConfigCheck decides when omp has ignored the custom models declared in
 * models.yml (which triggers the `omp models` diagnostic).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ModelsConfigCheck } from './helpers/shim.mjs';

const { missingCustomModels, missingKey } = ModelsConfigCheck;
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
