/* ═════════════════════════════════════════════════════════════════════
   app/link-target.js — pure classifier for Markdown link targets.

   classify(href, cwd) -> { kind: "external", url }
                        | { kind: "path", path }
                        | { kind: "ignore" }

   - http / https / mailto          -> external (system browser / mail client)
   - file:// URLs, absolute paths,
     relative paths (joined to cwd) -> path (opened by `open_link_path`)
   - "#anchor", other schemes, protocol-relative "//host", relative paths
     without a cwd                  -> ignore (caller still preventDefault)

   Paths come back with forward slashes, without "?query", "#L10-L20" or
   ":12:3" suffixes, and with "." / ".." segments resolved.
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.LinkTarget = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const IGNORE = Object.freeze({ kind: "ignore" });
  const EXTERNAL_SCHEMES = new Set(["http", "https", "mailto"]);
  // "a.md:12:3" is a path with a line suffix, not scheme "a.md".
  const SCHEME_RE = /^([A-Za-z][A-Za-z0-9+.-]*):(?!\d+(?::\d+)?$)/;
  const DRIVE_ABS_RE = /^[A-Za-z]:\//;
  const LINE_SUFFIX_RE = /:\d+(?::\d+)?$/;
  const PERCENT_RUN_RE = /(?:%[0-9A-Fa-f]{2})+/g;

  /** Decode each "%XX" run on its own so a literal "%" ("100%覆盖率.md") never throws. */
  function safeDecode(s) {
    return s.replace(PERCENT_RUN_RE, (run) => {
      try {
        return decodeURIComponent(run);
      } catch (_) {
        return run;
      }
    });
  }

  /** Resolve "." / ".." lexically, keeping the drive / leading-slash prefix. */
  function resolveDots(p) {
    const prefix = /^(?:[A-Za-z]:)?\/*/.exec(p)[0];
    const out = [];
    for (const seg of p.slice(prefix.length).split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") out.pop();
      else out.push(seg);
    }
    return prefix + out.join("/");
  }

  /** "file:///f:/x" -> "f:/x", "file:///Users/x" -> "/Users/x", "file://srv/share" -> "//srv/share". */
  function fileUrlToPath(raw) {
    let rest = raw.slice("file:".length).replace(/^\/\//, "");
    if (!rest.startsWith("/")) {
      // "file://host/share/x": drop "localhost", otherwise it's a UNC host.
      rest = /^localhost(?=\/|$)/i.test(rest) ? rest.slice("localhost".length) : `//${rest}`;
    }
    return rest.replace(/^\/([A-Za-z]:)/, "$1");
  }

  function classify(href, cwd) {
    const raw = String(href ?? "").trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("//")) return IGNORE;

    let candidate = raw;
    const m = SCHEME_RE.exec(raw);
    // A single letter is a Windows drive ("C:\a.md"), not a URL scheme.
    if (m && m[1].length > 1) {
      const scheme = m[1].toLowerCase();
      if (EXTERNAL_SCHEMES.has(scheme)) return { kind: "external", url: raw };
      if (scheme !== "file") return IGNORE;
      candidate = fileUrlToPath(raw);
    }

    // Query / fragment first (so "%23" in a name decodes afterwards), then
    // line suffix last so "C:" drive letters are never touched.
    let path = candidate.split("#")[0].split("?")[0];
    path = safeDecode(path).replace(/\\/g, "/").replace(LINE_SUFFIX_RE, "");
    if (!path) return IGNORE;

    if (!path.startsWith("/") && !DRIVE_ABS_RE.test(path)) {
      const base = String(cwd ?? "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
      if (!base) return IGNORE;
      path = `${base}/${path}`;
    }
    const resolved = resolveDots(path);
    return resolved ? { kind: "path", path: resolved } : IGNORE;
  }

  return { classify };
});
