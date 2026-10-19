//! Per-session omp process bridge.
//!
//! Each tab owns one omp child process spawned via `start_session`. Its
//! stdout is forwarded as `agent://line/{session_id}` Tauri events; its
//! exit (clean or otherwise) is announced as `agent://exit/{session_id}`.
//!
//! Submodules:
//! - [`inner`]  — `BridgeInner` per-session record (generation token,
//!   per-stdin mutex, child handle).
//! - [`spawn`]  — `spawn_omp` candidate-list resolution + Windows
//!   `CREATE_NO_WINDOW` flag.
//! - [`reader`] — stdout/stderr reader threads + bounded `read_until_capped`.
//! - [`workspace`] — default (app-private) cwd for "no project" sessions.

pub mod grace;
mod inner;
mod reader;
pub mod spawn;
pub mod workspace;

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;
use tauri::{AppHandle, Manager};

use inner::BridgeInner;
use reader::{spawn_stderr_reader, spawn_stdout_reader};
pub use spawn::ensure_gui_path;
use spawn::spawn_omp;

/// Manages one omp process per tab session.
///
/// # Events
/// - `agent://line/{session_id}` — payload: a single JSON-encoded RPC
///   line (string). One event per line that omp wrote to stdout.
/// - `agent://exit/{session_id}` — payload: a string. Empty (`""`) on
///   normal process exit; non-empty contains a human-readable error
///   describing why the session ended (spawn failed, line truncated past
///   the safety cap, etc.). Frontends should treat any non-empty payload
///   as an error reason to surface.
pub struct AgentBridge {
    sessions: Arc<Mutex<HashMap<String, BridgeInner>>>,
    /// Cached spawn / startup errors keyed by `session_id`. Populated on
    /// `start_session` failure, cleared on success. `send` checks this
    /// when no live session is found so the frontend gets the *real*
    /// reason (e.g. "omp not on PATH") instead of a generic "session not
    /// found". Also exposed via the `session_status` Tauri command for
    /// proactive frontend queries.
    last_errors: Arc<Mutex<HashMap<String, String>>>,
    /// Sessions whose post-update grace-period start is still retrying.
    starting: Mutex<HashSet<String>>,
    next_gen: AtomicU64,
}

