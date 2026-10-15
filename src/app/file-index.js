/* app/file-index.js — bounded breadth-first project file index used by the
   palette's "@" mode. Takes the directory lister as a parameter (the app
   passes OMP_BRIDGE.listDirectory) so it stays pure and testable.

   listDir(path) -> Promise<Array<{ name, path, is_dir }>> */
(function () {
  const DEFAULT_SKIP = [".git", "node_modules", "target", "dist", "build", ".next", ".venv", "__pycache__", ".idea", ".vscode"];

  function relativePath(root, full) {
    if (!root || !full) return full || "";
    const normRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
    const normFull = full.replace(/\\/g, "/");
    if (normFull === normRoot) return "";
    if (normFull.startsWith(normRoot + "/")) return normFull.slice(normRoot.length + 1);
    return full;
  }

  /**
   * @param {string} root
   * @param {(path: string) => Promise<Array>} listDir
   * @param {{ maxEntries?: number, maxDepth?: number, skip?: string[], batch?: number }} [opts]
   * @returns {Promise<Array<{ path: string, rel: string, name: string }>>}
   */
  async function buildFileIndex(root, listDir, opts) {
    const maxEntries = (opts && opts.maxEntries) || 4000;
    const maxDepth = (opts && opts.maxDepth) || 6;
    const batch = (opts && opts.batch) || 8;
    const skip = new Set((opts && opts.skip) || DEFAULT_SKIP);
    const files = [];
    let level = [root];
    for (let depth = 0; depth <= maxDepth && level.length > 0 && files.length < maxEntries; depth++) {
      const next = [];
      for (let i = 0; i < level.length && files.length < maxEntries; i += batch) {
        const chunk = level.slice(i, i + batch);
        const results = await Promise.all(
          chunk.map((dir) => Promise.resolve().then(() => listDir(dir)).catch(() => [])),
        );
        for (const entries of results) {
          for (const e of entries || []) {
            if (files.length >= maxEntries) break;
            if (e.is_dir) {
              if (!skip.has(e.name)) next.push(e.path);
            } else {
              files.push({ path: e.path, rel: relativePath(root, e.path), name: e.name });
            }
          }
        }
      }
      level = next;
    }
    return files;
  }

  window.FileIndex = { buildFileIndex, relativePath, DEFAULT_SKIP };
})();
