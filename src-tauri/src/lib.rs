// Tauri's `#[command]` macro requires arguments by value (owned `String`,
// `State<'_, _>`, `AppHandle`) for deserialization from the frontend
// invoke payload. Suppress the related pedantic lints at module scope so
// command signatures stay idiomatic for the Tauri API.
#![allow(clippy::needless_pass_by_value)]

mod agent;
mod git;
mod git_watcher;
mod models_config;
mod quick_bar;
mod saved_sessions;
mod shortcut;
mod tray;

use agent::AgentBridge;
use git_watcher::GitWatcherState;
use tauri::{Manager, State};

/// Write a JSON command to a specific session's omp stdin.
#[tauri::command]
fn send_command(
    session_id: String,
    json: String,
    bridge: State<'_, AgentBridge>,
) -> Result<(), String> {
    bridge.send(&session_id, &json)
}

/// Start an omp process for a new tab session.
/// `cwd`: absolute path to the project folder (empty string = omp's default).
/// `resume`: optional file path or session ID to resume an existing session.
#[tauri::command]
fn start_session(
    session_id: String,
    cwd: String,
    resume: Option<String>,
    bridge: State<'_, AgentBridge>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let cwd_opt = if cwd.is_empty() {
        None
    } else {
        Some(cwd.as_str())
    };
    bridge.start_session(session_id, cwd_opt, resume.as_deref(), app)
}

/// List saved sessions from disk (~/.omp/agent/sessions).
#[tauri::command]
fn list_saved_sessions(
    cwd: Option<String>,
    app: tauri::AppHandle,
) -> Vec<saved_sessions::SavedSession> {
    saved_sessions::scan_saved_sessions(&app, cwd.as_deref())
}

/// Kill the omp process for a tab session.
#[tauri::command]
fn stop_session(session_id: String, bridge: State<'_, AgentBridge>) {
    bridge.stop_session(&session_id);
}

/// Query a session's last error. Returns `None` if the session is
/// running (or has never been started under this id), `Some(reason)`
/// if its last `start_session` attempt failed.
///
/// This replaces a previous timing-fragile pattern that emitted a
/// delayed `agent://exit/{id}` after a fixed sleep, hoping the
/// frontend listener was attached in time. The frontend can now query
/// this synchronously on activation and surface the real reason.
#[tauri::command]
fn session_status(session_id: String, bridge: State<'_, AgentBridge>) -> Option<String> {
    bridge.last_error(&session_id)
}

/// Native folder picker — returns the chosen path or null.
///
/// On macOS, `AppKit` requires all `NSOpenPanel` calls to originate from
/// the main thread. `blocking_pick_folder` invokes the dialog directly
/// on the calling command-handler thread — an `AppKit` threading-model
/// violation that causes an indefinite hang (spinning beach ball + high CPU).
///
/// The callback-based `pick_folder` dispatches the dialog to the main
/// thread correctly. We bridge the callback to our async context with
/// an `mpsc` channel + `spawn_blocking` so the async executor is never
/// stalled.
#[tauri::command]
async fn open_project(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    // Use into_path() rather than to_string() so we get a real PathBuf
    // and convert through to_string_lossy(). Avoids platform-specific
    // FilePath::to_string formatting (URL encoding, UNC prefix quirks)
    // that could diverge from what std::fs and the rest of the app
    // expect downstream.
    app.dialog()
        .file()
        .set_title("Open Project Folder")
        .pick_folder(move |result| {
            let _ = tx.send(result);
        });
    let picked = tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await
        .map_err(|e| format!("join error: {e}"))?
        .map_err(|e| format!("channel error: {e}"))?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|e| format!("invalid picked path: {e}"))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Start watching `.git/HEAD` for a session's project path.
///
/// Returns the short branch name at call time, or `None` when `path` is
/// not inside a git repo or HEAD is detached.  The watcher fires
/// `"git://branch/{session_id}"` events on every subsequent HEAD change.
/// Watcher errors are silently ignored — the branch chip simply won't
/// update live.
#[tauri::command]
fn start_git_watch(
    session_id: String,
    path: String,
    watcher: State<'_, GitWatcherState>,
    app: tauri::AppHandle,
) -> Option<String> {
    let p = std::path::Path::new(&path);
    let (branch, head) = git::probe(p);
    if let Some(h) = head {
        let _ = watcher.start(&session_id, p, h, app);
    }
    branch
}

/// Stop the HEAD watcher for a session.  No-op when none is active.
#[tauri::command]
fn stop_git_watch(session_id: String, watcher: State<'_, GitWatcherState>) {
    watcher.stop(&session_id);
}

/// Open a URL in the system default browser.
/// Uses the `open` crate (`ShellExecute` on Windows, `xdg-open` on Linux, `open` on macOS).
/// `window.open(url, "_blank")` creates a Tauri webview instead — this is the correct
/// path for OAuth flows and any external URL that must open in the user's real browser.
#[tauri::command]
fn open_url_external(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| e.to_string())
}

