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
    #[serde(default)]
    pub is_standalone: bool,
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

/// Derive the display project name and "no project" flag from a session cwd.
fn project_meta(cwd: &str) -> (String, bool) {
    let project_name = if cwd.is_empty() {
        "Default".to_string()
    } else {
        Path::new(cwd)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(cwd)
            .to_string()
    };

    let norm_cwd = cwd.replace('\\', "/").to_lowercase();
    let is_standalone = cwd.is_empty()
        || cwd == "."
        || norm_cwd.ends_with("/target/debug")
        || norm_cwd.ends_with("/target/release")
        || norm_cwd.contains("/program files/pidesk")
        || norm_cwd.contains("/program files (x86)/pidesk")
        || norm_cwd.contains("/program files/omp desktop")
        || norm_cwd.contains("/program files (x86)/omp desktop");

    (project_name, is_standalone)
}

/// Normalise a path string for case-insensitive, separator-agnostic comparison.
fn norm_path(p: &str) -> String {
    p.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

/// Flag sessions whose cwd is empty, `.`, or equal to one of `dirs` as
/// "no project".
fn mark_standalone(sessions: &mut [SavedSession], dirs: &[PathBuf]) {
    let norm_dirs: Vec<String> = dirs
        .iter()
        .map(|d| norm_path(&d.to_string_lossy()))
        .collect();
    for s in sessions {
        let norm = norm_path(&s.cwd);
        if norm.is_empty() || norm == "." || norm_dirs.contains(&norm) {
            s.is_standalone = true;
        }
    }
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

    let (project_name, is_standalone) = project_meta(&cwd);

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
        is_standalone,
    })
}

// ── Session deletion ──────────────────────────────────────────────────────────

/// Core deletion logic — separated from the `AppHandle` dependency so it
/// can be exercised in unit tests.
///
/// `path`           – full path to a `.jsonl` session file.
/// `sessions_root`  – resolved sessions root (used for the safety check); if
///                    `None` the safety check is skipped (root doesn't exist).
pub fn delete_saved_session_inner(path: &str, sessions_root: Option<&Path>) -> Result<(), String> {
    let file_path = Path::new(path);

    if !file_path.exists() {
        return Err(format!("session file not found: {path}"));
    }

    if !file_path.is_file() {
        return Err(format!("path is not a file: {path}"));
    }

    let is_jsonl = file_path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|s| s.eq_ignore_ascii_case("jsonl"));
    if !is_jsonl {
        return Err("only .jsonl session files can be deleted".to_owned());
    }

    // Safety: verify the file_path is a descendant of the sessions root.
    // Canonicalize both sides to resolve any symlinks / relative segments.
    if let Some(root) = sessions_root {
        if root.exists() {
            let file_canon = file_path
                .canonicalize()
                .map_err(|e| format!("canonicalize file: {e}"))?;
            let root_canon = root
                .canonicalize()
                .map_err(|e| format!("canonicalize root: {e}"))?;
            if !file_canon.starts_with(&root_canon) {
                return Err(
                    "session file is outside the sessions root — refusing to delete".to_owned(),
                );
            }
        }
    }

    // Remove only the target session file.
    fs::remove_file(file_path).map_err(|e| format!("delete failed: {e}"))?;

    // Best-effort cleanup: remove the parent directory if now empty.
    // In shared project directories with other .jsonl sessions, this safely fails and is ignored.
    if let Some(parent) = file_path.parent() {
        let _ = fs::remove_dir(parent);
    }

    Ok(())
}

/// Delete a single saved session file from disk.
///
/// `path` must be the full path to an existing `.jsonl` session file
/// (as returned by [`scan_saved_sessions`]). Only that single file is
/// removed; other session files in the same shared directory are preserved.
pub fn delete_saved_session(path: &str, app: &AppHandle) -> Result<(), String> {
    let sessions_root = sessions_root_dir(app);
    delete_saved_session_inner(path, sessions_root.as_deref())
}

