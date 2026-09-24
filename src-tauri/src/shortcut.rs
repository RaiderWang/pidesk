//! Global shortcut registration for Quick Bar and screenshot capture.
//!
//! The user's preferred shortcut strings are persisted as JSON in the app's
//! config directory (`quick-bar-shortcut.json`) so they survive restarts.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

/// Default Quick Bar shortcut when no config exists.
pub const DEFAULT_QUICK_BAR_SHORTCUT: &str = "CmdOrCtrl+Shift+Space";
/// Default region screenshot shortcut when no config exists.
pub const DEFAULT_SCREENSHOT_SHORTCUT: &str = "Alt+S";

/// File name for the persisted shortcut config.
const CONFIG_FILE: &str = "quick-bar-shortcut.json";

fn default_quick_bar() -> String {
    DEFAULT_QUICK_BAR_SHORTCUT.to_string()
}

fn default_screenshot() -> String {
    DEFAULT_SCREENSHOT_SHORTCUT.to_string()
}

// ── Config persistence ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ShortcutConfig {
    #[serde(default = "default_quick_bar", alias = "shortcut")]
    pub quick_bar: String,
    #[serde(default = "default_screenshot")]
    pub screenshot: String,
}

impl Default for ShortcutConfig {
    fn default() -> Self {
        Self {
            quick_bar: default_quick_bar(),
            screenshot: default_screenshot(),
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
pub fn read_config(app: &AppHandle) -> ShortcutConfig {
    let Ok(path) = config_path(app) else {
        return ShortcutConfig::default();
    };
    let Ok(data) = fs::read_to_string(&path) else {
        return ShortcutConfig::default();
    };
    serde_json::from_str(&data).unwrap_or_default()
}

/// Write the shortcut config to disk.
fn write_config(app: &AppHandle, cfg: &ShortcutConfig) -> Result<(), String> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir error: {e}"))?;
    }
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("write error: {e}"))
}

// ── Registration ────────────────────────────────────────────────────────

/// Register both shortcuts initially during `setup`.
pub fn register_initial(app: &AppHandle) -> Result<(), String> {
    let cfg = read_config(app);
    let mut errors = Vec::new();

    if let Err(e) = register_shortcut(app, &cfg.quick_bar) {
        errors.push(format!("quick_bar ({}): {e}", cfg.quick_bar));
    }
    if let Err(e) = register_shortcut(app, &cfg.screenshot) {
        errors.push(format!("screenshot ({}): {e}", cfg.screenshot));
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

/// Dispatch global shortcut event to the appropriate feature handler.
pub fn handle_global_shortcut(app: &AppHandle, triggered: &tauri_plugin_global_shortcut::Shortcut) {
    let cfg = read_config(app);

    if let Ok(qb_sc) = cfg
        .quick_bar
        .parse::<tauri_plugin_global_shortcut::Shortcut>()
    {
        if triggered == &qb_sc {
            let _ = crate::quick_bar::toggle_quick_bar(app.clone());
            return;
        }
    }

    if let Ok(ss_sc) = cfg
        .screenshot
        .parse::<tauri_plugin_global_shortcut::Shortcut>()
    {
        if triggered == &ss_sc {
            handle_screenshot_action(app);
        }
    }
}

fn handle_screenshot_action(app: &AppHandle) {
    // If Quick Bar is currently visible, notify it so it can toggle auto-screen off
    // or trigger region capture in-place.
    if let Some(qb) = app.get_webview_window("quick-bar") {
        if qb.is_visible().unwrap_or(false) {
            let _ = qb.emit("quickbar://shortcut-screen", ());
            return;
        }
    }

    // When the main window is open/visible, capture goes to the main window's composer.
    // Otherwise, it targets the Quick Bar.
    let main_visible = app
        .get_webview_window("main")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);

    let target = if main_visible {
        crate::screenshot::CaptureTarget::Main
    } else {
        crate::screenshot::CaptureTarget::QuickBar
    };

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = crate::screenshot::begin_region_capture(&app_handle, target).await {
            eprintln!("[pidesk] global region capture failed: {e}");
        }
    });
}

