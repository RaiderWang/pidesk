//! Low-level `git` process helpers for the review drawer.
//!
//! Every invocation is hardened so output is machine-parseable regardless
//! of the user's / repository's git configuration, and stdout is read with a
//! hard byte cap (the child is killed once the cap is hit) so a gigantic
//! diff can never balloon memory.

use crate::agent::spawn::hide_console_window;
use std::io::Read;
use std::path::Path;
use std::process::{Command, ExitStatus, Stdio};

/// Output budget for a single unified diff query (8 MiB).
pub const MAX_DIFF_BYTES: usize = 8 * 1024 * 1024;
/// Budget for small listing queries (branches, commits, untracked paths).
pub const MAX_LIST_BYTES: usize = 1024 * 1024;
const STDERR_CAP: u64 = 64 * 1024;

/// Flags for every diff-producing command: no ANSI colour (`color.ui=always`),
/// no repo-configured external diff / textconv programs (arbitrary code
/// execution in untrusted repos), and fixed `a/` `b/` prefixes
/// (`diff.noprefix` / `diff.mnemonicPrefix` would break path parsing).
pub const DIFF_FLAGS: [&str; 5] = [
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--src-prefix=a/",
    "--dst-prefix=b/",
];

/// The well-known id of git's empty tree; the diff base for a repo with no commits.
pub const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/// A `git` command rooted at `cwd`, isolated from interactive / config surprises.
pub fn git_command(cwd: &Path) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(cwd)
        .args([
            "-c",
            "core.quotepath=false",
            "-c",
            "color.ui=never",
            "-c",
            "core.fsmonitor=false",
        ])
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null());
    hide_console_window(&mut cmd);
    cmd
}

/// Result of a capped run. `stdout` never exceeds the requested cap.
pub struct Captured {
    pub stdout: Vec<u8>,
    pub truncated: bool,
    pub status: ExitStatus,
    pub stderr: String,
}

/// Run `cmd`, reading at most `max` bytes of stdout. When the cap is exceeded
/// the child is killed and the output is cut back to the last full line.
pub fn run_capped(mut cmd: Command, max: usize) -> Result<Captured, String> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn git: {e}"))?;

    // Drain stderr on its own thread so a chatty child can't block on a full pipe.
    let stderr_thread = child.stderr.take().map(|pipe| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = pipe.take(STDERR_CAP).read_to_end(&mut buf);
            buf
        })
    });

    let mut stdout = Vec::new();
    // Read one byte past the cap so "exactly at the cap" isn't reported as truncated.
    let limit = u64::try_from(max).unwrap_or(u64::MAX).saturating_add(1);
    let read = child
        .stdout
        .take()
        .map_or(Ok(0), |pipe| pipe.take(limit).read_to_end(&mut stdout));
    let truncated = stdout.len() > max;
    if truncated {
        stdout.truncate(max);
        truncate_at_line_boundary(&mut stdout);
        let _ = child.kill();
    }

    let status = child
        .wait()
        .map_err(|e| format!("Failed to wait for git: {e}"))?;
    let stderr = stderr_thread
        .and_then(|t| t.join().ok())
        .map(|b| String::from_utf8_lossy(&b).trim().to_owned())
        .unwrap_or_default();
    read.map_err(|e| format!("Failed to read git output: {e}"))?;

    Ok(Captured {
        stdout,
        truncated,
        status,
        stderr,
    })
}

/// Run `cmd` expecting success; returns lossy UTF-8 stdout and the truncated flag.
pub fn run_git_text(cmd: Command, max: usize) -> Result<(String, bool), String> {
    let out = run_capped(cmd, max)?;
    // A deliberately killed (truncated) child exits non-zero; that is not an error.
    if !out.status.success() && !out.truncated {
        return Err(if out.stderr.is_empty() {
            format!("git exited with status {}", out.status)
        } else {
            out.stderr
        });
    }
    Ok((
        String::from_utf8_lossy(&out.stdout).into_owned(),
        out.truncated,
    ))
}

/// `true` when `cmd` exits successfully (output ignored).
pub fn succeeds(cmd: Command) -> bool {
    run_capped(cmd, 64 * 1024).is_ok_and(|o| o.status.success())
}

/// Cut `buf` back to just after its last newline so a diff never ends mid-line
/// (which also keeps multi-byte UTF-8 sequences intact). No newline → unchanged.
pub fn truncate_at_line_boundary(buf: &mut Vec<u8>) {
    if let Some(pos) = buf.iter().rposition(|&b| b == b'\n') {
        buf.truncate(pos + 1);
    }
}

/// Conservative allow-list check for a branch / commit / revision argument
/// coming from the frontend. Rejects option-looking values, range syntax,
/// whitespace/control characters and glob / path-ish punctuation.
pub fn is_safe_git_ref(r: &str) -> bool {
    !r.is_empty()
        && !r.starts_with('-')
        && !r.contains("..")
        && !r.chars().any(|c| {
            c.is_whitespace() || c.is_control() || matches!(c, ':' | '?' | '*' | '[' | '\\')
        })
}

