/* chat/bash-output.jsx — streamed output box of a `bash` tool card.
   Mounted only while the card is expanded, so collapsing and re-opening a
   running card remounts it and re-pins to the bottom. Pinning is paused if
   the user scrolls up (see ui/use-stick-scroll.jsx). */

function BashOutput({ output, running }) {
  const ref = React.useRef(null);
  // `output` is a fresh array on every update and is capped to the last 20
  // lines, so its length alone cannot signal new content.
  const onScroll = window.useStickScroll(ref, [output], { active: running });

  return (
    <pre className="tool-bash mono selectable" ref={ref} onScroll={onScroll}>
      {output.map((l, i) => (
        <div key={i} style={{ color: `var(--${l.color})` }}>{l.line}</div>
      ))}
    </pre>
  );
}

Object.assign(window, { BashOutput });
