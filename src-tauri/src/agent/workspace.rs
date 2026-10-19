//! Default working directory for "no project" sessions.
//!
//! omp always opens a folder as the session workspace, and project files in
//! that folder influence the agent. "No project" sessions therefore get a
//! dedicated, app-private directory (`<app local data>/workspace`) that
//! normally stays empty and is writable on every platform. The running
//! executable's directory is kept only as a fallback and so that sessions
//! saved by older builds can still be recognised as project-less.

use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Sub-directory of the app local data dir used as the no-project workspace.
const WORKSPACE_DIR: &str = "workspace";

/// Working directory for "no project" sessions.
///
/// Creates `<app local data>/workspace` if needed; on any failure falls back
/// to the executable's directory so a session can still start.
pub fn default_cwd(app: &AppHandle) -> PathBuf {
    resolve(workspace_dir(app), legacy_exe_dir)
}

/// Resolve a path omp reported relative to its working directory when that
/// directory was the "no project" workspace. Absolute paths pass through.
pub fn anchor_to_workspace(path: &Path, workspace: &Path) -> PathBuf {
    if path.is_relative() {
        workspace.join(path)
    } else {
        path.to_path_buf()
    }
}

/// Directory used by builds that predate the dedicated workspace: the
/// directory containing the running executable.
pub fn legacy_exe_dir() -> PathBuf {
    exe_dir(std::env::current_exe().ok())
}

/// The intended workspace path, if the platform exposes an app local data
/// directory. Pure path computation: never touches the filesystem, so it is
/// safe for read-only queries (e.g. classifying saved sessions).
pub fn workspace_dir(app: &AppHandle) -> Option<PathBuf> {
    match app.path().app_local_data_dir() {
        Ok(base) => Some(base.join(WORKSPACE_DIR)),
        Err(e) => {
            eprintln!("[pidesk] app local data dir unavailable: {e}");
            None
        }
    }
}

/// Ensure `primary` exists and return it, otherwise return the (lazily
/// computed) `legacy` directory.
fn resolve(primary: Option<PathBuf>, legacy: impl FnOnce() -> PathBuf) -> PathBuf {
    let Some(dir) = primary else {
        return legacy();
    };
    match ensure_dir(&dir) {
        Ok(()) => dir,
        Err(e) => {
            let fallback = legacy();
            eprintln!(
                "[pidesk] cannot create workspace {}: {e}; falling back to {}",
                dir.display(),
                fallback.display()
            );
            fallback
        }
    }
}

fn ensure_dir(dir: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    if dir.is_dir() {
        Ok(())
    } else {
        Err(std::io::Error::other("not a directory"))
    }
}

/// Derive the containing directory of an executable path, falling back to
/// `.` when the executable's own path can't be resolved.
fn exe_dir(exe_path: Option<PathBuf>) -> PathBuf {
    exe_path
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("."))
}

// ── tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::{anchor_to_workspace, exe_dir, resolve};
    use std::cell::Cell;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_base(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos());
        let dir = std::env::temp_dir().join(format!("pidesk_ws_{name}_{nanos}"));
        std::fs::create_dir_all(&dir).expect("temp base");
        dir
    }

    #[test]
    fn exe_dir_uses_parent_of_executable() {
        let exe = PathBuf::from("/opt/pidesk/pidesk");
        assert_eq!(exe_dir(Some(exe)), PathBuf::from("/opt/pidesk"));
    }

    #[test]
    fn exe_dir_falls_back_to_dot_when_unresolvable() {
        assert_eq!(exe_dir(None), PathBuf::from("."));
    }

    #[test]
    fn resolve_creates_and_returns_primary() {
        let base = temp_base("primary");
        let target = base.join("a").join("workspace");
        let calls = Cell::new(0);
        let got = resolve(Some(target.clone()), || {
            calls.set(calls.get() + 1);
            PathBuf::from("/legacy")
        });
        assert_eq!(got, target);
        assert!(target.is_dir());
        assert_eq!(calls.get(), 0, "fallback must stay lazy on success");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn resolve_falls_back_when_creation_fails() {
        let base = temp_base("blocked");
        let blocker = base.join("file");
        std::fs::write(&blocker, b"x").expect("blocker file");
        // A path nested under a regular file can never be created.
        let got = resolve(Some(blocker.join("workspace")), || PathBuf::from("/legacy"));
        assert_eq!(got, PathBuf::from("/legacy"));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn resolve_falls_back_without_primary() {
        assert_eq!(
            resolve(None, || PathBuf::from("/legacy")),
            PathBuf::from("/legacy")
        );
    }

    #[test]
    fn anchor_joins_relative_paths_to_workspace() {
        let ws = PathBuf::from("/data/workspace");
        assert_eq!(
            anchor_to_workspace(Path::new("export.html"), &ws),
            ws.join("export.html")
        );
    }

    #[test]
    fn anchor_keeps_absolute_paths() {
        let ws = PathBuf::from("/data/workspace");
        let abs = std::env::temp_dir().join("export.html");
        assert_eq!(anchor_to_workspace(&abs, &ws), abs);
    }
}
