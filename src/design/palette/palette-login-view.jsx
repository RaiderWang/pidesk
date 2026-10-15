/* palette/palette-login-view.jsx — "login" drill-in view of the command
   palette (OAuth provider picker). Rendered inside the palette's Modal. */

const { Icon: _PL_Icon, usePaletteCursor: _PL_useCursor } = window;

function PaletteLoginView({ loginProviders, onPickLogin, onClose, onBack }) {
  const t = window.t;
  const providers = loginProviders ?? [];
  const nav = _PL_useCursor(providers.length, loginProviders === null ? "loading" : "ready");

  const pick = (p) => {
    if (!p.available) return;
    onPickLogin(p);
    onClose();
  };

  return (
    <>
      <div className="bridge-input-row">
        <button className="btn icon ghost" title={t ? t("palette.foot.back", null, "back") : "back"}
          onClick={onBack} style={{ marginRight: 4 }}>
          <_PL_Icon name="chevR" size={12} color="var(--fg-3)" style={{ transform: "rotate(180deg)", display: "block" }} />
        </button>
        {/* Focusable so ArrowUp/Down/Enter work without a search field. */}
        <input autoFocus readOnly className="bridge-input mono" style={{ cursor: "default" }}
          value={t ? t("palette.login.title", null, "login") : "login"}
          onChange={() => {}}
          onKeyDown={(e) => nav.onKeyDown(e, (i) => pick(providers[i]))} />
        <span className="kbd">esc</span>
      </div>
      <div className="bridge-body" ref={nav.bodyRef}>
        <div className="bridge-group">
          <div className="bridge-group-head mono">
            {t ? t("palette.login.select", null, "select provider") : "select provider"}
          </div>
          {loginProviders === null && (
            <div className="bridge-empty" style={{ padding: "16px 32px" }}>
              {t ? t("palette.login.loading", null, "loading providers…") : "loading providers…"}
            </div>
          )}
          {loginProviders !== null && providers.length === 0 && (
            <div className="bridge-empty">{t ? t("palette.login.none", null, "no providers available") : "no providers available"}</div>
          )}
          {providers.map((p, i) => (
            <button key={p.id}
              className={`bridge-row ${p.authenticated ? "active" : ""}${i === nav.cursor ? " is-cursor" : ""}`}
              data-cursor={i === nav.cursor ? "true" : undefined}
              onMouseMove={() => nav.setCursor(i)}
              onClick={() => pick(p)}>
              <span className="bridge-glyph">
                {p.authenticated
                  ? <_PL_Icon name="check" size={10} color="var(--accent)" />
                  : <_PL_Icon name="bolt" size={10} color={p.available ? "var(--cyan)" : "var(--fg-5)"} />}
              </span>
              <span style={{ color: p.authenticated ? "var(--accent)" : p.available ? "var(--fg)" : "var(--fg-4)" }}>{p.name}</span>
              <span className="mono" style={{ color: "var(--fg-4)" }}>{p.id}</span>
              <span className="chip muted" style={{ marginLeft: "auto" }}>
                {p.authenticated
                  ? (t ? t("palette.login.loggedIn", null, "logged in") : "logged in")
                  : p.available
                    ? (t ? t("palette.login.available", null, "available") : "available")
                    : (t ? t("palette.login.unavailable", null, "unavailable") : "unavailable")}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="bridge-foot mono">
        <span className="kbd">↵</span> {t ? t("palette.foot.authenticate", null, "authenticate") : "authenticate"}
        <span className="kbd">esc</span> {t ? t("palette.foot.back", null, "back") : "back"}
      </div>
    </>
  );
}

Object.assign(window, { PaletteLoginView });
