/* ═════════════════════════════════════════════════════════════════════
   oauth-providers.js — which models.yml provider ids are omp OAuth logins.

   A static, exact list. It drives form defaults (auth mode = oauth, base
   URL cleared) and the "API Key shadows your OAuth login" hints, so it must
   never include API-key providers (deepseek, ollama, …).

   omp's `get_login_providers` is deliberately NOT used: it lists every
   `/login` provider (~70 are API-key-paste ones), carries no login type, and
   its `authenticated` flag is also true when a key comes from models.yml or
   an env var — so it would flag a plain `deepseek` + apiKey as OAuth.
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.OAuthProviders = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const BUILTIN = new Set([
    "openai-codex",
    "anthropic",
    "github-copilot",
    "google-antigravity",
    "google-gemini-cli",
    "cursor",
    "devin",
    "kimi-code",
    "zai",
    "zai-coding-plan",
    "zhipu-coding-plan",
    "alibaba-coding-plan",
    "minimax-code",
    "minimax-code-cn",
    "qwen-portal",
    "gitlab-duo",
    "perplexity",
    "xai-oauth",
    "openrouter",
    // Added in omp 19: providers with their own OAuth / device-code module.
    "antigravity-cli",
    "devin-cli",
    "devin-windsurf",
    "factory-droid",
    "kiro",
    "mistral",
    "snowflake",
    "gitlab-duo-agent",
    "muse-code",
  ]);

  /** Built-in OAuth provider id (case/space-insensitive). */
  function isOAuth(id) {
    return typeof id === "string" && BUILTIN.has(id.trim().toLowerCase());
  }

  return { isOAuth };
});
