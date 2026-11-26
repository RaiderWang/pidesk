//! Trailing-edge debounce with a hard upper bound.
//!
//! A plain "wait for quiet" debounce is starved by a steady stream of writes
//! (a build, an agent rewriting files): the tree would never refresh until the
//! stream stops. [`MAX_WAIT`] forces an emit once the burst has been going
//! that long.

use std::{
    sync::mpsc::{Receiver, RecvTimeoutError},
    time::{Duration, Instant},
};

/// Quiet window that closes a burst.
pub const QUIET: Duration = Duration::from_millis(250);
/// Longest a burst may delay the emit, however busy it is.
pub const MAX_WAIT: Duration = Duration::from_millis(1000);

/// How long to keep waiting for more events, `None` once `max_wait` since the
/// burst started has elapsed and the burst must be flushed now.
pub fn next_wait(
    quiet: Duration,
    max_wait: Duration,
    burst_started: Instant,
    now: Instant,
) -> Option<Duration> {
    let remaining = max_wait.checked_sub(now.saturating_duration_since(burst_started))?;
    if remaining.is_zero() {
        None
    } else {
        Some(quiet.min(remaining))
    }
}

/// Block on `rx`, coalescing bursts of `()` signals into one `emit` call.
/// Returns when every sender is gone (the watcher was dropped); a burst that
/// is still pending at that point is discarded, nobody is listening anymore.
pub fn run(rx: &Receiver<()>, quiet: Duration, max_wait: Duration, mut emit: impl FnMut()) {
    while rx.recv().is_ok() {
        let started = Instant::now();
        while let Some(wait) = next_wait(quiet, max_wait, started, Instant::now()) {
            match rx.recv_timeout(wait) {
                Ok(()) => {}
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        emit();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::thread;

    const Q: Duration = Duration::from_millis(100);
    const M: Duration = Duration::from_millis(400);

    #[test]
    fn next_wait_is_quiet_window_early_in_a_burst() {
        let t0 = Instant::now();
        assert_eq!(next_wait(Q, M, t0, t0), Some(Q));
        assert_eq!(
            next_wait(Q, M, t0, t0 + Duration::from_millis(250)),
            Some(Q)
        );
    }

    #[test]
    fn next_wait_shrinks_to_the_remaining_budget() {
        let t0 = Instant::now();
        assert_eq!(
            next_wait(Q, M, t0, t0 + Duration::from_millis(350)),
            Some(Duration::from_millis(50))
        );
    }

    #[test]
    fn next_wait_is_none_once_max_wait_is_spent() {
        let t0 = Instant::now();
        assert_eq!(next_wait(Q, M, t0, t0 + M), None);
        assert_eq!(next_wait(Q, M, t0, t0 + M + Duration::from_secs(1)), None);
    }

    #[test]
    fn a_burst_collapses_into_one_emit() {
        let (tx, rx) = mpsc::channel();
        let (out_tx, out_rx) = mpsc::channel();
        let worker = thread::spawn(move || run(&rx, Q, M, || out_tx.send(()).unwrap()));
        for _ in 0..5 {
            tx.send(()).unwrap();
            thread::sleep(Duration::from_millis(10));
        }
        assert!(out_rx.recv_timeout(Duration::from_secs(2)).is_ok());
        assert!(out_rx.recv_timeout(Duration::from_millis(300)).is_err());
        drop(tx);
        worker.join().unwrap();
    }

    #[test]
    fn a_never_quiet_stream_still_emits_within_max_wait() {
        let (tx, rx) = mpsc::channel();
        let (out_tx, out_rx) = mpsc::channel();
        let worker = thread::spawn(move || run(&rx, Q, M, || out_tx.send(()).unwrap()));
        let feeder = thread::spawn(move || {
            // One event every 30ms, well under the 100ms quiet window.
            let until = Instant::now() + Duration::from_millis(1500);
            while Instant::now() < until {
                if tx.send(()).is_err() {
                    return;
                }
                thread::sleep(Duration::from_millis(30));
            }
        });
        // Plain trailing debounce would stay silent for the full 1.5s.
        assert!(out_rx.recv_timeout(Duration::from_millis(1200)).is_ok());
        feeder.join().unwrap();
        worker.join().unwrap();
    }

    #[test]
    fn run_returns_when_senders_are_dropped() {
        let (tx, rx) = mpsc::channel::<()>();
        let worker = thread::spawn(move || run(&rx, Q, M, || {}));
        drop(tx);
        worker.join().unwrap();
    }
}
