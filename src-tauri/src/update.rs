//! In-app updater: thin Tauri-command wrapper around `tauri-plugin-updater`.
//!
//! Flow: `check_update` stores the pending [`Update`] handle in
//! [`UpdateState`] and returns its metadata; `install_update` downloads and
//! installs it (progress is emitted as `update://progress`); `restart_app`
//! stops every omp child and relaunches the app.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::agent::AgentBridge;

/// Event carrying [`Progress`] while an update downloads.
const PROGRESS_EVENT: &str = "update://progress";
/// Longest error message (in chars) forwarded to the UI.
const MAX_ERROR_CHARS: usize = 300;

/// Updater state: the update found by the last successful `check_update`
/// plus a flag that serialises installs (and blocks checks mid-install).
#[derive(Default)]
pub struct UpdateState {
    pending: Mutex<Option<Update>>,
    installing: AtomicBool,
}

/// RAII claim on [`UpdateState::installing`]; releases the flag on drop so an
/// error or early return can never leave the updater wedged.
struct InstallGuard<'a>(&'a AtomicBool);

impl<'a> InstallGuard<'a> {
    /// `None` when another install already holds the flag.
    fn acquire(flag: &'a AtomicBool) -> Option<Self> {
        flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Self(flag))
    }
}

impl Drop for InstallGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

/// Update metadata sent to the frontend.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

impl UpdateInfo {
    fn from_update(update: &Update) -> Self {
        Self {
            version: update.version.clone(),
            current_version: update.current_version.clone(),
            notes: update.body.clone().filter(|b| !b.trim().is_empty()),
            date: update.date.map(|d| d.to_string()),
        }
    }
}

/// Download progress payload for `update://progress`.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
    percent: Option<u8>,
}

impl Progress {
    fn new(downloaded: u64, total: Option<u64>) -> Self {
        Self {
            downloaded,
            total,
            percent: percent(downloaded, total),
        }
    }
}

/// Whole-number download percentage, clamped to 100. `None` when the total
/// size is unknown or zero.
fn percent(downloaded: u64, total: Option<u64>) -> Option<u8> {
    let total = total.filter(|t| *t > 0)?;
    let pct = (u128::from(downloaded) * 100 / u128::from(total)).min(100);
    u8::try_from(pct).ok()
}

/// Collapse a (possibly multi-line, very long) error into a short single line.
fn describe_error(err: &impl std::fmt::Display) -> String {
    let text = err.to_string();
    let first = text.lines().next().unwrap_or("").trim();
    if first.chars().count() <= MAX_ERROR_CHARS {
        first.to_string()
    } else {
        first.chars().take(MAX_ERROR_CHARS).collect::<String>() + "…"
    }
}

fn lock_pending(state: &UpdateState) -> Result<std::sync::MutexGuard<'_, Option<Update>>, String> {
    state
        .pending
        .lock()
        .map_err(|_| "update state lock poisoned".to_string())
}

const BUSY_ERROR: &str = "update already in progress";

/// Ask the update endpoint whether a newer version exists.
#[tauri::command]
pub async fn check_update(
    app: AppHandle,
    state: State<'_, UpdateState>,
) -> Result<Option<UpdateInfo>, String> {
    // Never replace the pending `Update` while it is being installed.
    if state.installing.load(Ordering::Acquire) {
        return Err(BUSY_ERROR.to_string());
    }
    // On Windows the plugin launches the installer and then calls
    // `std::process::exit(0)`, which skips `restart_app` and every destructor.
    // `on_before_exit` runs right before that, so stop the omp children there.
    // The setter *replaces* the plugin's default hook, which runs
    // `cleanup_before_exit` (tray icons, resources, window hide), so repeat it.
    // The hook fires before the installer starts: if launching it fails the
    // sessions are already gone (rare; the UI then offers retry / manual).
    let exit_app = app.clone();
    let updater = app
        .updater_builder()
        .on_before_exit(move || {
            exit_app.state::<AgentBridge>().stop_all();
            exit_app.cleanup_before_exit();
        })
        .build()
        .map_err(|e| describe_error(&e))?;
    let found = updater.check().await.map_err(|e| describe_error(&e))?;
    let info = found.as_ref().map(UpdateInfo::from_update);
    *lock_pending(&state)? = found;
    Ok(info)
}

