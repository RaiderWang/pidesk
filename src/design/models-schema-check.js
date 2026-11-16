/* ═════════════════════════════════════════════════════════════════════
   models-schema-check.js — pure pre-save check of a parsed models.yml.

   omp validates models.yml against a schema at startup and, when it fails,
   silently disables *every* custom provider. The most common slip is a
   string field YAML reads as another type (`apiKey: 123`, `id: true`), so
   this mirrors those string constraints before the file is written.

   check(parsed) → { ok, errors: [{ path, expected: "string", got }] }
   `parsed` is the output of YamlUtil.parseModelsYaml.
   ═════════════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  const PROVIDER_STRING_FIELDS = ["baseUrl", "apiKey", "api", "auth"];
  const MODEL_STRING_FIELDS = ["id", "name"];

  function kindOf(v) {
    return Array.isArray(v) ? "array" : typeof v;
  }

  function checkFields(obj, fields, basePath, errors) {
    for (const f of fields) {
      const v = obj[f];
      if (v === undefined || v === null || typeof v === "string") continue;
      errors.push({ path: `${basePath}.${f}`, expected: "string", got: kindOf(v) });
    }
  }

  function check(parsed) {
    const errors = [];
    const providers = parsed?.providers;
    if (providers && typeof providers === "object") {
      for (const [pKey, prov] of Object.entries(providers)) {
        if (!prov || typeof prov !== "object") continue;
        const pPath = `providers.${pKey}`;
        checkFields(prov, PROVIDER_STRING_FIELDS, pPath, errors);
        if (!Array.isArray(prov.models)) continue;
        prov.models.forEach((m, i) => {
          if (!m || typeof m !== "object") return;
          checkFields(m, MODEL_STRING_FIELDS, `${pPath}.models[${i}]`, errors);
        });
      }
    }
    return { ok: errors.length === 0, errors };
  }

  window.ModelsSchemaCheck = { check };
})();
