use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Information about a persisted session on disk.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SavedSession {
    pub id: String,
    pub title: String,
    pub timestamp: String,
    pub updated_at: Option<String>,
    pub cwd: String,
    pub project_name: String,
    pub path: String,
    pub message_count: usize,
    pub preview: Option<String>,
}

/// Locate the directory where omp persists sessions (`~/.omp/agent/sessions`).
fn sessions_root_dir(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("PI_CODING_AGENT_DIR") {
        if !dir.is_empty() {
            return Some(PathBuf::from(dir).join("sessions"));
        }
    }
    app.path()
        .home_dir()
        .ok()
        .map(|home| home.join(".omp").join("agent").join("sessions"))
}

/// Extract text content from a message content block array.
fn extract_text_from_content(content: &serde_json::Value) -> Option<String> {
    if let Some(arr) = content.as_array() {
        for block in arr {
            if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                if let Some(text) = block.get("text").and_then(|s| s.as_str()) {
                    let trimmed = text.trim();
                    if !trimmed.is_empty() {
                        return Some(trimmed.to_string());
                    }
                }
            }
        }
    } else if let Some(text) = content.as_str() {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    None
}

/// Parse a single `.jsonl` session file and extract metadata.
fn parse_session_file(path: &Path) -> Option<SavedSession> {
    let file = File::open(path).ok()?;
    let reader = BufReader::new(file);

    let mut session_id = String::new();
    let mut explicit_title = String::new();
    let mut fallback_title = String::new();
    let mut timestamp = String::new();
    let mut updated_at: Option<String> = None;
    let mut cwd = String::new();
    let mut message_count = 0usize;
    let mut last_preview: Option<String> = None;

    for line_res in reader.lines() {
        let Ok(line) = line_res else { continue };
        if line.is_empty() {
            continue;
        }

        let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };

        let event_type = val.get("type").and_then(|t| t.as_str()).unwrap_or("");

        match event_type {
            "title" => {
                if let Some(t) = val.get("title").and_then(|s| s.as_str()) {
                    let trimmed = t.trim();
                    if !trimmed.is_empty() {
                        explicit_title = trimmed.to_string();
                    }
                }
                if let Some(u) = val.get("updatedAt").and_then(|s| s.as_str()) {
                    updated_at = Some(u.to_string());
                }
            }
            "session" => {
                if let Some(id) = val.get("id").and_then(|s| s.as_str()) {
                    session_id = id.to_string();
                }
                if let Some(ts) = val.get("timestamp").and_then(|s| s.as_str()) {
                    timestamp = ts.to_string();
                }
                if let Some(dir) = val.get("cwd").and_then(|s| s.as_str()) {
                    cwd = dir.to_string();
                }
            }
            "message" => {
                message_count += 1;
                let msg = val.get("message");
                let role = msg
                    .and_then(|m| m.get("role"))
                    .and_then(|r| r.as_str())
                    .unwrap_or("");
                let text_opt = msg
                    .and_then(|m| m.get("content"))
                    .and_then(extract_text_from_content);

                if let Some(text) = text_opt {
                    if role == "user" && fallback_title.is_empty() {
                        // Truncate first user message as fallback title
                        fallback_title = if text.chars().count() > 60 {
                            format!("{}…", text.chars().take(60).collect::<String>())
                        } else {
                            text.clone()
                        };
                    }
                    // Keep latest text as preview snippet
                    last_preview = Some(if text.chars().count() > 120 {
                        format!("{}…", text.chars().take(120).collect::<String>())
                    } else {
                        text
                    });
                }
            }
            _ => {}
        }
    }

    if session_id.is_empty() && timestamp.is_empty() {
        return None;
    }

    let title = if !explicit_title.is_empty() {
        explicit_title
    } else if !fallback_title.is_empty() {
        fallback_title
    } else {
        "Untitled conversation".to_string()
    };

    let project_name = if cwd.is_empty() {
        "Default".to_string()
    } else {
        Path::new(&cwd)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&cwd)
            .to_string()
    };

    Some(SavedSession {
        id: session_id,
        title,
        timestamp,
        updated_at,
        cwd,
        project_name,
        path: path.to_string_lossy().into_owned(),
        message_count,
        preview: last_preview,
    })
}

// ── Session deletion ──────────────────────────────────────────────────────────

