//! Unified-diff generation for the three review targets.

use super::git::{
    git_command, is_safe_git_ref, run_capped, run_git_text, DIFF_FLAGS, EMPTY_TREE, MAX_DIFF_BYTES,
    MAX_LIST_BYTES,
};
use super::repo::{existing_dir, has_head, repo_root, resolves_to_commit};
use super::DiffOutput;
use std::path::Path;

/// Untracked files are appended as "new file" diffs, at most this many.
const MAX_UNTRACKED_FILES: usize = 200;

/// `/dev/null` equivalent understood by `git diff --no-index`.
const NULL_DEVICE: &str = if cfg!(windows) { "NUL" } else { "/dev/null" };

pub fn get_diff(cwd: &str, kind: &str, target_ref: Option<&str>) -> Result<DiffOutput, String> {
    get_diff_with_budget(cwd, kind, target_ref, MAX_DIFF_BYTES)
}

fn get_diff_with_budget(
    cwd: &str,
    kind: &str,
    target_ref: Option<&str>,
    budget: usize,
) -> Result<DiffOutput, String> {
    let Some(dir) = existing_dir(cwd) else {
        return Ok(DiffOutput::default());
    };
    let root = repo_root(dir)?;
    match kind {
        "uncommitted" => uncommitted(&root, budget),
        "base-branch" => {
            let base = checked_ref(&root, target_ref, "A valid base branch name is required")?;
            base_branch(&root, base, budget)
        }
        "commit" => {
            let hash = checked_ref(&root, target_ref, "A valid commit hash is required")?;
            commit(&root, hash, budget)
        }
        other => Err(format!("Unsupported review target kind: {other}")),
    }
}

/// Validate a frontend-supplied revision: well-formed, and really a commit.
fn checked_ref<'a>(root: &Path, r: Option<&'a str>, missing: &str) -> Result<&'a str, String> {
    let r = r.map(str::trim).filter(|r| is_safe_git_ref(r));
    let r = r.ok_or_else(|| missing.to_owned())?;
    if resolves_to_commit(root, r) {
        Ok(r)
    } else {
        Err(format!("Unknown revision: {r}"))
    }
}

fn diff_command(root: &Path) -> std::process::Command {
    let mut cmd = git_command(root);
    cmd.arg("diff").args(DIFF_FLAGS);
    cmd
}

/// Staged + unstaged changes versus `HEAD`, plus untracked files.
fn uncommitted(root: &Path, budget: usize) -> Result<DiffOutput, String> {
    // A repo without any commit diffs against git's empty tree.
    let base = if has_head(root) { "HEAD" } else { EMPTY_TREE };
    let mut cmd = diff_command(root);
    cmd.arg(base).arg("--");
    let (mut raw_diff, mut truncated) = run_git_text(cmd, budget)?;
    if !truncated {
        truncated = append_untracked(root, &mut raw_diff, budget);
    }
    Ok(DiffOutput {
        raw_diff,
        truncated,
    })
}

/// PR-style diff: everything on `HEAD` since it forked from `base`.
fn base_branch(root: &Path, base: &str, budget: usize) -> Result<DiffOutput, String> {
    if !has_head(root) {
        return Err("This repository has no commits yet".to_owned());
    }
    let mut mb = git_command(root);
    mb.args(["merge-base", base, "HEAD"]);
    let (merge_base, _) = run_git_text(mb, 256)?;
    let merge_base = merge_base.trim();
    if merge_base.is_empty() {
        return Err(format!("No common ancestor between {base} and HEAD"));
    }
    let mut cmd = diff_command(root);
    cmd.arg(merge_base).arg("HEAD").arg("--");
    let (raw_diff, truncated) = run_git_text(cmd, budget)?;
    Ok(DiffOutput {
        raw_diff,
        truncated,
    })
}

