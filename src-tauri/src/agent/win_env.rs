//! Windows: rebuild the user's environment when an installer relaunched us.
//!
//! The MSI updater starts the new app from a Windows Installer custom action,
//! which can hand it an environment that is not the logged-in user's (system
//! `PATH` only, possibly another account's `USERPROFILE`). omp then isn't
//! found, or runs with the wrong home. `CreateEnvironmentBlock` returns the
//! authoritative environment for our token (machine + user + volatile
//! variables, `%VAR%` already expanded, no code-page issues); the decision of
//! what to apply lives in [`super::win_path`].

use std::ffi::c_void;
use std::ptr;

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::Security::{TOKEN_DUPLICATE, TOKEN_IMPERSONATE, TOKEN_QUERY};
use windows_sys::Win32::System::Environment::{CreateEnvironmentBlock, DestroyEnvironmentBlock};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

use super::win_path::{parse_env_block, plan_env_updates};

/// Closes a token handle on drop.
struct Token(HANDLE);

impl Drop for Token {
    fn drop(&mut self) {
        // SAFETY: the handle came from a successful `OpenProcessToken`.
        unsafe { CloseHandle(self.0) };
    }
}

/// Fetch this process token's user environment as `(name, value)` pairs.
fn user_environment() -> Result<Vec<(String, String)>, String> {
    let mut raw: HANDLE = ptr::null_mut();
    // SAFETY: `raw` is a valid out-pointer; the pseudo handle from
    // `GetCurrentProcess` needs no closing.
    let ok = unsafe {
        OpenProcessToken(
            GetCurrentProcess(),
            TOKEN_QUERY | TOKEN_DUPLICATE | TOKEN_IMPERSONATE,
            ptr::addr_of_mut!(raw),
        )
    };
    if ok == 0 {
        return Err(format!(
            "OpenProcessToken: {}",
            std::io::Error::last_os_error()
        ));
    }
    let token = Token(raw);

    let mut block: *mut c_void = ptr::null_mut();
    // SAFETY: `block` is a valid out-pointer and `token` a live token handle.
    if unsafe { CreateEnvironmentBlock(ptr::addr_of_mut!(block), token.0, 0) } == 0 {
        return Err(format!(
            "CreateEnvironmentBlock: {}",
            std::io::Error::last_os_error()
        ));
    }

    // SAFETY: on success `block` points to a UTF-16 block terminated by two
    // NULs; we only read up to and including that terminator, then copy.
    let vars = unsafe {
        let base = block.cast::<u16>();
        let mut len = 0;
        while !(*base.add(len) == 0 && *base.add(len + 1) == 0) {
            len += 1;
        }
        parse_env_block(std::slice::from_raw_parts(base, len + 2))
    };
    // SAFETY: `block` was allocated by `CreateEnvironmentBlock` and is not
    // used after this point.
    unsafe { DestroyEnvironmentBlock(block) };
    Ok(vars)
}

fn env_var(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

/// One-line summary of the variables that matter for locating omp.
fn describe() -> String {
    format!(
        "USERNAME={:?} USERPROFILE={:?} LOCALAPPDATA={:?} PATH_len={}",
        env_var("USERNAME").unwrap_or_default(),
        env_var("USERPROFILE").unwrap_or_default(),
        env_var("LOCALAPPDATA").unwrap_or_default(),
        env_var("PATH").map_or(0, |p| p.len()),
    )
}

/// Bring this process's environment in line with the user's. Never fails the
/// launch: on error the environment is left as inherited.
///
/// Must run before any other thread reads or writes the environment.
pub fn refresh_process_env() {
    let block = match user_environment() {
        Ok(block) => block,
        Err(e) => {
            eprintln!("[pidesk] could not read user environment block: {e}");
            return;
        }
    };
    let updates = plan_env_updates(env_var, &block);
    if updates.is_empty() {
        return;
    }
    eprintln!("[pidesk] env before repair: {}", describe());
    for (name, value) in &updates {
        std::env::set_var(name, value);
    }
    let names: Vec<&str> = updates.iter().map(|(n, _)| n.as_str()).collect();
    eprintln!(
        "[pidesk] env repaired ({}): {}",
        names.join(","),
        describe()
    );
}
