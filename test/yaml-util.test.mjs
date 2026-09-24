/**
 * test/yaml-util.test.mjs
 *
 * Unit tests for src/design/yaml-util.js public API:
 *   parseModelsYaml / dumpModelsYaml / validateModelsYaml
 *
 * parseScalar and formatScalar are private helpers — they are exercised
 * indirectly through the round-trip tests.
 *
 * Run: node --test test/yaml-util.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseModelsYaml, dumpModelsYaml, validateModelsYaml } from './helpers/shim.mjs';

// ── parseModelsYaml ────────────────────────────────────────────────────────

describe('parseModelsYaml', () => {
  it('returns empty providers for null input', () => {
    assert.deepEqual(parseModelsYaml(null), { providers: {} });
  });

  it('returns empty providers for empty string', () => {
    assert.deepEqual(parseModelsYaml(''), { providers: {} });
  });

  it('returns empty providers for whitespace-only string', () => {
    assert.deepEqual(parseModelsYaml('   \n  '), { providers: {} });
  });

  it('parses a minimal provider with a single model', () => {
    const yaml = `
providers:
  anthropic:
    baseUrl: https://api.anthropic.com
    apiKey: sk-test
    api: anthropic
    models:
      - id: claude-3-5-sonnet-latest
        name: Sonnet 3.5
`;
    const result = parseModelsYaml(yaml);
    assert.ok(result.providers.anthropic, 'anthropic provider should exist');
    const p = result.providers.anthropic;
    assert.equal(p.baseUrl, 'https://api.anthropic.com');
    assert.equal(p.apiKey,  'sk-test');
    assert.equal(p.api,     'anthropic');
    assert.equal(p.models.length, 1);
    assert.equal(p.models[0].id,   'claude-3-5-sonnet-latest');
    assert.equal(p.models[0].name, 'Sonnet 3.5');
  });

  it('parses boolean scalar values (reasoning: true / false)', () => {
    const yaml = `
providers:
  test:
    models:
      - id: smart-model
        reasoning: true
      - id: fast-model
        reasoning: false
`;
    const { providers: { test: p } } = parseModelsYaml(yaml);
    assert.strictEqual(p.models[0].reasoning, true,  'true should parse as boolean true');
    assert.strictEqual(p.models[1].reasoning, false, 'false should parse as boolean false');
  });

  it('parses numeric scalar values (contextWindow, maxTokens)', () => {
    const yaml = `
providers:
  test:
    models:
      - id: m
        contextWindow: 200000
        maxTokens: 8192
`;
    const m = parseModelsYaml(yaml).providers.test.models[0];
    assert.strictEqual(m.contextWindow, 200000);
    assert.strictEqual(m.maxTokens,     8192);
  });

  it('parses null scalar values (null and ~)', () => {
    const yaml = `
providers:
  test:
    models:
      - id: m1
        reasoning: null
      - id: m2
        reasoning: ~
`;
    const models = parseModelsYaml(yaml).providers.test.models;
    assert.strictEqual(models[0].reasoning, null);
    assert.strictEqual(models[1].reasoning, null);
  });

  it('parses quoted string values', () => {
    const yaml = `
providers:
  test:
    apiKey: "my key with spaces"
    models: []
`;
    assert.equal(parseModelsYaml(yaml).providers.test.apiKey, 'my key with spaces');
  });

  it('parses multiple providers', () => {
    const yaml = `
providers:
  openai:
    apiKey: sk-openai
    models:
      - id: gpt-4o
  anthropic:
    apiKey: sk-ant
    models:
      - id: claude-3-5-sonnet-latest
`;
    const { providers } = parseModelsYaml(yaml);
    assert.ok(providers.openai);
    assert.ok(providers.anthropic);
    assert.equal(providers.openai.models[0].id,    'gpt-4o');
    assert.equal(providers.anthropic.models[0].id, 'claude-3-5-sonnet-latest');
  });

  it('normalizes missing models to empty array', () => {
    const yaml = `
providers:
  empty:
    apiKey: x
`;
    const p = parseModelsYaml(yaml).providers.empty;
    assert.ok(Array.isArray(p.models));
    assert.equal(p.models.length, 0);
  });

  it('ignores comment lines', () => {
    const yaml = `
# This is a comment
providers:
  test:
    # Another comment
    apiKey: sk-123
    models: []
`;
    assert.equal(parseModelsYaml(yaml).providers.test.apiKey, 'sk-123');
  });

  it('parses oauth auth mode', () => {
    const yaml = `
providers:
  oauth-provider:
    auth: oauth
    baseUrl: https://api.example.com
    models: []
`;
    assert.equal(parseModelsYaml(yaml).providers['oauth-provider'].auth, 'oauth');
  });
});

// ── dumpModelsYaml ────────────────────────────────────────────────────────

describe('dumpModelsYaml', () => {
  it('produces a string starting with "providers:"', () => {
    const yaml = dumpModelsYaml({ providers: {} });
    assert.ok(yaml.startsWith('providers:'), `expected "providers:", got: ${yaml.slice(0, 30)}`);
  });

  it('produces a trailing newline', () => {
    const yaml = dumpModelsYaml({ providers: {} });
    assert.ok(yaml.endsWith('\n'), 'YAML should end with newline');
  });

  it('handles empty providers object', () => {
    const yaml = dumpModelsYaml({ providers: {} });
    assert.ok(yaml.includes('{}'), 'empty providers should serialize as {}');
  });

  it('serializes a provider with models', () => {
    const data = {
      providers: {
        anthropic: {
          baseUrl: 'https://api.anthropic.com',
          apiKey:  'sk-ant',
          api:     'anthropic',
          models:  [{ id: 'claude-3-5-sonnet-latest', name: 'Sonnet 3.5' }],
        },
      },
    };
    const yaml = dumpModelsYaml(data);
    assert.ok(yaml.includes('anthropic:'));
    assert.ok(yaml.includes('claude-3-5-sonnet-latest'));
    assert.ok(yaml.includes('Sonnet 3.5'));
  });

  it('serializes boolean model fields (reasoning: true)', () => {
    const data = {
      providers: {
        test: {
          apiKey: '',
          models: [{ id: 'm', reasoning: true }],
        },
      },
    };
    const yaml = dumpModelsYaml(data);
    assert.ok(yaml.includes('reasoning: true'), `yaml should contain "reasoning: true", got:\n${yaml}`);
  });

  it('serializes oauth auth mode', () => {
    const data = {
      providers: {
        oauth: { auth: 'oauth', baseUrl: 'https://x.com', models: [] },
      },
    };
    const yaml = dumpModelsYaml(data);
    assert.ok(yaml.includes('auth: oauth'));
  });

  it('does NOT serialize auth line when auth is "apiKey" (implicit default)', () => {
    const data = {
      providers: {
        test: { apiKey: 'sk', auth: 'apiKey', models: [] },
      },
    };
    const yaml = dumpModelsYaml(data);
    assert.ok(!yaml.includes('auth:'), `auth: apiKey should be implicit, got:\n${yaml}`);
  });
});

// ── round-trip: dumpModelsYaml → parseModelsYaml ──────────────────────────

describe('round-trip (dump then parse)', () => {
  it('preserves baseUrl, apiKey, api fields', () => {
    const original = {
      providers: {
        anthropic: {
          baseUrl: 'https://api.anthropic.com',
          apiKey:  'sk-test-key',
          api:     'anthropic',
          models:  [],
        },
      },
    };
    const parsed = parseModelsYaml(dumpModelsYaml(original));
    const p = parsed.providers.anthropic;
    assert.equal(p.baseUrl, 'https://api.anthropic.com');
    assert.equal(p.apiKey,  'sk-test-key');
    assert.equal(p.api,     'anthropic');
  });

  it('preserves model id, name, contextWindow, maxTokens', () => {
    const original = {
      providers: {
        test: {
          apiKey: 'x',
          models: [{
            id:            'test-model-v2',
            name:          'Test V2',
            contextWindow: 128000,
            maxTokens:     4096,
          }],
        },
      },
    };
    const parsed = parseModelsYaml(dumpModelsYaml(original));
    const m = parsed.providers.test.models[0];
    assert.equal(m.id,            'test-model-v2');
    assert.equal(m.name,          'Test V2');
    assert.strictEqual(m.contextWindow, 128000);
    assert.strictEqual(m.maxTokens,     4096);
  });

  it('preserves reasoning boolean true', () => {
    const original = {
      providers: {
        test: { apiKey: 'x', models: [{ id: 'm', reasoning: true }] },
      },
    };
    const parsed = parseModelsYaml(dumpModelsYaml(original));
    assert.strictEqual(parsed.providers.test.models[0].reasoning, true);
  });

  it('preserves reasoning boolean false', () => {
    const original = {
      providers: {
        test: { apiKey: 'x', models: [{ id: 'm', reasoning: false }] },
      },
    };
    const parsed = parseModelsYaml(dumpModelsYaml(original));
    assert.strictEqual(parsed.providers.test.models[0].reasoning, false);
  });

  it('preserves oauth auth mode', () => {
    const original = {
      providers: {
        oauth: { auth: 'oauth', baseUrl: 'https://sso.example.com', models: [] },
      },
    };
    const parsed = parseModelsYaml(dumpModelsYaml(original));
    assert.equal(parsed.providers.oauth.auth, 'oauth');
  });

  it('round-trips multiple providers', () => {
    const original = {
      providers: {
        p1: { apiKey: 'k1', models: [{ id: 'm1' }] },
        p2: { apiKey: 'k2', models: [{ id: 'm2' }] },
      },
    };
    const parsed = parseModelsYaml(dumpModelsYaml(original));
    assert.ok(parsed.providers.p1);
    assert.ok(parsed.providers.p2);
    assert.equal(parsed.providers.p1.models[0].id, 'm1');
    assert.equal(parsed.providers.p2.models[0].id, 'm2');
  });
});

// ── validateModelsYaml ─────────────────────────────────────────────────────

describe('validateModelsYaml', () => {
  it('returns invalid for null', () => {
    const r = validateModelsYaml(null);
    assert.equal(r.valid, false);
    assert.ok(r.error, 'should have an error message');
  });

  it('returns invalid for empty string', () => {
    const r = validateModelsYaml('');
    assert.equal(r.valid, false);
  });

  it('returns invalid for whitespace-only string', () => {
    const r = validateModelsYaml('   ');
    assert.equal(r.valid, false);
  });

  it('returns valid with parsed object for well-formed YAML', () => {
    const yaml = `
providers:
  test:
    apiKey: sk-test
    models:
      - id: my-model
`;
    const r = validateModelsYaml(yaml);
    assert.equal(r.valid, true);
    assert.ok(r.parsed, 'parsed result should be present');
    assert.ok(r.parsed.providers.test, 'parsed should have test provider');
  });

  it('returns valid for minimal providers: {} YAML', () => {
    const r = validateModelsYaml('providers:\n  {}');
    assert.equal(r.valid, true);
  });

  it('returns parsed object matching direct parse result', () => {
    const yaml = `providers:\n  openai:\n    apiKey: sk-x\n    models: []\n`;
    const r = validateModelsYaml(yaml);
    const direct = parseModelsYaml(yaml);
    assert.deepEqual(r.parsed.providers.openai.apiKey, direct.providers.openai.apiKey);
  });
});
