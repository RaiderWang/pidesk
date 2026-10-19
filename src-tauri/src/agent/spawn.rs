#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::process::{Child, Command, Stdio};
use std::sync::OnceLock;

/// Windows: prevent a console window from flashing when we spawn omp.exe
/// from a GUI-subsystem parent. omp speaks JSON-RPC over stdio, so it's
/// almost certainly a console-subsystem binary; without this flag Windows
/// would attach a fresh console (visible flash) on every spawn.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Keep short-lived helper processes (e.g. `git`) from flashing a console
/// window on Windows. No-op on other platforms.
pub fn hide_console_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

/// Ensure PATH contains standard user binary directories on Unix (macOS / Linux).
/// macOS GUI apps launched from Finder/Dock run under launchd with a minimal
/// PATH (/usr/bin:/bin:/usr/sbin:/sbin), missing tools in ~/.bun/bin, /opt/homebrew/bin, etc.
// Body is empty on Windows; on Unix it mutates PATH and cannot be `const`.
#[cfg_attr(windows, allow(clippy::missing_const_for_fn))]
pub fn ensure_gui_path() {
    #[cfg(not(windows))]
    {
        static PATH_INITIALIZED: OnceLock<()> = OnceLock::new();
        PATH_INITIALIZED.get_or_init(|| {
            let current = std::env::var("PATH").unwrap_or_default();
            let mut extra = Vec::new();

            if let Ok(home) = std::env::var("HOME") {
                let h = std::path::Path::new(&home);
                extra.push(h.join(".bun/bin"));
                extra.push(h.join(".cargo/bin"));
                extra.push(h.join(".local/bin"));

                // Node / NVM versions if installed
                let nvm_versions = h.join(".nvm/versions/node");
                if let Ok(entries) = std::fs::read_dir(&nvm_versions) {
                    for entry in entries.flatten() {
                        let bin = entry.path().join("bin");
                        if bin.is_dir() {
                            extra.push(bin);
                        }
                    }
                }
            }

            extra.push(std::path::PathBuf::from("/opt/homebrew/bin"));
            extra.push(std::path::PathBuf::from("/opt/homebrew/sbin"));
            extra.push(std::path::PathBuf::from("/usr/local/bin"));
            extra.push(std::path::PathBuf::from("/usr/local/sbin"));

            let current_parts: Vec<&str> = current.split(':').collect();
            let mut to_prepend = Vec::new();
            for dir in extra {
                if dir.is_dir() {
                    let s = dir.to_string_lossy().to_string();
                    if !current_parts.iter().any(|&p| p == s) {
                        to_prepend.push(s);
                    }
                }
            }

            if !to_prepend.is_empty() {
                let new_path = format!("{}:{}", to_prepend.join(":"), current);
                std::env::set_var("PATH", &new_path);
            }
        });
    }
}

/// Candidate binary paths tried in order.
fn omp_candidates() -> Vec<std::path::PathBuf> {
    ensure_gui_path();
    let mut list = Vec::new();
    if cfg!(windows) {
        list.push(std::path::PathBuf::from("omp.exe"));
        list.push(std::path::PathBuf::from("omp"));
    } else {
        list.push(std::path::PathBuf::from("omp"));
        if let Ok(home) = std::env::var("HOME") {
            let h = std::path::Path::new(&home);
            list.push(h.join(".bun/bin/omp"));
            list.push(h.join(".cargo/bin/omp"));
            list.push(h.join(".local/bin/omp"));
        }
        list.push(std::path::PathBuf::from("/opt/homebrew/bin/omp"));
        list.push(std::path::PathBuf::from("/usr/local/bin/omp"));
    }
    list
}

// ── rpc-ui probe ─────────────────────────────────────────────────────────────

/// Probe result cache. Only filled when the probe actually ran, so an omp
/// that is briefly missing (e.g. right after an update) does not pin the
/// process to plain `rpc` forever.
static RPC_UI_SUPPORTED: OnceLock<bool> = OnceLock::new();

/// Return the RPC mode string to use when spawning omp.
/// Calls `omp --help` on first use and checks whether `rpc-ui` appears in the
/// output. A conclusive result is cached in a `OnceLock` for the process
/// lifetime; an inconclusive one (omp not found) falls back to `rpc` for this
/// spawn only and is probed again next time.
pub(super) fn rpc_mode() -> &'static str {
    let (supported, cache) = resolve_probe(RPC_UI_SUPPORTED.get().copied(), probe_rpc_ui);
    if cache {
        let _ = RPC_UI_SUPPORTED.set(supported);
    }
    if supported {
        "rpc-ui"
    } else {
        "rpc"
    }
}

