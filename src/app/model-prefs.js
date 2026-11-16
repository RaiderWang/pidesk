/* ═════════════════════════════════════════════════════════════════════
   model-prefs.js — pure helpers for the persisted "last used model"
   preference (`pidesk:prefs` in localStorage).

   The preference outlives edits to models.yml: renaming or deleting a
   custom model leaves a dangling `provider/id`, which every new session
   would re-push to omp (`Model not found`). These helpers let live.js
   drop such a preference without touching the thinking-level entry.

   Staleness is judged against models.yml only. Built-in / OAuth providers
   are never listed there, so they are never reported as stale.
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ModelPrefs = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MODEL_KEYS = ["modelId", "modelProvider", "modelName"];

  /** Copy of `prefs` without the model fields (thinkingLevel etc. kept). */
  function stripModel(prefs) {
    const out = { ...(prefs && typeof prefs === "object" ? prefs : {}) };
    for (const k of MODEL_KEYS) delete out[k];
    return out;
  }

  /**
   * True when the saved model belongs to a provider declared in models.yml
   * but is no longer listed under it (renamed / deleted).
   * `customData` is `{ customModels: [{id, provider}], customProviders: Set }`.
   */
  function isStaleCustomModel(prefs, customData) {
    if (!prefs || !prefs.modelId || !prefs.modelProvider) return false;
    const providers = customData?.customProviders;
    if (!providers || typeof providers.has !== "function") return false;
    if (!providers.has(prefs.modelProvider)) return false;
    const models = Array.isArray(customData.customModels) ? customData.customModels : [];
    return !models.some(
      (m) => m.provider === prefs.modelProvider && m.id === prefs.modelId,
    );
  }

  return { stripModel, isStaleCustomModel };
});