/// Core deletion logic — separated from the `AppHandle` dependency so it
/// can be exercised in unit tests.
///
/// `path`           – full path to a `.jsonl` session file.
/// `sessions_root`  – resolved sessions root (used for the safety check); if
///                    `None` the safety check is skipped (root doesn't exist).
pub(crate) fn delete_saved_session_inner(
    path: &str,
    sessions_root: Option<&Path>,
) -> Result<(), String> {
    let file_path = Path::new(path);

    if !file_path.exists() {
        return Err(format!("session file not found: {path}"));
    }

    let session_dir = file_path
        .parent()
        .ok_or_else(|| "cannot determine session directory from path".to_owned())?;

    // Safety: verify the session_dir is a descendant of the sessions root.
    // Canonicalize both sides to resolve any symlinks / relative segments.
    if let Some(root) = sessions_root {
        if root.exists() {
            let dir_canon  = session_dir.canonicalize().map_err(|e| format!("canonicalize dir: {e}"))?;
            let root_canon = root        .canonicalize().map_err(|e| format!("canonicalize root: {e}"))?;
            if !dir_canon.starts_with(&root_canon) {
                return Err(
                    "session directory is outside the sessions root — refusing to delete"
                        .to_owned(),
                );
            }
        }
    }

    fs::remove_dir_all(session_dir).map_err(|e| format!("delete failed: {e}"))
}

/// Delete a saved session by removing its parent directory from disk.
///
/// `path` must be the full path to an existing `.jsonl` session file
/// (as returned by [`scan_saved_sessions`]).  The parent directory
/// (the per-session sub-folder inside the sessions root) is removed
/// with all of its contents.
pub fn delete_saved_session(path: &str, app: &AppHandle) -> Result<(), String> {
    let sessions_root = sessions_root_dir(app);
    delete_saved_session_inner(path, sessions_root.as_deref())
}

// ── Session branching ─────────────────────────────────────────────────────────

/// Copy an omp session `.jsonl` file into a new sub-directory so that a
/// branching tab can start from the same history without sharing a file with
/// the original session.  Both tabs will diverge independently once omp
/// starts writing new turns.
///
/// `source_path` must be the full path to an existing `.jsonl` session file.
/// A sibling directory named `branch-<unix_ms>` is created alongside the
/// source's parent directory (i.e. inside the same sessions root), the file
/// is copied there under the same base name, and the new full path is
/// returned so the caller can pass it to `start_session` as `resume`.
///
/// When `max_messages` is `Some(n)`, only the first `n` `"type":"message"`
/// events (plus all non-message metadata lines) are written.  This lets the
/// frontend branch from an arbitrary point in the conversation instead of
/// always copying the full history.
pub fn copy_session_file(
    source_path: &str,
    max_messages: Option<usize>,
) -> Result<String, String> {
    let src = std::path::Path::new(source_path);
    if !src.exists() {
        return Err(format!("source not found: {source_path}"));
    }
    // src is <sessions_root>/<session_dir>/<file>.jsonl
    // parent()       → <sessions_root>/<session_dir>/
    // parent().parent() → <sessions_root>/
    let sessions_root = src
        .parent()
        .and_then(std::path::Path::parent)
        .ok_or_else(|| "cannot determine sessions root from path".to_owned())?;
    let file_name = src
        .file_name()
        .ok_or_else(|| "source path has no file name".to_owned())?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let new_dir = sessions_root.join(format!("branch-{ts}"));
    std::fs::create_dir_all(&new_dir).map_err(|e| format!("mkdir: {e}"))?;
    let dest = new_dir.join(file_name);

    if let Some(max) = max_messages {
        // Truncated copy — keep metadata events and the first `max` message events.
        let file = File::open(src).map_err(|e| format!("open: {e}"))?;
        let reader = BufReader::new(file);
        let mut output_lines: Vec<String> = Vec::new();
        let mut msg_count = 0usize;
        for line_res in reader.lines() {
            let Ok(line) = line_res else { continue };
            if line.is_empty() {
                continue;
            }
            let is_message = serde_json::from_str::<serde_json::Value>(&line)
                .ok()
                .and_then(|v| v.get("type")?.as_str().map(|t| t == "message"))
                .unwrap_or(false);
            if is_message {
                msg_count += 1;
                if msg_count > max {
                    break;
                }
            }
            output_lines.push(line);
        }
        let mut content = output_lines.join("\n");
        if !content.is_empty() {
            content.push('\n');
        }
        std::fs::write(&dest, content.as_bytes()).map_err(|e| format!("write: {e}"))?;
    } else {
        // Full copy — branch from HEAD.
        std::fs::copy(src, &dest).map_err(|e| format!("copy: {e}"))?;
    }

    Ok(dest.to_string_lossy().into_owned())
}

