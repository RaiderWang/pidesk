/* chat/message-copy-actions.jsx — "copy as markdown" / "copy as plain text"
   buttons for an assistant bubble's action row. Renders nothing when there
   is no text. One shared `copiedMode` + timer so only one check mark shows. */

const { Icon: _CopyIcon } = window;

function MessageCopyActions({ text }) {
  const [copiedMode, setCopiedMode] = React.useState(null); // null | "md" | "plain"
  const timerRef = React.useRef(null);

  React.useEffect(() => () => clearTimeout(timerRef.current), []);

  if (!text) return null;

  function copy(mode) {
    const out = mode === "plain" ? (window.MarkdownPlain?.toPlainText(text) ?? text) : text;
    navigator.clipboard?.writeText(out).then(() => {
      clearTimeout(timerRef.current);
      setCopiedMode(mode);
      timerRef.current = setTimeout(() => setCopiedMode(null), 1500);
    }).catch(() => {});
  }

  const tr = (key, fallback) => (window.t ? window.t(key, null, fallback) : fallback);
  const copied = tr("action.copied", "copied!");

  return (
    <>
      <button
        className="msg-act-btn"
        title={copiedMode === "md" ? copied : tr("action.copyMarkdown", "copy as markdown")}
        onClick={() => copy("md")}
      >
        <_CopyIcon name={copiedMode === "md" ? "check" : "copy"} size={12} />
      </button>
      <button
        className="msg-act-btn"
        title={copiedMode === "plain" ? copied : tr("action.copyPlain", "copy as plain text")}
        onClick={() => copy("plain")}
      >
        <_CopyIcon name={copiedMode === "plain" ? "check" : "text"} size={12} />
      </button>
    </>
  );
}

// Text blocks only (thoughts / plan blocks are not copied); empty and
// whitespace-only blocks skipped, so "" means there is nothing worth copying.
function getMessageText(msg) {
  return (msg.blocks || [])
    .filter((b) => b.type === "text" && b.text && b.text.trim())
    .map((b) => b.text)
    .join("\n\n");
}

Object.assign(window, { MessageCopyActions, getMessageText });
