//! Shared pieces of the "save a generated file" commands
//! (`image_export`, `session_export`).
//!
//! Every such command shows the native save dialog and writes the chosen
//! path itself, so the frontend never supplies a destination. The dialog is
//! parented to the main window so it cannot sink behind it and the user
//! cannot re-enter the command meanwhile. Only the *suggested* file name is
//! sanitised; the path the user picks is written verbatim so the OS overwrite
//! confirmation stays authoritative.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

const MAIN_WINDOW_LABEL: &str = "main";

/// Device names Windows refuses as file names (with or without extension).
const WINDOWS_RESERVED: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// `true` when the file name (ignoring trailing dots/spaces, which Windows
/// drops) ends in one of `exts`, compared case-insensitively.
pub fn has_extension(path: &Path, exts: &[&str]) -> bool {
    path.file_name()
        .map(|n| n.to_string_lossy())
        .and_then(|n| {
            n.trim_end_matches(|c: char| c == '.' || c.is_whitespace())
                .rsplit_once('.')
                .filter(|(stem, _)| !stem.is_empty())
                .map(|(_, ext)| exts.iter().any(|e| ext.eq_ignore_ascii_case(e)))
        })
        .unwrap_or(false)
}

/// Suggested name for the dialog: last path component, filesystem-hostile
/// characters replaced, Windows device names defused, and `exts[0]` appended
/// when the name does not already end in one of `exts`.
pub fn sanitize_filename(name: &str, exts: &[&str], fallback: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or_default();
    let cleaned: String = base
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches(|c: char| c == '.' || c.is_whitespace());
    if trimmed.is_empty() {
        return fallback.to_owned();
    }
    let stem = trimmed.split('.').next().unwrap_or_default();
    let mut out = if WINDOWS_RESERVED
        .iter()
        .any(|r| stem.trim_end().eq_ignore_ascii_case(r))
    {
        format!("_{trimmed}")
    } else {
        trimmed.to_owned()
    };
    if !has_extension(Path::new(&out), exts) {
        if let Some(ext) = exts.first() {
            out = format!("{out}.{ext}");
        }
    }
    out
}

/// Give a dialog result without any extension (GTK does not append one) the
/// default extension. A user-chosen extension, even an unexpected one, wins.
///
/// The dialog confirmed an overwrite of the name it returned, not of the
/// name we derive from it, so when the extended path already exists we refuse
/// instead of silently replacing a file the user never agreed to overwrite.
pub fn complete_picked_path(path: PathBuf, default_ext: &str) -> Result<PathBuf, String> {
    if path.extension().is_some() {
        return Ok(path);
    }
    let dest = path.with_extension(default_ext);
    if dest.exists() {
        return Err(format!(
            "refusing to overwrite existing file: {}",
            dest.display()
        ));
    }
    Ok(dest)
}

/// Show a single-filter "save as" dialog and wait for the result.
///
/// `None` means the user cancelled. Returns the path exactly as the dialog
/// produced it.
pub async fn pick_save_path(
    app: &AppHandle,
    title: &str,
    filter_name: &str,
    exts: &[&str],
    default_name: &str,
) -> Result<Option<PathBuf>, String> {
    use tauri_plugin_dialog::DialogExt;

    let mut builder = app
        .dialog()
        .file()
        .set_title(title)
        .add_filter(filter_name, exts)
        .set_file_name(default_name);
    if let Some(win) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        builder = builder.set_parent(&win);
    }

    let (tx, rx) = std::sync::mpsc::channel();
    builder.save_file(move |result| {
        let _ = tx.send(result);
    });
    let picked = tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await
        .map_err(|e| format!("join error: {e}"))?
        .map_err(|e| format!("channel error: {e}"))?;
    picked
        .map(|p| p.into_path().map_err(|e| format!("invalid path: {e}")))
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn has_extension_is_case_insensitive_and_ignores_trailing_dots() {
        assert!(has_extension(Path::new("a.HTML"), &["html", "htm"]));
        assert!(has_extension(Path::new("dir/a.htm"), &["html", "htm"]));
        assert!(has_extension(Path::new("a.html. "), &["html"]));
        assert!(!has_extension(Path::new("a.txt"), &["html"]));
        assert!(!has_extension(Path::new("html"), &["html"]));
        assert!(!has_extension(Path::new(".html"), &["html"]));
        assert!(!has_extension(Path::new(""), &["html"]));
    }

    #[test]
    fn sanitize_keeps_good_names_and_appends_extension() {
        assert_eq!(sanitize_filename("a.md", &["md"], "x.md"), "a.md");
        assert_eq!(sanitize_filename("A.MD", &["md"], "x.md"), "A.MD");
        assert_eq!(sanitize_filename("notes", &["md"], "x.md"), "notes.md");
        assert_eq!(sanitize_filename("a.txt", &["md"], "x.md"), "a.txt.md");
        assert_eq!(
            sanitize_filename("a.htm", &["html", "htm"], "x.html"),
            "a.htm"
        );
        assert_eq!(sanitize_filename("a", &["html", "htm"], "x.html"), "a.html");
    }

    #[test]
    fn sanitize_strips_paths_and_hostile_chars() {
        assert_eq!(
            sanitize_filename("../../etc/passwd", &["md"], "x.md"),
            "passwd.md"
        );
        assert_eq!(sanitize_filename("C:\\evil\\a.md", &["md"], "x.md"), "a.md");
        assert_eq!(sanitize_filename("a:b*c?.md", &["md"], "x.md"), "a_b_c_.md");
        assert_eq!(sanitize_filename("  ..  ", &["md"], "x.md"), "x.md");
        assert_eq!(sanitize_filename("", &["md"], "x.md"), "x.md");
        // Leading dots are trimmed (no hidden files), so ".md" is a bare stem.
        assert_eq!(sanitize_filename(".md", &["md"], "x.md"), "md.md");
    }

    #[test]
    fn sanitize_defuses_windows_device_names() {
        assert_eq!(sanitize_filename("CON", &["md"], "x.md"), "_CON.md");
        assert_eq!(sanitize_filename("nul.txt", &["md"], "x.md"), "_nul.txt.md");
        assert_eq!(sanitize_filename("Com1.md", &["md"], "x.md"), "_Com1.md");
        assert_eq!(sanitize_filename("console", &["md"], "x.md"), "console.md");
    }

    #[test]
    fn default_extension_only_when_missing() {
        assert_eq!(
            complete_picked_path(PathBuf::from("out/notes"), "md").unwrap(),
            PathBuf::from("out/notes.md")
        );
        assert_eq!(
            complete_picked_path(PathBuf::from("out/notes.txt"), "md").unwrap(),
            PathBuf::from("out/notes.txt")
        );
        assert_eq!(
            complete_picked_path(PathBuf::from("out/a.report"), "html").unwrap(),
            PathBuf::from("out/a.report")
        );
    }

    #[test]
    fn appended_extension_never_overwrites_an_existing_file() {
        let dir = std::env::temp_dir().join(format!("pidesk-complete-path-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("notes.md"), "keep me").unwrap();

        let err = complete_picked_path(dir.join("notes"), "md").unwrap_err();
        assert!(err.starts_with("refusing to overwrite"));
        // An explicit name is the dialog's business (it asked the user already).
        assert_eq!(
            complete_picked_path(dir.join("notes.md"), "md").unwrap(),
            dir.join("notes.md")
        );
        assert_eq!(
            complete_picked_path(dir.join("fresh"), "md").unwrap(),
            dir.join("fresh.md")
        );
        assert_eq!(
            std::fs::read_to_string(dir.join("notes.md")).unwrap(),
            "keep me"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
