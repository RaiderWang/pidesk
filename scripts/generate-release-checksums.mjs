import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Downloads non-sig release assets, calculates SHA-256 checksums,
 * writes and uploads checksums.txt, and appends a markdown table to the release body.
 */
export async function generateAndPublishChecksums(tag) {
  if (!tag) {
    throw new Error('Release tag is required.');
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pidesk-checksums-'));

  try {
    console.log(`[checksums] Downloading release assets for ${tag} to ${tempDir}...`);
    execSync(`gh release download "${tag}" --dir "${tempDir}" --pattern "*.*" --skip-existing`, {
      stdio: 'inherit',
    });

    const entries = fs.readdirSync(tempDir);
    const installableFiles = entries.filter((file) => {
      if (file.endsWith('.sig') || file === 'latest.json' || file === 'checksums.txt') {
        return false;
      }
      return fs.statSync(path.join(tempDir, file)).isFile();
    });

    if (installableFiles.length === 0) {
      console.warn('[checksums] No installable files found to compute checksums.');
      return;
    }

    const checksums = [];
    for (const file of installableFiles) {
      const filePath = path.join(tempDir, file);
      const buffer = fs.readFileSync(filePath);
      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      checksums.push({ file, hash });
    }

    checksums.sort((a, b) => a.file.localeCompare(b.file));

    // 1. Create checksums.txt
    const checksumsTxt = checksums.map((c) => `${c.hash}  ${c.file}`).join('\n') + '\n';
    const checksumsFilePath = path.join(tempDir, 'checksums.txt');
    fs.writeFileSync(checksumsFilePath, checksumsTxt, 'utf8');

    // 2. Upload checksums.txt
    console.log(`[checksums] Uploading checksums.txt to ${tag}...`);
    execSync(`gh release upload "${tag}" "${checksumsFilePath}" --clobber`, { stdio: 'inherit' });

    // 3. Format markdown table
    let mdTable = '\n\n---\n\n### 🔒 SHA-256 Checksums\n\n| Filename | SHA-256 Checksum |\n| :--- | :--- |\n';
    for (const c of checksums) {
      mdTable += `| \`${c.file}\` | \`${c.hash}\` |\n`;
    }

    // 4. Update release body
    const currentBody = execSync(`gh release view "${tag}" --json body --jq .body`, {
      encoding: 'utf8',
    });

    let newBody = currentBody;
    if (newBody.includes('### 🔒 SHA-256 Checksums')) {
      newBody = newBody.replace(/---[\s\S]*### 🔒 SHA-256 Checksums[\s\S]*$/, '').trim();
    }
    newBody = newBody.trim() + mdTable;

    const bodyFilePath = path.join(tempDir, 'release_body_with_checksums.md');
    fs.writeFileSync(bodyFilePath, newBody, 'utf8');

    console.log(`[checksums] Updating release description for ${tag}...`);
    execSync(`gh release edit "${tag}" --notes-file "${bodyFilePath}"`, { stdio: 'inherit' });

    console.log('[checksums] Successfully updated release with SHA-256 checksums.');
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }
}

// CLI entry point
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'))) {
  const targetTag = process.argv[2] || process.env.TAG || '';
  generateAndPublishChecksums(targetTag).catch((err) => {
    console.error('[checksums] Failed:', err);
    process.exit(1);
  });
}
