//! Opening Markdown link targets: web URLs and local files.
//!
//! Chat content is untrusted (it may echo prompt-injected text), so a link
//! must never be able to *run* something. URLs are limited to a scheme
//! allow-list. Local files are only handed to the OS default handler when
//! their type is a known document/media format; everything else (scripts,
//! executables, unknown types, `.app` bundles) goes to the configured
//! external editor — which only receives the path as an argument — or is
//! revealed in the file manager.

use std::fs;
use std::path::{Path, PathBuf};

/// Types that are safe to hand to the OS default handler (double-click).
const OPEN_EXTENSIONS: &[&str] = &[
    "md", "markdown", "mdx", "txt", "log", "pdf", "json", "jsonc", "yaml", "yml", "toml", "xml",
    "csv", "tsv", "html", "htm", "rtf", "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg",
    "avif", "tif", "tiff", "mp3", "wav", "flac", "ogg", "m4a", "mp4", "mov", "webm", "mkv", "avi",
    "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp",
];

/// Directory extensions that are really launchable bundles (macOS) — never opened.
const BUNDLE_EXTENSIONS: &[&str] = &[
    "app",
    "bundle",
    "pkg",
    "framework",
    "plugin",
    "workflow",
    "kext",
    "xpc",
    "prefpane",
];

#[derive(Debug, PartialEq, Eq)]
enum Action {
    /// OS default handler (`open::that`).
    Open,
    /// External editor from Tweaks.
    Editor,
    /// Highlight in the file manager.
    Reveal,
}

/// Lower-cased extension, ignoring the trailing dots/spaces Windows strips
/// (`evil.exe.` runs as `evil.exe`, but `Path::extension` would say `""`).
fn extension_of(name: &str) -> Option<String> {
    let trimmed = name.trim_end_matches(['.', ' ']);
    let (stem, ext) = trimmed.rsplit_once('.')?;
    (!stem.is_empty() && !ext.is_empty()).then(|| ext.to_ascii_lowercase())
}

fn decide_action(file_name: &str, is_dir: bool, has_editor: bool) -> Action {
    let ext = extension_of(file_name);
    let ext = ext.as_deref();
    if is_dir {
        // The extension check applies to directories too (`Foo.app`).
        return if ext.is_some_and(|e| BUNDLE_EXTENSIONS.contains(&e)) {
            Action::Reveal
        } else {
            Action::Open
        };
    }
    if ext.is_some_and(|e| OPEN_EXTENSIONS.contains(&e)) {
        Action::Open
    } else if has_editor {
        Action::Editor
    } else {
        Action::Reveal
    }
}

