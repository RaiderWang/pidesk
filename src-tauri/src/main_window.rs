//! Show / hide helpers for the main `PiDesk` window.
//!
//! On macOS, hiding the window also hides the Dock icon (the app keeps
//! living in the menu-bar tray), and showing it restores the icon. Without
//! this the Dock icon lingers but is unresponsive while the window is hidden.
//! On Windows/Linux the Dock concept doesn't exist, so these just show/hide.

use tauri::{AppHandle, Manager};

/// Bring the main window to the foreground (restoring the Dock icon on macOS).
pub fn show(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.set_dock_visibility(true);

    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

/// App-level run-event hook. On macOS, clicking the Dock icon (or
/// re-launching from Finder) emits `Reopen`; bring the main window back even
/// if it was hidden to the tray.
#[allow(clippy::needless_pass_by_value)] // signature fixed by `App::run`
pub fn on_run_event(app: &AppHandle, event: tauri::RunEvent) {
    #[cfg(target_os = "macos")]
    if matches!(event, tauri::RunEvent::Reopen { .. }) {
        show(app);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, event);
}

/// Hide the main window to the tray (removing the Dock icon on macOS).
pub fn hide(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }

    #[cfg(target_os = "macos")]
    let _ = app.set_dock_visibility(false);
}
