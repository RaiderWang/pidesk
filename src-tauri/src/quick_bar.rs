//! Quick Bar — a lightweight floating input panel invoked by a global
//! hotkey. The window is lazily created on first toggle and reused
//! across subsequent show/hide cycles.

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// Quick Bar window label — must match the capability file.
const LABEL: &str = "quick-bar";

/// Default logical width of the Quick Bar.
const DEFAULT_WIDTH: f64 = 680.0;
/// Minimum logical height (input row + hint bar).
const MIN_HEIGHT: f64 = 76.0;
/// Maximum logical height (input + expanded result area).
const MAX_HEIGHT: f64 = 480.0;
/// Vertical offset from top of screen (fraction of monitor height).
const TOP_FRACTION: f64 = 0.22;

// ── Pure helpers (tested below) ─────────────────────────────────────────

/// Compute the top-left `(x, y)` for centering the Quick Bar horizontally
/// and placing it at `TOP_FRACTION` of the monitor height.
///
/// `monitor_w` / `monitor_h` are the available monitor dimensions in
/// logical pixels; `bar_w` / `bar_h` are the Quick Bar's own dimensions.
#[must_use]
pub fn compute_position(monitor_w: f64, monitor_h: f64, bar_w: f64, bar_h: f64) -> (f64, f64) {
    let x = ((monitor_w - bar_w) / 2.0).max(0.0);
    let y = monitor_h.mul_add(TOP_FRACTION, -(bar_h / 2.0)).max(0.0);
    (x.round(), y.round())
}

/// Clamp a requested height to [`MIN_HEIGHT`, `MAX_HEIGHT`].
#[must_use]
pub const fn clamp_height(h: f64) -> f64 {
    h.clamp(MIN_HEIGHT, MAX_HEIGHT)
}

// ── Window management ───────────────────────────────────────────────────

/// Get the existing Quick Bar window, or lazily create one.
fn get_or_create(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(win) = app.get_webview_window(LABEL) {
        return Ok(win);
    }

    let win = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("quick-bar.html".into()))
        .title("Quick Bar")
        .inner_size(DEFAULT_WIDTH, MIN_HEIGHT)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .shadow(true)
        .focused(true)
        .build()
        .map_err(|e| format!("failed to create quick-bar window: {e}"))?;

    // Auto-hide when the window loses focus.
    let win_clone = win.clone();
    win.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Focused(false)) {
            let _ = win_clone.hide();
        }
    });

    Ok(win)
}

/// Reposition the window to the primary monitor's center-top area.
fn reposition(win: &tauri::WebviewWindow) -> Result<(), String> {
    let monitor = win
        .primary_monitor()
        .map_err(|e| format!("monitor query failed: {e}"))?
        .ok_or_else(|| "no primary monitor".to_string())?;

    let scale = monitor.scale_factor();
    let mon_w = f64::from(monitor.size().width) / scale;
    let mon_h = f64::from(monitor.size().height) / scale;

    let size = win.outer_size().map_err(|e| e.to_string())?;
    let bar_w = f64::from(size.width) / scale;
    let bar_h = f64::from(size.height) / scale;

    let (x, y) = compute_position(mon_w, mon_h, bar_w, bar_h);
    win.set_position(tauri::LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}

// ── Tauri commands ──────────────────────────────────────────────────────

/// Pre-create the Quick Bar window (hidden) during app startup.
///
/// `WebView2` initialisation is asynchronous. When the window was instead
/// built lazily on the very first [`toggle_quick_bar`] call, that same
/// call's `show()`/`set_focus()` could race the `WebView2` controller still
/// attaching to the freshly-created HWND — the window would silently
/// fail to come to the foreground, so the first hotkey/tray click after
/// launch appeared to do nothing. The second click always worked because
/// by then the webview had finished attaching. Building the window here
/// gives it the rest of the startup sequence to finish warming up before
/// the user can possibly trigger the first toggle.
pub fn warm_up(app: &AppHandle) -> Result<(), String> {
    get_or_create(app).map(|_| ())
}

/// Toggle the Quick Bar: show (with reposition) if hidden, hide if visible.
/// Emits `quickbar://show` to the Quick Bar webview so the frontend can
/// reset its state (clear input, result, mode) on each fresh invocation.
#[tauri::command]
pub fn toggle_quick_bar(app: AppHandle) -> Result<(), String> {
    let win = get_or_create(&app)?;
    let visible = win.is_visible().unwrap_or(false);
    if visible {
        win.hide().map_err(|e| e.to_string())
    } else {
        // Reset to minimum height each time it appears. Sizing/reposition
        // are cosmetic best-effort steps — if either fails (e.g. a
        // transient monitor/size query right after creation) we still
        // must reach `show()`/`set_focus()` below, or the window stays
        // hidden with no visible feedback at all. See `warm_up` for the
        // startup-time fix to the underlying race.
        if let Err(e) = win.set_size(tauri::LogicalSize::new(DEFAULT_WIDTH, MIN_HEIGHT)) {
            eprintln!("[pidesk] quick-bar resize failed: {e}");
        }
        if let Err(e) = reposition(&win) {
            eprintln!("[pidesk] quick-bar reposition failed: {e}");
        }
        // Notify the frontend to reset state before showing.
        let _ = win.emit("quickbar://show", ());
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())
    }
}

/// Hide the Quick Bar. No-op if already hidden or not yet created.
#[tauri::command]
pub fn hide_quick_bar(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(LABEL) {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Resize the Quick Bar's height (e.g. when the result area expands).
/// The new height is clamped to [`MIN_HEIGHT`, `MAX_HEIGHT`].
#[tauri::command]
pub fn set_quick_bar_height(app: AppHandle, height: f64) -> Result<(), String> {
    let win = app
        .get_webview_window(LABEL)
        .ok_or_else(|| "quick-bar not open".to_string())?;
    let h = clamp_height(height);
    win.set_size(tauri::LogicalSize::new(DEFAULT_WIDTH, h))
        .map_err(|e| e.to_string())?;
    reposition(&win)
}

// ── Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn position_centers_horizontally() {
        let (x, _) = compute_position(1920.0, 1080.0, 680.0, 56.0);
        // (1920 - 680) / 2 = 620
        assert!((x - 620.0).abs() < 1.0);
    }

    #[test]
    fn position_top_fraction() {
        let (_, y) = compute_position(1920.0, 1080.0, 680.0, 56.0);
        // 1080 * 0.22 - 56/2 = 237.6 - 28 = 209.6 → round = 210
        assert!((y - 210.0).abs() < 1.0);
    }

    #[test]
    fn position_clamps_to_zero() {
        // Tiny monitor where the bar is wider/taller than the screen.
        let (x, y) = compute_position(100.0, 50.0, 680.0, 56.0);
        assert_eq!(x, 0.0);
        assert_eq!(y, 0.0);
    }

    #[test]
    fn clamp_within_range() {
        assert!((clamp_height(200.0) - 200.0).abs() < f64::EPSILON);
    }

    #[test]
    fn clamp_below_min() {
        assert!((clamp_height(10.0) - MIN_HEIGHT).abs() < f64::EPSILON);
    }

    #[test]
    fn clamp_above_max() {
        assert!((clamp_height(9999.0) - MAX_HEIGHT).abs() < f64::EPSILON);
    }
}
