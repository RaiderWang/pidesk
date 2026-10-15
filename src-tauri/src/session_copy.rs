//! Session branching: copy an omp `.jsonl` session into a fresh sibling
//! directory so a forked tab can resume it without sharing a file with the
//! original.

use serde_json::Value;
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::Path;

/// Copy an omp session `.jsonl` file into a new `branch-<unix_ms>` directory
/// next to the source's parent directory (inside the same sessions root) and
/// return the new file's full path, ready to pass as `resume` to
/// `start_session`.
///
/// * `until_entry_id` — keep everything up to and including that entry, plus
///   the tool results that answer tool calls of the kept entries (a cut right
///   after an assistant turn must not leave dangling tool calls). The id must
///   exist in the file; otherwise this is an error rather than a silent full
///   copy.
/// * `max_messages` — legacy count-based cut (first `n` `"type":"message"`
///   events). Ignored when `until_entry_id` is given.
/// * neither — full copy.
pub fn copy_session_file(
    source_path: &str,
    max_messages: Option<usize>,
    until_entry_id: Option<&str>,
) -> Result<String, String> {
    let src = Path::new(source_path);
    if !src.exists() {
        return Err(format!("source not found: {source_path}"));
    }
    // src is <sessions_root>/<session_dir>/<file>.jsonl
    let sessions_root = src
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| "cannot determine sessions root from path".to_owned())?;
    let file_name = src
        .file_name()
        .ok_or_else(|| "source path has no file name".to_owned())?;

    // Resolve the (possibly truncated) content before touching the disk, so a
    // failed lookup leaves no empty `branch-*` directory behind.
    let content = match (until_entry_id, max_messages) {
        (Some(id), _) => Some(cut_until_entry(src, id)?),
        (None, Some(max)) => Some(cut_by_message_count(src, max)?),
        (None, None) => None,
    };

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let new_dir = sessions_root.join(format!("branch-{ts}"));
    fs::create_dir_all(&new_dir).map_err(|e| format!("mkdir: {e}"))?;
    let dest = new_dir.join(file_name);

    let written = content.as_ref().map_or_else(
        || {
            fs::copy(src, &dest)
                .map(|_| ())
                .map_err(|e| format!("copy: {e}"))
        },
        |text| fs::write(&dest, text.as_bytes()).map_err(|e| format!("write: {e}")),
    );
    if let Err(e) = written {
        let _ = fs::remove_dir_all(&new_dir);
        return Err(e);
    }

    Ok(dest.to_string_lossy().into_owned())
}

fn parse_line(line: &str) -> Option<Value> {
    serde_json::from_str(line).ok()
}

fn str_field<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key)?.as_str()
}

fn is_tool_result(v: &Value) -> bool {
    str_field(v, "type") == Some("message")
        && v.get("message")
            .and_then(|m| str_field(m, "role"))
            .is_some_and(|r| r == "toolResult")
}

fn push_line(out: &mut String, line: &str) {
    out.push_str(line);
    out.push('\n');
}

/// Lines up to and including the entry `target_id`, then any `toolResult`
/// entries whose parent is a kept entry (transitively).
fn cut_until_entry(src: &Path, target_id: &str) -> Result<String, String> {
    let reader = BufReader::new(File::open(src).map_err(|e| format!("open: {e}"))?);
    let mut out = String::new();
    let mut kept: HashSet<String> = HashSet::new();
    let mut found = false;

    for line in reader.lines().map_while(Result::ok) {
        if line.is_empty() {
            continue;
        }
        let val = parse_line(&line);
        let id = val.as_ref().and_then(|v| str_field(v, "id"));

        if found {
            let Some(v) = val.as_ref() else { continue };
            let answers_kept_call =
                is_tool_result(v) && str_field(v, "parentId").is_some_and(|p| kept.contains(p));
            if answers_kept_call {
                if let Some(id) = id {
                    kept.insert(id.to_owned());
                }
                push_line(&mut out, &line);
            }
        } else {
            push_line(&mut out, &line);
            if id == Some(target_id) {
                kept.insert(target_id.to_owned());
                found = true;
            }
        }
    }

    if found {
        Ok(out)
    } else {
        Err(format!("entry not found in session file: {target_id}"))
    }
}

