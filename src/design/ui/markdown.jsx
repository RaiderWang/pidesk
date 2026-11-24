/* ui/markdown.jsx — Markdown renderer using marked + highlight.js
   when available; falls back to plain text with HTML escaping.

   Messages containing a top-level ```mermaid fence are split by
   MarkdownSegments into HTML segments + <MermaidCard>s; everything else
   keeps the single `marked.parse` fast path. */

const _mdEscape = (text) => '<p>' + text
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';

// ── Markdown renderer — uses marked + highlight.js when available ─────────
const MarkdownContent = ({ text, streaming }) => {
  const parts = React.useMemo(() => {
    if (!text) return [{ type: 'md', html: '' }];
    // marked not loaded — render plain text with escaped HTML
    if (!window.marked) return [{ type: 'md', html: _mdEscape(text) }];
    try {
      const seg = window.MarkdownSegments;
      if (seg && window.MermaidRender && window.MermaidCard && seg.hasMermaidFence(text)) {
        const segs = seg.split(text, window.marked, { streaming: Boolean(streaming) });
        if (segs.length) return segs;
      }
      return [{ type: 'md', html: window.marked.parse(text) }];
    } catch (_) {
      return [{ type: 'md', html: '<pre>' + text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</pre>' }];
    }
  }, [text, streaming]);

  const cls = `md-content selectable${streaming ? ' md-streaming' : ''}`;
  // Fast path: one HTML blob, exactly as before mermaid support.
  if (parts.length === 1 && parts[0].type === 'md') {
    return <div key="html" className={cls} dangerouslySetInnerHTML={{ __html: parts[0].html }} />;
  }
  // Distinct key → clean remount when a message switches between the two shapes.
  return (
    <div key="segments" className={cls}>
      {parts.map((p, i) => (
        p.type === 'mermaid'
          ? <window.MermaidCard key={i} code={p.code} ready={p.ready} />
          : <div key={i} className="md-segment" dangerouslySetInnerHTML={{ __html: p.html }} />
      ))}
    </div>
  );
};


Object.assign(window, { MarkdownContent });
