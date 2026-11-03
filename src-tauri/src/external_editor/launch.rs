//! Pure parsing of the user-configured external editor command line into a
//! spawnable program + arguments. No process spawning happens here.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

/// Placeholder that, when present in the configured arguments, is replaced
/// by the target file path. Without it the path is appended as the last arg.
const FILE_PLACEHOLDER: &str = "{file}";

/// Windows extensions probed when the configured program has none
/// (`code` is really `code.cmd`).
const WINDOWS_EXTS: &[&str] = &["exe", "cmd", "bat", "com"];

#[derive(Debug, PartialEq, Eq)]
pub struct Launch {
    pub program: PathBuf,
    pub args: Vec<String>,
}

/// Split a command line on whitespace. Only double quotes group tokens;
/// backslashes are literal so Windows paths survive untouched.
pub fn split_command_line(input: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut has_token = false;
    for ch in input.chars() {
        match ch {
            '"' => {
                in_quotes = !in_quotes;
                has_token = true;
            }
            c if c.is_whitespace() && !in_quotes => {
                if has_token {
                    out.push(std::mem::take(&mut cur));
                    has_token = false;
                }
            }
            c => {
                cur.push(c);
                has_token = true;
            }
        }
    }
    if has_token {
        out.push(cur);
    }
    out
}

fn fill_args(args: &[String], file: &str) -> Vec<String> {
    if args.iter().any(|a| a.contains(FILE_PLACEHOLDER)) {
        args.iter()
            .map(|a| a.replace(FILE_PLACEHOLDER, file))
            .collect()
    } else {
        args.iter()
            .cloned()
            .chain(std::iter::once(file.to_owned()))
            .collect()
    }
}

fn is_app_bundle(p: &Path) -> bool {
    p.extension().is_some_and(|e| e.eq_ignore_ascii_case("app")) && p.is_dir()
}

/// Candidate extensions to append to a bare program name when probing.
fn probe_exts(p: &Path) -> &'static [&'static str] {
    if cfg!(windows) && p.extension().is_none() {
        WINDOWS_EXTS
    } else {
        &[""]
    }
}

fn probe(base: &Path, exts: &[&str]) -> Option<PathBuf> {
    exts.iter().find_map(|ext| {
        let candidate = if ext.is_empty() {
            base.to_path_buf()
        } else {
            let mut s = base.as_os_str().to_os_string();
            s.push(".");
            s.push(ext);
            PathBuf::from(s)
        };
        candidate.is_file().then_some(candidate)
    })
}

/// Resolve `program` to a concrete file: explicit paths are probed as-is,
/// bare names are searched along `path_var`. Unresolvable names are
/// returned unchanged so `spawn` reports the OS-level error.
fn resolve_program(program: &str, path_var: Option<&OsStr>) -> PathBuf {
    let p = Path::new(program);
    let exts = probe_exts(p);
    if p.is_absolute() || p.components().count() > 1 {
        return probe(p, exts).unwrap_or_else(|| p.to_path_buf());
    }
    path_var
        .into_iter()
        .flat_map(std::env::split_paths)
        .find_map(|dir| probe(&dir.join(program), exts))
        .unwrap_or_else(|| p.to_path_buf())
}

