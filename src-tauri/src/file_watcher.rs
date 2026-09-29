//! Project directory file watcher for PiDesk file tree panel.
//!
//! [`FileWatcherState`] manages recursive filesystem notifications using
//! [`notify::RecommendedWatcher`] on project directories, debounced to avoid
//! event floods during git operations, builds, or bulk agent writes.

use std::{
    collections::HashMap,
    path::Path,
    sync::{
        mpsc::{self, Receiver, RecvTimeoutError, Sender},
        Mutex,
    },
    thread,
    time::Duration,
};

use notify::{RecursiveMode, Watcher as _};
use serde::Serialize;
use tauri::{AppHandle, Emitter as _};

/// Payload sent via `"files://changed"` event to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeEvent {
    pub watch_id: String,
    pub path: String,
}

/// Checks whether a path component represents an ignored directory or file
/// (e.g. version control, dependencies, build output, lock / temporary files).
pub fn is_ignored_path(path: &Path) -> bool {
    for component in path.components() {
        if let std::path::Component::Normal(c) = component {
            let s = c.to_string_lossy();
            if s == ".git"
                || s == "node_modules"
                || s == "target"
                || s == "dist"
                || s == "build"
                || s == ".next"
                || s == ".nuxt"
                || s == ".cache"
                || s == ".turbo"
                || s == ".svn"
                || s == ".hg"
                || s == ".DS_Store"
                || s.starts_with(".#")
            {
                return true;
            }
        }
    }
    if let Some(ext) = path.extension() {
        let ext_str = ext.to_string_lossy();
        if ext_str == "tmp" || ext_str == "swp" || ext_str == "lock" || ext_str == "crswap" {
            return true;
        }
    }
    false
}

struct WatcherEntry {
    _watcher: notify::RecommendedWatcher,
    _tx: Sender<()>,
}

/// Holds active file tree watchers keyed by `watch_id`.
pub struct FileWatcherState {
    watchers: Mutex<HashMap<String, WatcherEntry>>,
}

impl FileWatcherState {
    pub fn new() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
        }
    }

    /// Start watching `path_str` recursively for `watch_id`.
    /// Debounces events with a 250ms quiet window and emits `"files://changed"` on `app`.
    pub fn start(
        &self,
        watch_id: &str,
        path_str: &str,
        app: AppHandle,
    ) -> Result<(), String> {
        let target_path = Path::new(path_str);
        if !target_path.exists() {
            return Err(format!("Directory does not exist: {path_str}"));
        }
        if !target_path.is_dir() {
            return Err(format!("Path is not a directory: {path_str}"));
        }

        // Cancel previous watcher for this watch_id if one already exists
        self.stop(watch_id);

        let (tx, rx): (Sender<()>, Receiver<()>) = mpsc::channel();
        let tx_cb = tx.clone();

        let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            let Ok(event) = res else { return };
            // Ignore access / read events
            if matches!(event.kind, notify::EventKind::Access(_)) {
                return;
            }
            // Check if any path changed is not in the ignore list
            let has_relevant_path = event.paths.iter().any(|p| !is_ignored_path(p));
            if has_relevant_path {
                let _ = tx_cb.send(());
            }
        })
        .map_err(|e| format!("Failed to create watcher: {e}"))?;

        watcher
            .watch(target_path, RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to watch directory {path_str}: {e}"))?;

        let wid = watch_id.to_owned();
        let p_owned = path_str.to_owned();

        // Spawn debouncing worker thread
        thread::Builder::new()
            .name(format!("file-watcher-{wid}"))
            .spawn(move || {
                while rx.recv().is_ok() {
                    // Drain and debounce for 250ms of quiet time
                    loop {
                        match rx.recv_timeout(Duration::from_millis(250)) {
                            Ok(_) => continue,
                            Err(RecvTimeoutError::Timeout) => break,
                            Err(RecvTimeoutError::Disconnected) => return,
                        }
                    }
                    let payload = FileChangeEvent {
                        watch_id: wid.clone(),
                        path: p_owned.clone(),
                    };
                    let _ = app.emit("files://changed", payload);
                }
            })
            .map_err(|e| format!("Failed to spawn debouncer thread: {e}"))?;

        let mut map = self
            .watchers
            .lock()
            .map_err(|_| "File watcher state poisoned".to_string())?;

        map.insert(
            watch_id.to_owned(),
            WatcherEntry {
                _watcher: watcher,
                _tx: tx,
            },
        );

        Ok(())
    }

    /// Stop watching for `watch_id`. Dropping the watcher entry unregisters
    /// the OS watcher and terminates the debouncer thread.
    pub fn stop(&self, watch_id: &str) {
        if let Ok(mut map) = self.watchers.lock() {
            map.remove(watch_id);
        }
    }
}

impl Default for FileWatcherState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_ignored_path() {
        assert!(is_ignored_path(Path::new(".git/HEAD")));
        assert!(is_ignored_path(Path::new("node_modules/express/index.js")));
        assert!(is_ignored_path(Path::new("target/debug/app.exe")));
        assert!(is_ignored_path(Path::new("dist/bundle.js")));
        assert!(is_ignored_path(Path::new("build/output.css")));
        assert!(is_ignored_path(Path::new(".next/cache/foo")));
        assert!(is_ignored_path(Path::new("some/path/file.tmp")));
        assert!(is_ignored_path(Path::new("file.lock")));
        assert!(is_ignored_path(Path::new(".#draft.txt")));

        // Normal paths should not be ignored
        assert!(!is_ignored_path(Path::new("src/main.rs")));
        assert!(!is_ignored_path(Path::new("src/components/panel.jsx")));
        assert!(!is_ignored_path(Path::new("README.md")));
        assert!(!is_ignored_path(Path::new("my-target-folder/file.txt")));
    }
}
