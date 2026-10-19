//! Windows PATH recovery for GUI launches.
//!
//! A process started by an installer (the in-app updater relaunches the app
//! that way) or by a stale shell can inherit an environment whose `PATH` lacks
//! the user's entries (`~/.bun/bin`, `%LOCALAPPDATA%\omp`, ...). omp is then
//! "not found" until the app is launched again from Explorer, and no amount
//! of retrying inside the broken process helps. The registry always holds the
//! authoritative `PATH`, so it is merged into the process environment, and
//! well-known install directories are probed as absolute paths.
//!
//! Everything except [`refresh_process_path`] is pure so it is unit-tested on
//! every platform.
#![cfg_attr(not(windows), allow(dead_code))]

use std::path::PathBuf;

/// Extract the `Path` value from `reg query <key> /v Path` output.
///
/// The line looks like `    Path    REG_EXPAND_SZ    C:\a;%USERPROFILE%\b`.
/// The value may contain spaces, so split on the type token rather than on
/// whitespace.
pub fn parse_reg_path(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let line = line.trim();
        let (name, rest) = line.split_once(char::is_whitespace)?;
        if !name.eq_ignore_ascii_case("path") {
            return None;
        }
        let rest = rest.trim_start();
        let value = rest
            .strip_prefix("REG_EXPAND_SZ")
            .or_else(|| rest.strip_prefix("REG_SZ"))?
            .trim();
        (!value.is_empty()).then(|| value.to_string())
    })
}

/// Expand `%VAR%` references using `lookup`. Unknown variables are left
/// verbatim, matching `ExpandEnvironmentStrings`.
pub fn expand_env(value: &str, lookup: impl Fn(&str) -> Option<String>) -> String {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let resolved = after
            .find('%')
            .filter(|&end| end > 0)
            .and_then(|end| lookup(&after[..end]).map(|v| (v, end)));
        if let Some((v, end)) = resolved {
            out.push_str(&v);
            rest = &after[end + 1..];
        } else {
            out.push('%');
            rest = after;
        }
    }
    out.push_str(rest);
    out
}

fn normalize(entry: &str) -> String {
    entry
        .trim()
        .trim_end_matches(['\\', '/'])
        .to_ascii_lowercase()
}

/// Append every entry of `extra` (a `;`-separated list) that `current` does
/// not already contain. Existing entries keep their priority. Returns `None`
/// when nothing needs to change.
pub fn merge_path(current: &str, extra: &str) -> Option<String> {
    let mut seen: Vec<String> = current
        .split(';')
        .map(normalize)
        .filter(|e| !e.is_empty())
        .collect();
    let mut merged = current.trim_end_matches(';').to_string();
    let mut changed = false;
    for entry in extra.split(';') {
        let key = normalize(entry);
        if key.is_empty() || seen.contains(&key) {
            continue;
        }
        if !merged.is_empty() {
            merged.push(';');
        }
        merged.push_str(entry.trim());
        seen.push(key);
        changed = true;
    }
    changed.then_some(merged)
}

/// Absolute paths where omp is commonly installed on Windows, probed after
/// the bare `omp.exe` lookup fails. `env` reads an environment variable.
pub fn fallback_candidates(env: impl Fn(&str) -> Option<String>) -> Vec<PathBuf> {
    let mut list = Vec::new();
    let mut add = |base: Option<String>, rel: &[&str]| {
        if let Some(base) = base.filter(|b| !b.is_empty()) {
            let mut p = PathBuf::from(base);
            p.extend(rel);
            list.push(p);
        }
    };
    add(env("BUN_INSTALL"), &["bin", "omp.exe"]);
    add(env("USERPROFILE"), &[".bun", "bin", "omp.exe"]);
    add(env("LOCALAPPDATA"), &["omp", "omp.exe"]);
    add(env("USERPROFILE"), &[".cargo", "bin", "omp.exe"]);
    add(env("USERPROFILE"), &[".local", "bin", "omp.exe"]);
    add(env("APPDATA"), &["npm", "omp.cmd"]);
    list
}

