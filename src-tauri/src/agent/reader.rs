use std::collections::HashMap;
use std::io::{BufRead, BufReader, ErrorKind};
use std::process::{ChildStderr, ChildStdout};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};

use super::inner::BridgeInner;

/// Hard cap on a single RPC line. Defends the reader thread from runaway
/// agent output that could otherwise allocate unbounded memory.
const MAX_LINE_BYTES: usize = 16 * 1024 * 1024;

pub(super) fn spawn_stdout_reader(
    sessions: Arc<Mutex<HashMap<String, BridgeInner>>>,
    last_errors: Arc<Mutex<HashMap<String, String>>>,
    stderr_lines: Arc<Mutex<Vec<String>>>,
    sid: String,
    gen: u64,
    app: AppHandle,
    stdout: ChildStdout,
) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let line_event = format!("agent://line/{sid}");
        let exit_event = format!("agent://exit/{sid}");
        let mut buf: Vec<u8> = Vec::with_capacity(8192);
        let mut exit_reason = String::new();

        loop {
            buf.clear();
            match read_until_capped(&mut reader, b'\n', &mut buf, MAX_LINE_BYTES) {
                Ok((0, _)) => break, // EOF — pipe closed, child exited
                Ok((_, true)) => {
                    // Line was longer than MAX_LINE_BYTES. We drained the
                    // pipe through the next '\n' but `buf` holds only a
                    // truncated prefix — emitting it would feed the
                    // frontend invalid JSON, which JSON.parse drops
                    // silently and surfaces as "the agent skipped a turn".
                    // Drop the line, log clearly, and keep reading.
                    eprintln!(
                        "[omp/{sid}] dropped a stdout line that exceeded {MAX_LINE_BYTES} bytes; \
                         frontend will not see this RPC message"
                    );
                }
                Ok((_, false)) => {
                    // Strip trailing CR/LF.
                    while matches!(buf.last(), Some(b'\n' | b'\r')) {
                        buf.pop();
                    }
                    if buf.is_empty() {
                        continue;
                    }
                    let text = String::from_utf8_lossy(&buf).into_owned();
                    let _ = app.emit(&line_event, text);
                }
                Err(e) => {
                    exit_reason = format!("stdout read error: {e}");
                    break;
                }
            }
        }

        // Brief delay to give stderr reader thread time to drain trailing output
        thread::sleep(std::time::Duration::from_millis(50));

        // Process exited. Only remove our own map entry — if start_session
        // already replaced this session with a fresh incarnation (higher
        // generation), leave it alone.
        let removed = if let Ok(mut s) = sessions.lock() {
            if let Some(inner) = s.get(&sid) {
                if inner.gen == gen {
                    s.remove(&sid)
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };

        if exit_reason.is_empty() {
            let stderr_tail = stderr_lines
                .lock()
                .map(|lines| lines.join("\n").trim().to_string())
                .unwrap_or_default();

            let exit_status = removed
                .and_then(|mut inner| inner.child.take())
                .and_then(|mut c| c.try_wait().ok().flatten());

            if !stderr_tail.is_empty() {
                exit_reason = stderr_tail;
            } else if let Some(status) = exit_status {
                if !status.success() {
                    exit_reason = format!("Process exited with status {status}");
                }
            }
        }

        if !exit_reason.is_empty() {
            if let Ok(mut errs) = last_errors.lock() {
                errs.insert(sid.clone(), exit_reason.clone());
            }
        }

        // Empty payload = clean exit; non-empty = error reason. See the
        // AgentBridge doc-comment for the full event contract.
        let _ = app.emit(&exit_event, exit_reason);
    });
}

pub(super) fn spawn_stderr_reader(
    sid: String,
    stderr: ChildStderr,
    stderr_lines: Arc<Mutex<Vec<String>>>,
) {
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            eprintln!("[omp/{sid}] {line}");
            if let Ok(mut lines) = stderr_lines.lock() {
                if lines.len() >= 30 {
                    lines.remove(0);
                }
                lines.push(line);
            }
        }
    });
}

/// `BufRead::read_until` with a hard byte cap. Once the cap is reached
/// further bytes are consumed off the pipe but discarded — readers never
/// allocate unbounded memory on runaway output.
///
/// Returns `(consumed, truncated)`:
/// - `consumed` = total bytes read off the pipe (including the delimiter).
///   Zero means EOF.
/// - `truncated` = `true` if the line was longer than `max` and the data
///   in `out` is a *prefix* of the actual line. Callers should refuse to
///   forward truncated payloads as if they were complete.
fn read_until_capped<R: BufRead>(
    r: &mut R,
    delim: u8,
    out: &mut Vec<u8>,
    max: usize,
) -> std::io::Result<(usize, bool)> {
    let mut total = 0;
    let mut truncated = false;
    loop {
        let avail = match r.fill_buf() {
            Ok(b) => b,
            Err(ref e) if e.kind() == ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        };
        if avail.is_empty() {
            return Ok((total, truncated));
        }
        let room = max.saturating_sub(out.len());
        let used = if let Some(i) = avail.iter().position(|&b| b == delim) {
            // Found the delimiter — frame the line and return.
            let take = (i + 1).min(room);
            if take < i + 1 {
                truncated = true;
            }
            out.extend_from_slice(&avail[..take]);
            let used = i + 1;
            r.consume(used);
            total += used;
            return Ok((total, truncated));
        } else {
            // No delimiter in the available chunk — keep reading.
            let take = avail.len().min(room);
            if take < avail.len() {
                truncated = true;
            }
            if take > 0 {
                out.extend_from_slice(&avail[..take]);
            }
            avail.len()
        };
        r.consume(used);
        total += used;
    }
}
