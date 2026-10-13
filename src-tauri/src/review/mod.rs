//! Git integration for the `PiDesk` code review drawer.
//!
//! - [`git`]  — hardened, output-capped `git` process helpers.
//! - [`repo`] — repository discovery, branch / commit listings.
//! - [`diff`] — unified diff generation for the three review targets.
//!
//! The Tauri commands below are `async` and run the (blocking) git work on
//! the blocking pool: a plain `fn` command would execute on the main thread
//! and freeze the UI for the duration of a large `git diff`.

mod diff;
mod git;
mod repo;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitEnvironmentStatus {
    pub has_project: bool,
    pub git_installed: bool,
    pub is_git_repo: bool,
    pub current_branch: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitSummary {
    pub hash: String,
    pub subject: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffOutput {
    pub raw_diff: String,
    /// `true` when the diff exceeded the size budget (or files were skipped).
    pub truncated: bool,
}

async fn run_blocking<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|e| format!("review task failed: {e}"))?
}

#[tauri::command]
pub async fn review_check_environment(cwd: String) -> Result<GitEnvironmentStatus, String> {
    run_blocking(move || Ok(repo::check_environment(&cwd))).await
}

#[tauri::command]
pub async fn review_list_branches(cwd: String) -> Result<Vec<String>, String> {
    run_blocking(move || repo::list_branches(&cwd)).await
}

#[tauri::command]
pub async fn review_list_commits(cwd: String, count: usize) -> Result<Vec<CommitSummary>, String> {
    run_blocking(move || repo::list_commits(&cwd, count)).await
}

#[tauri::command]
pub async fn review_get_diff(
    cwd: String,
    target_kind: String,
    target_ref: Option<String>,
) -> Result<DiffOutput, String> {
    run_blocking(move || diff::get_diff(&cwd, &target_kind, target_ref.as_deref())).await
}