/// Turn the configured `editor` string and a target `file` into a launch plan.
pub fn plan_launch(editor: &str, file: &str, path_var: Option<&OsStr>) -> Result<Launch, String> {
    let editor = editor.trim();
    if editor.is_empty() {
        return Err("No external editor configured".to_owned());
    }
    if !Path::new(file).is_file() {
        return Err(format!("Not a file: {file}"));
    }

    // A whole string that is a real path (e.g. unquoted `C:\Program Files\...`)
    // is the program itself; never split it on spaces.
    let (program, args) = if Path::new(editor).exists() {
        (editor.to_owned(), Vec::new())
    } else {
        let mut parts = split_command_line(editor);
        if parts.is_empty() {
            return Err("No external editor configured".to_owned());
        }
        (parts.remove(0), parts)
    };
    if program.is_empty() {
        return Err("External editor command is empty".to_owned());
    }

    if is_app_bundle(Path::new(&program)) {
        return Ok(Launch {
            program: PathBuf::from("open"),
            args: vec!["-a".to_owned(), program, file.to_owned()],
        });
    }
    Ok(Launch {
        program: resolve_program(&program, path_var),
        args: fill_args(&args, file),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "pidesk_editor_{tag}_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn split_handles_quotes_and_spaces() {
        assert_eq!(
            split_command_line(r#""C:\Program Files\Code\Code.exe" -g  --wait"#),
            vec![r"C:\Program Files\Code\Code.exe", "-g", "--wait"]
        );
    }

    #[test]
    fn split_keeps_backslashes_literal() {
        assert_eq!(
            split_command_line(r"C:\a\b.exe x"),
            vec![r"C:\a\b.exe", "x"]
        );
    }

    #[test]
    fn split_empty_and_blank() {
        assert_eq!(split_command_line("   "), Vec::<String>::new());
        assert_eq!(split_command_line(r#""""#), vec![""]);
    }

    #[test]
    fn fill_args_appends_file_without_placeholder() {
        let args = vec!["-g".to_owned()];
        assert_eq!(fill_args(&args, "a.txt"), vec!["-g", "a.txt"]);
    }

    #[test]
    fn fill_args_replaces_placeholder() {
        let args = vec!["--open={file}".to_owned(), "-n".to_owned()];
        assert_eq!(fill_args(&args, "a.txt"), vec!["--open=a.txt", "-n"]);
    }

    #[test]
    fn plan_rejects_empty_editor_and_missing_file() {
        let dir = temp_dir("empty");
        let file = dir.join("a.txt");
        fs::write(&file, "x").unwrap();
        assert!(plan_launch("  ", file.to_str().unwrap(), None).is_err());
        assert!(plan_launch("code", dir.join("nope.txt").to_str().unwrap(), None).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn plan_uses_whole_string_when_it_is_an_existing_path() {
        let dir = temp_dir("space dir");
        let editor = dir.join("my editor");
        let file = dir.join("a.txt");
        fs::write(&editor, "x").unwrap();
        fs::write(&file, "x").unwrap();
        let plan = plan_launch(editor.to_str().unwrap(), file.to_str().unwrap(), None).unwrap();
        assert_eq!(plan.program, editor);
        assert_eq!(plan.args, vec![file.to_str().unwrap()]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn plan_splits_quoted_program_with_args() {
        let dir = temp_dir("quoted");
        let editor = dir.join("my editor");
        let file = dir.join("a.txt");
        fs::write(&editor, "x").unwrap();
        fs::write(&file, "x").unwrap();
        let cmd = format!("\"{}\" -g", editor.display());
        let plan = plan_launch(&cmd, file.to_str().unwrap(), None).unwrap();
        assert_eq!(plan.program, editor);
        assert_eq!(plan.args, vec!["-g", file.to_str().unwrap()]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_searches_path_var_with_extensions() {
        let dir = temp_dir("path");
        let bin = dir.join("fake-ed.cmd");
        fs::write(&bin, "x").unwrap();
        let found = probe(&dir.join("fake-ed"), &["exe", "cmd"]);
        assert_eq!(found, Some(bin));
        let var = std::env::join_paths([&dir]).unwrap();
        let plain = dir.join("plain-ed.exe");
        fs::write(&plain, "x").unwrap();
        assert_eq!(resolve_program("plain-ed.exe", Some(&var)), plain);
        assert_eq!(
            resolve_program("missing-ed", Some(&var)),
            PathBuf::from("missing-ed")
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn plan_wraps_app_bundle_with_open() {
        let dir = temp_dir("app");
        let app = dir.join("Fake Editor.app");
        fs::create_dir_all(&app).unwrap();
        let file = dir.join("a.txt");
        fs::write(&file, "x").unwrap();
        let plan = plan_launch(app.to_str().unwrap(), file.to_str().unwrap(), None).unwrap();
        assert_eq!(plan.program, PathBuf::from("open"));
        assert_eq!(
            plan.args,
            vec!["-a", app.to_str().unwrap(), file.to_str().unwrap()]
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
