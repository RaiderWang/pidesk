//! System tray integration — icon, left-click toggle, right-click menu.
//!
//! Single left-click toggles the Quick Bar (with a ~400 ms debounce so a
//! double-click doesn't also trigger a single-click action).
//! Double left-click shows the main `PiDesk` window.

use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};

use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::quick_bar;

/// Default timeout window for coalescing two clicks into a double-click
/// and delaying single-click action.
pub const DOUBLE_CLICK_TIMEOUT: Duration = Duration::from_millis(400);

/// Action decided by [`TrayClickHandler`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayClickAction {
    /// Schedule single-click action (Quick Bar) after debounce duration.
    ArmSingleClick(u64),
    /// Fire double-click action (show main window) immediately.
    FireDoubleClick,
    /// Swallow this event (e.g. trailing Click after Windows DoubleClick).
    Ignore,
}

/// Manages click debounce, software double-click detection (required on macOS
/// and Linux where `TrayIconEvent::DoubleClick` is not synthesized by the OS/library),
/// and Windows trailing-click suppression.
#[derive(Clone)]
pub struct TrayClickHandler {
    click_gen: Arc<AtomicU64>,
    suppress_click: Arc<AtomicBool>,
    last_click: Arc<Mutex<Option<Instant>>>,
    double_click_timeout: Duration,
}

impl TrayClickHandler {
    pub fn new(timeout: Duration) -> Self {
        Self {
            click_gen: Arc::new(AtomicU64::new(0)),
            suppress_click: Arc::new(AtomicBool::new(false)),
            last_click: Arc::new(Mutex::new(None)),
            double_click_timeout: timeout,
        }
    }

    /// Process a Left Click (Up) event.
    pub fn handle_click_up(&self) -> TrayClickAction {
        // On Windows, a native DoubleClick is followed by a trailing Click(Up).
        // Swallow it.
        if self
            .suppress_click
            .compare_exchange(true, false, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            return TrayClickAction::Ignore;
        }

        let now = Instant::now();
        let mut last = self.last_click.lock().unwrap();

        if let Some(prev) = *last {
            if now.duration_since(prev) <= self.double_click_timeout {
                // Double click detected!
                *last = None;
                // Increment generation to cancel any pending single-click timer.
                self.click_gen.fetch_add(1, Ordering::SeqCst);
                return TrayClickAction::FireDoubleClick;
            }
        }

        // First click: record timestamp and increment generation.
        *last = Some(now);
        let gen = self.click_gen.fetch_add(1, Ordering::SeqCst) + 1;
        TrayClickAction::ArmSingleClick(gen)
    }

    /// Process a native `DoubleClick` event (e.g. delivered on Windows).
    pub fn handle_double_click(&self) -> TrayClickAction {
        let mut last = self.last_click.lock().unwrap();
        *last = None;
        self.click_gen.fetch_add(1, Ordering::SeqCst);
        self.suppress_click.store(true, Ordering::SeqCst);
        TrayClickAction::FireDoubleClick
    }

    /// Check if single-click timer should execute when delay expires.
    /// Atomically consumes `gen` and clears `last_click` under lock so
    /// it only ever fires once and an expired click cannot trigger double-click later.
    pub fn check_single_click_timeout(&self, gen: u64) -> bool {
        let mut last = self.last_click.lock().unwrap();
        if self
            .click_gen
            .compare_exchange(gen, gen + 1, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            *last = None;
            true
        } else {
            false
        }
    }
}