/// Download and install the update found by `check_update`.
#[tauri::command]
pub async fn install_update(app: AppHandle, state: State<'_, UpdateState>) -> Result<(), String> {
    let _guard = InstallGuard::acquire(&state.installing).ok_or_else(|| BUSY_ERROR.to_string())?;
    let update = lock_pending(&state)?
        .clone()
        .ok_or_else(|| "no pending update".to_string())?;

    let mut downloaded: u64 = 0;
    let progress_app = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress_app.emit(PROGRESS_EVENT, Progress::new(downloaded, total));
            },
            || {},
        )
        .await
        .map_err(|e| describe_error(&e))
}

/// Stop every omp child, then relaunch the app (applies an installed update).
///
/// Async so the blocking `kill + wait` runs off the main thread (sync
/// commands execute on it); `restart` from here goes through the normal
/// exit-request path.
#[tauri::command]
pub async fn restart_app(app: AppHandle) {
    let stopper = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        stopper.state::<AgentBridge>().stop_all();
    })
    .await;
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    // `on_before_exit` / `restart_app` need a live `AppHandle` (and, on
    // Windows, an installer launch), so they are not unit-testable here.
    #[test]
    fn install_guard_is_exclusive_and_releases_on_drop() {
        let flag = AtomicBool::new(false);
        let first = InstallGuard::acquire(&flag).expect("first claim");
        assert!(InstallGuard::acquire(&flag).is_none());
        assert!(flag.load(Ordering::Acquire));
        drop(first);
        assert!(!flag.load(Ordering::Acquire));
        assert!(InstallGuard::acquire(&flag).is_some());
    }

    #[test]
    fn percent_basic_and_clamped() {
        assert_eq!(percent(0, Some(200)), Some(0));
        assert_eq!(percent(50, Some(200)), Some(25));
        assert_eq!(percent(200, Some(200)), Some(100));
        assert_eq!(percent(500, Some(200)), Some(100));
    }

    #[test]
    fn percent_unknown_or_zero_total() {
        assert_eq!(percent(10, None), None);
        assert_eq!(percent(10, Some(0)), None);
    }

    #[test]
    fn percent_handles_huge_values_without_overflow() {
        assert_eq!(percent(u64::MAX / 2, Some(u64::MAX)), Some(49));
    }

    #[test]
    fn progress_carries_percent() {
        let p = Progress::new(25, Some(100));
        assert_eq!(p.percent, Some(25));
        assert_eq!(p.downloaded, 25);
        assert_eq!(Progress::new(5, None).percent, None);
    }

    #[test]
    fn describe_error_keeps_first_line_only() {
        assert_eq!(describe_error(&"boom\nstack line 2"), "boom");
    }

    #[test]
    fn describe_error_truncates_long_messages() {
        let long = "x".repeat(MAX_ERROR_CHARS + 50);
        let out = describe_error(&long);
        assert_eq!(out.chars().count(), MAX_ERROR_CHARS + 1);
        assert!(out.ends_with('…'));
    }

    #[test]
    fn update_info_serializes_camel_case() {
        let info = UpdateInfo {
            version: "1.2.3".into(),
            current_version: "1.2.2".into(),
            notes: Some("fixes".into()),
            date: None,
        };
        let v = serde_json::to_value(&info).expect("serialize");
        assert_eq!(v["currentVersion"], "1.2.2");
        assert_eq!(v["version"], "1.2.3");
        assert!(v["date"].is_null());
    }
}