/// One commit's own changes (merge commits: relative to their first parent).
fn commit(root: &Path, hash: &str, budget: usize) -> Result<DiffOutput, String> {
    let mut cmd = git_command(root);
    cmd.args(["show", "--format=", "--first-parent"])
        .args(DIFF_FLAGS)
        .arg(hash)
        .arg("--");
    let (raw_diff, truncated) = run_git_text(cmd, budget)?;
    Ok(DiffOutput {
        raw_diff,
        truncated,
    })
}

/// Append "new file" diffs for untracked files. Returns `true` when anything
/// was left out (file-count cap, size budget, or an oversized listing).
fn append_untracked(root: &Path, diff: &mut String, budget: usize) -> bool {
    let mut ls = git_command(root);
    ls.args(["ls-files", "--others", "--exclude-standard", "-z"]);
    let Ok(listing) = run_capped(ls, MAX_LIST_BYTES) else {
        return false;
    };
    let left_out = listing.truncated;
    let names = String::from_utf8_lossy(&listing.stdout);

    for (i, rel) in names.split('\0').filter(|p| !p.is_empty()).enumerate() {
        let remaining = budget.saturating_sub(diff.len());
        if i >= MAX_UNTRACKED_FILES || remaining == 0 {
            return true;
        }
        let mut cmd = diff_command(root);
        cmd.arg("--no-index").arg("--").arg(NULL_DEVICE).arg(rel);
        let Ok(out) = run_capped(cmd, remaining) else {
            continue;
        };
        // `--no-index` exits 1 when the files differ; anything higher is a real error.
        let failed = out.status.code().is_none_or(|c| c > 1);
        if out.stdout.is_empty() || (failed && !out.truncated) {
            continue;
        }
        if !diff.is_empty() && !diff.ends_with('\n') {
            diff.push('\n');
        }
        diff.push_str(&String::from_utf8_lossy(&out.stdout));
        if out.truncated {
            return true;
        }
    }
    left_out
}

#[cfg(test)]
mod tests {
    use super::super::git::test_util::TempRepo;
    use super::*;

    fn path(repo: &TempRepo) -> &str {
        repo.path.to_str().expect("utf8 path")
    }

    fn committed_repo() -> Option<TempRepo> {
        let repo = TempRepo::new()?;
        repo.write("a.txt", "one\n");
        repo.commit_all("init");
        repo.git(&["branch", "-M", "main"]);
        Some(repo)
    }

    #[test]
    fn unsupported_kind_and_blank_cwd() {
        let blank = get_diff("", "uncommitted", None).expect("empty");
        assert_eq!(blank.raw_diff, "");
        assert!(!blank.truncated);
        let Some(repo) = committed_repo() else { return };
        let err = get_diff(path(&repo), "bogus", None).expect_err("must fail");
        assert!(err.contains("Unsupported review target kind"));
    }

    #[test]
    fn uncommitted_covers_tracked_staged_and_untracked_changes() {
        let Some(repo) = committed_repo() else { return };
        repo.write("a.txt", "one\ntwo\n");
        repo.write("staged.txt", "s\n");
        repo.git(&["add", "staged.txt"]);
        repo.write("dir with space/new file.txt", "fresh\n");

        let out = get_diff(path(&repo), "uncommitted", None).expect("diff");
        assert!(!out.truncated);
        assert!(out.raw_diff.contains("+two"));
        assert!(out
            .raw_diff
            .contains("diff --git a/staged.txt b/staged.txt"));
        assert!(out.raw_diff.contains("new file.txt"));
        assert!(out.raw_diff.contains("+fresh"));
    }

    #[test]
    fn works_before_the_first_commit() {
        let Some(repo) = TempRepo::new() else { return };
        repo.write("staged.txt", "s\n");
        repo.git(&["add", "staged.txt"]);
        repo.write("loose.txt", "l\n");
        let out = get_diff(path(&repo), "uncommitted", None).expect("diff");
        assert!(out.raw_diff.contains("+s"));
        assert!(out.raw_diff.contains("+l"));

        let err = get_diff(path(&repo), "base-branch", Some("main")).expect_err("no commits");
        assert_ne!(err, "");
    }

