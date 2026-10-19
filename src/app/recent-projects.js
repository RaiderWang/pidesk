// app/recent-projects.js — recent projects management & persistence
(function () {
  "use strict";

  const STORAGE_KEY = "pidesk:recent_projects";
  const MAX_STORED = 20;
  let defaultCwd = null;

  function normPath(p) {
    return (p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  }

  function getProjectName(path) {
    if (!path) return "";
    const clean = path.replace(/\\/g, "/").replace(/\/+$/, "");
    const parts = clean.split("/");
    return parts[parts.length - 1] || clean;
  }

  function formatDisplayPath(path) {
    if (!path) return "";
    return path;
  }

  function setDefaultCwd(cwd) {
    if (cwd && typeof cwd === "string") {
      defaultCwd = normPath(cwd);
      // Clean any existing entries matching default cwd from storage
      getRecentProjects();
    }
  }

  function isStandalonePath(path, name = null) {
    if (!path || typeof path !== "string") return true;
    const clean = path.trim();
    if (!clean || clean === ".") return true;
    const norm = normPath(clean);

    if (name === "Default") return true;

    // Check against runtime default cwd if known
    if (defaultCwd && (norm === defaultCwd || norm.startsWith(defaultCwd + "/"))) {
      return true;
    }

    // Dedicated no-project workspace: <app local data>/<tauri identifier>/workspace.
    // Static fallback for before `getDefaultCwd` resolves (identifier from tauri.conf.json).
    if (/\/com\.raiderwang\.pidesk\/workspace(\/|$)/.test(norm)) {
      return true;
    }

    // Build/target directories where dev executable runs (e.g. target/debug, target/release)
    if (
      norm.endsWith("/target/debug") ||
      norm.endsWith("/target/release") ||
      norm.includes("/src-tauri/target/debug") ||
      norm.includes("/src-tauri/target/release") ||
      norm.includes("/target/debug") ||
      norm.includes("/target/release")
    ) {
      return true;
    }

    // Installed application directories (e.g. Program Files/PiDesk, Program Files/OMP Desktop)
    if (
      norm.includes("/program files/pidesk") ||
      norm.includes("/program files (x86)/pidesk") ||
      norm.includes("/program files/omp desktop") ||
      norm.includes("/program files (x86)/omp desktop")
    ) {
      return true;
    }

    // macOS app bundle
    if (norm.endsWith(".app") || norm.includes(".app/contents")) {
      return true;
    }

    // Check folder name if it matches common standalone / binary folder signatures
    if (
      (name === "debug" || name === "release") &&
      (norm.endsWith("/debug") || norm.endsWith("/release"))
    ) {
      return true;
    }

    if (
      (name === "PiDesk" || name === "OMP Desktop" || name === "pidesk" || name === "omp-desktop") &&
      (norm.includes("program files") || norm.includes("appdata") || norm.includes("target"))
    ) {
      return true;
    }

    return false;
  }

  function getRecentProjects() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const valid = parsed.filter(
        item => item && typeof item.path === "string" && item.path.trim() && !isStandalonePath(item.path, item.name)
      );
      if (valid.length !== parsed.length) {
        saveRecentProjects(valid);
      }
      return valid;
    } catch {
      return [];
    }
  }

  function saveRecentProjects(list) {
    try {
      const filtered = list.filter(item => !isStandalonePath(item.path, item.name));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered.slice(0, MAX_STORED)));
    } catch (e) {
      console.warn("[RecentProjects] Failed to save:", e);
    }
  }

  function addRecentProject(path, name = null) {
    if (!path || typeof path !== "string" || !path.trim()) return getRecentProjects();
    const cleanPath = path.trim();
    const projName = name || getProjectName(cleanPath);

    if (isStandalonePath(cleanPath, projName)) {
      return getRecentProjects();
    }

    const key = normPath(cleanPath);
    const existing = getRecentProjects();
    const filtered = existing.filter(item => normPath(item.path) !== key);
    const updated = [
      {
        path: cleanPath,
        name: projName,
        lastOpened: Date.now(),
      },
      ...filtered,
    ].slice(0, MAX_STORED);

    saveRecentProjects(updated);
    return updated;
  }

  function removeRecentProject(path) {
    if (!path) return getRecentProjects();
    const key = normPath(path);
    const existing = getRecentProjects();
    const filtered = existing.filter(item => normPath(item.path) !== key);
    saveRecentProjects(filtered);
    return filtered;
  }

  function syncFromSavedSessions(savedSessions) {
    if (!Array.isArray(savedSessions) || savedSessions.length === 0) {
      return getRecentProjects();
    }

    const current = getRecentProjects();
    const seen = new Set(current.map(p => normPath(p.path)));
    const additions = [];

    for (const session of savedSessions) {
      if (session?.is_standalone === true) continue;

      const cwd = session?.cwd;
      if (!cwd || typeof cwd !== "string" || !cwd.trim()) continue;
      const cleanCwd = cwd.trim();
      const name = session.project_name || getProjectName(cleanCwd);

      if (isStandalonePath(cleanCwd, name)) continue;

      const key = normPath(cleanCwd);
      if (seen.has(key)) continue;

      seen.add(key);
      let lastOpened = Date.now();
      const timeStr = session.updated_at || session.timestamp;
      if (timeStr) {
        const parsed = new Date(timeStr).getTime();
        if (!isNaN(parsed)) lastOpened = parsed;
      }

      additions.push({
        path: cleanCwd,
        name,
        lastOpened,
      });
    }

    const merged = [...current, ...additions];
    merged.sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
    const result = merged.slice(0, MAX_STORED);
    saveRecentProjects(result);
    return result;
  }

  const api = {
    normPath,
    getProjectName,
    formatDisplayPath,
    setDefaultCwd,
    isStandalonePath,
    getRecentProjects,
    saveRecentProjects,
    addRecentProject,
    removeRecentProject,
    syncFromSavedSessions,
  };

  if (typeof window !== "undefined") {
    window.RecentProjects = api;
  }
  if (typeof globalThis !== "undefined") {
    globalThis.RecentProjects = api;
  }
})();