/// Scan `~/.omp/agent/sessions/` for saved `.jsonl` session files.
/// If `cwd_filter` is provided, only sessions whose `cwd` matches are returned.
pub fn scan_saved_sessions(app: &AppHandle, cwd_filter: Option<&str>) -> Vec<SavedSession> {
    let Some(root) = sessions_root_dir(app) else {
        return Vec::new();
    };

    if !root.exists() {
        return Vec::new();
    }

    let Ok(entries) = fs::read_dir(&root) else {
        return Vec::new();
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
                            let norm_filter = filter
                                .replace('\\', "/")
                                .trim_end_matches('/')
                                .to_lowercase();
                            let norm_cwd = session
                                .cwd
                                .replace('\\', "/")
                                .trim_end_matches('/')
                                .to_lowercase();
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

    // New dedicated workspace plus the exe dir used by older builds.
    let standalone_dirs = [
        crate::agent::workspace::default_cwd(app),
        crate::agent::workspace::legacy_exe_dir(),
    ];
    mark_standalone(&mut sessions, &standalone_dirs);

    // Sort descending by timestamp / updated_at (newest first)
    sessions.sort_by(|a, b| {
        let key_b = b.updated_at.as_ref().unwrap_or(&b.timestamp);
        let key_a = a.updated_at.as_ref().unwrap_or(&a.timestamp);
        key_b.cmp(key_a)
    });

    sessions
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_test_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
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
        assert_eq!(
            session.updated_at.as_deref(),
            Some("2026-09-04T01:00:00.000Z")
        );

        let _ = fs::remove_dir_all(&dir);
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

    /// Happy path: the target session file is removed, and empty parent directory is cleaned up.
    #[test]
    fn delete_session_removes_file_and_empty_directory() {
        // Layout: <tmp>/<sessions_root>/<session_dir>/sess.jsonl
        let root = make_test_dir("del_root");
        let s_dir = root.join("session_dir");
        fs::create_dir_all(&s_dir).unwrap();
        let file = s_dir.join("sess.jsonl");
        File::create(&file).unwrap();

        let result = delete_saved_session_inner(file.to_str().unwrap(), Some(&root));
        assert!(result.is_ok(), "expected Ok, got {result:?}");
        assert!(!file.exists(), "session file should have been removed");
        assert!(
            !s_dir.exists(),
            "empty session directory should have been cleaned up"
        );
        // Root itself must survive
        assert!(root.exists(), "sessions root must not be removed");

        let _ = fs::remove_dir_all(&root);
    }

    /// Shared directory: deleting one session preserves sibling sessions and parent directory.
    #[test]
    fn delete_session_preserves_sibling_files_in_same_dir() {
        let root = make_test_dir("del_shared_root");
        let s_dir = root.join("shared_dir");
        fs::create_dir_all(&s_dir).unwrap();
        let file1 = s_dir.join("sess1.jsonl");
        let file2 = s_dir.join("sess2.jsonl");
        File::create(&file1).unwrap();
        File::create(&file2).unwrap();

        let result = delete_saved_session_inner(file1.to_str().unwrap(), Some(&root));
        assert!(result.is_ok(), "expected Ok, got {result:?}");
        assert!(!file1.exists(), "target session file must be deleted");
        assert!(file2.exists(), "sibling session file must remain intact");
        assert!(
            s_dir.exists(),
            "shared directory must NOT be deleted while siblings exist"
        );

        let _ = fs::remove_dir_all(&root);
    }

    /// Path outside the sessions root → safety error, nothing deleted.
    #[test]
    fn delete_session_outside_root_is_rejected() {
        let root = make_test_dir("del_safety_root");
        let other = make_test_dir("del_safety_other");
        let file = other.join("sess.jsonl");
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

    // ── mark_standalone tests ─────────────────────────────────────────────────

    fn session_with_cwd(cwd: &str) -> SavedSession {
        SavedSession {
            id: "id".into(),
            title: String::new(),
            timestamp: String::new(),
            updated_at: None,
            cwd: cwd.into(),
            project_name: String::new(),
            path: String::new(),
            message_count: 0,
            preview: None,
            is_standalone: false,
        }
    }

    #[test]
    fn mark_standalone_matches_workspace_and_legacy_dirs() {
        let dirs = [
            PathBuf::from("C:/Users/me/AppData/Local/app/workspace"),
            PathBuf::from("D:/Tools/PiDesk"),
        ];
        let mut sessions = vec![
            session_with_cwd(r"c:\users\ME\appdata\local\app\workspace"),
            session_with_cwd("D:/Tools/PiDesk/"),
            session_with_cwd(""),
            session_with_cwd("."),
            session_with_cwd("C:/Projects/real"),
        ];
        mark_standalone(&mut sessions, &dirs);
        let flags: Vec<bool> = sessions.iter().map(|s| s.is_standalone).collect();
        assert_eq!(flags, [true, true, true, true, false]);
    }
}