/// Metadata lines plus the first `max` `"type":"message"` events.
fn cut_by_message_count(src: &Path, max: usize) -> Result<String, String> {
    let reader = BufReader::new(File::open(src).map_err(|e| format!("open: {e}"))?);
    let mut out = String::new();
    let mut count = 0usize;

    for line in reader.lines().map_while(Result::ok) {
        if line.is_empty() {
            continue;
        }
        let is_message = parse_line(&line)
            .and_then(|v| v.get("type")?.as_str().map(|t| t == "message"))
            .unwrap_or(false);
        if is_message {
            count += 1;
            if count > max {
                break;
            }
        }
        push_line(&mut out, &line);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_test_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("omp_copy_{name}_{nanos}"));
        fs::create_dir_all(&dir).expect("created test dir");
        dir
    }

    /// Write `lines` to `<root>/session_dir/sess.jsonl`; returns (root, file).
    fn session_file(name: &str, lines: &[&str]) -> (PathBuf, PathBuf) {
        let root = make_test_dir(name);
        let dir = root.join("session_dir");
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("sess.jsonl");
        let mut f = File::create(&file).unwrap();
        for l in lines {
            writeln!(f, "{l}").unwrap();
        }
        (root, file)
    }

    fn msg(id: &str, parent: &str, role: &str) -> String {
        format!(
            r#"{{"type":"message","id":"{id}","parentId":"{parent}","message":{{"role":"{role}","content":"{id}"}}}}"#
        )
    }

    fn branch_dirs(root: &Path) -> usize {
        fs::read_dir(root)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().starts_with("branch-"))
            .count()
    }

    fn read_ids(path: &str) -> Vec<String> {
        fs::read_to_string(path)
            .unwrap()
            .lines()
            .filter_map(|l| parse_line(l).and_then(|v| str_field(&v, "id").map(str::to_owned)))
            .collect()
    }

    #[test]
    fn full_copy_lands_in_a_sibling_branch_dir() {
        let root = make_test_dir("full");
        let dir = root.join("session_dir");
        fs::create_dir_all(&dir).unwrap();
        let src = dir.join("sess.jsonl");
        fs::write(&src, b"line1\nline2").unwrap();

        let dest = PathBuf::from(copy_session_file(src.to_str().unwrap(), None, None).unwrap());
        assert_eq!(fs::read_to_string(&dest).unwrap(), "line1\nline2");
        let parent = dest.parent().unwrap();
        assert_eq!(parent.parent().unwrap(), root);
        assert!(parent
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("branch-"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn missing_source_is_an_error() {
        let err = copy_session_file("/nonexistent_root/dir/session.jsonl", None, None).unwrap_err();
        assert!(err.contains("source not found"));
    }

    #[test]
    fn bare_filename_has_no_sessions_root() {
        assert!(copy_session_file("session.jsonl", None, None).is_err());
    }

    #[test]
    fn count_cut_keeps_metadata_and_first_n_messages() {
        let (m1, a1, m2) = (
            msg("m1", "s1", "user"),
            msg("a1", "m1", "assistant"),
            msg("m2", "a1", "user"),
        );
        let (root, file) =
            session_file("count", &[r#"{"type":"session","id":"s1"}"#, &m1, &a1, &m2]);
        let dest = copy_session_file(file.to_str().unwrap(), Some(2), None).unwrap();
        assert_eq!(read_ids(&dest), ["s1", "m1", "a1"]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn entry_cut_stops_at_the_target() {
        let (m1, a1, m2, a2) = (
            msg("m1", "s1", "user"),
            msg("a1", "m1", "assistant"),
            msg("m2", "a1", "user"),
            msg("a2", "m2", "assistant"),
        );
        let (root, file) = session_file(
            "entry",
            &[r#"{"type":"session","id":"s1"}"#, &m1, &a1, &m2, &a2],
        );
        let dest = copy_session_file(file.to_str().unwrap(), None, Some("a1")).unwrap();
        assert_eq!(read_ids(&dest), ["s1", "m1", "a1"]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn entry_cut_keeps_tool_results_of_the_target_but_not_later_turns() {
        // a1 made two tool calls: r1 -> r2 chain; r3 hangs off a later turn.
        let (m1, a1, r1, r2, m2, r3) = (
            msg("m1", "s1", "user"),
            msg("a1", "m1", "assistant"),
            msg("r1", "a1", "toolResult"),
            msg("r2", "r1", "toolResult"),
            msg("m2", "r2", "user"),
            msg("r3", "m2", "toolResult"),
        );
        let (root, file) = session_file(
            "toolres",
            &[
                r#"{"type":"session","id":"s1"}"#,
                &m1,
                &a1,
                &r1,
                &r2,
                &m2,
                &r3,
            ],
        );
        let dest = copy_session_file(file.to_str().unwrap(), None, Some("a1")).unwrap();
        assert_eq!(read_ids(&dest), ["s1", "m1", "a1", "r1", "r2"]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn unknown_entry_id_is_an_error_and_leaves_no_branch_dir() {
        let m1 = msg("m1", "s1", "user");
        let (root, file) = session_file("unknown", &[r#"{"type":"session","id":"s1"}"#, &m1]);
        let err = copy_session_file(file.to_str().unwrap(), None, Some("nope")).unwrap_err();
        assert!(err.contains("entry not found"), "{err}");
        assert_eq!(branch_dirs(&root), 0, "no half-made branch directory");
        let _ = fs::remove_dir_all(&root);
    }
}
