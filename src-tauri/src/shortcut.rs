//! Global shortcut registration for the Quick Bar.
//!
//! The user's preferred shortcut string is persisted as a tiny JSON file
//! in the app's config directory so it survives restarts. If the file is
//! missing the default `CmdOrCtrl+Shift+Space` is used.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

/// Default shortcut when no config exists.
const DEFAULT_SHORTCUT: &str = "CmdOrCtrl+Shift+Space";

/// File name for the persisted shortcut config.
const CONFIG_FILE: &str = "quick-bar-shortcut.json";

// ── Config persistence ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ShortcutConfig {
    pub shortcut: String,
}

impl Default for ShortcutConfig {
    fn default() -> Self {
        Self {
            shortcut: DEFAULT_SHORTCUT.to_string(),
        }
    }
}

/// Resolve the config file path inside the app's config directory.
fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("config dir error: {e}"))?;
    Ok(dir.join(CONFIG_FILE))
}

/// Read the persisted shortcut config, falling back to default.
fn read_config(app: &AppHandle) -> ShortcutConfig {
    let Ok(path) = config_path(app) else {
        return ShortcutConfig::default();
    };
    let Ok(data) = fs::read_to_string(&path) else {
        return ShortcutConfig::default();
    };
    serde_json::from_str(&data).unwrap_or_default()
}

/// Write the shortcut config to disk. Creates the parent directory if
/// needed.
fn write_config(app: &AppHandle, cfg: &ShortcutConfig) -> Result<(), String> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir error: {e}"))?;
    }
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("write error: {e}"))
}

// ── Registration ────────────────────────────────────────────────────────

/// Register the Quick Bar hotkey using the persisted (or default) shortcut.
/// Call once during `setup`, after the global-shortcut plugin is installed.
pub fn register_initial(app: &AppHandle) -> Result<(), String> {
    let cfg = read_config(app);
    register_shortcut(app, &cfg.shortcut)
}

/// Low-level: parse and register a single shortcut string.
fn register_shortcut(app: &AppHandle, shortcut_str: &str) -> Result<(), String> {
    let gs = app.global_shortcut();
    gs.register(shortcut_str)
        .map_err(|e| format!("failed to register shortcut '{shortcut_str}': {e}"))
}

/// Low-level: unregister a shortcut string. Errors are ignored (the
/// shortcut may not be registered).
fn unregister_shortcut(app: &AppHandle, shortcut_str: &str) {
    let gs = app.global_shortcut();
    let _ = gs.unregister(shortcut_str);
}

// ── Tauri commands ──────────────────────────────────────────────────────

/// Return the current shortcut string.
#[tauri::command]
pub fn get_quick_bar_shortcut(app: AppHandle) -> String {
    read_config(&app).shortcut
}

/// Change the Quick Bar shortcut at runtime. The old shortcut is
/// unregistered first. On failure the old shortcut is re-registered
/// and the error is returned.
#[tauri::command]
pub fn set_quick_bar_shortcut(app: AppHandle, shortcut: String) -> Result<(), String> {
    let old = read_config(&app);
    // Try registering the new one first (validates the string).
    // We unregister the old one, register the new one, and if that
    // fails, roll back.
    unregister_shortcut(&app, &old.shortcut);
    if let Err(e) = register_shortcut(&app, &shortcut) {
        // Roll back.
        let _ = register_shortcut(&app, &old.shortcut);
        return Err(e);
    }
    let new_cfg = ShortcutConfig { shortcut };
    write_config(&app, &new_cfg)?;
    Ok(())
}

// ── Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_default() {
        let cfg = ShortcutConfig::default();
        assert_eq!(cfg.shortcut, DEFAULT_SHORTCUT);
    }

    #[test]
    fn config_serde_round_trip() {
        let cfg = ShortcutConfig {
            shortcut: "Ctrl+Alt+P".to_string(),
        };
        let json = serde_json::to_string(&cfg).unwrap();
        let back: ShortcutConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(cfg, back);
    }

    #[test]
    fn config_serde_default_on_invalid() {
        let bad = "not json at all";
        let cfg: ShortcutConfig = serde_json::from_str(bad).unwrap_or_default();
        assert_eq!(cfg.shortcut, DEFAULT_SHORTCUT);
    }
}
