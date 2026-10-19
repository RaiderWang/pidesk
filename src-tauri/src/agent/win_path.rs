//! Pure logic for repairing a stripped Windows process environment.
//!
//! A process relaunched by the MSI updater (`LaunchApplication` custom action)
//! can start with an environment block that is not the user's: no user `PATH`
//! entries (`~/.bun/bin`, ...) and possibly the wrong `USERPROFILE` /
//! `LOCALAPPDATA`. omp is then "not found" (or writes to the wrong home) until
//! the app is launched again from Explorer. [`super::win_env`] fetches the
//! authoritative user environment from the OS; this module decides what to
//! apply and lists well-known omp install locations.
//!
//! Everything here is pure so it is unit-tested on every platform.
#![cfg_attr(not(windows), allow(dead_code))]

use std::path::PathBuf;

/// Variables derived from the logon session. When the process is detected as
/// carrying another account's profile, these are overwritten.
const USER_SCOPED: [&str; 10] = [
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "HOMEDRIVE",
    "HOMEPATH",
    "USERNAME",
    "USERDOMAIN",
    "LOGONSERVER",
    "TEMP",
    "TMP",
];

/// Parse a `CreateEnvironmentBlock` result: UTF-16 `NAME=VALUE\0...\0\0`.
///
/// Hidden per-drive entries such as `=C:=C:\` (name starts with `=`) are
/// skipped, as are entries without a `=`.
pub fn parse_env_block(block: &[u16]) -> Vec<(String, String)> {
    block
        .split(|&c| c == 0)
        .take_while(|entry| !entry.is_empty())
        .filter_map(|entry| {
            let text = String::from_utf16_lossy(entry);
            if text.starts_with('=') {
                return None;
            }
            let (name, value) = text.split_once('=')?;
            Some((name.to_string(), value.to_string()))
        })
        .collect()
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

fn block_value<'a>(block: &'a [(String, String)], name: &str) -> Option<&'a str> {
    block
        .iter()
        .find(|(n, _)| n.eq_ignore_ascii_case(name))
        .map(|(_, v)| v.as_str())
}

/// True when the process carries a different profile than the user's own
/// environment block (e.g. the installer service's `systemprofile`).
pub fn is_polluted(current: impl Fn(&str) -> Option<String>, block: &[(String, String)]) -> bool {
    match (current("USERPROFILE"), block_value(block, "USERPROFILE")) {
        (Some(cur), Some(want)) => normalize(&cur) != normalize(want),
        _ => false,
    }
}

/// Decide which variables to set so the process matches the user's `block`.
///
/// - Variables missing from the process are added.
/// - `PATH` gets the block's missing entries appended (existing order wins).
/// - When the process is [polluted](is_polluted), the [`USER_SCOPED`]
///   variables are overwritten with the block's values; otherwise existing
///   values are never overridden.
///
/// `current` reads the process environment (case-insensitive, like Windows).
pub fn plan_env_updates(
    current: impl Fn(&str) -> Option<String>,
    block: &[(String, String)],
) -> Vec<(String, String)> {
    let polluted = is_polluted(&current, block);
    let mut updates = Vec::new();
    for (name, value) in block {
        if name.eq_ignore_ascii_case("PATH") {
            let have = current(name).unwrap_or_default();
            if let Some(merged) = merge_path(&have, value) {
                updates.push((name.clone(), merged));
            }
            continue;
        }
        let overwrite = polluted && USER_SCOPED.iter().any(|v| name.eq_ignore_ascii_case(v));
        let needs_set = current(name).is_none_or(|cur| overwrite && cur != *value);
        if needs_set {
            updates.push((name.clone(), value.clone()));
        }
    }
    updates
}

