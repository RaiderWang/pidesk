//! Save an exported session through the native "save as" dialog.
//!
//! Two formats, one command each. Both show the dialog and write the chosen
//! path themselves (see `export_common`), so the frontend never supplies a
//! destination:
//!
//! * Markdown — the frontend builds the text (`app/export-markdown.js`) and
//!   passes it in.
//! * HTML — omp writes the file itself (`export_html` RPC); the frontend
//!   passes that source path, which is moved to the chosen location.

use std::path::Path;

use tauri::AppHandle;

use crate::agent::workspace;
use crate::export_common::{
    complete_picked_path, has_extension, pick_save_path, sanitize_filename,
};

const MD_EXTS: [&str; 1] = ["md"];
const HTML_EXTS: [&str; 2] = ["html", "htm"];
/// Upper bound on the Markdown text crossing the IPC boundary.
const MAX_MARKDOWN_LEN: usize = 64 * 1024 * 1024;

/// `true` when both paths resolve to the same existing file.
fn is_same_file(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

/// The HTML source must be a regular `.html`/`.htm` file: the frontend may
/// only ask us to move something that looks like an omp export.
fn validate_html_source(src: &Path) -> Result<(), String> {
    if !has_extension(src, &HTML_EXTS) {
        return Err("export file is not an HTML file".to_owned());
    }
    if !src.is_file() {
        return Err(format!("export file not found: {}", src.display()));
    }
    Ok(())
}

/// Move omp's export to `dest`. Saving onto the source itself keeps it:
/// copying a file over itself and then deleting the "original" would destroy
/// the export.
fn move_html_export(src: &Path, dest: &Path) -> Result<(), String> {
    if is_same_file(src, dest) {
        return Ok(());
    }
    std::fs::copy(src, dest).map_err(|e| format!("copy error: {e}"))?;
    // Best effort: omp wrote the source into the project directory.
    let _ = std::fs::remove_file(src);
    Ok(())
}

/// Validate the Markdown payload before the user is asked for a location.
fn validate_markdown(content: &str) -> Result<(), String> {
    if content.trim().is_empty() {
        return Err("nothing to export".to_owned());
    }
    if content.len() > MAX_MARKDOWN_LEN {
        return Err("export too large".to_owned());
    }
    Ok(())
}

/// Prompt for a destination and write the Markdown transcript there.
///
/// Returns the saved path, or `None` when the user cancelled the dialog.
#[tauri::command]
pub async fn save_markdown_export(
    app: AppHandle,
    content: String,
    default_name: Option<String>,
    title: Option<String>,
) -> Result<Option<String>, String> {
    validate_markdown(&content)?;

    let name = sanitize_filename(
        default_name.as_deref().unwrap_or_default(),
        &MD_EXTS,
        "session.md",
    );
    let title = title.as_deref().unwrap_or("Export Session");
    let Some(dest) = pick_save_path(&app, title, "Markdown", &MD_EXTS, &name).await? else {
        return Ok(None);
    };
    let dest = complete_picked_path(dest, "md")?;

    tauri::async_runtime::spawn_blocking(move || {
        std::fs::write(&dest, content)
            .map(|()| dest.to_string_lossy().into_owned())
            .map_err(|e| format!("failed to write file: {e}"))
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
    .map(Some)
}

/// Relocate an HTML export that omp already wrote to a user-chosen location.
///
/// `source_path` is the path omp returned; a relative path is resolved
/// against the "no project" workspace. Returns the saved path, or `None`
/// when the user cancelled — in which case the generated file is removed so
/// it does not linger in the project directory.
#[tauri::command]
pub async fn save_html_export(
    app: AppHandle,
    source_path: String,
    default_name: Option<String>,
    title: Option<String>,
) -> Result<Option<String>, String> {
    // omp writes relative export names into its own cwd; for "no project"
    // sessions that is the dedicated workspace, not this process's CWD.
    let src =
        workspace::anchor_to_workspace(Path::new(&source_path), &workspace::default_cwd(&app));
    // `is_file` / `remove_file` are syscalls: keep them off the async worker.
    let src =
        tauri::async_runtime::spawn_blocking(move || validate_html_source(&src).map(|()| src))
            .await
            .map_err(|e| format!("join error: {e}"))??;

    let fallback_name = src.file_name().map_or_else(
        || "session-export.html".to_owned(),
        |n| n.to_string_lossy().into_owned(),
    );
    let name = sanitize_filename(
        default_name.as_deref().unwrap_or(&fallback_name),
        &HTML_EXTS,
        "session-export.html",
    );
    let title = title.as_deref().unwrap_or("Export Session");

    let outcome = match pick_save_path(&app, title, "HTML", &HTML_EXTS, &name).await {
        Ok(Some(picked)) => complete_picked_path(picked, "html").map(Some),
        other => other.map(|_| None),
    };
    // A cancel or failure must not leave omp's generated file behind.
    let dest = match outcome {
        Ok(Some(dest)) => dest,
        other => {
            let stale = src.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || std::fs::remove_file(stale)).await;
            return other.map(|_| None);
        }
    };

    tauri::async_runtime::spawn_blocking(move || {
        move_html_export(&src, &dest).map(|()| dest.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
    .map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// Unique scratch directory removed on drop.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "pidesk-session-export-{}-{tag}",
                std::process::id()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn file(&self, name: &str, body: &str) -> PathBuf {
            let p = self.0.join(name);
            std::fs::write(&p, body).unwrap();
            p
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn move_copies_then_removes_source() {
        let s = Scratch::new("move");
        let src = s.file("omp-session.html", "<html>x</html>");
        let dest = s.0.join("saved.html");
        move_html_export(&src, &dest).unwrap();
        assert_eq!(std::fs::read_to_string(&dest).unwrap(), "<html>x</html>");
        assert!(!src.exists());
    }

    #[test]
    fn move_onto_itself_keeps_the_file() {
        let s = Scratch::new("same");
        let src = s.file("omp-session.html", "<html>x</html>");
        move_html_export(&src, &src).unwrap();
        assert_eq!(std::fs::read_to_string(&src).unwrap(), "<html>x</html>");
    }

    #[test]
    fn move_into_missing_directory_fails_and_keeps_source() {
        let s = Scratch::new("missing");
        let src = s.file("omp-session.html", "x");
        let dest = s.0.join("nope").join("saved.html");
        let err = move_html_export(&src, &dest).unwrap_err();
        assert!(err.starts_with("copy error"));
        assert!(src.exists());
    }

    #[test]
    fn html_source_must_be_an_existing_html_file() {
        let s = Scratch::new("validate");
        let html = s.file("a.HTM", "x");
        let txt = s.file("a.txt", "x");
        assert!(validate_html_source(&html).is_ok());
        assert_eq!(
            validate_html_source(&txt).unwrap_err(),
            "export file is not an HTML file"
        );
        assert!(validate_html_source(&s.0.join("gone.html"))
            .unwrap_err()
            .starts_with("export file not found"));
        // A directory named like an HTML file is not a file.
        let dir = s.0.join("dir.html");
        std::fs::create_dir_all(&dir).unwrap();
        assert!(validate_html_source(&dir).is_err());
    }

    #[test]
    fn markdown_is_validated_before_any_dialog() {
        assert_eq!(validate_markdown("").unwrap_err(), "nothing to export");
        assert_eq!(validate_markdown(" \n\t").unwrap_err(), "nothing to export");
        assert!(validate_markdown("# User\n\nhi\n").is_ok());
        let huge = "a".repeat(MAX_MARKDOWN_LEN + 1);
        assert_eq!(validate_markdown(&huge).unwrap_err(), "export too large");
    }
}