/// Read a registry `Path` via `reg.exe` and expand its `%VAR%` references.
#[cfg(windows)]
fn registry_path(key: &str) -> Option<String> {
    use std::process::{Command, Stdio};

    let reg = std::env::var("SystemRoot").map_or_else(
        |_| PathBuf::from("reg"),
        |r| PathBuf::from(r).join("System32\\reg.exe"),
    );
    let mut cmd = Command::new(reg);
    cmd.args(["query", key, "/v", "Path"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    super::spawn::hide_console_window(&mut cmd);
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let raw = parse_reg_path(&String::from_utf8_lossy(&output.stdout))?;
    Some(expand_env(&raw, |name| std::env::var(name).ok()))
}

/// Merge the machine and user registry `PATH` into this process's `PATH`
/// (appended, so entries already present keep priority). Children such as omp
/// inherit the result.
#[cfg(windows)]
pub fn refresh_process_path() {
    let machine = "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment";
    let user = "HKCU\\Environment";
    let mut path = std::env::var("PATH").unwrap_or_default();
    let mut changed = false;
    for key in [machine, user] {
        let Some(extra) = registry_path(key) else {
            continue;
        };
        if let Some(merged) = merge_path(&path, &extra) {
            path = merged;
            changed = true;
        }
    }
    if changed {
        eprintln!("[pidesk] PATH was missing registry entries; merged them in");
        std::env::set_var("PATH", path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_expand_sz_value_with_spaces() {
        let out = "\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    C:\\a b;%USERPROFILE%\\.bun\\bin\r\n\r\n";
        assert_eq!(
            parse_reg_path(out).as_deref(),
            Some("C:\\a b;%USERPROFILE%\\.bun\\bin")
        );
    }

    #[test]
    fn parses_plain_sz_and_ignores_other_values() {
        let out = "    PathExt    REG_SZ    .EXE\n    Path    REG_SZ    C:\\x\n";
        assert_eq!(parse_reg_path(out).as_deref(), Some("C:\\x"));
    }

    #[test]
    fn parse_rejects_missing_or_empty() {
        assert_eq!(parse_reg_path(""), None);
        assert_eq!(parse_reg_path("ERROR: not found"), None);
        assert_eq!(parse_reg_path("    Path    REG_SZ    "), None);
    }

    #[test]
    fn expands_known_vars_and_keeps_unknown() {
        let lookup = |n: &str| (n == "USERPROFILE").then(|| "C:\\u".to_string());
        assert_eq!(expand_env("%USERPROFILE%\\bin", lookup), "C:\\u\\bin");
        assert_eq!(expand_env("%NOPE%\\bin;100%", lookup), "%NOPE%\\bin;100%");
        assert_eq!(expand_env("a%%b", lookup), "a%%b");
    }

    #[test]
    fn merge_appends_only_missing_entries() {
        let merged = merge_path("C:\\a;C:\\b\\", "c:\\B;C:\\c;;C:\\a").unwrap();
        assert_eq!(merged, "C:\\a;C:\\b\\;C:\\c");
    }

    #[test]
    fn merge_into_empty_and_noop() {
        assert_eq!(merge_path("", "C:\\a").as_deref(), Some("C:\\a"));
        assert_eq!(merge_path("C:\\a", "c:\\a\\"), None);
        assert_eq!(merge_path("C:\\a", ""), None);
    }

    #[test]
    fn fallbacks_use_available_vars_only() {
        let env = |n: &str| match n {
            "USERPROFILE" => Some("C:\\u".to_string()),
            "LOCALAPPDATA" => Some(String::new()),
            _ => None,
        };
        let list = fallback_candidates(env);
        assert!(list.contains(
            &PathBuf::from("C:\\u")
                .join(".bun")
                .join("bin")
                .join("omp.exe")
        ));
        assert!(list.iter().all(|p| p.starts_with("C:\\u")));
        assert_eq!(list.len(), 3);
    }
}
