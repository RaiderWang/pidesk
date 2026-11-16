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

  /**
   * Runs the (slow) diagnostic at most once per missing-set and drops stale
   * results. `run()` returns a promise of the warning text (or nullish);
   * `onResult(text|null)` receives only the answer to the latest request.
   *   request(key) — "" clears the warning; a key already diagnosed or in
   *                  flight is ignored; any other key starts a new run and
   *                  supersedes older ones.
   *   invalidate() — models.yml changed: forget results and discard in-flight ones.
   */
  function createRunner(run, onResult) {
    let seq = 0;
    let doneKey = "";
    let pendingKey = "";

    function request(key) {
      if (!key) {
        seq += 1;
        doneKey = "";
        pendingKey = "";
        onResult(null);
        return;
      }
      if (key === doneKey || key === pendingKey) return;
      seq += 1;
      const mine = seq;
      pendingKey = key;
      Promise.resolve()
        .then(run)
        .then((msg) => {
          if (mine !== seq) return;
          pendingKey = "";
          doneKey = key;
          onResult((typeof msg === "string" && msg.trim()) || null);
        })
        .catch(() => {
          if (mine === seq) pendingKey = "";
        });
    }

    function invalidate() {
      seq += 1;
      doneKey = "";
      pendingKey = "";
    }

    return { request, invalidate };
  }

  return { missingCustomModels, missingKey, createRunner };
});
