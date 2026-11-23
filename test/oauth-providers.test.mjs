import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OAuthProviders as OP } from './helpers/shim.mjs';

const ORIGINAL_19 = [
  'openai-codex', 'anthropic', 'github-copilot', 'google-antigravity',
  'google-gemini-cli', 'cursor', 'devin', 'kimi-code', 'zai', 'zai-coding-plan',
  'zhipu-coding-plan', 'alibaba-coding-plan', 'minimax-code', 'minimax-code-cn',
  'qwen-portal', 'gitlab-duo', 'perplexity', 'xai-oauth', 'openrouter',
];
const ADDED_19 = [
  'antigravity-cli', 'devin-cli', 'devin-windsurf', 'factory-droid', 'kiro',
  'mistral', 'snowflake', 'gitlab-duo-agent', 'muse-code',
];
const API_KEY_ONLY = ['deepseek', 'ollama', 'siliconflow', 'vllm', 'lm-studio', 'together'];

describe('OAuthProviders.isOAuth', () => {
  it('keeps the original 19 and the omp-19 additions', () => {
    for (const id of [...ORIGINAL_19, ...ADDED_19]) assert.equal(OP.isOAuth(id), true, id);
  });

  it('never treats API-key providers as OAuth', () => {
    for (const id of API_KEY_ONLY) assert.equal(OP.isOAuth(id), false, id);
  });

  it('does not treat the token-only cloudflare-workers-ai as OAuth', () => {
    assert.equal(OP.isOAuth('cloudflare-workers-ai'), false);
  });

  it('is case/space insensitive and rejects junk input', () => {
    assert.equal(OP.isOAuth('  Anthropic '), true);
    for (const bad of [undefined, null, 42, '', '  ', {}]) assert.equal(OP.isOAuth(bad), false);
  });

  it('exposes no login-state API (get_login_providers.authenticated also covers models.yml/env keys)', () => {
    assert.deepEqual(Object.keys(OP), ['isOAuth']);
  });
});