/// Drop the `\\?\` verbatim prefix `fs::canonicalize` adds on Windows;
/// several default handlers cannot open such paths.
fn strip_verbatim(path: PathBuf) -> PathBuf {
    let s = path.to_string_lossy();
    let stripped = s
        .strip_prefix(r"\\?\UNC\")
        .map(|rest| format!(r"\\{rest}"))
        .or_else(|| s.strip_prefix(r"\\?\").map(str::to_owned));
    stripped.map_or(path, PathBuf::from)
}

fn is_allowed_url(url: &str) -> bool {
    let lower = url.trim_start().to_ascii_lowercase();
    ["http://", "https://", "mailto:"]
        .iter()
        .any(|scheme| lower.starts_with(scheme))
}

/// Open `url` in the system browser / mail client. Only `http`, `https`
/// and `mailto` are accepted.
pub fn open_url(url: &str) -> Result<(), String> {
    if !is_allowed_url(url) {
        return Err(format!(
            "Refusing to open URL with unsupported scheme: {url}"
        ));
    }
    open::that(url.trim()).map_err(|e| e.to_string())
}

/// Resolve `path` (symlinks included, so the decision is made on the real
/// target) and pick how to open it.
fn plan(path: &str, has_editor: bool) -> Result<(PathBuf, Action), String> {
    let real = fs::canonicalize(path).map_err(|e| format!("Cannot open {path}: {e}"))?;
    let real = strip_verbatim(real);
    let name = real
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let action = decide_action(&name, real.is_dir(), has_editor);
    Ok((real, action))
}

fn reveal(path: &Path) -> Result<(), String> {
    crate::files::reveal_in_explorer(path.to_string_lossy().into_owned())
}

/// Open a local file or folder linked from chat. `editor` is the external
/// editor command line from Tweaks, if any.
#[tauri::command]
pub fn open_link_path(path: String, editor: Option<String>) -> Result<(), String> {
    let editor = editor.as_deref().map(str::trim).filter(|e| !e.is_empty());
    let (real, action) = plan(&path, editor.is_some())?;
    match (action, editor) {
        (Action::Open, _) => open::that(&real).map_err(|e| format!("Failed to open {path}: {e}")),
        (Action::Editor, Some(editor)) => {
            // A mistyped editor command must not leave the click dead.
            crate::external_editor::open_with_editor(
                editor.to_owned(),
                real.to_string_lossy().into_owned(),
            )
            .or_else(|_| reveal(&real))
        }
        _ => reveal(&real),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extension_ignores_trailing_dots_and_spaces() {
        assert_eq!(extension_of("evil.exe."), Some("exe".into()));
        assert_eq!(extension_of("evil.EXE  "), Some("exe".into()));
        assert_eq!(extension_of("a.tar.GZ"), Some("gz".into()));
        assert_eq!(extension_of("Makefile"), None);
        assert_eq!(extension_of(".gitignore"), None);
        assert_eq!(extension_of("trailing."), None);
    }

    #[test]
    fn documents_open_with_default_app() {
        for n in [
            "a.md",
            "README.MD",
            "x.pdf",
            "p.PNG",
            "d.json",
            "路由配置说明.md",
        ] {
            assert_eq!(decide_action(n, false, false), Action::Open, "{n}");
            assert_eq!(decide_action(n, false, true), Action::Open, "{n}");
        }
    }

    #[test]
    fn code_and_executables_never_open_by_default() {
        for n in [
            "live.js", "build.sh", "x.ps1", "x.py", "evil.exe", "a.bat", "Makefile", "x.lnk",
        ] {
            assert_eq!(decide_action(n, false, true), Action::Editor, "{n}");
            assert_eq!(decide_action(n, false, false), Action::Reveal, "{n}");
        }
    }

    #[test]
    fn windows_trailing_dot_and_space_bypass_is_blocked() {
        for n in ["evil.exe.", "evil.exe ", "evil.js. ."] {
            assert_ne!(decide_action(n, false, true), Action::Open, "{n}");
            assert_ne!(decide_action(n, false, false), Action::Open, "{n}");
        }
        // A document with trailing dots is still recognised as a document.
        assert_eq!(decide_action("notes.md.", false, false), Action::Open);
    }

    #[test]
    fn directories_open_but_bundles_are_revealed() {
        assert_eq!(decide_action("src", true, false), Action::Open);
        assert_eq!(decide_action("v1.2", true, false), Action::Open);
        assert_eq!(decide_action("Foo.app", true, true), Action::Reveal);
        assert_eq!(decide_action("Foo.APP.", true, true), Action::Reveal);
    }

    #[test]
    fn strips_windows_verbatim_prefix() {
        assert_eq!(
            strip_verbatim(PathBuf::from(r"\\?\C:\a\b.md")),
            PathBuf::from(r"C:\a\b.md")
        );
        assert_eq!(
            strip_verbatim(PathBuf::from(r"\\?\UNC\srv\share\a.md")),
            PathBuf::from(r"\\srv\share\a.md")
        );
        assert_eq!(strip_verbatim(PathBuf::from("/a/b")), PathBuf::from("/a/b"));
    }

    #[test]
    fn url_scheme_allow_list() {
        assert!(is_allowed_url("https://example.com"));
        assert!(is_allowed_url("HTTP://example.com"));
        assert!(is_allowed_url("mailto:a@b.c"));
        for bad in [
            "javascript:alert(1)",
            "file:///C:/a.exe",
            r"C:\a.exe",
            "ms-msdt:x",
            "",
        ] {
            assert!(!is_allowed_url(bad), "{bad}");
            assert!(open_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn plan_resolves_existing_files_and_rejects_missing() {
        let dir = std::env::temp_dir().join(format!(
            "pidesk_link_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let doc = dir.join("a.md");
        let script = dir.join("b.sh");
        fs::write(&doc, "x").unwrap();
        fs::write(&script, "x").unwrap();

        let (real, action) = plan(doc.to_str().unwrap(), false).unwrap();
        assert_eq!(action, Action::Open);
        assert!(!real.to_string_lossy().starts_with(r"\\?\"));
        assert_eq!(
            plan(script.to_str().unwrap(), false).unwrap().1,
            Action::Reveal
        );
        assert_eq!(
            plan(script.to_str().unwrap(), true).unwrap().1,
            Action::Editor
        );
        assert_eq!(plan(dir.to_str().unwrap(), false).unwrap().1, Action::Open);
        assert!(plan(dir.join("missing.md").to_str().unwrap(), false).is_err());
        assert!(
            open_link_path(dir.join("missing.md").to_string_lossy().into_owned(), None).is_err()
        );

        let _ = fs::remove_dir_all(&dir);
    }
}