/// Copy an omp session file to a new branched sub-directory so a forked tab
/// can start from the same history without sharing a file with the original.
///
/// `source_path` must be the full path to an existing `.jsonl` session file.
/// Returns the full path to the new copy, ready to pass as `resume` to
/// `start_session`.
#[tauri::command]
fn copy_session_file(source_path: String, max_messages: Option<usize>) -> Result<String, String> {
    saved_sessions::copy_session_file(&source_path, max_messages)
}

/// Permanently delete a saved session from disk.
///
/// `path` must be the full path to the session's `.jsonl` file (as returned
/// by `list_saved_sessions`). The entire parent directory (the per-session
/// sub-folder) is removed. A safety check ensures the directory is inside
/// the sessions root before deletion proceeds.
#[tauri::command]
fn delete_saved_session(path: String, app: tauri::AppHandle) -> Result<(), String> {
    saved_sessions::delete_saved_session(&path, &app)
}

/// Relocate an HTML export file that omp wrote to a user-chosen location
/// via the native save dialog.
///
/// `source_path` is the absolute path to the HTML file omp already wrote.
/// Returns `true` when the file was copied, `false` when the user
/// cancelled the dialog.  Same main-thread dispatch pattern as
/// `open_project` — see that doc-comment for the threading rationale.
#[tauri::command]
async fn save_html_export(source_path: String, app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;

    let src = std::path::Path::new(&source_path);
    if !src.exists() {
        return Err(format!("export file not found: {source_path}"));
    }
    let default_name = src.file_name().map_or_else(
        || "session-export.html".to_owned(),
        |n| n.to_string_lossy().into_owned(),
    );

    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title("Export Session")
        .add_filter("HTML", &["html"])
        .set_file_name(&default_name)
        .save_file(move |result| {
            let _ = tx.send(result);
        });
    let picked = tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await
        .map_err(|e| format!("join error: {e}"))?
        .map_err(|e| format!("channel error: {e}"))?;
    let Some(picked) = picked else {
        return Ok(false);
    };
    let dest = picked
        .into_path()
        .map_err(|e| format!("invalid path: {e}"))?;
    std::fs::copy(src, &dest).map_err(|e| format!("copy error: {e}"))?;
    // Clean up the original file omp wrote in the project directory.
    let _ = std::fs::remove_file(src);
    Ok(true)
}

/// Get the application version from package metadata.
#[tauri::command]
fn get_app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Run the Tauri application. Panics if the runtime fails to initialise.
///
/// # Panics
///
/// Panics if `tauri::Builder::run` returns an error (e.g. the webview
/// runtime cannot be initialised). This is a fatal startup condition;
/// there is no meaningful recovery from inside `main`.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        let _ = quick_bar::toggle_quick_bar(app.clone());
                    }
                })
                .build(),
        )
        .manage(AgentBridge::new())
        .manage(GitWatcherState::new())
        .invoke_handler(tauri::generate_handler![
            send_command,
            start_session,
            stop_session,
            session_status,
            open_project,
            start_git_watch,
            stop_git_watch,
            open_url_external,
            list_saved_sessions,
            models_config::read_models_config,
            models_config::write_models_config,
            models_config::open_models_file,
            models_config::open_models_folder,
            copy_session_file,
            delete_saved_session,
            save_html_export,
            get_app_version,
            quick_bar::toggle_quick_bar,
            quick_bar::hide_quick_bar,
            quick_bar::set_quick_bar_height,
            tray::set_tray_activity,
            shortcut::get_quick_bar_shortcut,
            shortcut::set_quick_bar_shortcut,
        ])
        .setup(|app| {
            // Intercept close on the main window: hide instead of destroy.
            // This keeps the webview (and quickbar-host.js relay) alive so
            // the Quick Bar and tray can still function. Users quit via
            // tray menu → Quit, which calls app.exit(0).
            if let Some(win) = app.get_webview_window("main") {
                let win_hide = win.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win_hide.hide();
                    }
                });

                #[cfg(debug_assertions)]
                win.open_devtools();
            }

            // System tray — left-click toggles Quick Bar, right-click shows menu.
            tray::build(app.handle()).unwrap_or_else(|e| {
                eprintln!("[pidesk] tray build failed: {e}");
            });

            // Global shortcut for Quick Bar (persisted or default).
            shortcut::register_initial(app.handle()).unwrap_or_else(|e| {
                eprintln!("[pidesk] shortcut registration failed: {e}");
            });

            // Pre-create the Quick Bar window (hidden) so its WebView2
            // controller has the rest of startup to finish attaching —
            // see `quick_bar::warm_up` doc comment for why this avoids a
            // no-op first hotkey/tray click.
            quick_bar::warm_up(app.handle()).unwrap_or_else(|e| {
                eprintln!("[pidesk] quick-bar warm-up failed: {e}");
            });

            // Start the default session (no cwd = omp's working directory).
            // The frontend activates this session on load via OMP_BRIDGE.activateSession("default").
            //
            // Failure handling: the bridge caches the spawn error keyed
            // by session_id. The frontend's activateSession queries
            // session_status on attach and surfaces the cached reason
            // if any — no event timing race, no delayed emit thread.
            let bridge = app.state::<AgentBridge>();
            if let Err(e) = bridge.start_session("default".into(), None, None, app.handle().clone())
            {
                eprintln!("[pidesk] failed to start default session: {e}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
