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
    resolve(workspace_dir(app), legacy_exe_dir())
}

/// Directory used by builds that predate the dedicated workspace: the
/// directory containing the running executable.
pub fn legacy_exe_dir() -> PathBuf {
    exe_dir(std::env::current_exe().ok())
}

/// The intended (not yet created) workspace path, if the platform exposes
/// an app local data directory.
fn workspace_dir(app: &AppHandle) -> Option<PathBuf> {
    match app.path().app_local_data_dir() {
        Ok(base) => Some(base.join(WORKSPACE_DIR)),
        Err(e) => {
            eprintln!("[pidesk] app local data dir unavailable: {e}");
            None
        }
    }
}

/// Pure(ish) helper: ensure `primary` exists and return it, otherwise
/// return `legacy`.
fn resolve(primary: Option<PathBuf>, legacy: PathBuf) -> PathBuf {
    let Some(dir) = primary else {
        return legacy;
    };
    match ensure_dir(&dir) {
        Ok(()) => dir,
        Err(e) => {
            eprintln!(
                "[pidesk] cannot create workspace {}: {e}; falling back to {}",
                dir.display(),
                legacy.display()
            );
            legacy
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
    use super::{exe_dir, resolve};
    use std::path::PathBuf;
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
        let legacy = PathBuf::from("/legacy");
        assert_eq!(resolve(Some(target.clone()), legacy), target);
        assert!(target.is_dir());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn resolve_falls_back_when_creation_fails() {
        let base = temp_base("blocked");
        let blocker = base.join("file");
        std::fs::write(&blocker, b"x").expect("blocker file");
        let legacy = PathBuf::from("/legacy");
        // A path nested under a regular file can never be created.
        let got = resolve(Some(blocker.join("workspace")), legacy.clone());
        assert_eq!(got, legacy);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn resolve_falls_back_without_primary() {
        let legacy = PathBuf::from("/legacy");
        assert_eq!(resolve(None, legacy.clone()), legacy);
    }
}