/// Combine the cached probe result with a fresh probe.
/// Returns `(supported, should_cache)`; `probe` only runs on a cache miss and
/// reports `None` when omp could not be run at all.
fn resolve_probe(cached: Option<bool>, probe: impl FnOnce() -> Option<bool>) -> (bool, bool) {
    if let Some(v) = cached {
        return (v, false);
    }
    probe().map_or((false, false), |v| (v, true))
}

/// Return true if the given help text advertises `rpc-ui` mode support.
/// Extracted as a pure function so it can be unit-tested without spawning omp.
fn help_text_supports_rpc_ui(text: &str) -> bool {
    text.contains("rpc-ui")
}

/// Run `omp --help`, collect stdout+stderr, and check for `rpc-ui`.
/// `None` means no candidate could be run, so the answer is unknown.
///
/// `--help` exits immediately without model initialisation or stdin reads,
/// so there are no pipe-buffering races and no dependency on API keys being
/// present in the environment. Old omp binaries that don't know about
/// `rpc-ui` simply won't mention it in their help output.
fn probe_rpc_ui() -> Option<bool> {
    for path in omp_candidates() {
        let mut cmd = Command::new(path);
        cmd.arg("--help")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let Ok(output) = cmd.output() else { continue };

        let text = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        );
        let supported = help_text_supports_rpc_ui(&text);
        eprintln!("[pidesk] rpc-ui probe: supported={supported}");
        return Some(supported);
    }
    // omp not found on PATH — spawn_omp will surface the real error.
    eprintln!("[pidesk] rpc-ui probe: omp not found, defaulting to rpc (not cached)");
    None
}

// ── session spawn ─────────────────────────────────────────────────────────────

/// Spawn omp for a live session using the best available RPC mode.
/// If `resume` is specified, `--resume <path_or_id>` is passed to resume an existing session.
/// `cwd` is the already-resolved working directory (see `AgentBridge::start_session`).
pub(super) fn spawn_omp(cwd: &std::path::Path, resume: Option<&str>) -> Result<Child, String> {
    let mode = rpc_mode();
    let mut last_err = String::from("no candidates tried");
    for path in omp_candidates() {
        let mut cmd = Command::new(&path);
        cmd.args(["--mode", mode]);
        if let Some(r) = resume {
            if !r.is_empty() {
                cmd.args(["--resume", r]);
            }
        }
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // Suppress the transient console window that Windows would
        // otherwise attach to a console-subsystem child of a GUI parent.
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.current_dir(cwd);
        match cmd.spawn() {
            Ok(child) => return Ok(child),
            Err(e) => {
                let msg = format!("{}: {e}", path.display());
                eprintln!("[pidesk] spawn attempt failed: {msg}");
                last_err = msg;
            }
        }
    }
    Err(format!(
        "failed to spawn omp ({last_err}). Make sure omp is installed and on PATH."
    ))
}

// ── tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::{help_text_supports_rpc_ui, resolve_probe};

    #[test]
    fn cached_probe_result_skips_the_probe() {
        let (v, cache) = resolve_probe(Some(true), || panic!("must not probe"));
        assert!(v);
        assert!(!cache);
    }

    #[test]
    fn conclusive_probe_is_cached() {
        assert_eq!(resolve_probe(None, || Some(true)), (true, true));
        assert_eq!(resolve_probe(None, || Some(false)), (false, true));
    }

    #[test]
    fn inconclusive_probe_falls_back_without_caching() {
        assert_eq!(resolve_probe(None, || None), (false, false));
    }

    #[test]
    fn detects_rpc_ui_in_mode_line() {
        let help = "  --mode=<value>   Output mode: text (default), json, rpc, or rpc-ui";
        assert!(help_text_supports_rpc_ui(help));
    }

    #[test]
    fn detects_rpc_ui_in_options_list() {
        let help = r#"options: ["text", "json", "rpc", "acp", "rpc-ui"]"#;
        assert!(help_text_supports_rpc_ui(help));
    }

    #[test]
    fn rejects_old_help_without_rpc_ui() {
        let help = "  --mode=<value>   Output mode: text (default), json, or rpc";
        assert!(!help_text_supports_rpc_ui(help));
    }

    #[test]
    fn rejects_empty_string() {
        assert!(!help_text_supports_rpc_ui(""));
    }

    #[test]
    fn rejects_partial_match_rpc() {
        // "rpc" alone must not satisfy the check
        assert!(!help_text_supports_rpc_ui("--mode rpc"));
    }

    #[test]
    fn accepts_rpc_ui_anywhere_in_text() {
        // Position in the string should not matter
        assert!(help_text_supports_rpc_ui("rpc-ui mode enables ask tool"));
        assert!(help_text_supports_rpc_ui(
            "supported modes: rpc-ui, rpc, text"
        ));
    }
}
