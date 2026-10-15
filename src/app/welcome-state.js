/* app/welcome-state.js — pure logic behind the empty-tab welcome card:
   when it is shown and which usage tips it lists. No DOM, no React. */
(function () {
  /** Tips shown on the welcome card. `fallback` mirrors the English i18n text
   *  so the card never renders a raw key if the dictionary lacks an entry. */
  const TIPS = Object.freeze([
    { key: "welcome.tip.ask",     fallback: "Type a request in the box below and press Enter — the agent reads, edits and runs things in your project." },
    { key: "welcome.tip.slashAt", fallback: "Type / for commands, @ to reference project files; paste or drop images to attach them." },
    { key: "welcome.tip.project", fallback: "Open a project folder to give the agent a working directory; without one the tab runs project-less." },
    { key: "welcome.tip.plan",    fallback: "Turn on Plan mode to review and annotate a plan before the agent starts executing." },
  ]);

  /** The welcome card replaces nothing: it shows only while a tab has no messages. */
  function shouldShowWelcome(messages) {
    return !Array.isArray(messages) || messages.length === 0;
  }

  window.WelcomeState = { TIPS, shouldShowWelcome };
})();