/// Whether a `git` binary can be executed at all (positive result is cached).
pub fn git_available() -> bool {
    use std::sync::atomic::{AtomicBool, Ordering};
    static FOUND: AtomicBool = AtomicBool::new(false);
    if FOUND.load(Ordering::Relaxed) {
        return true;
    }
    let mut cmd = Command::new("git");
    cmd.arg("--version").stdin(Stdio::null());
    hide_console_window(&mut cmd);
    let ok = run_capped(cmd, 256).is_ok_and(|o| o.status.success());
    if ok {
        FOUND.store(true, Ordering::Relaxed);
    }
    ok
}

/// Test-only throwaway repositories (skipped gracefully when git is absent).
#[cfg(test)]
pub mod test_util {
    use super::{git_available, git_command};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    pub struct TempRepo {
        pub path: PathBuf,
    }

    impl TempRepo {
        pub fn new() -> Option<Self> {
            static N: AtomicUsize = AtomicUsize::new(0);
            if !git_available() {
                return None;
            }
            let path = std::env::temp_dir().join(format!(
                "pidesk-review-{}-{}",
                std::process::id(),
                N.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&path).ok()?;
            let repo = Self { path };
            repo.git(&["init", "-q"]);
            Some(repo)
        }

        pub fn git(&self, args: &[&str]) {
            let mut cmd = git_command(&self.path);
            cmd.args(["-c", "user.name=t", "-c", "user.email=t@t"])
                .args(args);
            let out = cmd.output().expect("git runs");
            assert!(
                out.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&out.stderr)
            );
        }

        pub fn write(&self, rel: &str, content: &str) {
            let p = self.path.join(rel);
            if let Some(dir) = p.parent() {
                std::fs::create_dir_all(dir).expect("mkdir");
            }
            std::fs::write(p, content).expect("write");
        }

        pub fn commit_all(&self, msg: &str) {
            self.git(&["add", "-A"]);
            self.git(&["commit", "-q", "-m", msg]);
        }
    }

    impl Drop for TempRepo {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncates_back_to_the_last_full_line() {
        let mut buf = b"one\ntwo\nthr".to_vec();
        truncate_at_line_boundary(&mut buf);
        assert_eq!(buf, b"one\ntwo\n");

        let mut no_newline = b"abc".to_vec();
        truncate_at_line_boundary(&mut no_newline);
        assert_eq!(no_newline, b"abc");
    }

    #[test]
    fn accepts_branches_hashes_and_revision_syntax() {
        for ok in [
            "main",
            "feature/x-1",
            "origin/dev",
            "a1b2c3d",
            "HEAD~2",
            "v1.0^",
            "@{u}",
        ] {
            assert!(is_safe_git_ref(ok), "{ok} should be accepted");
        }
    }

    #[test]
    fn rejects_option_injection_ranges_and_odd_characters() {
        for bad in [
            "",
            "-p",
            "--output=x",
            "a..b",
            "a...b",
            "a b",
            "a\tb",
            "a\nb",
            "a\0b",
            "a:b",
            "a*",
            "a?",
            "a[0]",
            "a\\b",
        ] {
            assert!(!is_safe_git_ref(bad), "{bad:?} should be rejected");
        }
    }

    #[test]
    fn cap_is_enforced_while_reading_and_ends_on_a_line_boundary() {
        if !git_available() {
            return;
        }
        let Some(repo) = test_util::TempRepo::new() else {
            return;
        };
        repo.write("big.txt", &"0123456789\n".repeat(2000));
        repo.commit_all("big");

        let mut cmd = git_command(&repo.path);
        cmd.args(["show", "--format=", "HEAD"]);
        let out = run_capped(cmd, 1000).expect("runs");
        assert!(out.truncated);
        assert!(out.stdout.len() <= 1000);
        assert_eq!(out.stdout.last(), Some(&b'\n'));
    }

    #[test]
    fn surfaces_git_stderr_on_failure() {
        if !git_available() {
            return;
        }
        let Some(repo) = test_util::TempRepo::new() else {
            return;
        };
        let mut cmd = git_command(&repo.path);
        cmd.args(["rev-parse", "--verify", "no-such-ref"]);
        let err = run_git_text(cmd, 1024).expect_err("must fail");
        assert_ne!(err, "");
    }

    #[test]
    fn small_output_is_complete_and_not_truncated() {
        if !git_available() {
            return;
        }
        let mut cmd = Command::new("git");
        cmd.arg("--version").stdin(Stdio::null());
        let (text, truncated) = run_git_text(cmd, 4096).expect("runs");
        assert!(text.starts_with("git version"));
        assert!(!truncated);
    }
}
