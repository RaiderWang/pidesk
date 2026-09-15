/* ═════════════════════════════════════════════════════════════════════
   model-manager-modal.jsx — Custom Model Management Panel
   Allows adding, editing, deleting models & providers in models.yml.
   Supports both visual form view and raw YAML editing.
   ═════════════════════════════════════════════════════════════════════ */

const { Icon, YamlUtil } = window;

function ModelManagerModal({ open, onClose, onModelUpdated }) {
  const [tab, setTab]                     = React.useState("form"); // "form" | "yaml"
  const [filePath, setFilePath]           = React.useState("");
  const [rawYaml, setRawYaml]             = React.useState("");
  const [parsed, setParsed]               = React.useState({ providers: {} });
  const [loading, setLoading]             = React.useState(false);
  const [saving, setSaving]               = React.useState(false);
  const [toast, setToast]                 = React.useState(null);
  const [search, setSearch]               = React.useState("");
  const [editingModel, setEditingModel]   = React.useState(null);
  const [editingProv, setEditingProv]     = React.useState(null);
  const [confirmDel, setConfirmDel]       = React.useState(null);

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(t => (t?.message === message ? null : t)), 3500);
  };

  const loadConfig = React.useCallback(async () => {
    if (!window.OMP_BRIDGE?.readModelsConfig) return;
    setLoading(true);
    try {
      const res = await window.OMP_BRIDGE.readModelsConfig();
      setFilePath(res.path || "");
      setRawYaml(res.content || "");
      const p = YamlUtil.parseModelsYaml(res.content || "");
      setParsed(p);
    } catch (err) {
      showToast("Failed to load models config: " + (err.message || String(err)), "error");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (open) {
      setTab("form");
      setEditingModel(null);
      setEditingProv(null);
      setConfirmDel(null);
      setSearch("");
      loadConfig();
    }
  }, [open, loadConfig]);

  // Switch tabs with synchronization
  const handleTabChange = (targetTab) => {
    if (targetTab === tab) return;
    if (targetTab === "yaml") {
      const dumped = YamlUtil.dumpModelsYaml(parsed);
      setRawYaml(dumped);
      setTab("yaml");
    } else {
      const check = YamlUtil.validateModelsYaml(rawYaml);
      if (!check.valid) {
        showToast("Invalid YAML syntax, cannot switch to form view: " + check.error, "error");
        return;
      }
      setParsed(check.parsed);
      setTab("form");
    }
  };

  // Save changes to disk and reload models
  const handleSave = async () => {
    let yamlToSave = rawYaml;
    if (tab === "form") {
      yamlToSave = YamlUtil.dumpModelsYaml(parsed);
      setRawYaml(yamlToSave);
    } else {
      const check = YamlUtil.validateModelsYaml(rawYaml);
      if (!check.valid) {
        showToast("YAML validation failed: " + check.error, "error");
        return;
      }
      setParsed(check.parsed);
    }

    setSaving(true);
    try {
      await window.OMP_BRIDGE?.writeModelsConfig(yamlToSave);
      showToast("Models config saved & backed up to models.yml.bak");
      await window.OMP_BRIDGE?.refreshModels();
      onModelUpdated?.();
    } catch (err) {
      showToast("Save failed: " + (err.message || String(err)), "error");
    } finally {
      setSaving(false);
    }
  };

  // Keyboard navigation & Esc dismissal
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        if (editingModel) setEditingModel(null);
        else if (editingProv) setEditingProv(null);
        else if (confirmDel) setConfirmDel(null);
        else onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, editingModel, editingProv, confirmDel]);

  if (!open) return null;

  const providers = parsed?.providers || {};
  const pKeys = Object.keys(providers);

  // Model CRUD actions
  const saveModelItem = (pKey, modelData, isNew, oldId) => {
    const next = JSON.parse(JSON.stringify(parsed));
    if (!next.providers[pKey]) {
      next.providers[pKey] = { baseUrl: "", apiKey: "", api: "openai-completions", models: [] };
    }
    const list = next.providers[pKey].models || [];
    if (isNew) {
      list.push(modelData);
    } else {
      const idx = list.findIndex(m => m.id === oldId);
      if (idx !== -1) list[idx] = modelData;
      else list.push(modelData);
    }
    next.providers[pKey].models = list;
    setParsed(next);
    setEditingModel(null);
  };

  const deleteModelItem = (pKey, modelId) => {
    const next = JSON.parse(JSON.stringify(parsed));
    if (next.providers[pKey]?.models) {
      next.providers[pKey].models = next.providers[pKey].models.filter(m => m.id !== modelId);
      setParsed(next);
    }
    setConfirmDel(null);
  };

  // Provider CRUD actions
  const saveProviderItem = (pKey, provData, isNew, oldKey) => {
    const next = JSON.parse(JSON.stringify(parsed));
    if (!isNew && oldKey && oldKey !== pKey) {
      const oldModels = next.providers[oldKey]?.models || [];
      delete next.providers[oldKey];
      next.providers[pKey] = { ...provData, models: oldModels };
    } else {
      const existingModels = next.providers[pKey]?.models || [];
      next.providers[pKey] = { ...provData, models: existingModels };
    }
    setParsed(next);
    setEditingProv(null);
  };

  const deleteProviderItem = (pKey) => {
    const next = JSON.parse(JSON.stringify(parsed));
    delete next.providers[pKey];
    setParsed(next);
    setConfirmDel(null);
  };

  return (
    <>
      <div className="bridge-scrim" onClick={onClose} style={{ paddingTop: "5vh" }}>
        <div className="bridge slide-in" onClick={e => e.stopPropagation()}
          style={{ width: "min(880px, calc(100vw - 32px))", maxHeight: "88vh", display: "flex", flexDirection: "column" }}>

          {/* Modal Header */}
          <div className="bridge-input-row" style={{ padding: "10px 16px", gap: 10, borderBottom: "1px solid var(--line)" }}>
            <Icon name="cpu" size={16} color="var(--accent)" />
            <span style={{ fontWeight: 600, fontSize: "var(--d-text-md)", color: "var(--fg)" }}>
              Manage Models <span className="mono" style={{ fontSize: "var(--d-text-xs)", color: "var(--fg-4)", fontWeight: 400 }}>models.yml</span>
            </span>

            <div style={{ flex: 1 }} />

            <button className="btn ghost" style={{ height: 24, fontSize: "var(--d-text-xs)", padding: "0 8px", gap: 4 }}
              title="Open models.yml in external editor" onClick={() => window.OMP_BRIDGE?.openModelsFile()}>
              <Icon name="edit" size={11} color="var(--fg-3)" /> Open in Editor
            </button>
            <button className="btn ghost" style={{ height: 24, fontSize: "var(--d-text-xs)", padding: "0 8px", gap: 4 }}
              title="Reveal models folder in file explorer" onClick={() => window.OMP_BRIDGE?.openModelsFolder()}>
              <Icon name="folder" size={11} color="var(--fg-3)" /> Open Folder
            </button>
            <button className="btn ghost" style={{ height: 24, fontSize: "var(--d-text-xs)", padding: "0 8px", gap: 4 }}
              title="Reload configuration from disk" onClick={loadConfig}>
              <Icon name="refresh" size={11} color={loading ? "var(--accent)" : "var(--fg-3)"} /> Reload
            </button>
            <button className="btn icon ghost" onClick={onClose} style={{ width: 24, height: 24 }}>
              <Icon name="close" size={12} color="var(--fg-4)" />
            </button>
          </div>

          {/* Sub-bar: tabs + file path + search */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "8px 16px", borderBottom: "1px solid var(--line)", background: "var(--bg-surface)",
            fontSize: "var(--d-text-xs)", flexWrap: "wrap",
          }}>
            <div style={{ display: "flex", gap: 4, background: "var(--bg-card)", padding: 2, borderRadius: 6 }}>
              <button className={`btn ${tab === "form" ? "accent" : "ghost"}`}
                style={{ height: 22, padding: "0 10px", fontSize: "var(--d-text-xs)", borderRadius: 4 }}
                onClick={() => handleTabChange("form")}>
                Models ({pKeys.reduce((acc, k) => acc + (providers[k].models?.length || 0), 0)})
              </button>
              <button className={`btn ${tab === "yaml" ? "accent" : "ghost"}`}
                style={{ height: 22, padding: "0 10px", fontSize: "var(--d-text-xs)", borderRadius: 4 }}
                onClick={() => handleTabChange("yaml")}>
                Raw YAML
              </button>
            </div>

            {tab === "form" && (
              <input
                className="bridge-input mono"
                placeholder="Filter models or providers…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ height: 24, maxWidth: 220, fontSize: "var(--d-text-xs)", padding: "0 8px", borderRadius: 4, border: "1px solid var(--line)" }}
              />
            )}

            <span className="mono" style={{ color: "var(--fg-4)", marginLeft: "auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }} title={filePath}>
              {filePath}
            </span>
          </div>

          {/* Toast Alert */}
          {toast && (
            <div style={{
              padding: "8px 16px",
              background: toast.type === "error" ? "color-mix(in oklab, var(--rose) 18%, var(--bg-surface))" : "color-mix(in oklab, var(--lime) 18%, var(--bg-surface))",
              borderBottom: `1px solid ${toast.type === "error" ? "var(--rose)" : "var(--lime)"}`,
              color: toast.type === "error" ? "var(--rose)" : "var(--lime)",
              fontSize: "var(--d-text-xs)", display: "flex", alignItems: "center", gap: 6,
            }}>
              <Icon name={toast.type === "error" ? "warn" : "check"} size={12} />
              <span style={{ flex: 1 }}>{toast.message}</span>
              <button className="btn icon ghost" onClick={() => setToast(null)} style={{ width: 18, height: 18 }}><Icon name="close" size={9} /></button>
            </div>
          )}

          {/* Main Body */}
          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            {tab === "yaml" ? (
              <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 6 }}>
                <div className="mono" style={{ color: "var(--fg-4)", fontSize: "var(--d-text-xs)" }}>
                  Edit raw models.yml directly. Click &quot;Save &amp; Apply&quot; below to persist changes:
                </div>
                <textarea
                  className="mono"
                  value={rawYaml}
                  onChange={e => setRawYaml(e.target.value)}
                  style={{
                    width: "100%", height: "420px", resize: "vertical",
                    background: "var(--bg-app)", color: "var(--fg)", border: "1px solid var(--line)",
                    borderRadius: 8, padding: 12, fontSize: 13, lineHeight: "1.5",
                    fontFamily: "var(--font-mono, monospace)",
                  }}
                />
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* Add Provider Button */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span className="mono" style={{ color: "var(--fg-3)", fontSize: "var(--d-text-xs)" }}>
                    {pKeys.length} {pKeys.length === 1 ? "provider" : "providers"}
                  </span>
                  <button className="btn ghost outlined" style={{ height: 26, fontSize: "var(--d-text-xs)", gap: 4 }}
                    onClick={() => setEditingProv({ key: "custom-proxy", isNew: true, provider: { baseUrl: "http://localhost:20128/v1", apiKey: "", api: "openai-completions" } })}>
                    <Icon name="plus" size={10} color="var(--accent)" /> Add Provider
                  </button>
                </div>

                {pKeys.length === 0 && (
                  <div className="bridge-empty" style={{ padding: "30px 0" }}>
                    No model providers configured yet. Click &quot;Add Provider&quot; above or edit raw YAML directly.
                  </div>
                )}

                {/* Providers & Models List */}
                {pKeys.map(pKey => {
                  const prov = providers[pKey] || {};
                  const models = (prov.models || []).filter(m => {
                    if (!search.trim()) return true;
                    const q = search.toLowerCase();
                    return pKey.toLowerCase().includes(q) || (m.id && m.id.toLowerCase().includes(q)) || (m.name && m.name.toLowerCase().includes(q));
                  });

                  if (search.trim() && models.length === 0 && !pKey.toLowerCase().includes(search.toLowerCase())) {
                    return null;
                  }

                  return (
                    <div key={pKey} style={{
                      border: "1px solid var(--line)", borderRadius: 10, background: "var(--bg-surface)",
                      padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12,
                    }}>
                      {/* Provider Header */}
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span className="mono" style={{ fontWeight: 600, color: "var(--accent)", fontSize: "var(--d-text-sm)" }}>
                          {pKey}
                        </span>
                        <span className="chip muted mono" style={{ fontSize: "var(--d-text-xs)" }}>
                          {prov.api || "openai-completions"}
                        </span>
                        <span className="mono" style={{ color: "var(--fg-4)", fontSize: "var(--d-text-xs)" }}>
                          {prov.baseUrl || "—"}
                        </span>

                        <div style={{ flex: 1 }} />

                        <button className="btn ghost" style={{ height: 22, fontSize: "var(--d-text-xs)", padding: "0 6px", gap: 4 }}
                          onClick={() => setEditingModel({ providerKey: pKey, isNew: true, model: { id: "", name: "", contextWindow: 200000, maxTokens: 8192, reasoning: false, input: ["text"] } })}>
                          <Icon name="plus" size={10} color="var(--accent)" /> Add Model
                        </button>
                        <button className="btn ghost" style={{ height: 22, fontSize: "var(--d-text-xs)", padding: "0 6px" }}
                          title="Edit provider" onClick={() => setEditingProv({ key: pKey, isNew: false, provider: { ...prov } })}>
                          <Icon name="edit" size={11} color="var(--fg-3)" />
                        </button>
                        <button className="btn ghost" style={{ height: 22, fontSize: "var(--d-text-xs)", padding: "0 6px" }}
                          title="Delete provider" onClick={() => setConfirmDel({ type: "provider", providerKey: pKey })}>
                          <Icon name="trash" size={11} color="var(--rose)" />
                        </button>
                      </div>

                      {/* Model Rows */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 8 }}>
                        {models.map(m => (
                          <div key={m.id} style={{
                            border: "1px solid var(--line)", borderRadius: 8, background: "var(--bg-card)",
                            padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6,
                            transition: "border-color 0.15s, background 0.15s",
                          }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <Icon name="bolt" size={11} color="var(--cyan)" />
                              <span style={{ fontWeight: 600, fontSize: "var(--d-text-xs)", color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }} title={m.name || m.id}>
                                {m.name || m.id}
                              </span>
                              <button className="btn icon ghost" title="Edit model" style={{ width: 20, height: 20 }}
                                onClick={() => setEditingModel({ providerKey: pKey, isNew: false, model: { ...m }, oldId: m.id })}>
                                <Icon name="edit" size={10} color="var(--fg-3)" />
                              </button>
                              <button className="btn icon ghost" title="Delete model" style={{ width: 20, height: 20 }}
                                onClick={() => setConfirmDel({ type: "model", providerKey: pKey, modelId: m.id })}>
                                <Icon name="trash" size={10} color="var(--rose)" />
                              </button>
                            </div>

                            <div className="mono" style={{ fontSize: 11, color: "var(--fg-4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {m.id}
                            </div>

                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, flexWrap: "wrap" }}>
                              {m.contextWindow && (
                                <span className="chip muted mono" style={{ fontSize: 10, padding: "1px 5px" }}>
                                  ctx {Math.round(m.contextWindow / 1000)}k
                                </span>
                              )}
                              {m.maxTokens && (
                                <span className="chip muted mono" style={{ fontSize: 10, padding: "1px 5px" }}>
                                  out {Math.round(m.maxTokens / 1000)}k
                                </span>
                              )}
                              {m.reasoning && (
                                <span className="chip mono" style={{ fontSize: 10, padding: "1px 5px", color: "var(--lilac)", borderColor: "var(--lilac)" }}>
                                  reasoning
                                </span>
                              )}
                              {((Array.isArray(m.input) && m.input.includes("image")) || m.images || m.vision) && (
                                <span className="chip mono" style={{ fontSize: 10, padding: "1px 5px", color: "var(--cyan)", borderColor: "color-mix(in oklab, var(--cyan) 40%, transparent)" }}>
                                  vision
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                        {models.length === 0 && (
                          <div className="mono" style={{ color: "var(--fg-5)", fontSize: "var(--d-text-xs)", padding: "8px 0" }}>
                            No models configured under this provider
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 16px", borderTop: "1px solid var(--line)", background: "var(--bg-surface)",
          }}>
            <span className="mono" style={{ color: "var(--fg-4)", fontSize: "var(--d-text-xs)" }}>
              <span className="kbd">esc</span> to close
            </span>

            <div style={{ flex: 1 }} />

            <button className="btn ghost" onClick={onClose} style={{ height: 28, padding: "0 14px" }}>
              Cancel
            </button>
            <button className="btn accent" onClick={handleSave} disabled={saving}
              style={{ height: 28, padding: "0 16px", gap: 6 }}>
              <Icon name="check" size={11} /> {saving ? "Saving…" : "Save & Apply"}
            </button>
          </div>
        </div>
      </div>

      {/* Edit Model Sub-dialog */}
      {editingModel && (
        <EditModelModal
          item={editingModel}
          pKeys={pKeys}
          onClose={() => setEditingModel(null)}
          onSave={saveModelItem}
        />
      )}

      {/* Edit Provider Sub-dialog */}
      {editingProv && (
        <EditProviderModal
          item={editingProv}
          onClose={() => setEditingProv(null)}
          onSave={saveProviderItem}
        />
      )}

      {/* Delete Confirmation Sub-dialog */}
      {confirmDel && (
        <div className="bridge-scrim" style={{ zIndex: 10002, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", paddingTop: 0, padding: 16 }} onClick={() => setConfirmDel(null)}>
          <div className="bridge slide-in" onClick={e => e.stopPropagation()}
            style={{ width: 420, maxHeight: "90vh", overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--rose)", fontWeight: 600 }}>
              <Icon name="warn" size={16} /> Confirm Delete
            </div>
            <div style={{ fontSize: "var(--d-text-sm)", color: "var(--fg-2)" }}>
              {confirmDel.type === "model"
                ? `Are you sure you want to delete model "${confirmDel.modelId}"?`
                : `Are you sure you want to delete provider "${confirmDel.providerKey}" and all its models?`}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="btn ghost" onClick={() => setConfirmDel(null)}>Cancel</button>
              <button className="btn" style={{ background: "var(--rose)", color: "#fff" }}
                onClick={() => {
                  if (confirmDel.type === "model") deleteModelItem(confirmDel.providerKey, confirmDel.modelId);
                  else deleteProviderItem(confirmDel.providerKey);
                }}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Edit Model Modal Helper ───────────────────────────────────────────
function EditModelModal({ item, pKeys, onClose, onSave }) {
  const [providerKey, setProviderKey] = React.useState(item.providerKey || pKeys[0] || "custom-proxy");
  const [id, setId]                   = React.useState(item.model?.id || "");
  const [name, setName]               = React.useState(item.model?.name || "");
  const [ctx, setCtx]                 = React.useState(item.model?.contextWindow ?? 200000);
  const [maxTok, setMaxTok]           = React.useState(item.model?.maxTokens ?? 8192);
  const [reasoning, setReasoning]     = React.useState(!!item.model?.reasoning);
  const [vision, setVision]           = React.useState(
    Array.isArray(item.model?.input)
      ? item.model.input.includes("image")
      : (!!item.model?.images || !!item.model?.vision)
  );
  const [err, setErr]                 = React.useState("");

  const handleSubmit = (e) => {
    e?.preventDefault();
    if (!id.trim()) { setErr("Model ID is required"); return; }
    onSave(providerKey, {
      ...item.model,
      id: id.trim(),
      name: name.trim() || id.trim(),
      contextWindow: Number(ctx) || 200000,
      maxTokens: Number(maxTok) || 8192,
      reasoning: !!reasoning,
      input: vision ? ["text", "image"] : ["text"],
    }, item.isNew, item.oldId);
  };

  return (
    <div className="bridge-scrim" style={{ zIndex: 10002, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", paddingTop: 0, padding: 16 }} onClick={onClose}>
      <div className="bridge slide-in" onClick={e => e.stopPropagation()}
        style={{ width: 480, maxHeight: "90vh", overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: "var(--d-text-md)" }}>
          <Icon name="bolt" size={14} color="var(--accent)" />
          {item.isNew ? "Add Model" : "Edit Model"}
        </div>

        {err && <div style={{ color: "var(--rose)", fontSize: "var(--d-text-xs)" }}>{err}</div>}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--d-text-xs)", color: "var(--fg-3)" }}>
            Provider:
            <select
              value={providerKey}
              onChange={e => setProviderKey(e.target.value)}
              className="bridge-input mono"
              style={{ height: 28, padding: "0 8px", background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: 4, color: "var(--fg)" }}>
              {pKeys.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--d-text-xs)", color: "var(--fg-3)" }}>
            Model ID (e.g. auto/best-free, deepseek-chat):
            <input className="bridge-input mono" value={id} onChange={e => setId(e.target.value)} required placeholder="model-id" />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--d-text-xs)", color: "var(--fg-3)" }}>
            Display Name (optional):
            <input className="bridge-input" value={name} onChange={e => setName(e.target.value)} placeholder="friendly display name" />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--d-text-xs)", color: "var(--fg-3)" }}>
              Context Window:
              <input type="number" className="bridge-input mono" value={ctx} onChange={e => setCtx(e.target.value)} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--d-text-xs)", color: "var(--fg-3)" }}>
              Max Output Tokens:
              <input type="number" className="bridge-input mono" value={maxTok} onChange={e => setMaxTok(e.target.value)} />
            </label>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--d-text-xs)", color: "var(--fg-2)", cursor: "pointer", marginTop: 4 }}>
            <input type="checkbox" checked={reasoning} onChange={e => setReasoning(e.target.checked)} />
            Support reasoning / thinking effort
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--d-text-xs)", color: "var(--fg-2)", cursor: "pointer", marginTop: 2 }}>
            <input type="checkbox" checked={vision} onChange={e => setVision(e.target.checked)} />
            Support vision / image input
          </label>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn accent">Confirm</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Edit Provider Modal Helper ────────────────────────────────────────
function EditProviderModal({ item, onClose, onSave }) {
  const [key, setKey]         = React.useState(item.key || "");
  const [baseUrl, setBaseUrl] = React.useState(item.provider?.baseUrl || "");
  const [apiKey, setApiKey]   = React.useState(item.provider?.apiKey || "");
  const [api, setApi]         = React.useState(item.provider?.api || "openai-completions");
  const [err, setErr]         = React.useState("");

  const handleSubmit = (e) => {
    e?.preventDefault();
    if (!key.trim()) { setErr("Provider ID is required"); return; }
    onSave(key.trim(), {
      ...item.provider,
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      api: api.trim() || "openai-completions",
    }, item.isNew, item.key);
  };

  return (
    <div className="bridge-scrim" style={{ zIndex: 10002, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", paddingTop: 0, padding: 16 }} onClick={onClose}>
      <div className="bridge slide-in" onClick={e => e.stopPropagation()}
        style={{ width: 480, maxHeight: "90vh", overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: "var(--d-text-md)" }}>
          <Icon name="cpu" size={14} color="var(--accent)" />
          {item.isNew ? "Add Provider" : "Edit Provider"}
        </div>

        {err && <div style={{ color: "var(--rose)", fontSize: "var(--d-text-xs)" }}>{err}</div>}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--d-text-xs)", color: "var(--fg-3)" }}>
            Provider ID (e.g. custom-proxy):
            <input className="bridge-input mono" value={key} onChange={e => setKey(e.target.value)} required placeholder="custom-proxy" />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--d-text-xs)", color: "var(--fg-3)" }}>
            API Base URL (e.g. http://localhost:20128/v1):
            <input className="bridge-input mono" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="http://..." />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--d-text-xs)", color: "var(--fg-3)" }}>
            API Key (optional):
            <input type="password" className="bridge-input mono" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--d-text-xs)", color: "var(--fg-3)" }}>
            API Protocol:
            <select
              value={api}
              onChange={e => setApi(e.target.value)}
              className="bridge-input mono"
              style={{ height: 28, padding: "0 8px", background: "var(--bg-surface)", border: "1px solid var(--line)", borderRadius: 4, color: "var(--fg)" }}>
              <option value="openai-completions">openai-completions (OpenAI compatible)</option>
              <option value="anthropic-messages">anthropic-messages (Anthropic Messages)</option>
              <option value="gemini">gemini</option>
            </select>
          </label>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn accent">Confirm</button>
          </div>
        </form>
      </div>
    </div>
  );
}

window.ModelManagerModal = ModelManagerModal;