fn register_shortcut(app: &AppHandle, shortcut_str: &str) -> Result<(), String> {
    let gs = app.global_shortcut();
    gs.register(shortcut_str)
        .map_err(|e| format!("failed to register '{shortcut_str}': {e}"))
}

fn unregister_shortcut(app: &AppHandle, shortcut_str: &str) {
    let gs = app.global_shortcut();
    let _ = gs.unregister(shortcut_str);
}

// ── Tauri commands ──────────────────────────────────────────────────────

/// Return the complete shortcut configuration.
#[tauri::command]
pub fn get_shortcuts(app: AppHandle) -> ShortcutConfig {
    read_config(&app)
}

/// Change a shortcut by kind ("quick_bar" or "screenshot").
#[tauri::command]
pub fn set_shortcut(app: AppHandle, kind: String, shortcut: String) -> Result<(), String> {
    let mut cfg = read_config(&app);
    let old_val = match kind.as_str() {
        "quick_bar" => cfg.quick_bar.clone(),
        "screenshot" => cfg.screenshot.clone(),
        other => return Err(format!("unknown shortcut kind: {other}")),
    };

    if old_val == shortcut {
        return Ok(());
    }

    unregister_shortcut(&app, &old_val);
    if let Err(e) = register_shortcut(&app, &shortcut) {
        let _ = register_shortcut(&app, &old_val);
        return Err(e);
    }

    match kind.as_str() {
        "quick_bar" => cfg.quick_bar = shortcut,
        "screenshot" => cfg.screenshot = shortcut,
        _ => {}
    }

    write_config(&app, &cfg)?;
    let _ = app.emit("shortcuts://updated", cfg);
    Ok(())
}

/// Backwards-compatible commands
#[tauri::command]
pub fn get_quick_bar_shortcut(app: AppHandle) -> String {
    read_config(&app).quick_bar
}

#[tauri::command]
pub fn set_quick_bar_shortcut(app: AppHandle, shortcut: String) -> Result<(), String> {
    set_shortcut(app, "quick_bar".to_string(), shortcut)
}

#[tauri::command]
pub fn get_screenshot_shortcut(app: AppHandle) -> String {
    read_config(&app).screenshot
}

#[tauri::command]
pub fn set_screenshot_shortcut(app: AppHandle, shortcut: String) -> Result<(), String> {
    set_shortcut(app, "screenshot".to_string(), shortcut)
}

// ── Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_default() {
        let cfg = ShortcutConfig::default();
        assert_eq!(cfg.quick_bar, DEFAULT_QUICK_BAR_SHORTCUT);
        assert_eq!(cfg.screenshot, DEFAULT_SCREENSHOT_SHORTCUT);
    }

    #[test]
    fn config_legacy_single_shortcut_deserialization() {
        let json = r#"{"shortcut":"Ctrl+Alt+P"}"#;
        let cfg: ShortcutConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.quick_bar, "Ctrl+Alt+P");
        assert_eq!(cfg.screenshot, DEFAULT_SCREENSHOT_SHORTCUT);
    }

    #[test]
    fn config_serde_round_trip() {
        let cfg = ShortcutConfig {
            quick_bar: "Ctrl+Alt+P".to_string(),
            screenshot: "Alt+Shift+S".to_string(),
        };
        let json = serde_json::to_string(&cfg).unwrap();
        let back: ShortcutConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(cfg, back);
    }

    #[test]
    fn config_serde_default_on_invalid() {
        let bad = "not json at all";
        let cfg: ShortcutConfig = serde_json::from_str(bad).unwrap_or_default();
        assert_eq!(cfg.quick_bar, DEFAULT_QUICK_BAR_SHORTCUT);
        assert_eq!(cfg.screenshot, DEFAULT_SCREENSHOT_SHORTCUT);
    }
}
