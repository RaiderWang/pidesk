/* ═════════════════════════════════════════════════════════════════════
   yaml-util.js — Robust YAML parser & generator for models.yml
   Tailored for oh-my-pi / pi-coding-agent models configuration.
   Supports auth: oauth/apiKey/none, nested compat, headers & modelOverrides.
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
   *       auth?: "apiKey" | "oauth" | "none",
   *       models: [ { id, name, contextWindow, maxTokens, reasoning, ... } ],
   *       ...extraNestedProps
   *     }
   *   }
   * }
   */
  function parseModelsYaml(rawYaml) {
    const result = { providers: {} };
    if (!rawYaml || typeof rawYaml !== "string") return result;

    const rawLines = rawYaml.split(/\r?\n/);
    const lines = [];

    for (let i = 0; i < rawLines.length; i++) {
      let line = rawLines[i];
      // Strip comments
      const commentIdx = line.indexOf("#");
      if (commentIdx !== -1) {
        const before = line.slice(0, commentIdx);
        const singleQuotes = (before.match(/'/g) || []).length;
        const doubleQuotes = (before.match(/"/g) || []).length;
        if (singleQuotes % 2 === 0 && doubleQuotes % 2 === 0) {
          line = before;
        }
      }
      if (!line.trim()) continue;
      lines.push({ indent: line.search(/\S/), text: line.trim() });
    }

    if (lines.length === 0) return result;

    let index = 0;

    function parseBlock(minIndent) {
      if (index >= lines.length) return null;
      const first = lines[index];
      if (first.indent < minIndent) return null;

      if (first.text.startsWith("-")) {
        return parseSequence(first.indent);
      } else {
        return parseMapping(first.indent);
      }
    }

    function parseSequence(seqIndent) {
      const arr = [];
      while (index < lines.length) {
        const cur = lines[index];
        if (cur.indent < seqIndent) break;
        if (cur.indent > seqIndent) {
          index++;
          continue;
        }
        if (!cur.text.startsWith("-")) break;

        const afterDash = cur.text.slice(1).trim();
        index++;

        if (!afterDash) {
          const child = parseBlock(seqIndent + 1);
          arr.push(child !== null ? child : {});
        } else if (afterDash.includes(":")) {
          const colonIdx = afterDash.indexOf(":");
          const k = afterDash.slice(0, colonIdx).trim();
          const vRaw = afterDash.slice(colonIdx + 1).trim();
          const itemObj = {};

          if (vRaw === "") {
            const child = parseBlock(seqIndent + 2);
            itemObj[k] = child !== null ? child : {};
          } else {
            itemObj[k] = parseScalar(vRaw);
          }

          while (index < lines.length) {
            const next = lines[index];
            if (next.indent <= seqIndent) break;
            if (next.text.startsWith("-")) break;

            const nColon = next.text.indexOf(":");
            if (nColon !== -1) {
              const nk = next.text.slice(0, nColon).trim();
              const nvRaw = next.text.slice(nColon + 1).trim();
              index++;
              if (nvRaw === "") {
                const subChild = parseBlock(next.indent + 1);
                itemObj[nk] = subChild !== null ? subChild : {};
              } else {
                itemObj[nk] = parseScalar(nvRaw);
              }
            } else {
              index++;
            }
          }
          arr.push(itemObj);
        } else {
          arr.push(parseScalar(afterDash));
        }
      }
      return arr;
    }

    function parseMapping(mapIndent) {
      const obj = {};
      while (index < lines.length) {
        const cur = lines[index];
        if (cur.indent < mapIndent) break;
        if (cur.indent > mapIndent) {
          index++;
          continue;
        }
        if (cur.text.startsWith("-")) break;

        const colonIdx = cur.text.indexOf(":");
        if (colonIdx === -1) {
          index++;
          continue;
        }

        const key = cur.text.slice(0, colonIdx).trim();
        const valRaw = cur.text.slice(colonIdx + 1).trim();
        index++;

        if (valRaw === "") {
          if (index < lines.length && lines[index].indent > cur.indent) {
            const child = parseBlock(lines[index].indent);
            obj[key] = child !== null ? child : {};
          } else {
            obj[key] = {};
          }
        } else {
          obj[key] = parseScalar(valRaw);
        }
      }
      return obj;
    }

    const root = parseBlock(0) || {};
    const rawProviders = root.providers || {};
    const normalizedProviders = {};

    for (const [pKey, pVal] of Object.entries(rawProviders)) {
      if (typeof pVal !== "object" || pVal === null) continue;
      normalizedProviders[pKey] = {
        baseUrl: pVal.baseUrl !== undefined ? String(pVal.baseUrl) : "",
        apiKey: pVal.apiKey !== undefined ? String(pVal.apiKey) : "",
        api: pVal.api !== undefined ? String(pVal.api) : "openai-completions",
        models: Array.isArray(pVal.models) ? pVal.models : [],
        ...pVal
      };
    }

    return { providers: normalizedProviders };
  }

  /**
   * Helper to dump arbitrary nested mappings.
   */
  function dumpYamlMap(map, indentLevel) {
    const lines = [];
    const pad = " ".repeat(indentLevel);
    for (const [k, v] of Object.entries(map)) {
      if (v === undefined) continue;
      if (v === null) {
        lines.push(`${pad}${k}: null`);
      } else if (typeof v === "object" && !Array.isArray(v)) {
        if (Object.keys(v).length === 0) {
          lines.push(`${pad}${k}: {}`);
        } else {
          lines.push(`${pad}${k}:`);
          lines.push(...dumpYamlMap(v, indentLevel + 2));
        }
      } else if (Array.isArray(v)) {
        if (v.length === 0) {
          lines.push(`${pad}${k}: []`);
        } else {
          lines.push(`${pad}${k}:`);
          for (const item of v) {
            lines.push(`${pad}  - ${formatScalar(item)}`);
          }
        }
      } else {
        lines.push(`${pad}${k}: ${formatScalar(v)}`);
      }
    }
    return lines;
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

      if (prov.baseUrl !== undefined && prov.baseUrl !== "") {
        lines.push(`    baseUrl: ${formatScalar(prov.baseUrl)}`);
      }

      // Handle auth mode: oauth / none / apiKey
      if (prov.auth === "oauth") {
        lines.push(`    auth: oauth`);
        // For OAuth, only dump apiKey if user explicitly provided a non-empty key
        if (prov.apiKey && typeof prov.apiKey === "string" && prov.apiKey.trim()) {
          lines.push(`    apiKey: ${formatScalar(prov.apiKey)}`);
        }
      } else if (prov.auth === "none") {
        lines.push(`    auth: none`);
        if (prov.apiKey && typeof prov.apiKey === "string" && prov.apiKey.trim()) {
          lines.push(`    apiKey: ${formatScalar(prov.apiKey)}`);
        }
      } else {
        if (prov.apiKey !== undefined && prov.apiKey !== null) {
          lines.push(`    apiKey: ${formatScalar(prov.apiKey)}`);
        }
        if (prov.auth && prov.auth !== "apiKey") {
          lines.push(`    auth: ${formatScalar(prov.auth)}`);
        }
      }

      if (prov.api !== undefined && prov.api !== "") {
        lines.push(`    api: ${formatScalar(prov.api)}`);
      }

      // Preserve any extra provider properties (compat, headers, modelOverrides, etc.)
      for (const [k, v] of Object.entries(prov)) {
        if (["baseUrl", "apiKey", "api", "auth", "models"].includes(k)) continue;
        if (v === undefined) continue;
        if (typeof v === "object" && v !== null) {
          if (Array.isArray(v)) {
            if (v.length === 0) lines.push(`    ${k}: []`);
            else {
              lines.push(`    ${k}:`);
              for (const item of v) lines.push(`      - ${formatScalar(item)}`);
            }
          } else {
            if (Object.keys(v).length === 0) lines.push(`    ${k}: {}`);
            else {
              lines.push(`    ${k}:`);
              lines.push(...dumpYamlMap(v, 6));
            }
          }
        } else {
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
          if (m.contextWindow !== undefined && m.contextWindow !== null && m.contextWindow !== "") {
            lines.push(`        contextWindow: ${m.contextWindow}`);
          }
          if (m.maxTokens !== undefined && m.maxTokens !== null && m.maxTokens !== "") {
            lines.push(`        maxTokens: ${m.maxTokens}`);
          }
          if (m.reasoning !== undefined && m.reasoning !== null) {
            lines.push(`        reasoning: ${m.reasoning ? "true" : "false"}`);
          }
          if (m.input !== undefined && m.input !== null) {
            const arr = Array.isArray(m.input) ? m.input : [String(m.input)];
            lines.push(`        input: ${JSON.stringify(arr)}`);
          }
          // Preserve any extra model keys (compat, headers, etc.)
          for (const [mk, mv] of Object.entries(m)) {
            if (["id", "name", "contextWindow", "maxTokens", "reasoning", "input"].includes(mk)) continue;
            if (mv === undefined) continue;
            if (typeof mv === "object" && mv !== null) {
              lines.push(`        ${mk}:`);
              lines.push(...dumpYamlMap(mv, 10));
            } else {
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
