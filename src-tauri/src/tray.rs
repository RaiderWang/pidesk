//! System tray integration — icon, left-click toggle, right-click menu.
//!
//! Single left-click toggles the Quick Bar (with a ~400 ms debounce so a
//! double-click doesn't also trigger a single-click action).
//! Double left-click shows the main `PiDesk` window.

use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc,
};
use std::time::Duration;

use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::quick_bar;

/// Build and install the system tray. Call once during `setup`.
pub fn build(app: &AppHandle) -> Result<(), String> {
    let show_main = MenuItemBuilder::with_id("show_main", "Show PiDesk")
        .build(app)
        .map_err(|e| e.to_string())?;
    let show_bar = MenuItemBuilder::with_id("show_bar", "Quick Bar")
        .build(app)
        .map_err(|e| e.to_string())?;
    let quit = MenuItemBuilder::with_id("quit", "Quit")
        .build(app)
        .map_err(|e| e.to_string())?;

    let menu = MenuBuilder::new(app)
        .item(&show_main)
        .item(&show_bar)
        .separator()
        .item(&quit)
        .build()
        .map_err(|e| e.to_string())?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| "no default window icon".to_string())?;

    // Generation counter for the single-click debounce.  Left-click (Up)
    // increments the counter and schedules a delayed action; if a DoubleClick
    // arrives within the delay window it increments again, causing the
    // delayed check to find a mismatch and abort the single-click action.
    //
    // `suppress_click` handles the trailing Click(Up) that Windows always
    // delivers *after* a DoubleClick event.  Without it, that trailing
    // Click arms a second timer whose generation matches, so the Quick Bar
    // also opens ~400 ms after the main window.
    let click_gen: Arc<AtomicU64> = Arc::new(AtomicU64::new(0));
    let suppress_click: Arc<AtomicBool> = Arc::new(AtomicBool::new(false));

    TrayIconBuilder::new()
        .icon(icon)
        .tooltip("PiDesk")
        .show_menu_on_left_click(false)
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show_main" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.unminimize();
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
            "show_bar" => {
                let _ = quick_bar::toggle_quick_bar(app.clone());
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(move |tray, event| match event {
            // Single left-click: arm a generation and fire after ~400 ms unless
            // a DoubleClick cancels it by incrementing the generation first.
            //
            // On Windows the event sequence for a double-click is:
            //   Click(Up) → DoubleClick → Click(Up)
            // The trailing Click(Up) must be swallowed via `suppress_click`,
            // otherwise it arms a fresh timer whose generation matches and
            // the Quick Bar opens ~400 ms after the main window.
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } => {
                // Consume the trailing Click(Up) that follows a DoubleClick.
                if suppress_click
                    .compare_exchange(true, false, Ordering::SeqCst, Ordering::SeqCst)
                    .is_ok()
                {
                    return;
                }

                let gen = click_gen.fetch_add(1, Ordering::SeqCst) + 1;
                let gen_arc = Arc::clone(&click_gen);
                let app = tray.app_handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(400));
                    if gen_arc.load(Ordering::SeqCst) == gen {
                        let _ = quick_bar::toggle_quick_bar(app);
                    }
                });
            }
            // Double left-click: cancel the pending single-click and show the
            // main `PiDesk` window.  The Quick Bar will auto-hide on focus loss.
            TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => {
                // Cancel any pending single-click timer.
                click_gen.fetch_add(1, Ordering::SeqCst);
                // Tell the next Click(Up) to swallow itself.
                suppress_click.store(true, Ordering::SeqCst);

                if let Some(win) = tray.app_handle().get_webview_window("main") {
                    let _ = win.unminimize();
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
            _ => {}
        })
        .build(app)
        .map_err(|e| format!("failed to build tray: {e}"))?;

    Ok(())
}

// ── Activity tooltip ────────────────────────────────────────────────────

/// Map an activity string to a tray tooltip. Pure — no side effects.
#[must_use]
pub fn activity_tooltip(activity: &str) -> String {
    match activity {
        "idle" => "PiDesk".to_string(),
        "streaming" => "PiDesk — streaming…".to_string(),
        other => format!("PiDesk — {other}"),
    }
}

/// Tauri command: update the tray tooltip from the frontend.
#[tauri::command]
pub fn set_tray_activity(app: AppHandle, activity: String) -> Result<(), String> {
    let tooltip = activity_tooltip(&activity);
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_tooltip(Some(&tooltip))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tooltip_idle() {
        assert_eq!(activity_tooltip("idle"), "PiDesk");
    }

    #[test]
    fn tooltip_streaming() {
        assert_eq!(activity_tooltip("streaming"), "PiDesk — streaming…");
    }

    #[test]
    fn tooltip_custom() {
        assert_eq!(activity_tooltip("running bash"), "PiDesk — running bash");
    }

    // ── Click-generation debounce logic ────────────────────────────────

    #[test]
    fn click_gen_arm_still_matches() {
        // After a single click arms the counter, the generation must still
        // equal the snapshot taken at arm time (no double-click arrived).
        let gen_arc = Arc::new(AtomicU64::new(0));
        let gen = gen_arc.fetch_add(1, Ordering::SeqCst) + 1;
        assert_eq!(
            gen_arc.load(Ordering::SeqCst),
            gen,
            "generation unchanged → single-click action should fire"
        );
    }

    #[test]
    fn click_gen_double_click_cancels() {
        // A double-click increments the counter again, so the delayed check
        // finds a mismatch and cancels the single-click action.
        let gen_arc = Arc::new(AtomicU64::new(0));
        let gen = gen_arc.fetch_add(1, Ordering::SeqCst) + 1;
        gen_arc.fetch_add(1, Ordering::SeqCst);
        assert_ne!(
            gen_arc.load(Ordering::SeqCst),
            gen,
            "generation changed → single-click action should be cancelled"
        );
    }

    // ── Suppress-click flag (trailing Click after DoubleClick) ────────

    #[test]
    fn suppress_eats_trailing_click() {
        // DoubleClick sets the flag; the very next Click(Up) should consume
        // it via compare_exchange and do nothing.
        let suppress = Arc::new(AtomicBool::new(false));
        // Simulate DoubleClick → set flag.
        suppress.store(true, Ordering::SeqCst);
        // Trailing Click(Up) → consumed.
        assert!(
            suppress
                .compare_exchange(true, false, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok(),
            "trailing click should be swallowed"
        );
        // Subsequent Click(Up) → NOT suppressed (flag already cleared).
        assert!(
            suppress
                .compare_exchange(true, false, Ordering::SeqCst, Ordering::SeqCst)
                .is_err(),
            "normal click after trailing should not be suppressed"
        );
    }
}
