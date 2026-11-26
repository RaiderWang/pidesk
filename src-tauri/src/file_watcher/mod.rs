//! Project directory watcher behind the file tree panel.
//!
//! One recursive `notify` watcher per `watch_id` (the project root). Events
//! are filtered ([`ignore`]), debounced with an upper bound ([`debounce`]) and
//! surfaced to the frontend as `"files://changed"` ([`FileChangeEvent`]).
//! [`FileWatcherState`] owns the watchers and keeps start/stop ordered.

mod debounce;
mod ignore;
mod state;
mod watcher;

use tauri::{AppHandle, Emitter as _, Manager as _};

pub use state::FileWatcherState;

const CHANGED_EVENT: &str = "files://changed";

/// Start watching a project directory for file changes.
///
/// `async` + `spawn_blocking`: registering a recursive watch on a big tree
/// must not run on the main thread. The ticket from [`FileWatcherState::begin`]
/// is taken *before* going off-thread so a `stop_file_watch` that overtakes
/// this call invalidates it.
#[tauri::command]
pub async fn start_file_watch(
    watch_id: String,
    path: String,
    app: AppHandle,
) -> Result<(), String> {
    let (ticket, retired) = app.state::<FileWatcherState>().begin(&watch_id);
    tauri::async_runtime::spawn_blocking(move || {
        // Dropping a watcher can block (macOS joins the FSEvents thread).
        drop(retired);
        let emitter = app.clone();
        let watcher = watcher::build(&path, &watch_id, move |event| {
            let _ = emitter.emit(CHANGED_EVENT, event);
        })?;
        // `false` means a newer start/stop won the race; the watcher is gone.
        app.state::<FileWatcherState>()
            .commit(&watch_id, ticket, watcher);
        Ok(())
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}

/// Stop watching a project directory for file changes.
#[tauri::command]
pub fn stop_file_watch(watch_id: String, state: tauri::State<'_, FileWatcherState>) {
    // The ticket is invalidated synchronously (ordering vs. a slow start);
    // only the possibly blocking drop of the OS watcher moves off this thread.
    if let Some(retired) = state.stop(&watch_id) {
        tauri::async_runtime::spawn_blocking(move || drop(retired));
    }
}
