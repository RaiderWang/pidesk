/* ═════════════════════════════════════════════════════════════════════
   app-live.jsx — live-wired root. Replaces design/app.jsx.

   Session model: each tab owns one omp process. OMP_BRIDGE manages
   session lifecycle; the tab list and active session come from the
   bridge (snap.sessions / snap.activeSessionId). Switching tabs calls
   bridge.activateSession() which resets ALL per-session state and
   re-fetches from omp — so the right panel (sparkline, activity radar,
   minimap, kanban, context gauge) always reflects the active session.

   Constants and the cross-cutting effects (bridge subscription, theme,
   ⌘K shortcut) live in app/constants.js and app/use-bridge-snapshot.jsx
   respectively. This file owns only the App component itself: state
   declarations, handlers, and the render tree.
   ═════════════════════════════════════════════════════════════════════ */

const {
  Icon, ChatView, Composer, CommandBridge, WindowChrome, TabBar,
  StatusBar, AmbientRail, SplitPeer, PlanKanban, HistoryModal, ModelManagerModal, useTweaks,
  TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakColor, TweakSlider,
  TWEAK_DEFAULTS, NULL_MODEL, EMPTY_PROJECT, NULL_PEER,
  INTENT_FRAMING, APPROVAL_PROMPT,
  useBridgeSnapshot, useThemeEffect, useCommandShortcut, timeNow,
} = window;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  if (window.I18N && t.locale) {
    window.I18N.setLocale(t.locale);
  }
  const data          = window.OMP_DATA;
  const bridge        = window.OMP_BRIDGE;

  // ── UI state ──────────────────────────────────────────────────────────────
  const [bridgeOpen,  setBridgeOpen]  = React.useState(false);
  const [bridgeView,  setBridgeView]  = React.useState("commands");
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [modelManagerOpen, setModelManagerOpen] = React.useState(false);
  const [planOpen,    setPlanOpen]    = React.useState(false);
  const [planMode,    setPlanMode]    = React.useState(false);
  const planStartedRef = React.useRef(false); // true after first send in plan mode
  const [planAnnotations, setPlanAnnotations] = React.useState({});
  const handleAnnotate = React.useCallback((idx, value) => setPlanAnnotations(prev => {
    const next = { ...prev };
    if (value === null) delete next[idx]; else next[idx] = value;
    return next;
  }), []);

  // Cross-component highlight: hovering a minimap cell lights up the
  // matching chat bubble; clicking scrolls to it.
  const [hoveredMsgIdx, setHoveredMsgIdx] = React.useState(null);
  const handleMinimapClick = (idx) => {
    const el = document.querySelector(`[data-msg-idx="${idx}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  // ── Live data (all per-session — driven by OMP_BRIDGE.onUpdate) ───────────
  const [messages,      setMessages]      = React.useState([]);
  const [streaming,     setStreaming]     = React.useState(false);
  const [model,         setModelState]    = React.useState(NULL_MODEL);
  const [thinkingLevel, setThinkingLevel] = React.useState(null);
  const [ctx,           setCtx]           = React.useState(data.ctx);
  const [kanban,        setKanban]        = React.useState([]);
  const [planMeta,      setPlanMeta]      = React.useState(data.planMeta);
  const [models,        setModels]        = React.useState(() => bridge?.models || data.models || []);
  const [activity,      setActivity]      = React.useState([]);
  const [sparkline,     setSparkline]     = React.useState(Array(30).fill(0));
  const [loginProviders, setLoginProviders] = React.useState(null);

  // ── Peer session — pinned to the ambient rail ─────────────────────────────
  const [peer,          setPeer]          = React.useState(null);
  const [peerSessionId, setPeerSessionId] = React.useState(null);

  // ── Agent activity — running tools + turn clock ───────────────────────────
  const [runningTools,  setRunningTools]  = React.useState([]);
  const [recentTools,   setRecentTools]   = React.useState([]);
  const [turnStartMs,   setTurnStartMs]   = React.useState(null);

  // ── Tab list — driven by bridge session registry ──────────────────────────
  // Each entry: { id, name, path, color, branch }
  const [sessions,        setSessions]        = React.useState([]);
  const [activeSessionId, setActiveSessionId] = React.useState("");
  const [appVersion,      setAppVersion]      = React.useState(window.OMP_APP_VERSION || "");

  React.useEffect(() => {
    bridge?.getAppVersion?.().then(v => {
      if (v) {
        window.OMP_APP_VERSION = v;
        setAppVersion(v);
      }
    });
  }, [bridge]);

  // ── Cross-cutting effects (bridge subscription, theme, ⌘K) ────────────────
  useBridgeSnapshot(bridge, {
    setMessages, setStreaming, setCtx, setKanban, setPlanMeta,
    setModels, setActivity, setSparkline,
    setModelState, setThinkingLevel,
    setSessions, setActiveSessionId,
    setPeer, setPeerSessionId,
    setRunningTools, setRecentTools, setTurnStartMs,
  });
  useThemeEffect(t);
  useCommandShortcut(setBridgeOpen, setBridgeView);

  // Global shortcuts: Ctrl+H for history, Ctrl+M for model management, Ctrl+O for open project, Ctrl+T for standalone session
  React.useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setHistoryOpen(prev => !prev);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "m") {
        e.preventDefault();
        setModelManagerOpen(prev => !prev);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        handleNewProject();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "t") {
        e.preventDefault();
        handleNewStandalone();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Fetch OAuth providers whenever the login view opens (ensures fresh auth status)
  React.useEffect(() => {
    if (!bridgeOpen || bridgeView !== "login") return;
    setLoginProviders(null);
    bridge?.getLoginProviders()
      .then(data => setLoginProviders(data?.providers ?? []))
      .catch(() => setLoginProviders([]));
  }, [bridgeOpen, bridgeView]);

  const openBridge = view => { setBridgeView(view); setBridgeOpen(true); };

  // ── Derived values ────────────────────────────────────────────────────────
  const activeProject = sessions.find(s => s.id === activeSessionId) ?? sessions[0] ?? EMPTY_PROJECT;
  const todoCounts    = kanban.reduce(
    (acc, col) => {
      acc.total += col.tasks.length;
      acc.done  += col.tasks.filter(tk => tk.status === "done").length;
      return acc;
    },
    { total: 0, done: 0 }
  );

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSend = (text, images = []) => {
    const hasAnnotations = Object.keys(planAnnotations).length > 0;
    const hasImages = images && images.length > 0;
    if (!text.trim() && !hasAnnotations && !hasImages) return;
    let msg = text.trim();
    if (planMode) {
      if (hasAnnotations) {
        // Feedback with block comments — always takes priority over intent framing
        const lineComments = Object.entries(planAnnotations)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([, { raw, comment }]) => {
            const quoted = raw.split('\n').map(l => `> ${l}`).join('\n');
            return `${quoted}\n→ ${comment.trim()}`;
          }).join('\n\n');
        const parts = ['Line comments:\n' + lineComments, text.trim()].filter(Boolean);
        msg = parts.join('\n\n');
        setPlanAnnotations({});
        planStartedRef.current = true; // annotations imply plan is already in progress
      } else if (!planStartedRef.current) {
        // First clean send — wrap in intent framing
        planStartedRef.current = true;
        msg = INTENT_FRAMING(text.trim());
      }
    }
    if (streaming) {
      bridge?.steer(msg);
    } else if (bridge?.isConnected) {
      bridge.send(msg, images);
    } else {
      setMessages(prev => [...prev, { kind: "user", time: timeNow(), text: msg, images: images ?? [] }]);
    }
  };

  const handleAbort      = () => { bridge?.abort(); setStreaming(false); };
  const handlePickModel  = m  => { setModelState(m); bridge?.setModel(m); };
  const handleAskAnswer  = React.useCallback((id, value) => { bridge?.answerAsk(id, value); }, [bridge]); // bridge = window.OMP_BRIDGE, assigned once before React renders — stable ref
  const handlePickLogin = async (provider) => {
    if (!bridge) return;
    try {
      // OMP_BRIDGE.login resolves when OAuth completes (≤300 s).
      // live.js handles extension_ui_request.open_url via open_url_external (system browser).
      // For already-authenticated providers omp refreshes the token silently (no browser).
      // Use bridge.addAssistantMessage — writes into state.messages so the message
      // survives any subsequent notify() call (e.g. model registry refresh after login).
      await bridge.login(provider.id);
      bridge.addAssistantMessage(`Logged in to **${provider.name}**.`);
    } catch (err) {
      const msg = err?.message ?? String(err);
      bridge.addAssistantMessage(`**Login failed (${provider.name}):** ${msg}`);
    }
  };
  const cycleThinking    = () => bridge?.cycleThinking();

  const handleCommand = c => {
    if      (c.name === "plan")     { setPlanMode(true); planStartedRef.current = false; }
    else if (c.name === "todo")     { setPlanOpen(true); }
    else if (c.name === "compact")  { bridge?.compact(); }
    else if (c.name === "export")   { bridge?.exportHtml(); }
    else if (c.name === "thinking") { cycleThinking(); }
    else if (c.name === "model")    { openBridge("models"); }
    else if (c.name === "login")    { openBridge("login"); }
    else if (c.name === "new")      { bridge?.newSession(); }
    else if (c.name === "history")  { setHistoryOpen(true); }
    else if (c.name === "models")   { setModelManagerOpen(true); }
    else if (c.name === "steer") {
      // steer is only meaningful while the agent is streaming.
      // Selecting it from the palette while streaming closes the bridge so
      // the composer gets focus and the user can type a redirect message.
      // While idle, show an informational nudge instead.
      if (streaming) {
        setBridgeOpen(false);
        // composer's useEffect re-focuses textarea when bridge closes
      } else {
        bridge?.addAssistantMessage(
               window.t
                 ? window.t("cmd.steer.idle", null, "**Steer** is only available while the agent is running — type your message in the input area during streaming to redirect it.")
                 : "**Steer** is only available while the agent is running — type your message in the input area during streaming to redirect it."
             );
           }
         }
  };

  const handleResumeSession = async (session) => {
    if (!bridge || !session) return;
    await bridge.resumeSession(session);
  };

  // Branch from a specific message (or HEAD when idx is omitted)
  const handleBranch = React.useCallback(
    (fromMsgIdx = null) => { bridge?.branch(fromMsgIdx); },
    [bridge],
  );

  const handleApprovePlan = () => {
    setPlanAnnotations({});
    bridge?.followUp(APPROVAL_PROMPT());
    setPlanMode(false);
    planStartedRef.current = false;
    setPlanOpen(true);
  };

  // Tab select — switches the active session; bridge resets all per-session state
  // and re-fetches from the new session's omp → notify() pushes fresh data.
  const handleSelectTab = id => {
    if (id === activeSessionId) return;
    bridge?.activateSession(id);
    // setActiveSessionId is driven by snap.activeSessionId from onUpdate
  };

  // Open project → new session → new tab with its own omp process
  const handleNewProject = async () => {
    if (!bridge) return;
    const path = await bridge.pickFolder();
    if (!path) return;
    await bridge.openSession(path);
    // Tab list and activeSessionId are updated via onUpdate from the bridge
  };

  // Open standalone session (no project folder)
  const handleNewStandalone = async () => {
    if (!bridge) return;
    await bridge.openSession(null);
  };

  // Close tab → kills that session's omp process; bridge updates tab list
  const handleCloseTab = id => { bridge?.closeSession(id); };

  // ── Peer session handlers ───────────────────────────────────────────────
  const handleSetPeer   = id  => bridge?.setPeer(id);
  const handleClearPeer = ()  => bridge?.clearPeer();
  const handleFocusPeer = ()  => { if (peerSessionId) bridge?.activateSession(peerSessionId); };

  const showRail  = t.layout !== "focus";
  const showSplit = t.layout === "split" && peer !== null;
  const safePeer  = peer ?? NULL_PEER;
  const liveCtx   = ctx ?? data.ctx;

  return (
    <>
      <div className="app-backdrop" />
      <div className="app">
        <div className={`window scanlines ${showSplit ? "is-split" : ""}`}>
          <WindowChrome
            project={activeProject}
            peer={safePeer}
            onCmd={() => setBridgeOpen(true)}
          />
          <TabBar
            projects={sessions}
            activeId={activeSessionId}
            onSelect={handleSelectTab}
            peer={safePeer}
            onNew={handleNewProject}
            onNewProject={handleNewProject}
            onNewStandalone={handleNewStandalone}
            onClose={handleCloseTab}
            onHistory={() => setHistoryOpen(true)}
            onManageModels={() => setModelManagerOpen(true)}
            appVersion={appVersion}
            theme={t.theme}
          />

          <div className={`stage ${showRail ? "with-rail" : ""}`}>
            <main className="session">
              <ChatView messages={messages}
                planMode={planMode}
                annotations={planAnnotations}
                onAnnotate={handleAnnotate}
                onAskAnswer={handleAskAnswer}
                hoveredMsgIdx={hoveredMsgIdx}
                onBranch={handleBranch}
              />
              <Composer
                onSend={handleSend}
                planMode={planMode}
                onTogglePlan={() => {
                  const next = !planMode;
                  setPlanMode(next);
                  if (!next) planStartedRef.current = false;
                }}
                onOpenCmd={() => openBridge("commands")}
                onOpenModel={() => openBridge("models")}
                currentModel={model}
                thinking={thinkingLevel}
                onCycleThinking={cycleThinking}
                isStreaming={streaming}
                onAbort={handleAbort}
                onApprove={handleApprovePlan}
                annotationCount={Object.keys(planAnnotations).length}
                microcopy={data.microcopy}
                onPick={handleCommand}
              />
              <StatusBar
                ctx={liveCtx}
                model={model}
                thinking={thinkingLevel}
                todoDone={todoCounts.done}
                todoTotal={todoCounts.total}
                onTodo={() => setPlanOpen(true)}
                onModel={() => openBridge("models")}
                onTweaks={() => window.postMessage({ type: '__activate_edit_mode' }, '*')}
                autosave={t.autosave ?? true}
                onAutosave={v => setTweak("autosave", v)}
              />
            </main>

            {showSplit && (
              <SplitPeer peer={safePeer} onFocus={handleFocusPeer} onClear={handleClearPeer} />
            )}

            {showRail && (
              <AmbientRail
                ctx={liveCtx}
                activity={activity}
                peer={safePeer}
                peerSessionId={peerSessionId}
                sessions={sessions}
                activeSessionId={activeSessionId}
                onSetPeer={handleSetPeer}
                onClearPeer={handleClearPeer}
                onFocusPeer={handleFocusPeer}
                messages={messages}
                microcopy={data.microcopy}
                sparklineValues={sparkline}
                onClose={() => setTweak("layout", "focus")}
                hoveredMsgIdx={hoveredMsgIdx}
                onMinimapHover={setHoveredMsgIdx}
                onMinimapClick={handleMinimapClick}
                isStreaming={streaming}
                turnStartMs={turnStartMs}
                runningTools={runningTools}
                recentTools={recentTools}
              />
            )}
          </div>
        </div>
      </div>

      <CommandBridge
        open={bridgeOpen}
        initialView={bridgeView}
        onClose={() => setBridgeOpen(false)}
        onPick={handleCommand}
        onPickModel={handlePickModel}
        onPickLogin={handlePickLogin}
        loginProviders={loginProviders}
        currentModelId={model.id}
        models={models}
        onManageModels={() => setModelManagerOpen(true)}
      />

      {planOpen && (
        <PlanKanban
          kanban={kanban}
          planMeta={planMeta}
          onClose={() => setPlanOpen(false)}
          onAbort={handleAbort}
        />
      )}

      {historyOpen && (
        <HistoryModal
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          onResume={handleResumeSession}
          activeCwd={activeProject?.path}
        />
      )}

      {modelManagerOpen && (
        <ModelManagerModal
          open={modelManagerOpen}
          onClose={() => setModelManagerOpen(false)}
          onModelUpdated={() => bridge?.refreshModels()}
        />
      )}

      <TweaksPanel title={window.t("tweaks.title", null, "Tweaks")} noDeckControls>
        <TweakSection label={window.t("tweaks.section.general", null, "General")}>
          <TweakRadio label={window.t("tweaks.language", null, "Language")} value={t.locale || "zh-CN"}
            options={[
              { label: "English", value: "en" },
              { label: "简体中文", value: "zh-CN" },
            ]}
            onChange={v => setTweak("locale", v)}
          />
        </TweakSection>
        <TweakSection label={window.t("tweaks.section.look", null, "Look")}>
          <TweakRadio label={window.t("tweaks.theme", null, "theme")} value={t.theme}
            options={[
              { label: window.t("tweaks.theme.aurora", null, "aurora"),   value: "aurora"   },
              { label: window.t("tweaks.theme.phosphor", null, "phosphor"), value: "phosphor" },
              { label: window.t("tweaks.theme.daylight", null, "daylight"), value: "daylight" },
            ]}
            onChange={v => setTweak({ theme: v, accent:
              v === "aurora"   ? "#78E8BE" :
              v === "phosphor" ? "#39E557" : "#1F8A5B"
            })}
          />
          <TweakRadio label={window.t("tweaks.density", null, "density")} value={t.density}
            options={[
              { label: window.t("tweaks.density.cozy", null, "cozy"),    value: "cozy"    },
              { label: window.t("tweaks.density.compact", null, "compact"), value: "compact" },
              { label: window.t("tweaks.density.dense", null, "dense"),   value: "dense"   },
            ]}
            onChange={v => setTweak("density", v)}
          />
          <TweakColor label={window.t("tweaks.accent", null, "accent")} value={t.accent}
            options={["#78E8BE", "#39E557", "#1F8A5B", "#6EE7FF", "#FF7AC6", "#FFC56E", "#B59BFF"]}
            onChange={v => setTweak("accent", v)}
          />
          <TweakToggle label={window.t("tweaks.monoChat", null, "mono chat font")} value={t.monoChat}
            onChange={v => setTweak("monoChat", v)} />
          <TweakSlider label={window.t("tweaks.fontSize", null, "font size")} value={t.fontSize ?? 100}
            min={75} max={150} step={5} unit="%"
            onChange={v => setTweak("fontSize", v)} />
        </TweakSection>
        <TweakSection label={window.t("tweaks.section.layout", null, "Layout")}>
          <TweakRadio label={window.t("tweaks.layout", null, "layout")} value={t.layout}
            options={[
              { label: window.t("tweaks.layout.rail", null, "rail"),  value: "rail"  },
              { label: window.t("tweaks.layout.split", null, "split"), value: "split" },
              { label: window.t("tweaks.layout.focus", null, "focus"), value: "focus" },
            ]}
            onChange={v => setTweak("layout", v)}
          />
        </TweakSection>
      </TweaksPanel>
    </>
  );
}


ReactDOM.createRoot(document.getElementById("root")).render(<App />);
