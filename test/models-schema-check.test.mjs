/**
 * test/models-schema-check.test.mjs
 *
 * ModelsSchemaCheck.check mirrors omp's "string field must be a string" schema
 * rule on a parsed models.yml, so a config omp would reject is caught before save.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ModelsSchemaCheck, parseModelsYaml } from './helpers/shim.mjs';

const { check } = ModelsSchemaCheck;

describe('ModelsSchemaCheck.check', () => {
  it('accepts a valid config', () => {
    const parsed = parseModelsYaml(
      'providers:\n  p:\n    baseUrl: http://x/v1\n    apiKey: ENV_KEY\n    api: openai-completions\n    models:\n      - id: m1\n        name: M1\n        contextWindow: 1000\n',
    );
    assert.deepEqual(check(parsed), { ok: true, errors: [] });
  });

  it('flags a numeric apiKey with its path (the reported bug)', () => {
    const parsed = parseModelsYaml(
      'providers:\n  local-qwen:\n    baseUrl: http://x/v1\n    apiKey: 123\n    models: []\n',
    );
    const r = check(parsed);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, [
      { path: 'providers.local-qwen.apiKey', expected: 'string', got: 'number' },
    ]);
  });

  it('accepts a quoted numeric apiKey', () => {
    const parsed = parseModelsYaml('providers:\n  p:\n    apiKey: "123"\n    models: []\n');
    assert.equal(check(parsed).ok, true);
  });

  it('flags non-string model id and name with their index', () => {
    const parsed = parseModelsYaml(
      'providers:\n  p:\n    apiKey: k\n    models:\n      - id: ok\n      - id: true\n        name: 7\n',
    );
    assert.deepEqual(check(parsed).errors, [
      { path: 'providers.p.models[1].id', expected: 'string', got: 'boolean' },
      { path: 'providers.p.models[1].name', expected: 'string', got: 'number' },
    ]);
  });

  it('reports every problem across providers', () => {
    const r = check({
      providers: {
        a: { apiKey: 1, models: [] },
        b: { baseUrl: false, models: [{ id: 2 }] },
      },
    });
    assert.deepEqual(r.errors.map((e) => e.path), [
      'providers.a.apiKey',
      'providers.b.baseUrl',
      'providers.b.models[0].id',
    ]);
  });

  it('does not flag absent or null fields, and tolerates junk input', () => {
    assert.equal(check({ providers: { p: { apiKey: null, models: [{ id: 'x' }] } } }).ok, true);
    assert.equal(check({ providers: {} }).ok, true);
    assert.equal(check(null).ok, true);
    assert.equal(check({ providers: { p: null } }).ok, true);
  });
});
