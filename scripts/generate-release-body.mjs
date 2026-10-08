import fs from 'node:fs';
import path from 'node:path';

/**
 * Extracts changelog notes for a specific version from CHANGELOG.md
 * and generates the complete release markdown body.
 */
export function extractChangelog(changelogContent, tag) {
  const ver = (tag || '').replace(/^v/, '').trim();
  if (!ver) return '';

  const lines = changelogContent.split(/\r?\n/);
  let capturing = false;
  const captured = [];
  const verRegex = new RegExp(`^## \\[(?:v)?${ver.replace(/\./g, '\\.')}\\]`);

  for (const line of lines) {
    if (verRegex.test(line)) {
      capturing = true;
      continue;
    }
    if (capturing && /^## \[/.test(line)) {
      break;
    }
    if (capturing) {
      captured.push(line);
    }
  }

  return captured.join('\n').trim();
}

export function buildReleaseBody(tag, changelogNotes) {
  const safeTag = tag || 'latest';
  const parts = [];

  parts.push(`## PiDesk ${safeTag}\n`);

  if (changelogNotes) {
    parts.push(`### 🚀 What's Changed / 版本变更说明\n\n${changelogNotes}\n\n---\n`);
  }

  parts.push(`### 📦 Installation Guide / 安装指南

#### 🍎 macOS
- **Homebrew (Recommended / 推荐)**:
  \`\`\`bash
  brew install --cask raiderwang/tap/pidesk
  \`\`\`
  *Automatically bypasses Gatekeeper quarantine, no extra command needed.*
- **Manual DMG (.dmg)**:
  Download \`.dmg\` (\`aarch64\` for Apple Silicon, \`x64\` for Intel).
  **If macOS says "PiDesk is damaged and can't be opened"（提示已损坏）**, run this command in terminal to clear the quarantine attribute:
  \`\`\`bash
  xattr -cr /Applications/PiDesk.app
  \`\`\`

#### 🪟 Windows
- Download \`.msi\` (recommended) or \`.exe\` installer.
- If Windows SmartScreen prompts on launch, click **More info → Run anyway**（点击“更多信息” → “仍要运行”）.

#### 🐧 Linux
- Download \`.AppImage\` or \`.deb\`.

---

### ⚙️ Requirements
- [oh-my-pi](https://github.com/can1357/oh-my-pi) (\`omp\`) must be installed and available on your \`PATH\`.`);

  return parts.join('\n');
}

// CLI entry point
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'))) {
  const targetTag = process.argv[2] || process.env.TAG || '';
  const changelogPath = path.resolve('CHANGELOG.md');
  const changelogContent = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8') : '';

  const notes = extractChangelog(changelogContent, targetTag);
  const releaseBody = buildReleaseBody(targetTag, notes);

  if (process.env.GITHUB_OUTPUT) {
    const delimiter = `EOF_${Date.now()}`;
    const outputBlock = `body<<${delimiter}\n${releaseBody}\n${delimiter}\n`;
    fs.appendFileSync(process.env.GITHUB_OUTPUT, outputBlock, 'utf8');
  }

  // Also write to release_body.md for inspection or debugging
  fs.writeFileSync(path.resolve('release_body.md'), releaseBody, 'utf8');
  console.log(`Generated release body for ${targetTag} (notes length: ${notes.length} chars)`);
}
