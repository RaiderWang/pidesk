//! Which filesystem events are worth refreshing the file tree for.
//!
//! The tree lists names and "is a directory" only, so what matters is
//! structure: entries appearing, disappearing or being renamed. Content and
//! metadata writes are noise, and so is anything living inside a dependency /
//! build / VCS directory.
//!
//! Paths are judged **relative to the watched root**: an ancestor of the
//! project called `build` or `target` must not silence the whole project.

use std::path::{Component, Path};

use notify::event::{EventKind, ModifyKind};

/// Directories whose contents never refresh the tree. The directory entry
/// itself still counts when it is created, removed or renamed.
const IGNORED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".cache",
    ".turbo",
    ".svn",
    ".hg",
];

/// Atomic-write scratch files. The final rename reports the real path.
const IGNORED_EXTS: &[&str] = &["tmp", "swp", "crswap"];

const DS_STORE: &str = ".DS_Store";
const EDITOR_LOCK_PREFIX: &str = ".#";

const fn is_structural(kind: EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(ModifyKind::Name(_))
    )
}

/// Case-insensitive: Windows and macOS file systems are, so `A.TMP` is as much
/// a scratch file as `a.tmp`.
fn has_ignored_ext(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| IGNORED_EXTS.iter().any(|x| e.eq_ignore_ascii_case(x)))
}

fn is_noise_file(name: &str) -> bool {
    name == DS_STORE || name.starts_with(EDITOR_LOCK_PREFIX)
}

/// Whether an event of `kind` on `path` (inside `root`) should refresh the tree.
pub fn is_relevant(root: &Path, kind: EventKind, path: &Path) -> bool {
    // Reads and content / metadata writes do not change what the tree shows.
    if matches!(
        kind,
        EventKind::Access(_) | EventKind::Modify(ModifyKind::Data(_) | ModifyKind::Metadata(_))
    ) {
        return false;
    }
    if has_ignored_ext(path) {
        return false;
    }
    // Outside `root` (should not happen once both sides come from the same
    // canonical path): only the extension rule applies, never the ancestors.
    let Ok(rel) = path.strip_prefix(root) else {
        return true;
    };

    let count = rel.components().count();
    for (i, component) in rel.components().enumerate() {
        let Component::Normal(name) = component else {
            continue;
        };
        let name = name.to_string_lossy();
        if is_noise_file(&name) {
            return false;
        }
        if IGNORED_DIRS.iter().any(|d| name == *d) {
            // Only the ignored directory entry itself is interesting, and only
            // when it appears / disappears / is renamed. Its own mtime changes
            // whenever anything inside it is written.
            return i + 1 == count && is_structural(kind);
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{AccessKind, CreateKind, DataChange, MetadataKind, RemoveKind, RenameMode};

    fn root() -> &'static Path {
        Path::new("/work/proj")
    }

    fn create() -> EventKind {
        EventKind::Create(CreateKind::Any)
    }

    fn remove() -> EventKind {
        EventKind::Remove(RemoveKind::Any)
    }

    fn rename() -> EventKind {
        EventKind::Modify(ModifyKind::Name(RenameMode::To))
    }

    fn modify_any() -> EventKind {
        EventKind::Modify(ModifyKind::Any)
    }

    fn rel(p: &str) -> std::path::PathBuf {
        root().join(p)
    }

    #[test]
    fn normal_paths_are_relevant() {
        assert!(is_relevant(root(), create(), &rel("src/main.rs")));
        assert!(is_relevant(root(), remove(), &rel("README.md")));
        assert!(is_relevant(root(), rename(), &rel("src/a.rs")));
        assert!(is_relevant(root(), modify_any(), &rel("src/a.rs")));
        assert!(is_relevant(
            root(),
            create(),
            &rel("my-target-folder/file.txt")
        ));
    }

    #[test]
    fn ancestor_named_like_an_ignored_dir_does_not_silence_the_project() {
        for ancestor in [
            "/home/me/build/proj",
            "/srv/target/proj",
            "/x/dist/.cache/proj",
        ] {
            let root = Path::new(ancestor);
            assert!(is_relevant(root, create(), &root.join("src/main.rs")));
        }
    }

    #[test]
    fn inside_ignored_dirs_is_ignored() {
        for p in [
            ".git/HEAD",
            "node_modules/express/index.js",
            "target/debug/app.exe",
            "dist/bundle.js",
            "build/out.css",
            ".next/cache/foo",
            "pkg/node_modules/x",
        ] {
            assert!(!is_relevant(root(), create(), &rel(p)), "{p}");
            assert!(!is_relevant(root(), remove(), &rel(p)), "{p}");
        }
    }

    #[test]
    fn ignored_dir_itself_passes_only_for_structural_events() {
        for name in ["build", "target", "node_modules", ".git"] {
            assert!(is_relevant(root(), create(), &rel(name)), "{name} create");
            assert!(is_relevant(root(), remove(), &rel(name)), "{name} remove");
            assert!(is_relevant(root(), rename(), &rel(name)), "{name} rename");
            assert!(
                !is_relevant(root(), modify_any(), &rel(name)),
                "{name} modify"
            );
            assert!(
                !is_relevant(
                    root(),
                    EventKind::Modify(ModifyKind::Metadata(MetadataKind::WriteTime)),
                    &rel(name)
                ),
                "{name} metadata"
            );
        }
    }

    #[test]
    fn content_metadata_and_access_events_are_dropped() {
        let p = rel("src/a.rs");
        assert!(!is_relevant(
            root(),
            EventKind::Modify(ModifyKind::Data(DataChange::Content)),
            &p
        ));
        assert!(!is_relevant(
            root(),
            EventKind::Modify(ModifyKind::Metadata(MetadataKind::Any)),
            &p
        ));
        assert!(!is_relevant(
            root(),
            EventKind::Access(AccessKind::Read),
            &p
        ));
    }

    #[test]
    fn scratch_files_are_ignored_but_lock_files_are_not() {
        assert!(!is_relevant(root(), create(), &rel("a.tmp")));
        assert!(!is_relevant(root(), create(), &rel("src/.a.rs.swp")));
        assert!(!is_relevant(root(), create(), &rel("x.crswap")));
        assert!(!is_relevant(root(), create(), &rel(".DS_Store")));
        assert!(!is_relevant(root(), create(), &rel("src/.#draft.txt")));
        assert!(is_relevant(root(), create(), &rel("Cargo.lock")));
        assert!(is_relevant(root(), create(), &rel("bun.lock")));
    }

    #[test]
    fn scratch_file_extensions_match_case_insensitively() {
        assert!(!is_relevant(root(), create(), &rel("A.TMP")));
        assert!(!is_relevant(root(), create(), &rel("src/.a.rs.SWP")));
        assert!(!is_relevant(root(), create(), &rel("x.CrSwap")));
        assert!(is_relevant(root(), create(), &rel("a.tmpl")));
    }

    #[test]
    fn path_outside_root_falls_back_to_extension_rule_only() {
        let other = Path::new("/elsewhere/node_modules/x.js");
        assert!(is_relevant(root(), create(), other));
        assert!(!is_relevant(
            root(),
            create(),
            Path::new("/elsewhere/x.tmp")
        ));
    }

    #[test]
    fn root_itself_is_relevant() {
        assert!(is_relevant(root(), create(), root()));
    }
}