    #[test]
    fn paths_are_repo_relative_even_from_a_subdirectory() {
        let Some(repo) = committed_repo() else { return };
        repo.write("pkg/f.txt", "x\n");
        repo.commit_all("pkg");
        repo.write("pkg/f.txt", "y\n");
        repo.write("top-level-untracked.txt", "u\n");
        let sub = repo.path.join("pkg");
        let out = get_diff(sub.to_str().expect("utf8"), "uncommitted", None).expect("diff");
        assert!(out.raw_diff.contains("diff --git a/pkg/f.txt b/pkg/f.txt"));
        assert!(out.raw_diff.contains("top-level-untracked.txt"));
    }

    #[test]
    fn output_ignores_colour_and_prefix_configuration() {
        let Some(repo) = committed_repo() else { return };
        repo.git(&["config", "color.ui", "always"]);
        repo.git(&["config", "color.diff", "always"]);
        repo.git(&["config", "diff.noprefix", "true"]);
        repo.write("a.txt", "changed\n");
        let out = get_diff(path(&repo), "uncommitted", None).expect("diff");
        assert!(!out.raw_diff.contains('\u{1b}'), "no ANSI escapes");
        assert!(out.raw_diff.contains("--- a/a.txt"));
        assert!(out.raw_diff.contains("+++ b/a.txt"));
    }

    #[test]
    fn base_branch_shows_only_changes_since_the_fork() {
        let Some(repo) = committed_repo() else { return };
        repo.git(&["checkout", "-q", "-b", "feature"]);
        repo.write("feat.txt", "f\n");
        repo.commit_all("feat");
        repo.git(&["checkout", "-q", "main"]);
        repo.write("main-only.txt", "m\n");
        repo.commit_all("main moves on");
        repo.git(&["checkout", "-q", "feature"]);

        let out = get_diff(path(&repo), "base-branch", Some("main")).expect("diff");
        assert!(out.raw_diff.contains("feat.txt"));
        assert!(!out.raw_diff.contains("main-only.txt"));
    }

    #[test]
    fn commit_target_shows_that_commit_only() {
        let Some(repo) = committed_repo() else { return };
        repo.write("b.txt", "b\n");
        repo.commit_all("second");
        repo.write("c.txt", "c\n");
        repo.commit_all("third");
        let out = get_diff(path(&repo), "commit", Some("HEAD~1")).expect("diff");
        assert!(out.raw_diff.contains("b.txt"));
        assert!(!out.raw_diff.contains("c.txt"));
        assert!(!out.raw_diff.contains("a.txt"));
    }

    #[test]
    fn bad_refs_are_rejected_before_git_sees_them() {
        let Some(repo) = committed_repo() else { return };
        for bad in ["--output=pwned.txt", "a..b", "x y", ""] {
            assert!(
                get_diff(path(&repo), "commit", Some(bad)).is_err(),
                "{bad:?}"
            );
        }
        assert!(get_diff(path(&repo), "commit", None).is_err());
        let err =
            get_diff(path(&repo), "base-branch", Some("no-such-branch")).expect_err("unknown");
        assert!(err.contains("Unknown revision"));
        assert!(!repo.path.join("pwned.txt").exists());
    }

    #[test]
    fn oversized_output_is_flagged_truncated_and_stays_within_budget() {
        let Some(repo) = committed_repo() else { return };
        repo.write("a.txt", &"line of text\n".repeat(500));
        let out = get_diff_with_budget(path(&repo), "uncommitted", None, 1500).expect("diff");
        assert!(out.truncated);
        assert!(out.raw_diff.len() <= 1500);
        assert!(out.raw_diff.ends_with('\n'));
    }

    #[test]
    fn oversized_untracked_files_set_the_truncated_flag() {
        let Some(repo) = committed_repo() else { return };
        repo.write("huge.log", &"0123456789\n".repeat(1000));
        let out = get_diff_with_budget(path(&repo), "uncommitted", None, 2000).expect("diff");
        assert!(out.truncated);
        assert!(out.raw_diff.len() <= 2000);
        assert!(out.raw_diff.contains("huge.log"));
    }
}