/// Scan `~/.omp/agent/sessions/` for saved `.jsonl` session files.
/// If `cwd_filter` is provided, only sessions whose `cwd` matches are returned.
pub fn scan_saved_sessions(
    app: &AppHandle,
    cwd_filter: Option<&str>,
) -> Result<Vec<SavedSession>, String> {
    let Some(root) = sessions_root_dir(app) else {
        return Ok(Vec::new());
    };

    if !root.exists() {
        return Ok(Vec::new());
    }

    let Ok(entries) = fs::read_dir(&root) else {
        return Ok(Vec::new());
    };

    let mut sessions = Vec::new();

    for entry_res in entries {
        let Ok(entry) = entry_res else { continue };
        let folder_path = entry.path();
        if !folder_path.is_dir() {
            continue;
        }

        let Ok(files) = fs::read_dir(&folder_path) else {
            continue;
        };

        for file_res in files {
            let Ok(file_entry) = file_res else { continue };
            let path = file_entry.path();
            if path.is_file()
                && path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .is_some_and(|s| s.eq_ignore_ascii_case("jsonl"))
            {
                if let Some(session) = parse_session_file(&path) {
                    if let Some(filter) = cwd_filter {
                        if !filter.is_empty() {
                            let norm_filter = filter.replace('\\', "/").trim_end_matches('/').to_lowercase();
                            let norm_cwd = session.cwd.replace('\\', "/").trim_end_matches('/').to_lowercase();
                            if norm_cwd != norm_filter {
                                continue;
                            }
                        }
                    }
                    sessions.push(session);
                }
            }
        }
    }

    // Sort descending by timestamp / updated_at (newest first)
    sessions.sort_by(|a, b| {
        let key_b = b.updated_at.as_ref().unwrap_or(&b.timestamp);
        let key_a = a.updated_at.as_ref().unwrap_or(&a.timestamp);
        key_b.cmp(key_a)
    });

    Ok(sessions)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_test_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("omp_test_{name}_{nanos}"));
        fs::create_dir_all(&dir).expect("created test dir");
        dir
    }

    #[test]
    fn parses_session_file_with_fallback_title() {
        let dir = make_test_dir("fallback");
        let file_path = dir.join("test_session.jsonl");
        let mut file = File::create(&file_path).expect("file created");

        writeln!(file, r#"{{"type":"title","v":1,"title":""}}"#).unwrap();
        writeln!(file, r#"{{"type":"session","version":3,"id":"sess-123","timestamp":"2026-09-04T00:00:00.000Z","cwd":"/test/project"}}"#).unwrap();
        writeln!(file, r#"{{"type":"message","message":{{"role":"user","content":[{{"type":"text","text":"What is quantum computing?"}}]}}}}"#).unwrap();
        writeln!(file, r#"{{"type":"message","message":{{"role":"assistant","content":[{{"type":"text","text":"Quantum computing is..."}}]}}}}"#).unwrap();

        let session = parse_session_file(&file_path).expect("parsed session");
        assert_eq!(session.id, "sess-123");
        assert_eq!(session.title, "What is quantum computing?");
        assert_eq!(session.cwd, "/test/project");
        assert_eq!(session.message_count, 2);
        assert_eq!(session.preview.as_deref(), Some("Quantum computing is..."));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn parses_session_file_with_explicit_title() {
        let dir = make_test_dir("explicit");
        let file_path = dir.join("test_explicit.jsonl");
        let mut file = File::create(&file_path).expect("file created");

        writeln!(file, r#"{{"type":"title","v":1,"title":"Custom Topic Title","updatedAt":"2026-09-04T01:00:00.000Z"}}"#).unwrap();
        writeln!(file, r#"{{"type":"session","version":3,"id":"sess-456","timestamp":"2026-09-04T00:00:00.000Z","cwd":"/test/another"}}"#).unwrap();

        let session = parse_session_file(&file_path).expect("parsed session");
        assert_eq!(session.id, "sess-456");
        assert_eq!(session.title, "Custom Topic Title");
        assert_eq!(session.updated_at.as_deref(), Some("2026-09-04T01:00:00.000Z"));

        let _ = fs::remove_dir_all(&dir);
    }

    // ── copy_session_file tests ───────────────────────────────────────────────

    /// Happy path: copy succeeds and the new file contains the same content.
    #[test]
    fn copy_session_file_success() {
        // Layout: <tmp>/sessions_root/session_dir/sess.jsonl
        let root  = make_test_dir("copy_root");
        let s_dir = root.join("session_dir");
        fs::create_dir_all(&s_dir).unwrap();
        let src = s_dir.join("sess.jsonl");
        File::create(&src).unwrap().write_all(b"line1\nline2").unwrap();

        let result = copy_session_file(src.to_str().unwrap(), None);
        assert!(result.is_ok(), "expected Ok, got {result:?}");
        let dest = std::path::PathBuf::from(result.unwrap());
        assert!(dest.exists(), "copied file should exist");
        assert_eq!(
            fs::read_to_string(&dest).unwrap(),
            "line1\nline2",
            "content must match"
        );
        // Destination must be a sibling of session_dir, not inside it.
        let dest_parent = dest.parent().unwrap();
        assert_eq!(dest_parent.parent().unwrap(), root, "new dir is inside sessions_root");
        assert!(
            dest_parent.file_name().unwrap().to_str().unwrap().starts_with("branch-"),
            "new dir should be named branch-<ts>"
        );
        let _ = fs::remove_dir_all(&root);
    }

    /// Source does not exist → error.
    #[test]
    fn copy_session_file_missing_source() {
        let result = copy_session_file("/nonexistent_root/dir/session.jsonl", None);
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("source not found"),
            "error should mention source not found"
        );
    }

    /// A bare filename with no parent/grandparent triggers a path error after
    /// "source not found" (file doesn't exist).
    #[test]
    fn copy_session_file_no_grandparent() {
        let result = copy_session_file("session.jsonl", None);
        assert!(result.is_err());
    }

    // ── delete_saved_session tests ────────────────────────────────────────────

    /// Non-existent path → "session file not found" error.
    #[test]
    fn delete_session_missing_file() {
        let result = delete_saved_session_inner("/nonexistent/path/session.jsonl", None);
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("session file not found"),
            "error should mention file not found"
        );
    }

    /// Happy path: the session directory is removed from disk.
    #[test]
    fn delete_session_removes_directory() {
        // Layout: <tmp>/<sessions_root>/<session_dir>/sess.jsonl
        let root     = make_test_dir("del_root");
        let s_dir    = root.join("session_dir");
        fs::create_dir_all(&s_dir).unwrap();
        let file     = s_dir.join("sess.jsonl");
        File::create(&file).unwrap();

        let result = delete_saved_session_inner(file.to_str().unwrap(), Some(&root));
        assert!(result.is_ok(), "expected Ok, got {result:?}");
        assert!(!s_dir.exists(), "session directory should have been removed");
        // Root itself must survive
        assert!(root.exists(), "sessions root must not be removed");

        let _ = fs::remove_dir_all(&root);
    }

    /// Path outside the sessions root → safety error, nothing deleted.
    #[test]
    fn delete_session_outside_root_is_rejected() {
        let root     = make_test_dir("del_safety_root");
        let other    = make_test_dir("del_safety_other");
        let file     = other.join("sess.jsonl");
        File::create(&file).unwrap();

        let result = delete_saved_session_inner(file.to_str().unwrap(), Some(&root));
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("outside the sessions root"),
            "safety check should fire"
        );
        assert!(file.exists(), "file outside root must not be deleted");

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&other);
    }

    /// Truncated copy: keeps metadata events plus only the first N message events.
    #[test]
    fn copy_session_file_truncated() {
        let root  = make_test_dir("copy_trunc");
        let s_dir = root.join("trunc_dir");
        fs::create_dir_all(&s_dir).unwrap();
        let src = s_dir.join("sess.jsonl");
        {
            let mut f = File::create(&src).unwrap();
            writeln!(f, r#"{{"type":"session","id":"s1","timestamp":"2026-01-01"}}"#).unwrap();
            writeln!(f, r#"{{"type":"message","message":{{"role":"user","content":"m1"}}}}"#).unwrap();
            writeln!(f, r#"{{"type":"message","message":{{"role":"assistant","content":"a1"}}}}"#).unwrap();
            writeln!(f, r#"{{"type":"message","message":{{"role":"user","content":"m2"}}}}"#).unwrap();
            writeln!(f, r#"{{"type":"message","message":{{"role":"assistant","content":"a2"}}}}"#).unwrap();
        }
        // Keep only the first 2 message events (user m1 + assistant a1).
        let result = copy_session_file(src.to_str().unwrap(), Some(2));
        assert!(result.is_ok(), "{result:?}");
        let content = fs::read_to_string(result.unwrap()).unwrap();
        let lines: Vec<&str> = content.lines().collect();
        // session metadata + 2 message lines = 3 lines total
        assert_eq!(lines.len(), 3, "should have 3 lines: 1 session + 2 messages, got: {lines:?}");
        assert!(lines[0].contains("\"type\":\"session\""), "first line is session metadata");
        assert!(lines[1].contains("\"content\":\"m1\""), "second line is first user msg");
        assert!(lines[2].contains("\"content\":\"a1\""), "third line is first assistant msg");
        let _ = fs::remove_dir_all(&root);
    }
}
