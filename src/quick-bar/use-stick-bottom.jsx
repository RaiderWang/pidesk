/* use-stick-bottom.jsx — keeps a scrollable element pinned to its bottom
   while new content streams in, so the latest text stays visible.

   Pinning pauses if the user scrolls up to read earlier text, and resumes
   once they scroll back near the bottom (or when `resetKey` becomes falsy,
   i.e. a fresh reply starts).

   Intentionally no top-level `const` destructures: Babel scripts share the
   document top-level scope with quick-bar.jsx. */

/** Distance (px) from the bottom that still counts as "at the bottom". */
const QB_STICK_THRESHOLD = 24;

/**
 * @param {React.RefObject<HTMLElement>} ref  scroll container
 * @param {Array} deps  content dependencies; scroll re-pins when they change
 * @param {*} resetKey  falsy => a new reply is starting, force re-pin
 * @returns {() => void} `onScroll` handler to attach to the container
 */
function useStickToBottom(ref, deps, resetKey) {
  const stickRef = React.useRef(true);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!resetKey) stickRef.current = true;
    if (stickRef.current) el.scrollTop = el.scrollHeight;
  }, deps);

  return React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    stickRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= QB_STICK_THRESHOLD;
  }, [ref]);
}

Object.assign(window, { useStickToBottom });
