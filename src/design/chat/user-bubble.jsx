/* chat/user-bubble.jsx — user-side bubble, right-aligned. */

function UserBubble({ msg, idx, highlighted }) {
  const [lightboxImg, setLightboxImg] = React.useState(null);
  const [copied, setCopied] = React.useState(false);
  const images = msg.images || [];

  function handleCopy() {
    const text = msg.text || "";
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }

  return (
    <div className={`row user fade-up${highlighted ? " mm-hot" : ""}`} data-msg-idx={idx}>
      <div className="user-bubble selectable">
        <div className="user-meta">
          <span className="mono" style={{ color: "var(--fg-4)" }}>{msg.time}</span>
          <span className="chip muted">you</span>
        </div>

        {images.length > 0 && (
          <div className="user-bubble-images">
            {images.map((img, i) => {
              const src = img.dataUrl || (img.data ? `data:${img.mimeType || "image/png"};base64,${img.data}` : null);
              if (!src) return null;
              return (
                <div key={i} className="user-bubble-img-wrap" onClick={() => setLightboxImg(src)} title="click to enlarge">
                  <img src={src} alt="attachment" className="user-bubble-img" />
                </div>
              );
            })}
          </div>
        )}

        {msg.text && <div className="user-text">{msg.text}</div>}

        <div className="msg-actions">
          <button
            className="msg-act-btn"
            title={copied ? "copied!" : (window.t ? window.t("action.copy", null, "copy as markdown") : "copy as markdown")}
            onClick={handleCopy}
          >
            <window.Icon name={copied ? "check" : "copy"} size={12} />
          </button>
        </div>

        {lightboxImg && (
          <div className="lightbox-scrim" onClick={() => setLightboxImg(null)}>
            <div className="lightbox-content" onClick={e => e.stopPropagation()}>
              <img src={lightboxImg} alt="full preview" className="lightbox-img" />
              <button className="btn icon ghost lightbox-close" onClick={() => setLightboxImg(null)} title="close">
                <window.Icon name="close" size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { UserBubble });
