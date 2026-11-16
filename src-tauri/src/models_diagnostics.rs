//! Detect a `models.yml` that omp rejects.
//!
//! omp validates `models.yml` at startup and, on a schema error, disables
//! *every* custom provider. In `--mode rpc` it says nothing about it (no
//! stderr, no event), so the custom models simply vanish from the running
//! agent. The one place the reason is printed is the `omp models` CLI, which
//! this module runs on demand.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::agent::spawn::{hide_console_window, omp_candidates};

const MARKER: &str = "models.yml validation failed";
/// `omp models` may touch the network for its catalog; never wait forever.
const TIMEOUT: Duration = Duration::from_secs(30);

/// Pull the validation failure out of `omp models` output: the indented
/// detail lines under the `models.yml validation failed` header (or the
/// header itself when there are none). `None` when the config loaded fine.
fn extract_validation_warning(output: &str) -> Option<String> {
    let mut lines = output.lines();
    let header = lines.find(|l| l.contains(MARKER))?;
    let details: Vec<&str> = lines
        .take_while(|l| l.starts_with(char::is_whitespace) && !l.trim().is_empty())
        .map(str::trim)
        .collect();
    Some(if details.is_empty() {
        header.trim().to_owned()
    } else {
        details.join("\n")
    })
}

fn drain<R: Read + Send + 'static>(mut reader: R) -> JoinHandle<String> {
    thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = reader.read_to_end(&mut buf);
        String::from_utf8_lossy(&buf).into_owned()
    })
}

/// Run `omp models` and return its combined stdout+stderr. `None` when the
/// binary could not be started.
fn run_omp_models(path: &Path) -> Option<String> {
    let mut cmd = Command::new(path);
    cmd.args(["models", "--no-extensions"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console_window(&mut cmd);
    let mut child = cmd.spawn().ok()?;
    let stdout = drain(child.stdout.take()?);
    let stderr = drain(child.stderr.take()?);

    let began = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if began.elapsed() < TIMEOUT => thread::sleep(Duration::from_millis(100)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
        }
    }
    let err = stderr.join().unwrap_or_default();
    let out = stdout.join().unwrap_or_default();
    Some(format!("{err}\n{out}"))
}

/// Why omp would ignore the user's custom models, if it does: the schema
/// error from `models.yml`. `None` when the config is valid or omp could not
/// be run (nothing trustworthy to report). Blocks for a few seconds, so the
/// frontend only calls it once it already sees models missing from omp.
///
/// `async` + `spawn_blocking`: a sync command would run on the main thread and
/// freeze the window while `omp models` is polled.
#[tauri::command]
pub async fn check_models_config() -> Option<String> {
    tauri::async_runtime::spawn_blocking(|| {
        omp_candidates()
            .into_iter()
            .find_map(|path| run_omp_models(&path))
            .and_then(|text| extract_validation_warning(&text))
    })
    .await
    .ok()
    .flatten()
}

#[cfg(test)]
mod tests {
    use super::extract_validation_warning;

    #[test]
    fn extracts_detail_lines_under_the_header() {
        let out = "Warning: models.yml validation failed — custom providers disabled\r\n  \
                   Failed to load config file models, Schema error: providers.local-qwen.apiKey: \
                   must be a string (was a number)\r\n\r\nNo models matching \"arkcode\"\r\n";
        assert_eq!(
            extract_validation_warning(out).as_deref(),
            Some(
                "Failed to load config file models, Schema error: providers.local-qwen.apiKey: \
                 must be a string (was a number)"
            )
        );
    }

    #[test]
    fn keeps_multiple_detail_lines_and_stops_at_unindented_text() {
        let out = "x\nWarning: models.yml validation failed\n  a\n  b\nzzz\n  c\n";
        assert_eq!(extract_validation_warning(out).as_deref(), Some("a\nb"));
    }

    #[test]
    fn falls_back_to_the_header_without_details() {
        let out = "Warning: models.yml validation failed — custom providers disabled\n";
        assert_eq!(
            extract_validation_warning(out).as_deref(),
            Some("Warning: models.yml validation failed — custom providers disabled")
        );
    }

    #[test]
    fn none_when_config_is_valid() {
        assert_eq!(extract_validation_warning(""), None);
        assert_eq!(
            extract_validation_warning("anthropic\n  claude-opus\n"),
            None
        );
    }
}
