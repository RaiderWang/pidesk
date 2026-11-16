/* ═════════════════════════════════════════════════════════════════════
   models-config-check.js — pure helpers for noticing that omp ignored
   the custom models declared in models.yml.

   PiDesk lists custom models straight from models.yml, but omp only
   serves them when its own schema validation passed; on a failure it
   drops every custom provider silently (nothing on RPC). A custom model
   absent from omp's `get_available_models` is the symptom that triggers
   a diagnostic (the `check_models_config` Tauri command).
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ModelsConfigCheck = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const keyOf = (m) => `${m?.provider || ""}/${m?.id || ""}`;

  /**
   * `provider/id` keys of custom models omp did not report, sorted.
   * `rpcModels` is omp's list, `customModels` the entries parsed from models.yml.
   */
  function missingCustomModels(rpcModels, customModels) {
    const known = new Set((Array.isArray(rpcModels) ? rpcModels : []).map(keyOf));
    return (Array.isArray(customModels) ? customModels : [])
      .map(keyOf)
      .filter((k) => !known.has(k))
      .sort();
  }

  /** Stable identity of a missing set, used to avoid re-running the diagnostic. */
  function missingKey(missing) {
    return Array.isArray(missing) && missing.length ? missing.join("\n") : "";
  }

  return { missingCustomModels, missingKey };
});
