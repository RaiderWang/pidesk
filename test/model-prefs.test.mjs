/**
 * test/model-prefs.test.mjs
 *
 * Pure helpers for the persisted last-used-model preference.
 * Regression: a model renamed/deleted in models.yml left a dangling
 * `provider/id` in localStorage that every new session re-pushed to omp.
 *
 * Run: node --test test/model-prefs.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/shim.mjs';

const { stripModel, isStaleCustomModel } = globalThis.ModelPrefs;

const custom = (models, providers) => ({
  customModels: models,
  customProviders: new Set(providers ?? models.map((m) => m.provider)),
});

describe('ModelPrefs.stripModel', () => {
  it('drops the three model keys and keeps the rest', () => {
    const out = stripModel({
      modelId: 'a', modelProvider: 'p', modelName: 'A', thinkingLevel: 'high', other: 1,
    });
    assert.deepEqual(out, { thinkingLevel: 'high', other: 1 });
  });

  it('does not mutate its input', () => {
    const prefs = { modelId: 'a', modelProvider: 'p', thinkingLevel: 'low' };
    stripModel(prefs);
    assert.equal(prefs.modelId, 'a');
  });

  it('tolerates missing / non-object input', () => {
    assert.deepEqual(stripModel(null), {});
    assert.deepEqual(stripModel(undefined), {});
  });
});

describe('ModelPrefs.isStaleCustomModel', () => {
  const prefs = { modelId: 'deepseek-v4-flash', modelProvider: 'arkcode' };

  it('true when the id was renamed under a custom provider', () => {
    const data = custom([{ id: 'deepseek-v4.1-flash', provider: 'arkcode' }]);
    assert.equal(isStaleCustomModel(prefs, data), true);
  });

  it('true when the model was deleted but the provider remains', () => {
    const data = custom([], ['arkcode']);
    assert.equal(isStaleCustomModel(prefs, data), true);
  });

  it('false while the model is still listed', () => {
    const data = custom([{ id: 'deepseek-v4-flash', provider: 'arkcode' }]);
    assert.equal(isStaleCustomModel(prefs, data), false);
  });

  it('same id under another provider does not keep it alive', () => {
    const data = custom(
      [{ id: 'deepseek-v4-flash', provider: 'other' }],
      ['arkcode', 'other'],
    );
    assert.equal(isStaleCustomModel(prefs, data), true);
  });

  it('never stale for built-in / OAuth providers absent from models.yml', () => {
    const data = custom([{ id: 'x', provider: 'arkcode' }]);
    assert.equal(
      isStaleCustomModel({ modelId: 'claude-sonnet', modelProvider: 'anthropic' }, data),
      false,
    );
  });

  it('false without a saved model or without models.yml data', () => {
    assert.equal(isStaleCustomModel({ thinkingLevel: 'low' }, custom([], ['arkcode'])), false);
    assert.equal(isStaleCustomModel(null, custom([], ['arkcode'])), false);
    assert.equal(isStaleCustomModel(prefs, null), false);
    assert.equal(isStaleCustomModel(prefs, { customModels: [], customProviders: new Set() }), false);
  });
});
