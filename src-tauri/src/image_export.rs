//! Save a PNG rendered by the frontend (e.g. a rasterised Mermaid diagram)
//! through the native "save as" dialog.
//!
//! The dialog is parented to the main window so it cannot sink behind it and
//! the user cannot re-enter the command meanwhile. Only the *suggested* file
//! name is sanitised; the path the user picks is written verbatim so the OS
//! overwrite confirmation stays authoritative.

use base64::Engine;
use tauri::{AppHandle, Manager};

const MAIN_WINDOW_LABEL: &str = "main";
/// Upper bound on the base64 payload crossing the IPC boundary.
const MAX_BASE64_LEN: usize = 64 * 1024 * 1024;
const PNG_MAGIC: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
const FALLBACK_NAME: &str = "image.png";

/// Drop a leading `data:...,` URL prefix; raw base64 passes through.
fn strip_data_url_prefix(s: &str) -> &str {
    s.strip_prefix("data:")
        .and_then(|rest| rest.split_once(','))
        .map_or(s, |(_, payload)| payload)
}

/// Suggested name for the dialog: last path component, filesystem-hostile
/// characters replaced, `.png` appended when missing.
fn sanitize_filename(name: &str) -> String {
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
        return FALLBACK_NAME.to_owned();
    }
    let has_png_ext = trimmed
        .rsplit_once('.')
        .is_some_and(|(stem, ext)| !stem.is_empty() && ext.eq_ignore_ascii_case("png"));
    if has_png_ext {
        trimmed.to_owned()
    } else {
        format!("{trimmed}.png")
    }
}

/// Validate and decode the payload: bounded size, valid base64, non-empty,
/// PNG signature. Guards against writing a corrupt file on a frontend bug.
fn decode_png(base64_data: &str) -> Result<Vec<u8>, String> {
    if base64_data.len() > MAX_BASE64_LEN {
        return Err("image too large".to_owned());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(strip_data_url_prefix(base64_data).trim())
        .map_err(|e| format!("invalid base64: {e}"))?;
    if bytes.is_empty() {
        return Err("empty image".to_owned());
    }
    if !bytes.starts_with(PNG_MAGIC) {
        return Err("not a PNG image".to_owned());
    }
    Ok(bytes)
}

/// Prompt for a destination and write the PNG there.
///
/// Returns the saved path, or `None` when the user cancelled the dialog.
#[tauri::command]
pub async fn save_image_to_disk(
    app: AppHandle,
    base64_data: String,
    default_filename: Option<String>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    // Validate before bothering the user with a dialog; decoding a large
    // payload stays off the async worker.
    let bytes = tauri::async_runtime::spawn_blocking(move || decode_png(&base64_data))
        .await
        .map_err(|e| format!("join error: {e}"))??;

    let name = sanitize_filename(default_filename.as_deref().unwrap_or(FALLBACK_NAME));
    let mut builder = app
        .dialog()
        .file()
        .set_title("Save Image")
        .add_filter("PNG Image", &["png"])
        .set_file_name(&name);
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
    let Some(picked) = picked else {
        return Ok(None);
    };
    let dest = picked
        .into_path()
        .map_err(|e| format!("invalid path: {e}"))?;

    let written = tauri::async_runtime::spawn_blocking(move || {
        std::fs::write(&dest, bytes)
            .map(|()| dest.to_string_lossy().into_owned())
            .map_err(|e| format!("failed to write file: {e}"))
    })
    .await
    .map_err(|e| format!("join error: {e}"))??;
    Ok(Some(written))
}

#[cfg(test)]
mod tests {
    use super::*;

    // 1x1 transparent PNG.
    const TINY_PNG_B64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==";

    #[test]
    fn strips_data_url_prefix_only_when_present() {
        assert_eq!(strip_data_url_prefix("data:image/png;base64,QUJD"), "QUJD");
        assert_eq!(strip_data_url_prefix("QUJD"), "QUJD");
        assert_eq!(strip_data_url_prefix("data:no-comma"), "data:no-comma");
    }

    #[test]
    fn sanitize_keeps_good_names_and_appends_png() {
        assert_eq!(sanitize_filename("diagram.png"), "diagram.png");
        assert_eq!(sanitize_filename("Diagram.PNG"), "Diagram.PNG");
        assert_eq!(sanitize_filename("diagram"), "diagram.png");
        assert_eq!(sanitize_filename("diagram.jpg"), "diagram.jpg.png");
    }

    #[test]
    fn sanitize_strips_paths_and_hostile_chars() {
        assert_eq!(sanitize_filename("../../etc/passwd"), "passwd.png");
        assert_eq!(sanitize_filename("C:\\evil\\a.png"), "a.png");
        assert_eq!(sanitize_filename("a:b*c?.png"), "a_b_c_.png");
        assert_eq!(sanitize_filename("  ..  "), FALLBACK_NAME);
        assert_eq!(sanitize_filename(""), FALLBACK_NAME);
        // Leading dots are trimmed (no hidden files), so ".png" is a bare stem.
        assert_eq!(sanitize_filename(".png"), "png.png");
    }

    #[test]
    fn decodes_valid_png_with_or_without_prefix() {
        let raw = decode_png(TINY_PNG_B64).unwrap();
        assert!(raw.starts_with(PNG_MAGIC));
        let prefixed = format!("data:image/png;base64,{TINY_PNG_B64}");
        assert_eq!(decode_png(&prefixed).unwrap(), raw);
    }

    #[test]
    fn rejects_bad_payloads() {
        assert!(decode_png("!!!not base64!!!")
            .unwrap_err()
            .contains("invalid base64"));
        assert_eq!(decode_png("").unwrap_err(), "empty image");
        // "hello" is valid base64 of non-PNG bytes.
        assert_eq!(decode_png("aGVsbG8=").unwrap_err(), "not a PNG image");
        let huge = "A".repeat(MAX_BASE64_LEN + 1);
        assert_eq!(decode_png(&huge).unwrap_err(), "image too large");
    }
}
