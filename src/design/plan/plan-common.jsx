/* plan/plan-common.jsx — small Plan primitives shared by the kanban modal and the dock view. */

const { Icon } = window;

// ── Phase pill ────────────────────────────────────────────────────────
function PhasePill({ phase }) {
  const map = {
    running: { color: "var(--cyan)",   icon: "live",   label: window.t ? window.t("plan.phase.running", null, "running") : "running" },
    done:    { color: "var(--accent)", icon: "check",  label: window.t ? window.t("plan.phase.done", null, "done") : "done"    },
    queued:  { color: "var(--amber)",  icon: "clock",  label: window.t ? window.t("plan.phase.queued", null, "queued") : "queued"  },
    idle:    { color: "var(--fg-4)",   icon: "circle", label: window.t ? window.t("plan.phase.idle", null, "idle") : "idle"      },
  };
  const m = map[phase] ?? map.idle;
  return (
    <span className="chip" style={{
      color: m.color,
      borderColor: `color-mix(in oklab, ${m.color} 35%, var(--line))`,
      background:  `color-mix(in oklab, ${m.color} 12%, transparent)`,
      boxShadow: phase === "running" ? `0 0 10px color-mix(in oklab, ${m.color} 25%, transparent)` : "none",
    }}>
      <Icon name={m.icon} size={10} color={m.color} /> {m.label}
    </span>
  );
}


// ── Touched File Chip with Copy Feedback ──────────────────────────────
function TouchChip({ file }) {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = (e) => {
    e.stopPropagation();
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(file);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };

  return (
    <span
      className="kanban-touch-chip"
      onClick={handleCopy}
      title={copied
        ? (window.t ? window.t("plan.copied", null, "Copied!") : "Copied!")
        : (window.t ? window.t("plan.copyPath", null, "Copy file path") : "Copy file path")}
    >
      <Icon name={copied ? "check" : "file"} size={9} color={copied ? "var(--accent)" : "var(--fg-4)"} />
      <span>{file}</span>
      {copied && <span style={{ color: "var(--accent)", fontSize: 10 }}>✓</span>}
    </span>
  );
}

Object.assign(window, { PhasePill, TouchChip });
