//! Repository discovery + ref listings for the review drawer.

use super::git::{git_available, git_command, run_git_text, succeeds, MAX_LIST_BYTES};
use super::{CommitSummary, GitEnvironmentStatus};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// `cwd` trimmed and verified to be an existing directory.
pub fn existing_dir(cwd: &str) -> Option<&Path> {
    let trimmed = cwd.trim();
    if trimmed.is_empty() {
        return None;
    }
    let path = Path::new(trimmed);
    path.is_dir().then_some(path)
}

/// Top-level directory of the work tree containing `dir`.
///
/// Diffs are always generated from here: `git diff` paths are repo-root
/// relative, while `ls-files --others` is cwd relative — mixing the two when
/// the project sits in a sub-directory produced inconsistent paths.
pub fn repo_root(dir: &Path) -> Result<PathBuf, String> {
    let mut cmd = git_command(dir);
    cmd.args(["rev-parse", "--show-toplevel"]);
    let (out, _) = run_git_text(cmd, MAX_LIST_BYTES)?;
    let root = out.trim();
    if root.is_empty() {
        return Err("Not inside a git work tree".to_owned());
    }
    Ok(PathBuf::from(root))
}

/// Whether `HEAD` resolves to a commit (false in a freshly `git init`ed repo).
pub fn has_head(root: &Path) -> bool {
    let mut cmd = git_command(root);
    cmd.args(["rev-parse", "--verify", "--quiet", "HEAD"]);
    succeeds(cmd)
}

/// Whether `rev` names an existing commit-ish.
pub fn resolves_to_commit(root: &Path, rev: &str) -> bool {
    let mut cmd = git_command(root);
    cmd.args(["rev-parse", "--verify", "--quiet"])
        .arg(format!("{rev}^{{commit}}"));
    succeeds(cmd)
}

pub fn check_environment(cwd: &str) -> GitEnvironmentStatus {
    let dir = existing_dir(cwd);
    let mut status = GitEnvironmentStatus {
        has_project: dir.is_some(),
        git_installed: git_available(),
        is_git_repo: false,
        current_branch: None,
    };
    let Some(dir) = dir.filter(|_| status.git_installed) else {
        return status;
    };

    let mut inside = git_command(dir);
    inside.args(["rev-parse", "--is-inside-work-tree"]);
    status.is_git_repo = run_git_text(inside, 64).is_ok_and(|(out, _)| out.trim() == "true");
    if !status.is_git_repo {
        return status;
    }

    let mut branch = git_command(dir);
    branch.args(["branch", "--show-current"]);
    status.current_branch = run_git_text(branch, 4096)
        .ok()
        .map(|(out, _)| out.trim().to_owned())
        .filter(|name| !name.is_empty());
    status
}

/// Local and remote-tracking branch names (short form), `origin/HEAD` aliases removed.
pub fn list_branches(cwd: &str) -> Result<Vec<String>, String> {
    let Some(dir) = existing_dir(cwd) else {
        return Ok(Vec::new());
    };
    let mut cmd = git_command(dir);
    cmd.args([
        "for-each-ref",
        "--format=%(refname)",
        "refs/heads",
        "refs/remotes",
    ]);
    let (text, _) = run_git_text(cmd, MAX_LIST_BYTES)?;
    Ok(parse_branches(&text))
}

fn parse_branches(refnames: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    refnames
        .lines()
        .map(str::trim)
        .filter(|full| !full.ends_with("/HEAD"))
        .filter_map(|full| {
            full.strip_prefix("refs/heads/")
                .or_else(|| full.strip_prefix("refs/remotes/"))
        })
        .filter(|name| !name.is_empty() && seen.insert(*name))
        .map(str::to_owned)
        .collect()
}

