//! Startup grace period after an in-app update.
//!
//! Right after an update the freshly installed app is relaunched while omp
//! may still be briefly unavailable (files locked or being scanned, PATH not
//! settled). Spawning once and caching the failure shows a scary error banner
//! that clears on its own a few seconds later. Instead, the first start after
//! an update keeps retrying for a bounded time.
//!
//! The updater cannot hand state to the new process in memory (on Windows the
//! installer relaunches the app), so a small marker file in the app local
//! data directory carries the "just updated" signal across the restart.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Manager};

/// File name of the marker inside the app local data directory.
const MARKER_FILE: &str = "update-restart.flag";
/// A marker older than this is stale (the update never restarted) and ignored.
// `Duration::from_mins` is too new for the stable toolchain CI pins.
#[allow(clippy::duration_suboptimal_units)]
const MARKER_MAX_AGE: Duration = Duration::from_secs(10 * 60);
/// How long a post-update start keeps retrying before giving up.
pub const GRACE_TOTAL: Duration = Duration::from_secs(30);
/// Pause between spawn attempts during the grace period.
pub const GRACE_INTERVAL: Duration = Duration::from_millis(500);

/// Delay before the next spawn attempt, or `None` once the grace period
/// is used up (`elapsed` is the time since the first attempt).
pub fn next_delay(elapsed: Duration) -> Option<Duration> {
    let remaining = GRACE_TOTAL.checked_sub(elapsed)?;
    if remaining.is_zero() {
        return None;
    }
    Some(GRACE_INTERVAL.min(remaining))
}

/// Run `attempt` until it succeeds or the grace period is used up.
///
/// `elapsed` reports the time since the first attempt (attempts themselves
/// can be slow, so wall time rather than a sleep tally); `wait` sleeps for
/// the given delay and returns `false` to cancel. The last error is returned
/// when giving up or cancelled.
pub fn retry_with_grace<E>(
    mut attempt: impl FnMut() -> Result<(), E>,
    mut elapsed: impl FnMut() -> Duration,
    mut wait: impl FnMut(Duration) -> bool,
) -> Result<(), E> {
    loop {
        let err = match attempt() {
            Ok(()) => return Ok(()),
            Err(e) => e,
        };
        let Some(delay) = next_delay(elapsed()) else {
            return Err(err);
        };
        if !wait(delay) {
            return Err(err);
        }
    }
}

/// True when a marker last modified at `modified` is still valid at `now`.
/// A modification time in the future (clock skew) counts as fresh.
fn is_fresh(modified: SystemTime, now: SystemTime) -> bool {
    now.duration_since(modified)
        .map_or(true, |age| age <= MARKER_MAX_AGE)
}

fn marker_path(dir: &Path) -> PathBuf {
    dir.join(MARKER_FILE)
}

/// Record that an update is about to restart the app.
fn write_marker(dir: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    fs::write(marker_path(dir), b"")
}

/// Consume the marker: returns true if a fresh one existed. The file is
/// removed either way so a stale marker never lingers.
fn take_marker(dir: &Path, now: SystemTime) -> bool {
    let path = marker_path(dir);
    let Ok(meta) = fs::metadata(&path) else {
        return false;
    };
    let fresh = meta.modified().map_or(true, |m| is_fresh(m, now));
    let _ = fs::remove_file(&path);
    fresh
}

/// Write the post-update marker. Failure is logged only: it merely costs the
/// extended wait, so it must never fail the update itself.
pub fn mark_update_restart(app: &AppHandle) {
    match app.path().app_local_data_dir() {
        Ok(dir) => {
            if let Err(e) = write_marker(&dir) {
                eprintln!("[pidesk] could not write update marker: {e}");
            }
        }
        Err(e) => eprintln!("[pidesk] app local data dir unavailable: {e}"),
    }
}