/// Absolute paths where omp is commonly installed on Windows, probed after
/// the bare `omp.exe` lookup fails. `env` reads an environment variable.
///
/// Only `.exe` locations: a `.cmd` shim would make `Child::kill` terminate
/// just `cmd.exe` and leak the real process.
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
    list
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wide(entries: &[&str]) -> Vec<u16> {
        let mut out = Vec::new();
        for e in entries {
            out.extend(e.encode_utf16());
            out.push(0);
        }
        out.push(0);
        out
    }

    fn pairs(items: &[(&str, &str)]) -> Vec<(String, String)> {
        items
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect()
    }

    /// Case-insensitive lookup over a fixed table, like the Windows env.
    fn env<'a>(vars: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |name| {
            vars.iter()
                .find(|(k, _)| k.eq_ignore_ascii_case(name))
                .map(|(_, v)| (*v).to_string())
        }
    }

    #[test]
    fn parses_entries_with_spaces_and_non_ascii() {
        let block = wide(&["A=1", "Path=C:\\a b;D:\\开发\\bin", "EMPTY="]);
        assert_eq!(
            parse_env_block(&block),
            pairs(&[("A", "1"), ("Path", "C:\\a b;D:\\开发\\bin"), ("EMPTY", "")])
        );
    }

    #[test]
    fn parse_skips_drive_entries_and_malformed() {
        let block = wide(&["=C:=C:\\work", "NOEQUALS", "X=y=z"]);
        assert_eq!(parse_env_block(&block), pairs(&[("X", "y=z")]));
    }

    #[test]
    fn parse_handles_empty_blocks() {
        assert_eq!(parse_env_block(&[]), pairs(&[]));
        assert_eq!(parse_env_block(&[0, 0]), pairs(&[]));
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
    fn fills_missing_variables_and_merges_path() {
        let block = pairs(&[
            ("Path", "C:\\sys;C:\\u\\.bun\\bin"),
            ("BRAVE_API_KEY", "k"),
            ("USERPROFILE", "C:\\u"),
        ]);
        let vars = [("PATH", "C:\\sys"), ("USERPROFILE", "C:\\u")];
        let updates = plan_env_updates(env(&vars), &block);
        assert_eq!(
            updates,
            pairs(&[("Path", "C:\\sys;C:\\u\\.bun\\bin"), ("BRAVE_API_KEY", "k")])
        );
    }

    #[test]
    fn clean_process_keeps_existing_values() {
        let block = pairs(&[("USERPROFILE", "C:\\u"), ("TEMP", "C:\\u\\t"), ("X", "1")]);
        let vars = [
            ("USERPROFILE", "C:\\u\\"),
            ("TEMP", "D:\\custom"),
            ("X", "0"),
        ];
        assert!(!is_polluted(env(&vars), &block));
        assert_eq!(plan_env_updates(env(&vars), &block), pairs(&[]));
    }

    #[test]
    fn polluted_process_gets_user_scoped_variables_overwritten() {
        let sys = "C:\\Windows\\system32\\config\\systemprofile";
        let block = pairs(&[
            ("USERPROFILE", "C:\\u"),
            ("LocalAppData", "C:\\u\\AppData\\Local"),
            ("TEMP", "C:\\u\\AppData\\Local\\Temp"),
            ("ComSpec", "C:\\other\\cmd.exe"),
            ("Path", "C:\\sys;C:\\u\\.bun\\bin"),
        ]);
        let local = format!("{sys}\\AppData\\Local");
        let vars = [
            ("USERPROFILE", sys),
            ("LOCALAPPDATA", local.as_str()),
            ("TEMP", "C:\\Windows\\TEMP"),
            ("COMSPEC", "C:\\Windows\\system32\\cmd.exe"),
            ("PATH", "C:\\sys"),
        ];
        assert!(is_polluted(env(&vars), &block));
        let updates = plan_env_updates(env(&vars), &block);
        assert_eq!(
            updates,
            pairs(&[
                ("USERPROFILE", "C:\\u"),
                ("LocalAppData", "C:\\u\\AppData\\Local"),
                ("TEMP", "C:\\u\\AppData\\Local\\Temp"),
                ("Path", "C:\\sys;C:\\u\\.bun\\bin"),
            ])
        );
    }

    #[test]
    fn missing_path_variable_is_created() {
        let block = pairs(&[("PATH", "C:\\sys")]);
        let updates = plan_env_updates(env(&[]), &block);
        assert_eq!(updates, pairs(&[("PATH", "C:\\sys")]));
    }

    #[test]
    fn fallbacks_use_available_vars_only() {
        let vars = [("USERPROFILE", "C:\\u"), ("LOCALAPPDATA", "")];
        let list = fallback_candidates(env(&vars));
        assert!(list.contains(
            &PathBuf::from("C:\\u")
                .join(".bun")
                .join("bin")
                .join("omp.exe")
        ));
        assert!(list.iter().all(|p| p.starts_with("C:\\u")));
        assert!(list
            .iter()
            .all(|p| p.extension().is_some_and(|e| e == "exe")));
        assert_eq!(list.len(), 3);
    }
}