/// Most recent commits (`count` clamped to 1..=100) reachable from `HEAD`.
pub fn list_commits(cwd: &str, count: usize) -> Result<Vec<CommitSummary>, String> {
    let Some(dir) = existing_dir(cwd) else {
        return Ok(Vec::new());
    };
    let root = repo_root(dir)?;
    if !has_head(&root) {
        return Ok(Vec::new());
    }
    let mut cmd = git_command(&root);
    cmd.arg("log")
        .arg(format!("-n{}", count.clamp(1, 100)))
        .arg("--format=%H%x1f%s");
    let (text, _) = run_git_text(cmd, MAX_LIST_BYTES)?;
    Ok(parse_commits(&text))
}

fn parse_commits(log: &str) -> Vec<CommitSummary> {
    log.lines()
        .filter_map(|line| {
            let (hash, subject) = line.split_once('\u{1f}')?;
            let hash = hash.trim();
            (!hash.is_empty()).then(|| CommitSummary {
                hash: hash.to_owned(),
                subject: subject.trim().to_owned(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::super::git::test_util::TempRepo;
    use super::*;

    #[test]
    fn existing_dir_rejects_blank_and_missing_paths() {
        assert!(existing_dir("").is_none());
        assert!(existing_dir("   ").is_none());
        assert!(existing_dir("/definitely/not/here/xyz").is_none());
        let tmp = std::env::temp_dir();
        assert!(existing_dir(tmp.to_str().expect("utf8 temp dir")).is_some());
    }

    #[test]
    fn parses_branches_without_head_aliases_or_duplicates() {
        let refs = "refs/heads/main\nrefs/heads/dev\nrefs/remotes/origin/HEAD\n\
                    refs/remotes/origin/main\nrefs/remotes/origin/dev\nrefs/heads/main\n";
        assert_eq!(
            parse_branches(refs),
            ["main", "dev", "origin/main", "origin/dev"]
        );
    }

    #[test]
    fn parses_commit_lines_including_empty_subjects() {
        let log = "aaa\u{1f}first change\nbbb\u{1f}\n\u{1f}orphan\nnot a commit line\n";
        let commits = parse_commits(log);
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].hash, "aaa");
        assert_eq!(commits[0].subject, "first change");
        assert_eq!(commits[1].hash, "bbb");
        assert_eq!(commits[1].subject, "");
    }

    #[test]
    fn missing_project_is_reported_without_touching_git() {
        let status = check_environment("");
        assert!(!status.has_project);
        assert!(!status.is_git_repo);
        assert!(status.current_branch.is_none());
    }

    #[test]
    fn detects_repo_branch_and_commits() {
        let Some(repo) = TempRepo::new() else { return };
        repo.git(&["checkout", "-q", "-b", "feature/x"]);
        let path = repo.path.to_str().expect("utf8 path");

        // Fresh repo: a work tree, but no commits yet.
        let status = check_environment(path);
        assert!(status.has_project && status.git_installed && status.is_git_repo);
        assert_eq!(status.current_branch.as_deref(), Some("feature/x"));
        assert!(list_commits(path, 10).expect("ok").is_empty());
        assert!(!has_head(&repo.path));

        repo.write("a.txt", "1\n");
        repo.commit_all("first");
        repo.write("a.txt", "2\n");
        repo.commit_all("second");
        assert!(has_head(&repo.path));
        assert!(resolves_to_commit(&repo.path, "HEAD"));
        assert!(!resolves_to_commit(&repo.path, "no-such-branch"));

        let commits = list_commits(path, 10).expect("ok");
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].subject, "second");
        assert_eq!(list_commits(path, 1).expect("ok").len(), 1);
        assert!(list_branches(path)
            .expect("ok")
            .contains(&"feature/x".to_owned()));
    }

    #[test]
    fn repo_root_resolves_from_a_subdirectory() {
        let Some(repo) = TempRepo::new() else { return };
        repo.write("pkg/inner/f.txt", "x\n");
        let sub = repo.path.join("pkg").join("inner");
        let root = repo_root(&sub).expect("inside a repo");
        assert_eq!(
            root.canonicalize().expect("root exists"),
            repo.path.canonicalize().expect("repo exists")
        );
    }
}
