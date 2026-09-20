/* hub/agent-hub.jsx — Agent Hub main component.
   Adaptive card for the ambient rail that switches between three modes:
   - Compact: enhanced tool timeline (default, no subagents)
   - Tree: live subagent tree (auto-activated when `task` tool starts)
   - Summary: task results (auto-activated when `task` finishes, 5s auto-collapse)

   Depends on: HubCompact, HubTree, HubSummary, Icon (loaded before this file). */

const { Icon, HubCompact, HubTree, HubSummary } = window;

function AgentHub({ hubMode, hubAgents, hubHistory, runningTools, recentTools,
                    isStreaming, turnStartMs, activity }) {
  const [mode, setMode] = React.useState(hubMode);

  // Sync with external mode changes (driven by live.js hub state)
  React.useEffect(() => setMode(hubMode), [hubMode]);

  const handleAutoCollapse = React.useCallback(() => setMode("compact"), []);

  return (
    <div className="agent-hub">
      {mode === "tree" && (
        <HubTree agents={hubAgents} isStreaming={isStreaming} />
      )}
      {mode === "summary" && (
        <HubSummary agents={hubAgents} history={hubHistory}
          onAutoCollapse={handleAutoCollapse} />
      )}
      {mode === "compact" && (
        <HubCompact runningTools={runningTools} recentTools={recentTools}
          isStreaming={isStreaming} turnStartMs={turnStartMs} activity={activity} />
      )}
    </div>
  );
}

Object.assign(window, { AgentHub });
