/* live/models.js — model list, current model and thinking level for the active tab.

   Owns: the set_model origin queue handling, saved-preference restore, syncing
   the current model against the merged list, the initial fetch, the models.yml
   diagnosis runner, the model/thinking RPC *response* handlers (merged into the
   dispatch tables of live/response-handlers.js) and the OMP_BRIDGE model API.
   Registers window._Live.Models; all collaborators are injected into create(). */
(function () {
  "use strict";
  window._Live = window._Live || {};

  // ── Pure helpers (exported for tests) ──────────────────────────────────────
  /** True when the active model can reason / the list offers more than "off". */
  function hasReasoning(state) {
    return Boolean(
      state.model?.reasoning ||
      state.model?.thinking ||
      (Array.isArray(state.availableThinkingLevels) && state.availableThinkingLevels.length > 1)
    );
  }

  /**
   * Levels a client-side cycle walks through: what omp reported, else the model's
   * configured efforts (after "off"), else the generic ladder. Never "auto".
   */
  function resolveValidLevels(state) {
    if (Array.isArray(state.availableThinkingLevels) && state.availableThinkingLevels.length > 1) {
      return state.availableThinkingLevels;
    }
    const efforts = state.model?.thinking?.efforts;
    if (Array.isArray(efforts) && efforts.length > 0) return ["off", ...efforts];
    return ["off", "low", "medium", "high"];
  }

  // Same id under another provider is a different model; a model without a
  // provider matches by id alone.
  function findListedModel(state) {
    if (!state.model || !Array.isArray(state.models)) return undefined;
    return state.models.find(m => m.id === state.model.id && (!state.model.provider || m.provider === state.model.provider))
      || state.models.find(m => m.id === state.model.id);
  }

  /**
   * @param {object}   ctx
   * @param {object}   ctx.state
   * @param {object}   ctx.rt
   * @param {Function} ctx.notify
   * @param {Function} ctx.send               send a command to the active omp
   * @param {Map}      ctx.sessionRegistry
   * @param {Array}    ctx.pendingSetModel    origins ("restore" | "user") of in-flight set_model, oldest first
   * @param {object}   ctx.prefs              live/prefs.js ({ loadPrefs, savePrefs, clearModelPrefs })
   * @param {object}   ctx.customModels       live/custom-models.js ({ loadFromConfig, mergeModels, buildModelEntry })
   */
  function create({ state, rt, notify, send, sessionRegistry, pendingSetModel, prefs, customModels }) {
    const { loadPrefs, savePrefs, clearModelPrefs } = prefs;
    const { buildModelEntry, mergeModels } = customModels;

    // Reads models.yml; `current` follows whatever model is active once the read lands.
    const loadCustomModelsFromConfig = () => customModels.loadFromConfig(
      id => state.rpcState?.model?.id === id || state.model?.id === id,
    );

    // ── Sending ────────────────────────────────────────────────────────────────
    // Origin of each in-flight set_model: omp answers commands in order, so each
    // response shifts one entry. A failed "restore" is silent and self-heals; a
    // failed "user" shows a notice.
    function sendSetModel(provider, modelId, origin) {
      pendingSetModel.push(origin);
      send({ type: "set_model", provider, modelId });
    }

    // Push the current thinking level to the active model (or force "off" for
    // an explicitly non-reasoning one). Shared by set_model success and the
    // rollback after a failed preference restore.
    function pushThinkingLevel() {
      if (!state.thinkingLevel || state.thinkingLevel === "off") return;
      if (state.model?.reasoning === false) {
        state.thinkingLevel = "off";
        savePrefs({ thinkingLevel: "off" });
      } else {
        send({ type: "set_thinking_level", level: state.thinkingLevel });
      }
    }

    // On the first get_state of a fresh session push the user's saved model +
    // thinking level so the new omp process matches their previous choice.
    function restorePrefs() {
      const saved = loadPrefs();
      if (!saved || typeof saved !== "object") return;

      if (saved.thinkingLevel) {
        state.thinkingLevel = saved.thinkingLevel;
      }

      // Model — only override when saved preference differs from omp's default.
      // When switching models, do not push set_thinking_level to the old model first:
      // if omp's default model is non-reasoning (e.g. auto/best-free), pushing a thinking
      // level will cause omp to clamp/reset it to undefined. Instead, switch model first;
      // the set_model response handler re-pushes state.thinkingLevel to the new model.
      // Same id under another provider is a different model; a model without a
      // reported provider is compared by id only (no needless set_model).
      const sameModel = state.model?.id === saved.modelId
        && (!state.model?.provider || state.model.provider === saved.modelProvider);
      const willChangeModel = Boolean(saved.modelId && saved.modelProvider && !sameModel);
      if (willChangeModel) {
        // No pre-check against state.models: it may still hold only the models.yml
        // entries here (built-in/OAuth models arrive later). A stale model fails
        // the set_model and is healed in the set_model failure handler.
        sendSetModel(saved.modelProvider, saved.modelId, "restore");
        // Optimistic local update to prevent the UI flashing omp's default model.
        state.model = buildModelEntry({
          id: saved.modelId,
          name: saved.modelName,
          provider: saved.modelProvider,
        });
        if (state.models.length > 0) {
          state.models = state.models.map(m => ({
            ...m, current: m.id === saved.modelId && (!m.provider || m.provider === saved.modelProvider),
          }));
        }
      } else if (saved.thinkingLevel) {
        // Model unchanged — push thinking level directly to current model.
        send({ type: "set_thinking_level", level: saved.thinkingLevel });
      }
    }

    // Copy the listed model's capabilities onto the active model and keep the
    // available thinking levels / current level consistent with them.
    function syncCurrentModel() {
      if (!state.model || !Array.isArray(state.models) || state.models.length === 0) return;
      const match = findListedModel(state);
      if (!match) return;

      const prevReasoning = Boolean(state.model.reasoning || state.model.thinking);
      const matchReasons = Boolean(match.reasoning || match.thinking);

      state.model = {
        ...state.model,
        name:          match.name || state.model.name,
        provider:      match.provider || state.model.provider,
        reasoning:     match.reasoning,
        thinking:      match.thinking,
        input:         match.input || state.model.input,
        contextWindow: match.contextWindow || state.model.contextWindow,
        maxTokens:     match.maxTokens || state.model.maxTokens,
      };

      if (!matchReasons) {
        state.availableThinkingLevels = ["off"];
        if (state.thinkingLevel && state.thinkingLevel !== "off") {
          state.thinkingLevel = "off";
          savePrefs({ thinkingLevel: "off" });
          send({ type: "set_thinking_level", level: "off" });
        }
      } else {
        const configuredEfforts = Array.isArray(match.thinking?.efforts) && match.thinking.efforts.length > 0
          ? match.thinking.efforts
          : ["low", "medium", "high"];
        state.availableThinkingLevels = ["off", ...configuredEfforts];

        if (!prevReasoning && (state.thinkingLevel === "off" || !state.thinkingLevel)) {
          const defaultLevel = match.thinking?.defaultLevel || configuredEfforts[0] || "off";
          state.thinkingLevel = defaultLevel;
          savePrefs({ thinkingLevel: defaultLevel });
          if (defaultLevel !== "off") {
            send({ type: "set_thinking_level", level: defaultLevel });
          }
        } else if (state.thinkingLevel && state.thinkingLevel !== "off" && !state.availableThinkingLevels.includes(state.thinkingLevel)) {
          const nextLevel = match.thinking?.defaultLevel || configuredEfforts[0] || "off";
          state.thinkingLevel = nextLevel;
          savePrefs({ thinkingLevel: nextLevel });
          if (nextLevel !== "off") {
            send({ type: "set_thinking_level", level: nextLevel });
          }
        }
      }
    }

    // ── models.yml diagnosis ───────────────────────────────────────────────────
    // omp silently drops every custom provider when models.yml fails its schema
    // validation, while PiDesk still lists those models from the file. When
    // custom models are missing from omp's list, ask `omp models` why (it prints
    // the validation error; RPC mode does not) and surface it.
    // The runner de-duplicates per missing-set and drops results superseded by a
    // newer request or by `invalidate()` (models.yml saved while a run was in flight).
    let configCheckRunner = null;
    function modelsConfigRunner() {
      if (!configCheckRunner) {
        configCheckRunner = window.ModelsConfigCheck.createRunner(
          () => window.__TAURI__.core.invoke("check_models_config"),
          (msg) => {
            if (state.modelsConfigWarning === msg) return;
            state.modelsConfigWarning = msg;
            notify();
          },
        );
      }
      return configCheckRunner;
    }
    function checkModelsConfig(rpcModels, customData) {
      const check = window.ModelsConfigCheck;
      if (!window.__TAURI__ || !check?.createRunner) return;
      const key = check.missingKey(check.missingCustomModels(rpcModels, customData?.customModels));
      modelsConfigRunner().request(key);
    }

    // ── Initial fetch ──────────────────────────────────────────────────────────
    function initFetch() {
      send({ type: "get_state" });
      send({ type: "get_messages" });
      send({ type: "get_available_models" });
      send({ type: "get_available_thinking_levels" });
      loadCustomModelsFromConfig().then(customData => {
        if (customData.customModels.length > 0) {
          state.models = mergeModels(state.models, customData);
          syncCurrentModel();
          notify();
        }
      }).catch(() => {});
    }

    // True when the session's omp is gone and nothing is about to bring it
    // back. A grace-period start in progress must not be pre-empted by an
    // explicit start_session (the backend treats that as cancelling it).
    async function needsRestart(id) {
      if (!window.__TAURI__ || !id || rt.conn.agentStarting) return false;
      const { invoke } = window.__TAURI__.core;
      const running = await invoke("is_session_running", { sessionId: id }).catch(() => false);
      if (running) return false;
      const starting = await invoke("is_session_starting", { sessionId: id }).catch(() => false);
      return !starting;
    }

    // ── RPC response handlers (composed by live/response-handlers.js) ─────────
    // `always`: run for success and failure; return true when fully handled.
    // `success`: (data, resp) — only reached after the generic failure early-return.
    function onSetModelFailure(resp) {
      if (resp.success) return false; // success continues to the `success` table
      console.warn("[live] set_model failed:", resp.error);
      if (pendingSetModel.shift() === "restore") {
        // Saved model no longer exists (e.g. renamed in models.yml): forget it,
        // fall back to what omp is actually running, no notice — not a user action.
        clearModelPrefs();
        const rpcModel = state.rpcState?.model;
        state.model = rpcModel ? buildModelEntry(rpcModel) : null;
        if (rpcModel) {
          syncCurrentModel();
          state.models = state.models.map(m => ({ ...m, current: m.id === rpcModel.id }));
        }
        pushThinkingLevel();
        notify();
        return true;
      }
      const errMsg = resp.error || "Failed to switch model";
      const failText = window.t
        ? window.t("agent.modelSwitchFailed", { error: errMsg })
        : `⚠️ **Model Switch Failed:** ${errMsg}`;
      state.messages = [...state.messages, window.NoticeBubble.make(failText, window.timeNow())];
      notify();
      return true;
    }

    function onGetAvailableModels(data) {
      const rpcModels = (data.models ?? []).map(m => ({
        ...buildModelEntry(m),
        current:  state.rpcState?.model?.id === m.id || state.model?.id === m.id,
      }));
      loadCustomModelsFromConfig().then(customData => {
        state.models = mergeModels(rpcModels, customData);
        syncCurrentModel();
        notify();
        console.log(`[live] models loaded (${state.models.length} total) for session '${rt.conn.activeSessionId}'`);
        checkModelsConfig(rpcModels, customData);
      }).catch(() => {
        state.models = rpcModels;
        syncCurrentModel();
        notify();
      });
    }

    function onGetAvailableThinkingLevels(data) {
      if (!Array.isArray(data?.levels)) return;
      const customModel = findListedModel(state);
      const customEfforts = customModel?.thinking?.efforts ?? state.model?.thinking?.efforts;

      if (Array.isArray(customEfforts) && customEfforts.length > 0) {
        state.availableThinkingLevels = ["off", ...customEfforts];
      } else if (state.model?.reasoning === false) {
        state.availableThinkingLevels = ["off"];
      } else {
        state.availableThinkingLevels = data.levels;
      }
      if (state.thinkingLevel && state.thinkingLevel !== "off" && !state.availableThinkingLevels.includes(state.thinkingLevel)) {
        const fallback = state.availableThinkingLevels.length > 1
          ? (state.model?.thinking?.defaultLevel || state.availableThinkingLevels[1] || "off")
          : "off";
        state.thinkingLevel = fallback;
        savePrefs({ thinkingLevel: fallback });
        if (fallback !== "off") {
          send({ type: "set_thinking_level", level: fallback });
        }
      }
      notify();
    }

    function onSetModelSuccess(data) {
      pendingSetModel.shift();
      if (!data) return;
      state.model  = buildModelEntry(data);
      state.models = state.models.map(m => ({ ...m, current: m.id === data.id }));
      savePrefs({ modelId: data.id, modelProvider: data.provider, modelName: data.name });
      syncCurrentModel();
      pushThinkingLevel();
      send({ type: "get_available_thinking_levels" });
      send({ type: "get_state" });
      notify();
    }

    function onCycleModel(data) {
      if (!data?.model) return;
      state.model  = buildModelEntry(data.model);
      if (data.thinkingLevel != null) state.thinkingLevel = data.thinkingLevel;
      state.models = state.models.map(m => ({ ...m, current: m.id === data.model.id }));
      savePrefs({ modelId: data.model.id, modelProvider: data.model.provider, modelName: data.model.name });
      if (data.thinkingLevel != null) savePrefs({ thinkingLevel: data.thinkingLevel });
      send({ type: "get_available_thinking_levels" });
      notify();
    }

    // PiDesk no longer *sends* cycle_thinking_level (omp ≤ 18.x returns null, so it
    // cycles client-side — see cycleThinking). The response is still honoured, e.g. a
    // stale/other-origin reply: a valid level is adopted, anything else is clamped.
    function onCycleThinkingLevel(data) {
      if (!hasReasoning(state)) {
        state.thinkingLevel = "off";
      } else {
        const validLevels = resolveValidLevels(state);
        if (data?.level != null && validLevels.includes(data.level)) {
          state.thinkingLevel = data.level;
        } else {
          const idx = validLevels.indexOf(state.thinkingLevel);
          const next = validLevels[(idx + 1) % validLevels.length];
          state.thinkingLevel = next;
          send({ type: "set_thinking_level", level: next });
        }
      }
      savePrefs({ thinkingLevel: state.thinkingLevel });
      notify();
    }

    // ── OMP_BRIDGE model API ───────────────────────────────────────────────────
    async function setModel(model) {
      if (await needsRestart(rt.conn.activeSessionId)) {
        const entry = sessionRegistry.get(rt.conn.activeSessionId);
        const cwd = entry?.path ?? "";
        await window.__TAURI__.core
          .invoke("start_session", { sessionId: rt.conn.activeSessionId, cwd })
          .catch(() => {});
      }
      state.agentError = null;
      sendSetModel(model.provider, model.id, "user");
    }

    function cycleModel() { send({ type: "cycle_model" }); }

    function cycleThinking() {
      if (!hasReasoning(state)) {
        state.thinkingLevel = "off";
      } else {
        const levels = resolveValidLevels(state);
        const idx = levels.indexOf(state.thinkingLevel);
        const next = levels[(idx + 1) % levels.length];
        state.thinkingLevel = next;
        savePrefs({ thinkingLevel: next });
        send({ type: "set_thinking_level", level: next });
      }
      notify();
    }

    /** Hide the models.yml warning banner until the missing-model set changes. */
    function dismissModelsConfigWarning() {
      state.modelsConfigWarning = null;
      notify();
    }

    async function refreshModels() {
      configCheckRunner?.invalidate(); // models.yml changed: drop in-flight result, diagnose again
      if (await needsRestart(rt.conn.activeSessionId)) {
        const entry = sessionRegistry.get(rt.conn.activeSessionId);
        const cwd = entry?.path ?? "";
        console.log(`[live] session '${rt.conn.activeSessionId}' is not running; restarting with new models config`);
        try {
          await window.__TAURI__.core.invoke("start_session", {
            sessionId: rt.conn.activeSessionId,
            cwd,
          });
          state.agentError = null;
          const notice = window.t
            ? window.t("agent.restartedAfterModelConfig")
            : "Restarted session with new model configuration.";
          state.messages = [...state.messages, window.NoticeBubble.make(`✨ **${notice}**`, window.timeNow())];
        } catch (e) {
          console.warn("[live] failed to restart session:", e);
          state.agentError = (e && typeof e === "string") ? e : (e?.message || String(e));
        }
      }
      const customData = await loadCustomModelsFromConfig();
      // A model renamed/deleted in models.yml must not be re-pushed to the next
      // session. Judged on models.yml itself: the running omp still lists it.
      if (window.ModelPrefs?.isStaleCustomModel(loadPrefs(), customData)) {
        clearModelPrefs();
      }
      if (customData.customModels.length > 0 || customData.customProviders.size > 0) {
        state.models = mergeModels(state.models, customData);
      }
      syncCurrentModel();
      notify();
      // While omp is still starting the post-start init fetch covers this.
      if (!rt.conn.agentStarting) initFetch();
    }

    return {
      restorePrefs, syncCurrentModel, initFetch, sendSetModel, pushThinkingLevel,
      responseHandlers: {
        always: { set_model: onSetModelFailure },
        success: {
          get_available_models:          onGetAvailableModels,
          get_available_thinking_levels: onGetAvailableThinkingLevels,
          set_model:                     onSetModelSuccess,
          cycle_model:                   onCycleModel,
          cycle_thinking_level:          onCycleThinkingLevel,
        },
      },
      api: {
        setModel, cycleModel, cycleThinking, dismissModelsConfigWarning, refreshModels,
        getAvailableThinkingLevels() { return state.availableThinkingLevels; },
      },
    };
  }

  window._Live.Models = { create, hasReasoning, resolveValidLevels };
})();
