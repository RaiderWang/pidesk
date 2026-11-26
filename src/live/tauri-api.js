/* live/tauri-api.js — OMP_BRIDGE methods that are plain Tauri invoke wrappers
   (no session state). Spread into window.OMP_BRIDGE by live.js. `window.__TAURI__`
   is read at call time so tests / demo mode can set or omit it late. */
(function () {
  "use strict";
  const TauriApi = {
    /** List saved sessions on disk (~/.omp/agent/sessions). */
    async listSavedSessions(cwd = null) {
      if (!window.__TAURI__) return [];
      try {
        const sessions = await window.__TAURI__.core.invoke("list_saved_sessions", { cwd: cwd || null });
        return sessions || [];
      } catch (err) {
        console.error("[live] listSavedSessions error:", err);
        return [];
      }
    },

    /** Get default cwd for standalone sessions. */
    async getDefaultCwd() {
      if (!window.__TAURI__) return null;
      try {
        const dir = await window.__TAURI__.core.invoke("get_default_cwd");
        if (dir && window.RecentProjects?.setDefaultCwd) {
          window.RecentProjects.setDefaultCwd(dir);
        }
        return dir;
      } catch {
        return null;
      }
    },

    /**
     * Permanently delete a saved session from disk.
     * `path` is the full path to the session's `.jsonl` file (from listSavedSessions).
     * Only that `.jsonl` file is removed (the project's other sessions are kept);
     * an emptied parent directory is cleaned up by the backend.
     */
    async deleteSavedSession(path) {
      if (!window.__TAURI__) return;
      await window.__TAURI__.core.invoke("delete_saved_session", { path });
    },

    /** Read models.yml configuration from disk. */
    async readModelsConfig() {
      if (!window.__TAURI__) return { path: "", content: "", exists: false };
      try {
        return await window.__TAURI__.core.invoke("read_models_config");
      } catch (err) {
        console.error("[live] readModelsConfig error:", err);
        throw err;
      }
    },

    /** Write models.yml configuration to disk. */
    async writeModelsConfig(content) {
      if (!window.__TAURI__) return;
      try {
        await window.__TAURI__.core.invoke("write_models_config", { content });
      } catch (err) {
        console.error("[live] writeModelsConfig error:", err);
        throw err;
      }
    },

    /** Open models.yml in the system default text editor. */
    async openModelsFile() {
      if (!window.__TAURI__) return;
      try {
        await window.__TAURI__.core.invoke("open_models_file");
      } catch (err) {
        console.error("[live] openModelsFile error:", err);
        throw err;
      }
    },

    /** Open models directory in the file explorer. */
    async openModelsFolder() {
      if (!window.__TAURI__) return;
      try {
        await window.__TAURI__.core.invoke("open_models_folder");
      } catch (err) {
        console.error("[live] openModelsFolder error:", err);
        throw err;
      }
    },

    /** List directory contents */
    async listDirectory(path) {
      if (!window.__TAURI__) return [];
      try {
        return await window.__TAURI__.core.invoke("list_directory", { path });
      } catch (err) {
        console.error("[live] listDirectory error:", err);
        throw err;
      }
    },

    /** Rename file or directory */
    async renameFile(oldPath, newPath) {
      if (!window.__TAURI__) return;
      try {
        await window.__TAURI__.core.invoke("rename_file", { oldPath, newPath });
      } catch (err) {
        console.error("[live] renameFile error:", err);
        throw err;
      }
    },

    /** Delete file or directory */
    async deleteFileOrDir(path) {
      if (!window.__TAURI__) return;
      try {
        await window.__TAURI__.core.invoke("delete_file_or_dir", { path });
      } catch (err) {
        console.error("[live] deleteFileOrDir error:", err);
        throw err;
      }
    },

    /** Open with default application */
    async openPathDefault(path) {
      if (!window.__TAURI__) return;
      try {
        await window.__TAURI__.core.invoke("open_path_default", { path });
      } catch (err) {
        console.error("[live] openPathDefault error:", err);
        throw err;
      }
    },

    /** Open a file in the external editor command configured in Tweaks */
    async openWithEditor(editor, path) {
      if (!window.__TAURI__) return;
      try {
        await window.__TAURI__.core.invoke("open_with_editor", { editor, path });
      } catch (err) {
        console.error("[live] openWithEditor error:", err);
        throw err;
      }
    },

    /** Reveal in OS file manager */
    async revealInExplorer(path) {
      if (!window.__TAURI__) return;
      try {
        await window.__TAURI__.core.invoke("reveal_in_explorer", { path });
      } catch (err) {
        console.error("[live] revealInExplorer error:", err);
        throw err;
      }
    },

    /**
     * Start watching files in a directory for auto-refresh.
     * Never throws; resolves to `{ ok: true }`, `{ ok: false, unavailable: true }`
     * (no Tauri, e.g. demo mode: nothing to report) or `{ ok: false, error }`.
     */
    async startFilesWatch(watchId, path) {
      if (!window.__TAURI__) return { ok: false, unavailable: true };
      try {
        await window.__TAURI__.core.invoke("start_file_watch", { watchId, path });
        return { ok: true };
      } catch (err) {
        console.error("[live] startFilesWatch error:", err);
        return { ok: false, error: String(err?.message ?? err) };
      }
    },

    /** Stop watching files in a directory */
    async stopFilesWatch(watchId) {
      if (!window.__TAURI__) return;
      try {
        await window.__TAURI__.core.invoke("stop_file_watch", { watchId });
      } catch (err) {
        console.error("[live] stopFilesWatch error:", err);
      }
    },

    /** Get application version from Tauri backend. */
    async getAppVersion() {
      if (!window.__TAURI__) return "0.3.0";
      try {
        return await window.__TAURI__.core.invoke("get_app_version");
      } catch (err) {
        console.error("[live] getAppVersion error:", err);
        return "0.3.0";
      }
    },

    /** Open native folder picker and return the chosen path (or null). */
    async pickFolder() {
      if (!window.__TAURI__) return null;
      return window.__TAURI__.core.invoke("open_project");
    },
  };

  window._Live = window._Live || {};
  window._Live.TauriApi = TauriApi;
})();
