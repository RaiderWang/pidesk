/* ═════════════════════════════════════════════════════════════════════
   review-prompt.js — Code Review Prompt Formatter
   Transforms parsed diffs, file summaries, and user annotations into
   structured review prompts for LLM session turns.
   ═════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./review-annotation-keys.js"));
  } else {
    root.ReviewPrompt = factory(root.ReviewAnnotationKeys);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Keys) {
  "use strict";

  const LARGE_DIFF_CHAR_LIMIT = 45000;
  const LARGE_DIFF_FILE_LIMIT = 20;
  const SNIPPET_MAX = 120;

  const DEFAULT_LABEL = { zh: "未提交更改", en: "Uncommitted changes" };

  /** Wrap `body` in a code fence that cannot be closed by the body itself. */
  function fenceBlock(body, info) {
    let fence = "```";
    while (body.includes(fence)) fence += "`";
    return `${fence}${info || ""}\n${body}\n${fence}`;
  }

  function snippetOf(row) {
    if (!row || typeof row.text !== "string") return "";
    const text = row.text.trim().replace(/`/g, "'");
    if (!text) return "";
    return text.length > SNIPPET_MAX ? text.slice(0, SNIPPET_MAX) + "…" : text;
  }

  function describeLine(parsed, isZh) {
    if (!parsed) return "";
    const { side, line } = parsed;
    if (isZh) {
      if (side === "old") return `原行 ${line}（已删除）`;
      return `行 ${line}`;
    }
    return side === "old" ? `Old line ${line} (removed)` : `Line ${line}`;
  }

  /**
   * @param {Object} annotations  { [filePath]: { [lineKey]: note } }
   * @param {string} lang         "zh" | "en"
   * @param {Array}  files        Optional parsed files; used to quote the annotated code line.
   */
  function formatAnnotations(annotations, lang = "zh", files = []) {
    if (!annotations || Object.keys(annotations).length === 0) return "";
    const isZh = lang === "zh";
    const header = isZh
      ? "\n### 📌 用户特定批注与要求\n请重点关注以下具体代码行的人工批注与修改意图：\n"
      : "\n### 📌 User Annotations & Directives\nPlease address the following specific line-level notes from the reviewer:\n";

    const byPath = new Map((files || []).map((f) => [f.path, f]));
    const lines = [header];
    for (const [fileKey, fileNotes] of Object.entries(annotations)) {
      if (!fileNotes || Object.keys(fileNotes).length === 0) continue;
      lines.push(isZh ? `- **文件 \`${fileKey}\`**:` : `- **File \`${fileKey}\`**:`);
      const file = byPath.get(fileKey);
      const keys = Object.keys(fileNotes).sort(Keys.compareKeys);
      for (const lineKey of keys) {
        const note = fileNotes[lineKey];
        if (!note || !note.trim()) continue;
        const parsed = Keys.parseKey(lineKey);
        const label = parsed ? describeLine(parsed, isZh) : lineKey;
        const snippet = snippetOf(Keys.findRow(file, lineKey));
        const quote = snippet ? ` \`${snippet}\`` : "";
        lines.push(`  - **${label}**${quote}: ${note.trim()}`);
      }
    }
    return lines.length > 1 ? lines.join("\n") + "\n" : "";
  }

  function buildReviewPrompt(options) {
    const {
      targetLabel,
      files = [],
      rawDiff = "",
      annotations = {},
      focusInstructions = "",
      truncated = false,
      lang = "zh",
    } = options;

    const isZh = lang === "zh";
    const label = targetLabel || DEFAULT_LABEL[isZh ? "zh" : "en"];
    const totalAdded = files.reduce((acc, f) => acc + (f.linesAdded || 0), 0);
    const totalRemoved = files.reduce((acc, f) => acc + (f.linesRemoved || 0), 0);
    const isLargeDiff =
      rawDiff.length > LARGE_DIFF_CHAR_LIMIT || files.length > LARGE_DIFF_FILE_LIMIT;

    const parts = [];

    // Title & Context
    if (isZh) {
      parts.push(`## 🔍 代码审查请求 (${label})`);
      parts.push(
        `请对当前代码变更进行专业审查。本次改动涉及 **${files.length}** 个文件，累计新增 **+${totalAdded}** 行，删除 **-${totalRemoved}** 行。`
      );
    } else {
      parts.push(`## 🔍 Code Review Request (${label})`);
      parts.push(
        `Please conduct a thorough code review. Changes touch **${files.length}** files (+${totalAdded} lines, -${totalRemoved} lines).`
      );
    }

    if (focusInstructions && focusInstructions.trim()) {
      parts.push(
        isZh
          ? `\n### 🎯 用户重点关注方向\n${focusInstructions.trim()}`
          : `\n### 🎯 User Focus Areas\n${focusInstructions.trim()}`
      );
    }

    const notesText = formatAnnotations(annotations, lang, files);
    if (notesText) parts.push(notesText);

    if (files.length > 0) {
      parts.push(isZh ? "\n### 📁 变动文件清单" : "\n### 📁 Modified Files");
      for (const f of files) {
        parts.push(`- \`${f.path}\` (+${f.linesAdded} / -${f.linesRemoved}, ${f.status})`);
      }
    }

    if (truncated) {
      parts.push(
        isZh
          ? "\n> ⚠️ 差异输出超出大小上限，已被截断；请用 `git diff` 自行查看完整改动。"
          : "\n> ⚠️ The diff exceeded the size budget and was truncated; run `git diff` yourself for the full change."
      );
    }

    // Diff payload
    if (isLargeDiff) {
      if (isZh) {
        parts.push("\n### ⚠️ 代码差异提示");
        parts.push(
          "本次代码差异较大，为节省上下文窗口，建议你根据上述文件清单按需使用 `read` 工具或 `git diff` 查看详细代码。"
        );
      } else {
        parts.push("\n### ⚠️ Large Diff Advisory");
        parts.push(
          "The diff exceeds standard inline budget. Please inspect individual files with your tools as needed."
        );
      }
    } else if (rawDiff && rawDiff.trim()) {
      parts.push(isZh ? "\n### 📋 代码差异 (Git Diff)" : "\n### 📋 Patch Diff");
      parts.push(fenceBlock(rawDiff.trim(), "diff"));
    }

    // Review checklist criteria
    if (isZh) {
      parts.push(
        "\n### 📝 审查要点指南\n" +
          "1. **逻辑正确性**：是否存在边界情况遗漏、空指针/未定义解引用、异常未捕获等隐患？\n" +
          "2. **架构与性能**：改动是否符合项目设计风格？是否存在重复计算、内存泄漏或资源未释放？\n" +
          "3. **安全风险**：是否存在安全漏洞（如注入、未过滤输入、竞态条件等）？\n" +
          "4. **批注响应**：如果有用户在指定行提出的批注，请逐一正面回应并给出具体的改进建议或修正代码。"
      );
    } else {
      parts.push(
        "\n### 📝 Review Guidelines\n" +
          "1. **Correctness**: Look for edge cases, nullability issues, unhandled errors.\n" +
          "2. **Design & Performance**: Conformance to existing architecture, potential memory leaks.\n" +
          "3. **Security**: Identify vulnerabilities, injection risks, race conditions.\n" +
          "4. **Annotation Responses**: Directly address each user inline note with concrete suggestions."
      );
    }

    return parts.join("\n\n");
  }

  return {
    buildReviewPrompt,
    formatAnnotations,
    fenceBlock,
  };
});
