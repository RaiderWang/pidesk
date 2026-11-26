//! Active watchers keyed by `watch_id`, with start/stop ordering guaranteed.
//!
//! Starting a recursive watch is slow, so it runs off the async worker, which
//! means a `stop` can overtake a `start` that is still registering. Each
//! `begin` therefore takes a ticket; a finished watcher is only stored if its
//! ticket is still the newest for that id. A late loser is dropped instead of
//! leaking an OS watch plus its debounce thread.
//!
//! Watchers are always dropped **outside** the lock. [`FileWatcherState::begin`]
//! and [`FileWatcherState::stop`] hand the retired watcher back instead of
//! dropping it: on macOS dropping a watcher joins the `FSEvents` thread, which
//! must not happen on the main thread or an async worker.

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, MutexGuard, PoisonError,
    },
};

use notify::RecommendedWatcher;

#[derive(Default)]
struct Slots {
    /// Newest ticket handed out per id; removed by `stop`.
    latest: HashMap<String, u64>,
    active: HashMap<String, RecommendedWatcher>,
}

#[derive(Default)]
pub struct FileWatcherState {
    slots: Mutex<Slots>,
    tickets: AtomicU64,
}

impl FileWatcherState {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> MutexGuard<'_, Slots> {
        self.slots.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Claim the newest start for `watch_id`. Returns the ticket and the
    /// previous watcher, if any; the caller drops it off the hot thread.
    pub fn begin(&self, watch_id: &str) -> (u64, Option<RecommendedWatcher>) {
        let ticket = self.tickets.fetch_add(1, Ordering::Relaxed) + 1;
        let retired = {
            let mut slots = self.lock();
            slots.latest.insert(watch_id.to_owned(), ticket);
            slots.active.remove(watch_id)
        };
        (ticket, retired)
    }

    /// Store `watcher` if `ticket` is still the newest for `watch_id`;
    /// otherwise drop it. Returns whether it was stored.
    pub fn commit(&self, watch_id: &str, ticket: u64, watcher: RecommendedWatcher) -> bool {
        let (stored, leftover) = {
            let mut slots = self.lock();
            if slots.latest.get(watch_id) == Some(&ticket) {
                (true, slots.active.insert(watch_id.to_owned(), watcher))
            } else {
                (false, Some(watcher))
            }
        };
        drop(leftover);
        stored
    }

    /// Invalidate any start still in flight for `watch_id` and detach its
    /// running watcher, which the caller drops off the hot thread.
    pub fn stop(&self, watch_id: &str) -> Option<RecommendedWatcher> {
        let mut slots = self.lock();
        slots.latest.remove(watch_id);
        slots.active.remove(watch_id)
    }

    #[cfg(test)]
    fn active_count(&self) -> usize {
        self.lock().active.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_watcher::watcher;
    use std::path::PathBuf;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let dir =
                std::env::temp_dir().join(format!("pidesk-fw-state-{}-{tag}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn watcher(&self, id: &str) -> RecommendedWatcher {
            watcher::build(self.0.to_str().unwrap(), id, |_| {}).unwrap()
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn commit_stores_the_newest_ticket() {
        let dir = TempDir::new("commit");
        let state = FileWatcherState::new();
        let ticket = state.begin("a").0;
        assert!(state.commit("a", ticket, dir.watcher("a")));
        assert_eq!(state.active_count(), 1);
    }

    #[test]
    fn stop_that_overtakes_a_slow_start_leaves_nothing_behind() {
        let dir = TempDir::new("overtake");
        let state = FileWatcherState::new();
        let ticket = state.begin("a").0;
        // The user closed the panel while the watcher was still registering.
        state.stop("a");
        assert!(!state.commit("a", ticket, dir.watcher("a")));
        assert_eq!(state.active_count(), 0);
    }

    #[test]
    fn a_newer_start_supersedes_an_older_one() {
        let dir = TempDir::new("supersede");
        let state = FileWatcherState::new();
        let old = state.begin("a").0;
        let new = state.begin("a").0;
        // The newer start finishes first; the older one arrives late.
        assert!(state.commit("a", new, dir.watcher("a")));
        assert!(!state.commit("a", old, dir.watcher("a")));
        assert_eq!(state.active_count(), 1);
    }

    #[test]
    fn begin_hands_back_the_running_watcher_instead_of_dropping_it() {
        let dir = TempDir::new("retire");
        let state = FileWatcherState::new();
        let (first, none_yet) = state.begin("a");
        assert!(none_yet.is_none());
        assert!(state.commit("a", first, dir.watcher("a")));
        let (_second, retired) = state.begin("a");
        assert!(retired.is_some(), "caller decides where it is dropped");
        assert_eq!(state.active_count(), 0);
    }

    #[test]
    fn stop_hands_back_the_running_watcher_and_is_a_no_op_when_idle() {
        let dir = TempDir::new("stop-ret");
        let state = FileWatcherState::new();
        assert!(state.stop("a").is_none());
        let ticket = state.begin("a").0;
        assert!(state.commit("a", ticket, dir.watcher("a")));
        assert!(state.stop("a").is_some());
        assert_eq!(state.active_count(), 0);
    }

    #[test]
    fn ids_are_independent() {
        let dir = TempDir::new("ids");
        let state = FileWatcherState::new();
        let a = state.begin("a").0;
        let b = state.begin("b").0;
        assert!(state.commit("a", a, dir.watcher("a")));
        assert!(state.commit("b", b, dir.watcher("b")));
        state.stop("a");
        assert_eq!(state.active_count(), 1);
    }
}
