/* live/custom-models.js — pure model-list helpers: build a UI model entry from
   an RPC model, read custom models from models.yml, merge them into omp's list. */
(function () {
  "use strict";

  function buildModelEntry(m) {
    return {
      id:       m.id,
      name:     m.name ?? window.MODEL_NAMES?.[m.id] ?? window.formatModelId(m.id),
      provider: m.provider,
      note:     m.provider,
      latency:  0,
      current:  true,
      input:    m.input,
      reasoning: m.reasoning,
      thinking:  m.thinking,
    };
  }

  /**
   * Custom models declared in models.yml. `isCurrent(id)` is evaluated after the
   * file read (not at call time) so a model switch that lands while the read is
   * in flight is still reflected in `current`.
   */
  async function loadFromConfig(isCurrent = () => false) {
    if (!window.__TAURI__) return { customModels: [], customProviders: new Set() };
    try {
      const res = await window.__TAURI__.core.invoke("read_models_config");
      if (!res?.content || !window.YamlUtil?.parseModelsYaml) {
        return { customModels: [], customProviders: new Set() };
      }
      const parsed = window.YamlUtil.parseModelsYaml(res.content);
      const customModels = [];
      const providers = parsed?.providers || {};
      const customProviders = new Set(Object.keys(providers));

      for (const [providerName, pConfig] of Object.entries(providers)) {
        if (!pConfig || !Array.isArray(pConfig.models)) continue;
        for (const m of pConfig.models) {
          if (!m || !m.id) continue;
          customModels.push({
            id:            m.id,
            name:          m.name || m.id,
            provider:      providerName,
            note:          providerName,
            latency:       0,
            current:       isCurrent(m.id),
            contextWindow: m.contextWindow,
            maxTokens:     m.maxTokens,
            reasoning:     !!m.reasoning,
            thinking:      m.thinking,
            input:         m.input ?? (m.images ? ["text", "image"] : ["text"]),
          });
        }
      }
      return { customModels, customProviders };
    } catch (e) {
      console.warn("[live] Failed to read models.yml for custom models:", e);
      return { customModels: [], customProviders: new Set() };
    }
  }

  function mergeModels(baseList, { customModels } = {}) {
    const modelKey = m => `${m.provider || ""}/${m.id || ""}`;
    const customMap = new Map((customModels || []).map(m => [modelKey(m), m]));
    const customById = new Map((customModels || []).map(m => [m.id, m]));

    // Retain all base models (including OAuth & builtins), enriching matching ones with custom metadata
    const merged = (baseList || []).map(m => {
      const key = modelKey(m);
      if (customMap.has(key)) {
        const custom = customMap.get(key);
        customMap.delete(key);
        customById.delete(m.id);
        return { ...m, ...custom };
      }
      if (customById.has(m.id)) {
        const custom = customById.get(m.id);
        customMap.delete(modelKey(custom));
        customById.delete(m.id);
        return { ...m, ...custom };
      }
      return m;
    });

    // Append any additional custom models not present in baseList
    for (const cm of customMap.values()) {
      if (customById.has(cm.id)) {
        merged.push(cm);
        customById.delete(cm.id);
      }
    }
    return merged;
  }

  window._Live = window._Live || {};
  window._Live.CustomModels = { buildModelEntry, loadFromConfig, mergeModels };
})();
