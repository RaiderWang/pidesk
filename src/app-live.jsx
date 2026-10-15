/* ═════════════════════════════════════════════════════════════════════
   app-live.jsx — live-wired root. Replaces design/app.jsx.

   Session model: each tab owns one omp process. OMP_BRIDGE manages
   session lifecycle; the tab list and active session come from the
   bridge (snap.sessions / snap.activeSessionId). Switching tabs calls
   bridge.activateSession() which resets ALL per-session state and
   re-fetches from omp — so the right panel (sparkline, agent hub,
   minimap, kanban, context gauge) always reflects the active session.

   Constants and the cross-cutting effects (bridge subscription, theme,
   ⌘K shortcut) live in app/constants.js and app/use-bridge-snapshot.jsx
   respectively. This file owns only the App component itself: state
   declarations, handlers, and the render tree.
   ═════════════════════════════════════════════════════════════════════ */

const {
  Icon, ChatView, Composer, CommandPalette, ShortcutsHelp, WindowChrome, TabBar,
  StatusBar, AmbientRail, SplitPeer, PlanKanban, PlanDockView, HistoryModal, ModelManagerModal, ToolLogModal, AgentErrorBanner, useTweaks,
  FileTreePanel, ActivityBar, DockPanel, useDockState, useViewportWidth,
  TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakColor, TweakSlider, TweakShortcut,
  TWEAK_DEFAULTS, NULL_MODEL, EMPTY_PROJECT, NULL_PEER,
  INTENT_FRAMING, APPROVAL_PROMPT,
  useBridgeSnapshot, useThemeEffect, useGlobalShortcuts, timeNow,
  UndoConfirmModal, useUndoMessage,
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
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [modelManagerOpen, setModelManagerOpen] = React.useState(false);
  const [reviewOpen,  setReviewOpen]  = React.useState(false);
  const [reviewFocus, setReviewFocus] = React.useState("");
  const [activeLogTool, setActiveLogTool] = React.useState(null);

  React.useEffect(() => {
    const onOpenReview = (e) => {
      setReviewFocus(e?.detail?.focus || "");
      setReviewOpen(true);
    };
    window.addEventListener("open-review-drawer", onOpenReview);
    return () => window.removeEventListener("open-review-drawer", onOpenReview);
  }, []);
  const [toolLogs, setToolLogs] = React.useState({});
  const [planOpen,    setPlanOpen]    = React.useState(false);
  const [planMode,    setPlanMode]    = React.useState(false);
  // Dock / file-tree state is persisted by app/dock-state.js; the stage grid
  // is derived from it in the render section below.
  const dock = useDockState();
  const viewportW = useViewportWidth();
  const handleToggleFiles = dock.toggleFiles;
  // "focus" layout hides the dock; any entry that opens it leaves focus mode.
  const dockWanted = dock.state.dockOpen && t.layout !== "focus";
  const openDockTab = (tab) => {
    dock.openDock(tab);
    if (t.layout === "focus") setTweak("layout", "rail");
  };
  const toggleDockTab = (tab) => {
    if (dockWanted && dock.state.dockTab === tab) dock.setDockOpen(false);
    else openDockTab(tab);
  };
  const planStartedRef = React.useRef(false); // true after first send in plan mode
  const [planActive, setPlanActive] = React.useState(false);
  const [planAnnotations, setPlanAnnotations] = React.useState({});
  const handleAnnotate = React.useCallback((idx, value) => setPlanAnnotations(prev => {
    const next = { ...prev };
    if (value === null) delete next[idx]; else next[idx] = value;
    return next;
  }), []);

  // Cross-component highlight: hovering a minimap cell lights up the
  // matching chat bubble; clicking scrolls to it.
  const [hoveredMsgIdx, setHoveredMsgIdx] = React.useState(null);
  // ChatView listens for this so a message folded into a collapsed tool
  // group is revealed before scrolling.
  const handleMinimapClick = (idx) => {
    window.dispatchEvent(new CustomEvent("chat-scroll-to-msg", { detail: { idx } }));
  };

  // ── Live data (all per-session — driven by OMP_BRIDGE.onUpdate) ───────────
  const [messages,      setMessages]      = React.useState([]);
  const [streaming,     setStreaming]     = React.useState(false);
  const [model,         setModelState]    = React.useState(NULL_MODEL);
  const [thinkingLevel, setThinkingLevel] = React.useState(null);
  const [availableThinkingLevels, setAvailableThinkingLevels] = React.useState(null);
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

  // ── Agent Hub — subagent tree / task tracking ────────────────────────────
  const [hubMode,    setHubMode]    = React.useState("compact");
  const [hubAgents,  setHubAgents]  = React.useState([]);
  const [hubHistory, setHubHistory] = React.useState([]);
  const [agentError, setAgentError] = React.useState(null);
  const [hasPendingAsyncWork, setHasPendingAsyncWork] = React.useState(false);
  const [isSettled,           setIsSettled]           = React.useState(true);

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

  React.useEffect(() => {
    if (!window.__TAURI__) return;
    window.__TAURI__.core.invoke("get_shortcuts").then((sc) => {
      if (sc) {
        setTweak({
          quickBarShortcut: sc.quick_bar || "CmdOrCtrl+Shift+Space",
          screenshotShortcut: sc.screenshot || "Alt+S",
        });
      }
    }).catch(() => {});
    bridge?.getDefaultCwd?.();

    let unlisten;
    window.__TAURI__.event.listen("shortcuts://updated", (ev) => {
      const sc = ev.payload;
      if (sc) {
        setTweak({
          quickBarShortcut: sc.quick_bar || "CmdOrCtrl+Shift+Space",
          screenshotShortcut: sc.screenshot || "Alt+S",
        });
      }
    }).then(u => { unlisten = u; });

    return () => { unlisten?.(); };
  }, [setTweak]);

  // ── Cross-cutting effects (bridge subscription, theme, ⌘K) ────────────────
  useBridgeSnapshot(bridge, {
    setMessages, setStreaming, setCtx, setKanban, setPlanMeta,
    setModels, setActivity, setSparkline,
    setModelState, setThinkingLevel, setAvailableThinkingLevels,
    setSessions, setActiveSessionId,
    setPeer, setPeerSessionId,
    setRunningTools, setRecentTools, setTurnStartMs,
    setHubMode, setHubAgents, setHubHistory,
    setAgentError, setToolLogs,
    setHasPendingAsyncWork, setIsSettled,
  });
  useThemeEffect(t);
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
  const hasProject    = Boolean(activeProject?.path && activeProject.path.trim());
  const todoCounts    = kanban.reduce(
    (acc, col) => {
      acc.total += col.tasks.length;
      acc.done  += col.tasks.filter(tk => tk.status === "done").length;
      return acc;
    },
    { total: 0, done: 0 }
  );

  const hasPlanTasks   = todoCounts.total > 0;
  const isPlanDone     = hasPlanTasks && todoCounts.done >= todoCounts.total;
  const kanbanFlashing = planActive && hasPlanTasks && !isPlanDone;

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
      if (agentError) {
        bridge?.retrySession?.(activeSessionId);
      }
      setMessages(prev => [...prev, { kind: "user", time: timeNow(), text: msg, images: images ?? [] }]);
    }
  };

  const handleAbort      = () => { bridge?.abort(); setStreaming(false); setPlanActive(false); };
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
    if      (c.name === "plan")     { setPlanMode(true); setPlanActive(true); planStartedRef.current = false; }
    else if (c.name === "todo" || c.name === "kanban") { openDockTab("plan"); }
    else if (c.name === "compact")  { bridge?.compact(); }
    else if (c.name === "export")   { bridge?.exportHtml(); }
    else if (c.name === "thinking") { cycleThinking(); }
    else if (c.name === "model")    { openBridge("models"); }
    else if (c.name === "login")    { openBridge("login"); }
    else if (c.name === "new")      { bridge?.newSession(); }
    else if (c.name === "history")  { setHistoryOpen(true); }
    else if (c.name === "models")   { setModelManagerOpen(true); }
    else if (c.name === "review")   { setReviewOpen(true); }
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

  // Undo a sent user message: confirm → omp rolls back → text/images return to the composer.
  const { canUndo, blockReason: undoBlockReason, requestUndo, undoDialog } = useUndoMessage({
    bridge, messages, streaming, hasPendingAsyncWork,
    onUndone: (r) => {
      setPlanAnnotations({}); // annotations were bound to messages that may be gone
      if (r.planFramingStripped) planStartedRef.current = false; // next plan send re-wraps the intent
    },
  });

  const handleApprovePlan = () => {
    setPlanAnnotations({});
    bridge?.followUp(APPROVAL_PROMPT());
    setPlanMode(false);
    planStartedRef.current = false;
    setPlanActive(true);
  };

  // Tab select — switches the active session; bridge resets all per-session state
  // and re-fetches from the new session's omp → notify() pushes fresh data.
  const handleSelectTab = id => {
    if (id === activeSessionId) return;
    setPlanActive(false);
    bridge?.activateSession(id);
    // setActiveSessionId is driven by snap.activeSessionId from onUpdate
  };

  // Open project → new session → new tab with its own omp process
  const handleNewProject = async () => {
    if (!bridge) return;
    const path = await bridge.pickFolder();
    if (!path) return;
    window.RecentProjects?.addRecentProject(path);
    setPlanActive(false);
    await bridge.openSession(path);
    // Tab list and activeSessionId are updated via onUpdate from the bridge
  };

  // Open recent project (switches to tab if already open, else opens new session)
  const handleOpenRecentProject = async (path) => {
    if (!bridge || !path) return;
    window.RecentProjects?.addRecentProject(path);
    const norm = p => (p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    const targetNorm = norm(path);
    const existing = sessions.find(s => s.path && norm(s.path) === targetNorm);
    if (existing) {
      handleSelectTab(existing.id);
    } else {
      setPlanActive(false);
      await bridge.openSession(path);
    }
  };

  // Open standalone session (no project folder)
  const handleNewStandalone = async () => {
    if (!bridge) return;
    setPlanActive(false);
    await bridge.openSession(null);
  };

  // Close tab → kills that session's omp process; bridge updates tab list
  const handleCloseTab = id => {
    setPlanActive(false);
    bridge?.closeSession(id);
  };

  // ── Peer session handlers ───────────────────────────────────────────────
  const handleSetPeer   = id  => bridge?.setPeer(id);
  const handleClearPeer = ()  => bridge?.clearPeer();
  const handleFocusPeer = ()  => { if (peerSessionId) bridge?.activateSession(peerSessionId); };

  // ── Global shortcuts + palette actions (shared handlers) ────────────────
  // Palette / help are the only shortcuts live over a dialog; never stack them
  // on top of another dialog (its keys would leak through to the one below).
  const otherModalOpen = historyOpen || modelManagerOpen || planOpen || activeLogTool != null;
  const togglePalette = () => {
    if (bridgeOpen) { setBridgeOpen(false); setBridgeView("commands"); }
    else if (!otherModalOpen && !shortcutsOpen) openBridge("commands");
  };
  const openShortcutsHelp = () => {
    if (shortcutsOpen) { setShortcutsOpen(false); return; }
    if (otherModalOpen) return;
    setBridgeOpen(false);
    setShortcutsOpen(true);
  };
  const openTweaks = () => window.postMessage({ type: "__activate_edit_mode" }, "*");
  useGlobalShortcuts({
    palette:     togglePalette,
    help:        openShortcutsHelp,
    openProject: handleNewProject,
    newSession:  handleNewStandalone,
    history:     () => setHistoryOpen(prev => !prev),
    models:      () => setModelManagerOpen(prev => !prev),
    toggleFiles: handleToggleFiles,
    togglePlan:  () => toggleDockTab("plan"),
  });
  const paletteActions = [
    { id: "openProject", icon: "folder",   shortcutId: "openProject", run: handleNewProject,
      label: window.t("palette.action.openProject", null, "Open project…") },
    { id: "newSession",  icon: "plus",     shortcutId: "newSession",  run: handleNewStandalone,
      label: window.t("palette.action.newSession", null, "New standalone session") },
    { id: "history",     icon: "clock",    shortcutId: "history",     run: () => setHistoryOpen(true),
      label: window.t("palette.action.history", null, "Session history") },
    { id: "models",      icon: "cpu",      shortcutId: "models",      run: () => setModelManagerOpen(true),
      label: window.t("palette.action.models", null, "Manage models") },
    { id: "togglePlan",  icon: "plan",     shortcutId: "togglePlan",  run: () => toggleDockTab("plan"),
      label: window.t("palette.action.plan", null, "Toggle plan panel") },
    { id: "planBoard",   icon: "plan",     run: () => setPlanOpen(true),
      label: window.t("palette.action.planBoard", null, "Open plan board") },
    { id: "overview",    icon: "radar",    run: () => toggleDockTab("overview"),
      label: window.t("palette.action.overview", null, "Toggle overview panel") },
    { id: "toggleFiles", icon: "sidebar",  shortcutId: "toggleFiles", run: handleToggleFiles,
      label: window.t("palette.action.files", null, "Toggle file tree") },
    { id: "tweaks",      icon: "cog",      run: openTweaks,
      label: window.t("palette.action.tweaks", null, "Open tweaks") },
    { id: "help",        icon: "info",     shortcutId: "help",        run: () => setShortcutsOpen(true),
      label: window.t("palette.action.shortcuts", null, "Keyboard shortcuts") },
  ];

  const showSplit = t.layout === "split" && peer !== null;
  const safePeer  = peer ?? NULL_PEER;
  const liveCtx   = ctx ?? data.ctx;
  const stage = window.DockLayout.resolveStageLayout({
    activity: true,
    files: hasProject && dock.state.filesOpen, filesW: dock.state.filesWidth,
    split: showSplit,
    dock: dockWanted, dockW: dock.state.dockWidth,
    width: viewportW,
  });
  const dockTabs = [
    { id: "overview", icon: "radar", label: window.t("activity.overview", null, "Overview") },
    { id: "plan", icon: "plan", label: window.t("activity.plan", null, "Plan"), badge: todoCounts.total },
  ];

  return (
    <>
      <div className="app-backdrop" />
      <div className="app">
        <div className={`window scanlines ${showSplit ? "is-split" : ""}`}>
          <WindowChrome
            project={activeProject}
            peer={safePeer}
            onCmd={() => openBridge("commands")}
          />
          <TabBar
            projects={sessions}
            activeId={activeSessionId}
            onSelect={handleSelectTab}
            peer={safePeer}
            onNew={handleNewProject}
            onNewProject={handleNewProject}
            onNewStandalone={handleNewStandalone}
            onOpenRecentProject={handleOpenRecentProject}
            onClose={handleCloseTab}
            appVersion={appVersion}
            theme={t.theme}
          />

          <div className="stage" style={{ gridTemplateColumns: stage.columns }}>
            <ActivityBar
              hasProject={hasProject}
              filesActive={stage.files}
              dockOpen={dockWanted}
              dockTab={dock.state.dockTab}
              planBadge={todoCounts.total}
              planFlashing={kanbanFlashing}
              onFiles={handleToggleFiles}
              onPlan={() => toggleDockTab("plan")}
              onReview={() => window.dispatchEvent(new CustomEvent("open-review-drawer"))}
              onOverview={() => toggleDockTab("overview")}
              onHistory={() => setHistoryOpen(true)}
              onModels={() => setModelManagerOpen(true)}
              onSettings={openTweaks}
            />
            {stage.files && (
              <FileTreePanel
                rootPath={activeProject.path}
                projectName={activeProject.name}
                onClose={handleToggleFiles}
                bridge={bridge}
                width={stage.filesW}
                onWidthChange={dock.setFilesWidth}
              />
            )}
            <main className="session">
              {agentError && (
                <AgentErrorBanner
                  error={agentError}
                  onRetry={() => bridge?.retrySession?.(activeSessionId)}
                  onConfigureModels={() => setModelManagerOpen(true)}
                />
              )}
              <ChatView messages={messages}
                planMode={planMode}
                annotations={planAnnotations}
                onAnnotate={handleAnnotate}
                onAskAnswer={handleAskAnswer}
                hoveredMsgIdx={hoveredMsgIdx}
                onBranch={handleBranch}
                onUndo={requestUndo}
                canUndo={canUndo}
                undoBlockReason={undoBlockReason}
                onOpenKanban={() => openDockTab("plan")}
                groupTools={t.groupTools !== false}
                locale={t.locale}
                systemShortcuts={{ quickBar: t.quickBarShortcut, screenshot: t.screenshotShortcut }}
              />
              <Composer
                onSend={handleSend}
                planMode={planMode}
                onTogglePlan={() => {
                  const next = !planMode;
                  setPlanMode(next);
                  if (!next) {
                    planStartedRef.current = false;
                    setPlanActive(false);
                  } else {
                    setPlanActive(true);
                  }
                }}
                onOpenCmd={() => openBridge("commands")}
                onOpenModel={() => openBridge("models")}
                currentModel={model}
                thinking={thinkingLevel}
                availableThinkingLevels={availableThinkingLevels}
                onCycleThinking={cycleThinking}
                isStreaming={streaming}
                onAbort={handleAbort}
                onApprove={handleApprovePlan}
                annotationCount={Object.keys(planAnnotations).length}
                microcopy={data.microcopy}
                onPick={handleCommand}
                screenshotShortcut={t.screenshotShortcut}
                agentError={agentError}
              />
              <StatusBar
                ctx={liveCtx}
                model={model}
                todoDone={todoCounts.done}
                todoTotal={todoCounts.total}
                onTodo={() => openDockTab("plan")}
                onModel={() => openBridge("models")}
                autosave={t.autosave ?? true}
                isStreaming={streaming}
                agentError={agentError}
              />
            </main>

            {showSplit && (
              <SplitPeer peer={safePeer} onFocus={handleFocusPeer} onClear={handleClearPeer} />
            )}

            {stage.dock && (
              <DockPanel
                tabs={dockTabs}
                activeTab={dock.state.dockTab}
                onTab={dock.setDockTab}
                onClose={() => dock.setDockOpen(false)}
                width={stage.dockW}
                onWidthChange={dock.setDockWidth}
              >
                {dock.state.dockTab === "plan" ? (
                  <PlanDockView
                    kanban={kanban}
                    planMeta={planMeta}
                    isStreaming={streaming || runningTools.length > 0}
                    onAbort={handleAbort}
                    onExpand={() => setPlanOpen(true)}
                  />
                ) : (
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
                    hoveredMsgIdx={hoveredMsgIdx}
                    onMinimapHover={setHoveredMsgIdx}
                    onMinimapClick={handleMinimapClick}
                    isStreaming={streaming}
                    turnStartMs={turnStartMs}
                    runningTools={runningTools}
                    recentTools={recentTools}
                    hubMode={hubMode}
                    hubAgents={hubAgents}
                    hubHistory={hubHistory}
                    hasPendingAsyncWork={hasPendingAsyncWork}
                    onOpenToolLog={setActiveLogTool}
                  />
                )}
              </DockPanel>
            )}
          </div>
        </div>
      </div>

      <CommandPalette
        open={bridgeOpen}
        initialView={bridgeView}
        onClose={() => {
          setBridgeOpen(false);
          setBridgeView("commands");
        }}
        onPick={handleCommand}
        onPickModel={handlePickModel}
        onPickLogin={handlePickLogin}
        loginProviders={loginProviders}
        currentModelId={model.id}
        models={models}
        onManageModels={() => setModelManagerOpen(true)}
        actions={paletteActions}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectTab={handleSelectTab}
        onResumeSaved={handleResumeSession}
        projectPath={hasProject ? activeProject.path : ""}
        systemShortcuts={{ quickBar: t.quickBarShortcut, screenshot: t.screenshotShortcut }}
      />

      <ShortcutsHelp
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        system={{ quickBar: t.quickBarShortcut, screenshot: t.screenshotShortcut }}
      />

      {planOpen && (
        <PlanKanban
          kanban={kanban}
          planMeta={planMeta}
          isStreaming={streaming || runningTools.length > 0}
          onClose={() => setPlanOpen(false)}
          onAbort={handleAbort}
        />
      )}

      <UndoConfirmModal {...undoDialog} />

      {historyOpen && (
        <HistoryModal
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          onResume={handleResumeSession}
          activeCwd={activeProject?.path}
          openSessions={sessions}
        />
      )}

      {modelManagerOpen && (
        <ModelManagerModal
          open={modelManagerOpen}
          onClose={() => setModelManagerOpen(false)}
          onModelUpdated={() => bridge?.refreshModels()}
        />
      )}

      {activeLogTool && (
        <ToolLogModal
          tool={activeLogTool}
          toolLogs={toolLogs}
          onClose={() => setActiveLogTool(null)}
        />
      )}

      {window.ReviewDrawer && (
        <window.ReviewDrawer
          isOpen={reviewOpen}
          onClose={() => setReviewOpen(false)}
          activeSessionId={activeSessionId}
          initialFocus={reviewFocus}
          onInsertComposer={(text) => window.ComposerInsert?.appendToComposer(text) ?? false}
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
          <TweakToggle label={window.t("tweaks.autosave", null, "autosave")} value={t.autosave ?? true}
            onChange={v => setTweak("autosave", v)} />
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
          <TweakToggle label={window.t("tweaks.groupTools", null, "group tool calls")} value={t.groupTools !== false}
            onChange={v => setTweak("groupTools", v)} />
          <TweakSlider label={window.t("tweaks.fontSize", null, "font size")} value={t.fontSize ?? 100}
            min={75} max={150} step={5} unit="%"
            onChange={v => setTweak("fontSize", v)} />
        </TweakSection>
        <TweakSection label={window.t("tweaks.section.layout", null, "Layout")}>
          <TweakRadio label={window.t("tweaks.layout", null, "layout")}
            value={window.DockState.layoutForDisplay(t.layout, dock.state.dockOpen)}
            options={[
              { label: window.t("tweaks.layout.rail", null, "rail"),  value: "rail"  },
              { label: window.t("tweaks.layout.split", null, "split"), value: "split" },
              { label: window.t("tweaks.layout.focus", null, "focus"), value: "focus" },
            ]}
            onChange={v => { setTweak("layout", v); if (v !== "focus") dock.setDockOpen(true); }}
          />
        </TweakSection>
        <TweakSection label={window.t("tweaks.section.shortcuts", null, "Shortcuts")}>
          <TweakShortcut
            label={window.t("tweaks.shortcut.quickBar", null, "Toggle Quick Bar")}
            value={t.quickBarShortcut || "CmdOrCtrl+Shift+Space"}
            defaultValue="CmdOrCtrl+Shift+Space"
            onChange={async (newVal) => {
              if (window.__TAURI__) {
                await window.__TAURI__.core.invoke("set_shortcut", { kind: "quick_bar", shortcut: newVal });
              }
              setTweak("quickBarShortcut", newVal);
            }}
          />
          <TweakShortcut
            label={window.t("tweaks.shortcut.screenshot", null, "Region screenshot")}
            value={t.screenshotShortcut || "Alt+S"}
            defaultValue="Alt+S"
            onChange={async (newVal) => {
              if (window.__TAURI__) {
                await window.__TAURI__.core.invoke("set_shortcut", { kind: "screenshot", shortcut: newVal });
              }
              setTweak("screenshotShortcut", newVal);
            }}
          />
        </TweakSection>
      </TweaksPanel>
    </>
  );
}


ReactDOM.createRoot(document.getElementById("root")).render(<App />);