impl AgentBridge {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            last_errors: Arc::new(Mutex::new(HashMap::new())),
            starting: Mutex::new(HashSet::new()),
            next_gen: AtomicU64::new(1),
        }
    }

    /// Spawn omp for a session. If a session with this id already exists
    /// it is replaced atomically; the previous child is reaped on a
    /// background thread so this never blocks. On spawn failure the
    /// error string is cached so subsequent `send` / `session_status`
    /// calls can surface the real reason.
    pub fn start_session(
        &self,
        session_id: String,
        cwd: Option<&str>,
        resume: Option<&str>,
        app: AppHandle,
    ) -> Result<(), String> {
        // No project specified — pin the child to the dedicated app-private
        // workspace instead of letting it inherit the ambient CWD of the
        // Tauri process (fragile and different per launch site) or the exe
        // directory (can sit inside a repo under `cargo run`, or be
        // read-only under Program Files). The workspace stays empty so no
        // project files influence the agent. It is only created when needed.
        let cwd_path: Cow<'_, Path> = cwd.filter(|d| !d.is_empty()).map_or_else(
            || Cow::Owned(workspace::default_cwd(&app)),
            |dir| Cow::Borrowed(Path::new(dir)),
        );
        // An explicit start supersedes any grace-period retry loop.
        self.set_starting(&session_id, false);
        self.spawn_and_install(&session_id, &cwd_path, resume, &app)
            .inspect_err(|e| self.cache_error(&session_id, e.clone()))
    }

    /// Start a session on a background thread, retrying spawn failures for
    /// the post-update grace period (see [`grace`]). Returns immediately;
    /// the session counts as *starting* ([`Self::is_starting`]) until it
    /// is running or the grace period ends, and only then is a failure
    /// cached for `session_status`.
    pub fn start_session_with_grace(
        app: &AppHandle,
        session_id: String,
        cwd: Option<String>,
        resume: Option<String>,
    ) {
        let bridge = app.state::<Self>();
        bridge.clear_error(&session_id);
        bridge.set_starting(&session_id, true);
        let app = app.clone();
        thread::spawn(move || {
            let bridge = app.state::<Self>();
            let cwd_path = cwd.as_deref().filter(|d| !d.is_empty()).map_or_else(
                || workspace::default_cwd(&app),
                |dir| Path::new(dir).to_path_buf(),
            );
            let began = Instant::now();
            let result = grace::retry_with_grace(
                || bridge.spawn_and_install(&session_id, &cwd_path, resume.as_deref(), &app),
                || began.elapsed(),
                |delay| {
                    thread::sleep(delay);
                    bridge.is_starting(&session_id)
                },
            );
            // `false` here means an explicit start/stop took over: leave
            // its state alone instead of reporting our stale outcome.
            if bridge.set_starting(&session_id, false) {
                if let Err(e) = result {
                    eprintln!("[pidesk] session '{session_id}' did not start within grace: {e}");
                    bridge.cache_error(&session_id, e);
                }
            }
        });
    }

    /// Spawn omp and register it as `session_id`, replacing any previous
    /// incarnation. Does not touch the cached-error state on failure; callers
    /// decide whether a failure is final.
    fn spawn_and_install(
        &self,
        session_id: &str,
        cwd_path: &Path,
        resume: Option<&str>,
        app: &AppHandle,
    ) -> Result<(), String> {
        let mut child = spawn_omp(cwd_path, resume)?;
        let stdin = child.stdin.take().expect("stdin piped");
        let stdout = child.stdout.take().expect("stdout piped");
        let stderr = child.stderr.take().expect("stderr piped");
        let stdin_arc = Arc::new(Mutex::new(stdin));
        let gen = self.next_gen.fetch_add(1, Ordering::SeqCst);

        // Atomic install: drop any previous BridgeInner under the lock,
        // install the new one in the same critical section.
        let prev = {
            let mut s = self
                .sessions
                .lock()
                .map_err(|_| "lock poisoned".to_string())?;
            s.insert(
                session_id.to_owned(),
                BridgeInner {
                    gen,
                    stdin: Some(stdin_arc),
                    child: Some(child),
                },
            )
        };
        if let Some(mut prev) = prev {
            prev.stdin = None;
            if let Some(mut c) = prev.child.take() {
                // Reap off-thread so the Tauri command thread is never
                // blocked by a stuck process.
                thread::spawn(move || {
                    let _ = c.kill();
                    let _ = c.wait();
                });
            }
        }

        // Successful spawn — clear any cached error from a previous
        // failed attempt for this id.
        self.clear_error(session_id);

        let stderr_lines = Arc::new(Mutex::new(Vec::new()));
        spawn_stdout_reader(
            self.sessions.clone(),
            self.last_errors.clone(),
            stderr_lines.clone(),
            session_id.to_owned(),
            gen,
            app.clone(),
            stdout,
        );
        spawn_stderr_reader(session_id.to_owned(), stderr, stderr_lines);
        Ok(())
    }

    /// True while a grace-period start for `session_id` is still retrying.
    pub fn is_starting(&self, session_id: &str) -> bool {
        self.starting
            .lock()
            .is_ok_and(|set| set.contains(session_id))
    }

    /// Add/remove `session_id` from the starting set. Returns whether the
    /// set changed (i.e. for `false`: it *was* starting).
    fn set_starting(&self, session_id: &str, starting: bool) -> bool {
        let Ok(mut set) = self.starting.lock() else {
            return false;
        };
        if starting {
            set.insert(session_id.to_owned())
        } else {
            set.remove(session_id)
        }
    }

    /// Check if a session process is currently registered and active.
    pub fn is_running(&self, session_id: &str) -> bool {
        let Ok(s) = self.sessions.lock() else {
            return false;
        };
        s.contains_key(session_id)
    }

    pub fn stop_session(&self, session_id: &str) {
        self.set_starting(session_id, false);
        let removed = {
            // Best-effort cleanup: silently bail on a poisoned lock
            // rather than panicking. The map is only readable in error
            // paths from this point on anyway.
            let Ok(mut s) = self.sessions.lock() else {
                return;
            };
            s.remove(session_id)
        };
        if let Some(mut inner) = removed {
            inner.stdin = None;
            if let Some(mut c) = inner.child.take() {
                thread::spawn(move || {
                    let _ = c.kill();
                    let _ = c.wait();
                });
            }
        }
        self.clear_error(session_id);
    }

    /// Write a JSON line to the session's stdin. The map lock is held only
    /// long enough to clone the per-session stdin Arc; the actual write
    /// happens without the map lock so a blocked pipe never deadlocks
    /// concurrent management calls. If the session isn't running, the
    /// cached startup error (if any) takes precedence over a generic
    /// "session not found" so the frontend gets the real reason.
    pub fn send(&self, session_id: &str, line: &str) -> Result<(), String> {
        let stdin_arc = {
            let s = self
                .sessions
                .lock()
                .map_err(|_| "lock poisoned".to_string())?;
            if let Some(inner) = s.get(session_id) {
                inner.stdin.clone()
            } else {
                if self.is_starting(session_id) {
                    return Err("agent is starting".to_string());
                }
                if let Some(err) = self.last_error(session_id) {
                    return Err(err);
                }
                return Err(format!("session '{session_id}' not found"));
            }
        };
        let stdin_arc = stdin_arc.ok_or_else(|| "agent not running".to_string())?;

        // Strip any trailing CR/LF the caller appended. The omp RPC parser
        // is line-framed — a stray blank line corrupts the stream and a
        // newline embedded inside `line` would split one logical message
        // across two frames. We only handle the trailing case here; the
        // frontend is responsible for not embedding raw newlines in JSON
        // (which is invalid JSON anyway).
        let trimmed = line.trim_end_matches(['\r', '\n']);

        let mut stdin = stdin_arc
            .lock()
            .map_err(|_| "stdin lock poisoned".to_string())?;
        writeln!(*stdin, "{trimmed}").map_err(|e| e.to_string())?;
        // ChildStdin is unbuffered, but flush() costs nothing and keeps
        // the contract explicit.
        stdin.flush().map_err(|e| e.to_string())
    }

    /// Look up the last cached spawn / startup error for a `session_id`.
    /// Returns `None` if the session is currently running cleanly (or
    /// has never been started for this id).
    pub fn last_error(&self, session_id: &str) -> Option<String> {
        let Ok(errs) = self.last_errors.lock() else {
            return None;
        };
        errs.get(session_id).cloned()
    }

    fn cache_error(&self, session_id: &str, err: String) {
        if let Ok(mut errs) = self.last_errors.lock() {
            errs.insert(session_id.to_string(), err);
        }
    }

    fn clear_error(&self, session_id: &str) {
        if let Ok(mut errs) = self.last_errors.lock() {
            errs.remove(session_id);
        }
    }
}

