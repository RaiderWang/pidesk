//! Builds one recursive OS watcher whose events are filtered, debounced and
//! handed to an `emit` callback.

use std::{
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc,
    },
    thread,
};

use notify::{RecommendedWatcher, RecursiveMode, Watcher as _};
use serde::Serialize;

use super::{debounce, ignore};

/// Payload of the `"files://changed"` event.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeEvent {
    pub watch_id: String,
    pub path: String,
}

static THREAD_SEQ: AtomicU64 = AtomicU64::new(1);

/// Whether one raw `notify` callback result should schedule a refresh.
///
/// Errors and rescan requests (the OS dropped events: `ReadDirectoryChangesW`
/// buffer overflow, `FSEvents` must-scan) mean "something changed, we do not
/// know what", so they always refresh. A rescan event carries no paths.
fn signals_refresh(root: &Path, res: &notify::Result<notify::Event>) -> bool {
    res.as_ref().map_or(true, |event| {
        event.need_rescan()
            || event
                .paths
                .iter()
                .any(|p| ignore::is_relevant(root, event.kind, p))
    })
}

/// Watch `path_str` recursively and call `emit` (on a debounce thread) after
/// each burst of relevant changes. Blocking: registering a recursive watch can
/// take a while on large trees, so call from a blocking context.
///
/// Dropping the returned watcher unregisters the OS watch; that also drops the
/// channel sender, which ends the debounce thread.
pub fn build(
    path_str: &str,
    watch_id: &str,
    emit: impl Fn(FileChangeEvent) + Send + 'static,
) -> Result<RecommendedWatcher, String> {
    let target = Path::new(path_str);
    if !target.exists() {
        return Err(format!("Directory does not exist: {path_str}"));
    }
    if !target.is_dir() {
        return Err(format!("Path is not a directory: {path_str}"));
    }
    // One canonical root is both what the OS watches and what event paths are
    // judged against, so `strip_prefix` agrees on every platform (`FSEvents`
    // reports `/private/var/..`, Windows may report a verbatim `\\?\` form).
    let root = std::fs::canonicalize(target).unwrap_or_else(|_| target.to_path_buf());

    let (tx, rx) = mpsc::channel::<()>();
    let callback_root = root.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if signals_refresh(&callback_root, &res) {
            let _ = tx.send(());
        }
    })
    .map_err(|e| format!("Failed to create watcher: {e}"))?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch directory {path_str}: {e}"))?;

    let event = FileChangeEvent {
        watch_id: watch_id.to_owned(),
        path: path_str.to_owned(),
    };
    thread::Builder::new()
        .name(format!(
            "file-watcher-{}",
            THREAD_SEQ.fetch_add(1, Ordering::Relaxed)
        ))
        .spawn(move || {
            debounce::run(&rx, debounce::QUIET, debounce::MAX_WAIT, || {
                emit(event.clone());
            });
        })
        .map_err(|e| format!("Failed to spawn debouncer thread: {e}"))?;

    Ok(watcher)
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, Flag, ModifyKind};
    use notify::EventKind;
    use std::{path::PathBuf, time::Duration};

    fn root() -> PathBuf {
        PathBuf::from("/work/proj")
    }

    #[test]
    fn errors_and_rescan_requests_refresh() {
        let err: notify::Result<notify::Event> = Err(notify::Error::generic("overflow"));
        assert!(signals_refresh(&root(), &err));

        // No paths at all: only the flag says something happened.
        let rescan = notify::Event::new(EventKind::Other).set_flag(Flag::Rescan);
        assert!(signals_refresh(&root(), &Ok(rescan)));
    }

    #[test]
    fn relevant_and_irrelevant_events() {
        let created = notify::Event::new(EventKind::Create(CreateKind::File))
            .add_path(root().join("src/new.rs"));
        assert!(signals_refresh(&root(), &Ok(created)));

        let inside_ignored = notify::Event::new(EventKind::Create(CreateKind::File))
            .add_path(root().join("node_modules/x/index.js"));
        assert!(!signals_refresh(&root(), &Ok(inside_ignored)));

        let content = notify::Event::new(EventKind::Modify(ModifyKind::Any));
        assert!(!signals_refresh(&root(), &Ok(content)), "no paths, no flag");
    }

    #[test]
    fn rejects_missing_directory_and_plain_file() {
        let missing = build("/definitely/not/here", "w", |_| {}).unwrap_err();
        assert!(missing.starts_with("Directory does not exist"));

        let file = std::env::temp_dir().join(format!("pidesk-fw-file-{}", std::process::id()));
        std::fs::write(&file, "x").unwrap();
        let not_dir = build(file.to_str().unwrap(), "w", |_| {}).unwrap_err();
        std::fs::remove_file(&file).ok();
        assert!(not_dir.starts_with("Path is not a directory"));
    }

    #[test]
    fn emits_once_for_a_real_new_file() {
        let dir = std::env::temp_dir().join(format!("pidesk-fw-live-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let (tx, rx) = mpsc::channel();
        let watcher = build(dir.to_str().unwrap(), "live", move |e| {
            let _ = tx.send(e);
        })
        .unwrap();

        std::fs::write(dir.join("hello.txt"), "hi").unwrap();
        let got = rx.recv_timeout(Duration::from_secs(10));
        drop(watcher);
        std::fs::remove_dir_all(&dir).ok();

        let event = got.expect("a change event for a newly created file");
        assert_eq!(event.watch_id, "live");
        assert_eq!(event.path, dir.to_str().unwrap());
    }
}