/// Helper to bring the main PiDesk window to foreground and hide Quick Bar.
fn show_main_window(app: &AppHandle) {
    let _ = quick_bar::hide_quick_bar(app.clone());
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

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

    let click_handler = TrayClickHandler::new(DOUBLE_CLICK_TIMEOUT);

    TrayIconBuilder::new()
        .icon(icon)
        .tooltip("PiDesk")
        .show_menu_on_left_click(false)
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show_main" => {
                show_main_window(app);
            }
            "show_bar" => {
                let _ = quick_bar::toggle_quick_bar(app.clone());
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event({
            let handler = click_handler.clone();
            move |tray, event| match event {
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } => match handler.handle_click_up() {
                    TrayClickAction::FireDoubleClick => {
                        show_main_window(tray.app_handle());
                    }
                    TrayClickAction::ArmSingleClick(gen) => {
                        let handler = handler.clone();
                        let app = tray.app_handle().clone();
                        let timeout = handler.double_click_timeout;
                        std::thread::spawn(move || {
                            std::thread::sleep(timeout);
                            if handler.check_single_click_timeout(gen) {
                                let _ = quick_bar::toggle_quick_bar(app);
                            }
                        });
                    }
                    TrayClickAction::Ignore => {}
                },
                TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                } => {
                    if handler.handle_double_click() == TrayClickAction::FireDoubleClick {
                        show_main_window(tray.app_handle());
                    }
                }
                _ => {}
            }
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

    // ── Click debounce & double-click logic ───────────────────────────

    #[test]
    fn single_click_arms_and_timeout_fires() {
        let handler = TrayClickHandler::new(Duration::from_millis(50));
        let action = handler.handle_click_up();
        assert_eq!(action, TrayClickAction::ArmSingleClick(1));

        // Before timeout check with matching gen -> fires
        assert!(handler.check_single_click_timeout(1));

        // Second check with same gen fails because gen hasn't changed but state was cleared
        assert!(!handler.check_single_click_timeout(1));
    }

    #[test]
    fn double_click_within_timeout_fires_double_click() {
        let handler = TrayClickHandler::new(Duration::from_millis(200));
        let first = handler.handle_click_up();
        assert_eq!(first, TrayClickAction::ArmSingleClick(1));

        // Second click quickly follows
        let second = handler.handle_click_up();
        assert_eq!(second, TrayClickAction::FireDoubleClick);

        // Pending single-click from first click must be cancelled
        assert!(!handler.check_single_click_timeout(1));
    }

    #[test]
    fn double_click_after_timeout_acts_as_two_single_clicks() {
        let handler = TrayClickHandler::new(Duration::from_millis(20));
        let first = handler.handle_click_up();
        assert_eq!(first, TrayClickAction::ArmSingleClick(1));

        // Sleep past the timeout
        std::thread::sleep(Duration::from_millis(30));

        // The first timer fires and consumes the state
        assert!(handler.check_single_click_timeout(1));

        // The next click is now a new single click, not a double-click
        let second = handler.handle_click_up();
        assert_eq!(second, TrayClickAction::ArmSingleClick(3));
    }

    #[test]
    fn native_double_click_cancels_timer_and_suppresses_trailing_click() {
        let handler = TrayClickHandler::new(Duration::from_millis(200));
        // Windows click sequence: Click(Up) -> DoubleClick -> Click(Up)
        let first = handler.handle_click_up();
        assert_eq!(first, TrayClickAction::ArmSingleClick(1));

        let dbl = handler.handle_double_click();
        assert_eq!(dbl, TrayClickAction::FireDoubleClick);

        // Single click timer is invalidated
        assert!(!handler.check_single_click_timeout(1));

        // Trailing Click(Up) is suppressed
        let trailing = handler.handle_click_up();
        assert_eq!(trailing, TrayClickAction::Ignore);

        // Next click is normal again
        let next = handler.handle_click_up();
        assert_eq!(next, TrayClickAction::ArmSingleClick(3));
    }

    #[test]
    fn triple_click_groups_into_double_then_single() {
        let handler = TrayClickHandler::new(Duration::from_millis(200));
        let c1 = handler.handle_click_up();
        assert_eq!(c1, TrayClickAction::ArmSingleClick(1));

        let c2 = handler.handle_click_up();
        assert_eq!(c2, TrayClickAction::FireDoubleClick);

        let c3 = handler.handle_click_up();
        assert_eq!(c3, TrayClickAction::ArmSingleClick(3));
    }
}
