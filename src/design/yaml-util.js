/* ═════════════════════════════════════════════════════════════════════
   yaml-util.js — Lightweight YAML parser & generator for models.yml
   Tailored for oh-my-pi / pi-coding-agent models configuration.
   ═════════════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  /**
   * Parse a scalar value into boolean, number, or string.
   */
  function parseScalar(val) {
    if (val === undefined || val === null) return "";
    let s = String(val).trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      return s.slice(1, -1);
    }
    if (s === "true") return true;
    if (s === "false") return false;
    if (s === "null" || s === "~") return null;
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
    if (s.startsWith("[") && s.endsWith("]")) {
      try {
        return JSON.parse(s);
      } catch {
        return s.slice(1, -1).split(",").map(x => x.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
      }
    }
    return s;
  }

  /**
   * Format a scalar value for YAML output.
   */
  function formatScalar(val) {
    if (val === undefined || val === null) return "''";
    if (typeof val === "boolean") return val ? "true" : "false";
    if (typeof val === "number") return String(val);
    const s = String(val);
    if (s === "") return "''";
    // If string contains colons, hashes, special chars, or starts with dash/quote, quote it
    if (/[:#\[\]{},>|%@`\*\?]|^\s|\s$|^[-?]/.test(s)) {
      return JSON.stringify(s);
    }
    return s;
  }

  /**
   * Parse models.yml string into a structured JavaScript object:
   * {
   *   providers: {
   *     [providerId]: {
   *       baseUrl: string,
   *       apiKey: string,
   *       api: string,
   *       models: [ { id, name, contextWindow, maxTokens, reasoning, ... } ]
   *     }
   *   }
   * }
   */
  function parseModelsYaml(rawYaml) {
    const result = { providers: {} };
    if (!rawYaml || typeof rawYaml !== "string") return result;

    const lines = rawYaml.split(/\r?\n/);
    let curProvider = null;
    let inModelsList = false;
    let curModel = null;
    let curModelPropList = null;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      // Strip comments
      const commentIdx = line.indexOf("#");
      if (commentIdx !== -1) {
        // Only strip if not inside quotes
        const before = line.slice(0, commentIdx);
        const singleQuotes = (before.match(/'/g) || []).length;
        const doubleQuotes = (before.match(/"/g) || []).length;
        if (singleQuotes % 2 === 0 && doubleQuotes % 2 === 0) {
          line = before;
        }
      }

      if (!line.trim()) continue;

      const indent = line.search(/\S/);
      const trimmed = line.trim();

      // Top level: providers:
      if (indent === 0 && trimmed.startsWith("providers:")) {
        curProvider = null;
        inModelsList = false;
        curModel = null;
        curModelPropList = null;
        continue;
      }

      // Provider key level (indent ~2: "  custom-proxy:")
      if (indent >= 2 && indent <= 4 && trimmed.endsWith(":") && !trimmed.startsWith("-") && !inModelsList) {
        const pKey = trimmed.slice(0, -1).trim();
        if (pKey !== "models") {
          curProvider = pKey;
          if (!result.providers[curProvider]) {
            result.providers[curProvider] = {
              baseUrl: "",
              apiKey: "",
              api: "openai-completions",
              models: []
            };
          }
          inModelsList = false;
          curModel = null;
          curModelPropList = null;
          continue;
        }
      }

      // Within a provider:
      if (curProvider && result.providers[curProvider]) {
        const prov = result.providers[curProvider];

        // "models:" section start
        if (trimmed === "models:" || trimmed.startsWith("models:")) {
          inModelsList = true;
          curModel = null;
          curModelPropList = null;
          continue;
        }

        // Inside models list:
        if (inModelsList) {
          // Sub-item in a multiline list under current model (e.g. "          - image" under "input:")
          if (curModel && curModelPropList && trimmed.startsWith("-") && indent > 6) {
            const itemVal = parseScalar(trimmed.slice(1).trim());
            if (Array.isArray(curModel[curModelPropList])) {
              curModel[curModelPropList].push(itemVal);
            }
            continue;
          }

          // New model entry starts with "- id:" or "-"
          if (trimmed.startsWith("-")) {
            curModelPropList = null;
            curModel = {
              id: "",
              name: "",
              contextWindow: 128000,
              maxTokens: 8192
            };
            prov.models.push(curModel);

            const rest = trimmed.slice(1).trim();
            if (rest) {
              const colonIdx = rest.indexOf(":");
              if (colonIdx !== -1) {
                const k = rest.slice(0, colonIdx).trim();
                const v = parseScalar(rest.slice(colonIdx + 1).trim());
                curModel[k] = v;
              }
            }
            continue;
          }

          // Model properties (indent > list indent)
          if (curModel && trimmed.includes(":")) {
            const colonIdx = trimmed.indexOf(":");
            const k = trimmed.slice(0, colonIdx).trim();
            const restVal = trimmed.slice(colonIdx + 1).trim();
            if (restVal === "") {
              curModelPropList = k;
              curModel[k] = [];
            } else {
              curModelPropList = null;
              curModel[k] = parseScalar(restVal);
            }
            continue;
          }
        }

        // Provider properties (baseUrl, apiKey, api, headers, etc.)
        if (!inModelsList && trimmed.includes(":")) {
          const colonIdx = trimmed.indexOf(":");
          const k = trimmed.slice(0, colonIdx).trim();
          const v = parseScalar(trimmed.slice(colonIdx + 1).trim());
          prov[k] = v;
        }
      }
    }

    return result;
  }

  /**
   * Serialize structured models config back into formatted YAML.
   */
  function dumpModelsYaml(data) {
    const lines = ["providers:"];
    const providers = data?.providers || {};
    const pKeys = Object.keys(providers);

    if (pKeys.length === 0) {
      lines.push("  {}");
      return lines.join("\n") + "\n";
    }

    for (const pKey of pKeys) {
      const prov = providers[pKey] || {};
      lines.push(`  ${pKey}:`);

      if (prov.baseUrl !== undefined) {
        lines.push(`    baseUrl: ${formatScalar(prov.baseUrl)}`);
      }
      if (prov.apiKey !== undefined) {
        lines.push(`    apiKey: ${formatScalar(prov.apiKey)}`);
      }
      if (prov.api !== undefined) {
        lines.push(`    api: ${formatScalar(prov.api)}`);
      }

      // Any extra non-model properties
      for (const [k, v] of Object.entries(prov)) {
        if (!["baseUrl", "apiKey", "api", "models"].includes(k) && typeof v !== "object") {
          lines.push(`    ${k}: ${formatScalar(v)}`);
        }
      }

      const models = Array.isArray(prov.models) ? prov.models : [];
      if (models.length === 0) {
        lines.push("    models: []");
      } else {
        lines.push("    models:");
        for (const m of models) {
          lines.push(`      - id: ${formatScalar(m.id || "")}`);
          if (m.name) {
            lines.push(`        name: ${formatScalar(m.name)}`);
          }
          if (m.contextWindow !== undefined && m.contextWindow !== null) {
            lines.push(`        contextWindow: ${m.contextWindow}`);
          }
          if (m.maxTokens !== undefined && m.maxTokens !== null) {
            lines.push(`        maxTokens: ${m.maxTokens}`);
          }
          if (m.reasoning !== undefined && m.reasoning !== null) {
            lines.push(`        reasoning: ${m.reasoning ? "true" : "false"}`);
          }
          if (m.input !== undefined && m.input !== null) {
            const arr = Array.isArray(m.input) ? m.input : [String(m.input)];
            lines.push(`        input: ${JSON.stringify(arr)}`);
          }
          // Preserve any extra model keys
          for (const [mk, mv] of Object.entries(m)) {
            if (!["id", "name", "contextWindow", "maxTokens", "reasoning", "input"].includes(mk) && typeof mv !== "object") {
              lines.push(`        ${mk}: ${formatScalar(mv)}`);
            }
          }
        }
      }
    }

    return lines.join("\n") + "\n";
  }

  /**
   * Validate YAML syntax & structure.
   */
  function validateModelsYaml(raw) {
    if (!raw || typeof raw !== "string" || !raw.trim()) {
      return { valid: false, error: "Configuration is empty" };
    }
    try {
      const parsed = parseModelsYaml(raw);
      if (!parsed || typeof parsed.providers !== "object") {
        return { valid: false, error: "Root must contain 'providers:' mapping" };
      }
      return { valid: true, parsed };
    } catch (err) {
      return { valid: false, error: err.message || String(err) };
    }
  }

  window.YamlUtil = {
    parseModelsYaml,
    dumpModelsYaml,
    validateModelsYaml,
  };
})();
