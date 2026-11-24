/* ui/use-stick-scroll.jsx — keeps a scrollable output box pinned to its
   bottom while `active` (e.g. a tool is still streaming), pausing when the
   user scrolls up and re-pinning on an inactive -> active transition.
   Pure decisions live in app/stick-scroll.js (window.StickScroll).

   Usage: const onScroll = useStickScroll(ref, [output], { active: running });
          <pre ref={ref} onScroll={onScroll}>…</pre>

   `deps` must keep the same length per call site. */

function useStickScroll(ref, deps, { active }) {
  const stickRef = React.useRef(true);
  const prevActiveRef = React.useRef(false);

  React.useLayoutEffect(() => {
    const el = ref.current;
    const wasActive = prevActiveRef.current;
    // Update before the early return, otherwise a false -> true edge is lost.
    prevActiveRef.current = active;
    if (!active) return;
    // Resolve the re-pin before the element check: if the box mounts on a
    // later render, `wasActive` is already true and the edge would be lost.
    stickRef.current = window.StickScroll.nextStick({
      stuck: stickRef.current, active, wasActive,
    });
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [active, ...deps]);

  return React.useCallback(() => {
    stickRef.current = window.StickScroll.nextStick({
      stuck: stickRef.current,
      active: true,
      wasActive: true,
      nearBottom: window.StickScroll.isNearBottom(ref.current),
    });
  }, [ref]);
}

Object.assign(window, { useStickScroll });
