/* chat/welcome-card.jsx — empty-session welcome: short usage tips plus the
   full shortcut list. Shown by ChatView while a tab has no messages.
   ShortcutsList loads after this file, so it is looked up at render time. */

const { Icon: _WC_Icon } = window;

function WelcomeCard({ system }) {
  const t = window.t;
  const S = window.AppShortcuts;
  const List = window.ShortcutsList;
  const tr = (key, params, fallback) => (t ? t(key, params, fallback) : fallback);
  return (
    <div className="welcome-card fade-up">
      <div className="welcome-head">
        <div className="welcome-glyph">
          <_WC_Icon name="sparkle" size={18} color="var(--accent)" />
        </div>
        <div>
          <div className="welcome-title">{tr("welcome.title", null, "Welcome to PiDesk")}</div>
          <div className="welcome-sub">{tr("welcome.subtitle", null, "A desktop workspace for the omp coding agent")}</div>
        </div>
      </div>

      <ul className="welcome-tips">
        {window.WelcomeState.TIPS.map(({ key, fallback }) => (
          <li key={key}>{tr(key, null, fallback)}</li>
        ))}
      </ul>

      <div className="bridge-group-head mono welcome-section">
        {tr("welcome.shortcuts", null, "Keyboard shortcuts")}
      </div>
      <div className="welcome-shortcuts">
        {List && <List system={system} />}
      </div>

      {S && (
        <div className="welcome-foot">
          {tr("welcome.footer", { help: S.displayFor("help"), palette: S.displayFor("palette") },
            `${S.displayFor("help")} shortcuts · ${S.displayFor("palette")} command palette`)}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { WelcomeCard });
