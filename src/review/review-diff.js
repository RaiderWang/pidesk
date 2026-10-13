/* ═════════════════════════════════════════════════════════════════════
   review-diff.js — Unified Git Diff Parser & Exclusions Filter
   Parses raw unified diff output into structured multi-file model
   with file/line-level metadata and exclusions tracking.
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ReviewDiff = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Common lock, minified, snapshot, or build files to exclude by default
  const EXCLUDED_PATTERNS = [
    // `.lock` covers yarn.lock / Cargo.lock / poetry.lock; `-lock.*` covers
    // package-lock.json / pnpm-lock.yaml.
    { pattern: /\.lock$/i, reason: "lockfile" },
    { pattern: /-lock\.(json|ya?ml)$/i, reason: "lockfile" },
    { pattern: /\.min\.(js|css)$/i, reason: "minified" },
    { pattern: /\.generated\./i, reason: "generated" },
    { pattern: /\.snap$/i, reason: "snapshot" },
    { pattern: /\.(js|css)\.map$/i, reason: "sourcemap" },
    { pattern: /^(dist|build|out|target)\//i, reason: "build_output" },
    { pattern: /(^|\/)(node_modules|vendor)\//i, reason: "vendor" },
    // SVG is text and routinely worth reviewing, so it is intentionally not listed.
    { pattern: /\.(png|jpe?g|gif|ico|webp|avif)$/i, reason: "image" },
    { pattern: /\.(woff2?|ttf|eot|otf)$/i, reason: "font" },
    { pattern: /\.(pdf|zip|tar|gz|rar|7z|exe|dll|so|dylib)$/i, reason: "binary" },
  ];

  const SIMPLE_ESCAPES = {
    a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\x0b", "\\": "\\", "'": "'", '"': '"',
  };

  // Runs of `\303\251`-style octal escapes are UTF-8 bytes, not code points.
  function decodeOctalRuns(s) {
    return s.replace(/(?:\\[0-7]{3})+/g, (run) => {
      const bytes = run.match(/[0-7]{3}/g).map((o) => parseInt(o, 8) & 0xff);
      if (typeof TextDecoder === "function") {
        return new TextDecoder("utf-8").decode(Uint8Array.from(bytes));
      }
      return String.fromCharCode(...bytes);
    });
  }

  function decodeGitPath(token) {
    if (!token) return "";
    let s = token.trim();
    if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
      s = decodeOctalRuns(s.slice(1, -1));
      s = s.replace(/\\([abfnrtv\\'"])/g, (_, esc) => SIMPLE_ESCAPES[esc] || esc);
    }
    return s.replace(/^[ab]\//, "");
  }

  /**
   * Split the remainder of a `diff --git ` line into [oldToken, newToken].
   * Paths may contain spaces, so a naive `split(" ")` is wrong: prefer the
   * split where both sides are the same path (`a/X b/X`), and honour
   * quoted tokens. Renames are corrected later from `rename from/to`.
   */
  function splitDiffGitHeader(rest) {
    if (rest.startsWith('"')) {
      let i = 1;
      while (i < rest.length && !(rest[i] === '"' && rest[i - 1] !== "\\")) i++;
      return [rest.slice(0, i + 1), rest.slice(i + 2)];
    }
    for (let i = rest.indexOf(" "); i !== -1; i = rest.indexOf(" ", i + 1)) {
      const left = rest.slice(0, i);
      const right = rest.slice(i + 1);
      if (left.startsWith("a/") && right.startsWith("b/") && left.slice(2) === right.slice(2)) {
        return [left, right];
      }
    }
    const first = rest.indexOf(" ");
    return first === -1 ? [rest, ""] : [rest.slice(0, first), rest.slice(first + 1)];
  }

  // `--- a/my file.txt\t` — git appends a TAB when the path contains spaces.
  function pathFromMarkerLine(line) {
    return line.slice(4).replace(/\t.*$/, "").trim();
  }

  function isNullPath(p) {
    return p === "/dev/null" || p === "NUL";
  }

  function splitFileDiffs(rawDiff) {
    if (!rawDiff || typeof rawDiff !== "string") return [];
    const lines = rawDiff.split("\n");
    const blocks = [];
    let currentBlock = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("diff --git ") && currentBlock.length > 0) {
        blocks.push(currentBlock.join("\n"));
        currentBlock = [line];
      } else {
        currentBlock.push(line);
      }
    }
    if (currentBlock.length > 0) {
      blocks.push(currentBlock.join("\n"));
    }
    return blocks.filter((b) => b.trim().length > 0);
  }

  function parseSingleFileDiff(blockText) {
    const lines = blockText.split("\n");
    let oldPath = "";
    let newPath = "";
    let status = "modified";
    let isBinary = false;

    // Header inspection: everything before the first hunk. (Never scan past
    // `@@` — a removed line like `-- foo` would otherwise look like `--- foo`.)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("@@")) break;
      if (line.startsWith("diff --git ")) {
        const [o, n] = splitDiffGitHeader(line.slice("diff --git ".length));
        oldPath = decodeGitPath(o);
        newPath = decodeGitPath(n);
      } else if (line.startsWith("new file mode ")) {
        status = "added";
      } else if (line.startsWith("deleted file mode ")) {
        status = "deleted";
      } else if (line.startsWith("similarity index ")) {
        status = "renamed";
      } else if (line.startsWith("rename from ")) {
        status = "renamed";
        oldPath = decodeGitPath(line.slice("rename from ".length));
      } else if (line.startsWith("rename to ")) {
        newPath = decodeGitPath(line.slice("rename to ".length));
      } else if (line.startsWith("Binary files ") || line.includes("GIT binary patch")) {
        isBinary = true;
      } else if (line.startsWith("--- ")) {
        const p = pathFromMarkerLine(line);
        if (isNullPath(p)) status = "added";
        else oldPath = decodeGitPath(p);
      } else if (line.startsWith("+++ ")) {
        const p = pathFromMarkerLine(line);
        if (isNullPath(p)) status = "deleted";
        else newPath = decodeGitPath(p);
      }
    }

    const filePath = newPath || oldPath || "unknown";
    const rows = [];
    let linesAdded = 0;
    let linesRemoved = 0;
    let curOldLine = 0;
    let curNewLine = 0;
    let inHunk = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("@@")) {
        inHunk = true;
        // @@ -oldStart,oldCount +newStart,newCount @@
        const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
        if (match) {
          curOldLine = parseInt(match[1], 10) - 1;
          curNewLine = parseInt(match[2], 10) - 1;
        }
        rows.push({
          kind: "hunk",
          raw: line,
          text: line,
          hunkHeader: line,
        });
        continue;
      }

      if (!inHunk) continue;

      if (line.startsWith("+")) {
        curNewLine++;
        linesAdded++;
        rows.push({
          kind: "add",
          raw: line,
          text: line.slice(1),
          newLine: curNewLine,
        });
      } else if (line.startsWith("-")) {
        curOldLine++;
        linesRemoved++;
        rows.push({
          kind: "rem",
          raw: line,
          text: line.slice(1),
          oldLine: curOldLine,
        });
      } else if (line.startsWith(" ")) {
        curOldLine++;
        curNewLine++;
        rows.push({
          kind: "ctx",
          raw: line,
          text: line.slice(1),
          oldLine: curOldLine,
          newLine: curNewLine,
        });
      } else if (line.startsWith("\\ No newline at end of file")) {
        rows.push({
          kind: "no-newline",
          raw: line,
          text: line,
        });
      }
    }

    return {
      path: filePath,
      oldPath: oldPath || filePath,
      newPath: newPath || filePath,
      status,
      isBinary,
      rawDiff: blockText,
      rows,
      linesAdded,
      linesRemoved,
    };
  }

  function parseMultiFileDiff(rawDiff) {
    if (!rawDiff || !rawDiff.trim()) {
      return [];
    }
    const blocks = splitFileDiffs(rawDiff);
    return blocks.map(parseSingleFileDiff);
  }

  function filterExcludedFiles(files) {
    const displayFiles = [];
    const excludedFiles = [];

    for (const file of files) {
      let isExcluded = false;
      let matchedReason = "";

      for (const rule of EXCLUDED_PATTERNS) {
        if (rule.pattern.test(file.path)) {
          isExcluded = true;
          matchedReason = rule.reason;
          break;
        }
      }

      if (isExcluded) {
        excludedFiles.push({ ...file, excludeReason: matchedReason });
      } else {
        displayFiles.push(file);
      }
    }

    return {
      displayFiles,
      excludedFiles,
      totalAdded: displayFiles.reduce((acc, f) => acc + f.linesAdded, 0),
      totalRemoved: displayFiles.reduce((acc, f) => acc + f.linesRemoved, 0),
    };
  }

  /** Re-assemble a raw diff from already-filtered files (drops excluded ones). */
  function joinFileDiffs(files) {
    if (!Array.isArray(files) || files.length === 0) return "";
    return files.map((f) => f.rawDiff.replace(/\n+$/, "")).join("\n") + "\n";
  }

  return {
    parseMultiFileDiff,
    filterExcludedFiles,
    joinFileDiffs,
    decodeGitPath,
    splitDiffGitHeader,
  };
});
