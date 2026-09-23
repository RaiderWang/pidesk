/* app/use-bridge-snapshot.jsx — custom hooks that decouple the App
   component from the cross-cutting effects:
   - useBridgeSnapshot:  subscribes to OMP_BRIDGE.onUpdate and routes the
                         snapshot fields into a setter map.
   - useThemeEffect:     reflects tweaks state onto <html> classes /
                         CSS custom properties.
   - useCommandShortcut: ⌘K / ⌃K toggles the command bridge; Escape closes
                         it. Centralised here so app-live.jsx only owns
                         render + handlers. */

const { NULL_MODEL: _UB_NULL_MODEL } = window;

function useBridgeSnapshot(bridge, setters) {
  React.useEffect(() => {
    if (!bridge) return undefined;
    const unsub = bridge.onUpdate((snap) => {
      setters.setMessages(snap.messages);
      setters.setStreaming(snap.isStreaming);
      setters.setCtx(snap.ctx);
      setters.setKanban(snap.kanban);
      setters.setPlanMeta(snap.planMeta);
      setters.setModels(snap.models);
      setters.setActivity(snap.activity);
      setters.setSparkline(snap.sparkline);
      setters.setModelState(snap.model || _UB_NULL_MODEL);
      if (snap.thinkingLevel) setters.setThinkingLevel(snap.thinkingLevel);
      setters.setSessions(snap.sessions ?? []);
      if (snap.activeSessionId) setters.setActiveSessionId(snap.activeSessionId);
      // Peer session — optional setters (safe for callers that don't use peer)
      if (snap.peer !== undefined)          setters.setPeer?.(snap.peer);
      if (snap.peerSessionId !== undefined) setters.setPeerSessionId?.(snap.peerSessionId);
      // Agent activity — running tools + turn clock
      setters.setRunningTools?.(snap.runningTools ?? []);
      setters.setRecentTools?.(snap.recentTools ?? []);
      setters.setTurnStartMs?.(snap.turnStartMs ?? null);
      // Agent Hub — subagent tree / task tracking
      setters.setHubMode?.(snap.hubMode ?? "compact");
      setters.setHubAgents?.(snap.hubAgents ?? []);
      setters.setHubHistory?.(snap.hubHistory ?? []);
    });
    return unsub;
  }, [bridge]);
}

function useThemeEffect(t) {
  React.useEffect(() => {
    window.applyAppearance(t);
  }, [t.theme, t.density, t.accent, t.monoChat, t.fontSize]);
}

function useCommandShortcut(setBridgeOpen, setBridgeView) {
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setBridgeOpen((v) => {
          if (!v) setBridgeView("commands");
          return !v;
        });
      }
      if (e.key === "Escape") setBridgeOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setBridgeOpen, setBridgeView]);
}

Object.assign(window, { useBridgeSnapshot, useThemeEffect, useCommandShortcut });