/// True (once) when this launch directly follows an in-app update.
pub fn take_update_marker(app: &AppHandle) -> bool {
    app.path()
        .app_local_data_dir()
        .is_ok_and(|dir| take_marker(&dir, SystemTime::now()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pidesk-grace-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn next_delay_steps_until_total_then_stops() {
        assert_eq!(next_delay(Duration::ZERO), Some(GRACE_INTERVAL));
        assert_eq!(next_delay(Duration::from_secs(10)), Some(GRACE_INTERVAL));
        assert_eq!(next_delay(GRACE_TOTAL), None);
        assert_eq!(next_delay(GRACE_TOTAL + Duration::from_secs(1)), None);
    }

    #[test]
    fn next_delay_never_overshoots_the_deadline() {
        let elapsed = Duration::from_millis(29_900);
        assert_eq!(next_delay(elapsed), Some(Duration::from_millis(100)));
    }

    #[test]
    fn total_attempts_are_bounded() {
        let mut elapsed = Duration::ZERO;
        let mut sleeps = 0u32;
        while let Some(d) = next_delay(elapsed) {
            elapsed += d;
            sleeps += 1;
        }
        assert_eq!(elapsed, GRACE_TOTAL);
        assert_eq!(sleeps, 60);
    }

    /// Virtual clock: each `wait` advances time by the requested delay.
    fn run_virtual(fail_times: u32, cancel_after: Option<u32>) -> (Result<(), String>, u32) {
        let clock = std::cell::Cell::new(Duration::ZERO);
        let attempts = std::cell::Cell::new(0u32);
        let waits = std::cell::Cell::new(0u32);
        let result = retry_with_grace(
            || {
                attempts.set(attempts.get() + 1);
                if attempts.get() > fail_times {
                    Ok(())
                } else {
                    Err(format!("fail {}", attempts.get()))
                }
            },
            || clock.get(),
            |d| {
                waits.set(waits.get() + 1);
                clock.set(clock.get() + d);
                cancel_after.is_none_or(|n| waits.get() <= n)
            },
        );
        (result, attempts.get())
    }

    #[test]
    fn retry_succeeds_after_transient_failures() {
        let (result, attempts) = run_virtual(3, None);
        assert_eq!(result, Ok(()));
        assert_eq!(attempts, 4);
    }

    #[test]
    fn retry_succeeds_first_try_without_waiting() {
        let (result, attempts) = run_virtual(0, None);
        assert_eq!(result, Ok(()));
        assert_eq!(attempts, 1);
    }

    #[test]
    fn retry_gives_up_after_grace_with_last_error() {
        let (result, attempts) = run_virtual(u32::MAX, None);
        // One attempt up front plus one after each of the 60 waits.
        assert_eq!(attempts, 61);
        assert_eq!(result, Err("fail 61".to_string()));
    }

    #[test]
    fn retry_stops_when_cancelled() {
        let (result, attempts) = run_virtual(u32::MAX, Some(2));
        assert_eq!(attempts, 3);
        assert_eq!(result, Err("fail 3".to_string()));
    }

    #[test]
    fn freshness_window() {
        let now = SystemTime::now();
        assert!(is_fresh(now, now));
        assert!(is_fresh(now - Duration::from_secs(60), now));
        assert!(!is_fresh(
            now - MARKER_MAX_AGE - Duration::from_secs(1),
            now
        ));
        assert!(is_fresh(now + Duration::from_secs(30), now));
    }

    #[test]
    fn marker_is_consumed_exactly_once() {
        let dir = scratch_dir("once");
        assert!(!take_marker(&dir, SystemTime::now()));
        write_marker(&dir).expect("write marker");
        assert!(take_marker(&dir, SystemTime::now()));
        assert!(!marker_path(&dir).exists());
        assert!(!take_marker(&dir, SystemTime::now()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn stale_marker_is_ignored_but_removed() {
        let dir = scratch_dir("stale");
        write_marker(&dir).expect("write marker");
        let later = SystemTime::now() + MARKER_MAX_AGE + Duration::from_secs(60);
        assert!(!take_marker(&dir, later));
        assert!(!marker_path(&dir).exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