impl Default for AgentBridge {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentBridge {
    /// Kill and reap every session's child synchronously. Used on drop and
    /// before an in-process restart (which skips managed-state destructors),
    /// so no omp process is orphaned.
    pub fn stop_all(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for (_, mut inner) in sessions.drain() {
                inner.stdin = None;
                if let Some(mut c) = inner.child.take() {
                    let _ = c.kill();
                    let _ = c.wait();
                }
            }
        }
    }
}

impl Drop for AgentBridge {
    fn drop(&mut self) {
        self.stop_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starting_flag_tracks_set_and_clear() {
        let bridge = AgentBridge::new();
        assert!(!bridge.is_starting("a"));
        assert!(bridge.set_starting("a", true));
        assert!(bridge.is_starting("a"));
        assert!(!bridge.is_starting("b"));
        assert!(bridge.set_starting("a", false));
        assert!(!bridge.is_starting("a"));
        // Clearing something that was never starting reports no change,
        // which is how a grace thread detects it was superseded.
        assert!(!bridge.set_starting("a", false));
    }

    #[test]
    fn send_reports_starting_before_generic_not_found() {
        let bridge = AgentBridge::new();
        assert_eq!(
            bridge.send("a", "{}"),
            Err("session 'a' not found".to_string())
        );
        bridge.set_starting("a", true);
        assert_eq!(bridge.send("a", "{}"), Err("agent is starting".to_string()));
        bridge.set_starting("a", false);
        bridge.cache_error("a", "boom".to_string());
        assert_eq!(bridge.send("a", "{}"), Err("boom".to_string()));
    }

    #[test]
    fn stop_session_cancels_a_pending_start() {
        let bridge = AgentBridge::new();
        bridge.set_starting("a", true);
        bridge.stop_session("a");
        assert!(!bridge.is_starting("a"));
    }
}
