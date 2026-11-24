/* ═════════════════════════════════════════════════════════════════════
   app/markdown-segments.js — split a Markdown message into plain-Markdown
   HTML segments and ```mermaid fence segments.

   Pure logic (UMD, same shape as marked-cjk.js). `MarkdownContent` uses it
   so each mermaid diagram becomes its own React <MermaidCard> instead of
   being squeezed through `marked`'s renderer.code (which sees neither the
   `streaming` flag nor the token's raw text, so it cannot tell a finished
   fence from one that is still being streamed).

   API:
     hasMermaidFence(text)               → fast pre-check (regex, no lexing)
     isClosedFence(raw)                  → does a fenced-code token's raw end
                                           with a matching closing fence?
     split(text, marked, { streaming })  → segments, in order:
         { type: "md", html }
         { type: "mermaid", code, closed, ready }
       `ready` = closed || !streaming: the diagram may be rendered now.
       Only top-level fences are split out; mermaid inside lists or quotes
       stays an ordinary code block.
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.MarkdownSegments = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MERMAID_FENCE = /^ {0,3}(?:`{3,}|~{3,})[ \t]*mermaid(?:[ \t]|$)/im;
  const OPEN_FENCE = /^ {0,3}(`{3,}|~{3,})/;
  const CLOSE_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

  function hasMermaidFence(text) {
    return typeof text === "string" && MERMAID_FENCE.test(text);
  }

  function isClosedFence(raw) {
    if (typeof raw !== "string") return false;
    const lines = raw.replace(/\r/g, "").replace(/\n+$/, "").split("\n");
    if (lines.length < 2) return false;
    const open = OPEN_FENCE.exec(lines[0]);
    const close = CLOSE_FENCE.exec(lines[lines.length - 1]);
    if (!open || !close) return false;
    return close[1][0] === open[1][0] && close[1].length >= open[1].length;
  }

  function isMermaidToken(tok) {
    if (!tok || tok.type !== "code" || tok.codeBlockStyle === "indented") return false;
    const lang = String(tok.lang || "").trim().split(/\s/)[0];
    return lang.toLowerCase() === "mermaid";
  }

  function split(text, marked, opts) {
    const streaming = Boolean(opts && opts.streaming);
    if (!text) return [];
    const tokens = marked.lexer(text);
    const out = [];
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const html = marked.parser(run);
      run = [];
      // Blank lines / link-reference definitions render to nothing.
      if (html.trim()) out.push({ type: "md", html });
    };
    for (const tok of tokens) {
      if (isMermaidToken(tok)) {
        flush();
        const closed = isClosedFence(tok.raw);
        out.push({ type: "mermaid", code: tok.text || "", closed, ready: closed || !streaming });
      } else {
        run.push(tok);
      }
    }
    flush();
    return out;
  }

  return { hasMermaidFence, isClosedFence, isMermaidToken, split };
});
