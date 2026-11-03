//! Open a file in the user-configured external editor, and pick the editor
//! executable via a native dialog.

mod launch;

use crate::agent::spawn::{ensure_gui_path, hide_console_window};
use std::process::{Command, Stdio};

/// Launch `editor` (a command line, see `launch::plan_launch`) on `path`.
/// The editor is detached: stdio is nulled and the child is reaped on a
/// background thread so it never becomes a zombie.
#[tauri::command]
pub fn open_with_editor(editor: String, path: String) -> Result<(), String> {
    ensure_gui_path();
    let path_var = std::env::var_os("PATH");
    let plan = launch::plan_launch(&editor, &path, path_var.as_deref())?;

    let mut cmd = Command::new(&plan.program);
    cmd.args(&plan.args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    hide_console_window(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to launch {}: {e}", plan.program.display()))?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

/// Native file picker for the editor executable.
///
/// Same pattern as `open_project`: callback-style `pick_file` bridged to
/// async via `mpsc` + `spawn_blocking`. Never use `blocking_pick_file`
/// (`AppKit` deadlocks off the main thread). The extension filter is Windows
/// only: macOS/Linux CLI entry points (`/usr/local/bin/code`) have none.
#[tauri::command]
pub async fn pick_editor_executable(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    let builder = app.dialog().file().set_title("Select External Editor");
    #[cfg(windows)]
    let builder = builder.add_filter("Executable", &["exe", "cmd", "bat"]);
    builder.pick_file(move |result| {
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
