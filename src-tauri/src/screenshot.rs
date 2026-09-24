//! Screen capture and region selection for the Quick Bar.
//!
//! Provides full-screen capture with auto-downscaling to manage resolution/payload size,
//! and an interactive region-selection overlay window.

use std::sync::Mutex;
use std::time::Duration;

use base64::Engine;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ExtendedColorType, RgbaImage};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Label for the fullscreen selection overlay window.
pub const OVERLAY_LABEL: &str = "screenshot-overlay";
/// Quick Bar window label.
const QUICK_BAR_LABEL: &str = "quick-bar";
/// Main window label.
const MAIN_WINDOW_LABEL: &str = "main";

/// Target window that requested the region capture.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CaptureTarget {
    #[default]
    QuickBar,
    Main,
}

/// Maximum width for screenshot payloads sent to models.
pub const DEFAULT_MAX_WIDTH: u32 = 1920;
/// Default JPEG quality (balanced for text readability vs size).
pub const DEFAULT_JPEG_QUALITY: u8 = 75;

// ── State ───────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct ScreenshotState {
    /// Full-resolution image held while the region overlay is active.
    pub frozen_image: Mutex<Option<RgbaImage>>,
    /// Base64 data-URL of the current frozen screenshot for the overlay window.
    pub current_background: Mutex<Option<String>>,
    /// Window that should receive the capture result and be restored.
    pub target: Mutex<CaptureTarget>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionResult {
    pub base64: String,
    pub mime_type: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackgroundPayload {
    data_url: String,
}

// ── Pure transformation helpers (tested below) ──────────────────────────

/// Calculate physical crop bounds from logical selection and device pixel ratio.
#[must_use]
pub fn compute_crop_rect(
    img_w: u32,
    img_h: u32,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    scale_factor: f64,
) -> (u32, u32, u32, u32) {
    let scale = if scale_factor <= 0.0 {
        1.0
    } else {
        scale_factor
    };
    let px = (f64::from(x) * scale).round() as u32;
    let py = (f64::from(y) * scale).round() as u32;
    let pw = (f64::from(w) * scale).round() as u32;
    let ph = (f64::from(h) * scale).round() as u32;

    let clamped_x = px.min(img_w);
    let clamped_y = py.min(img_h);
    let clamped_w = pw.min(img_w.saturating_sub(clamped_x));
    let clamped_h = ph.min(img_h.saturating_sub(clamped_y));

    (clamped_x, clamped_y, clamped_w.max(1), clamped_h.max(1))
}

/// Compute new dimensions preserving aspect ratio if wider than `max_w`.
#[must_use]
pub fn compute_resize_dims(orig_w: u32, orig_h: u32, max_w: u32) -> (u32, u32) {
    if orig_w == 0 || orig_h == 0 {
        return (1, 1);
    }
    if orig_w > max_w {
        let aspect = f64::from(orig_h) / f64::from(orig_w);
        let new_h = ((f64::from(max_w) * aspect).round() as u32).max(1);
        (max_w, new_h)
    } else {
        (orig_w, orig_h)
    }
}

/// Downscale an RGBA image if wider than `max_w`.
#[must_use]
pub fn resize_if_needed(img: RgbaImage, max_w: u32) -> RgbaImage {
    let (new_w, new_h) = compute_resize_dims(img.width(), img.height(), max_w);
    if new_w != img.width() || new_h != img.height() {
        image::imageops::resize(&img, new_w, new_h, FilterType::Lanczos3)
    } else {
        img
    }
}

/// Encode RGBA image buffer to JPEG base64 string.
pub fn encode_jpeg_base64(img: &RgbaImage, quality: u8) -> Result<String, String> {
    let rgb_img = DynamicImage::ImageRgba8(img.clone()).to_rgb8();
    let mut buf = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut buf, quality);
    encoder
        .encode(
            rgb_img.as_raw(),
            rgb_img.width(),
            rgb_img.height(),
            ExtendedColorType::Rgb8,
        )
        .map_err(|e| format!("jpeg encode error: {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&buf))
}

/// Capture the primary screen into an RGBA buffer.
pub fn capture_primary_screen() -> Result<RgbaImage, String> {
    let monitors = xcap::Monitor::all().map_err(|e| format!("failed to list monitors: {e}"))?;
    let primary = monitors
        .into_iter()
        .find(|m| m.is_primary())
        .ok_or_else(|| "no primary monitor found".to_string())?;
    primary
        .capture_image()
        .map_err(|e| format!("screen capture failed: {e}"))
}

// ── Tauri Commands ──────────────────────────────────────────────────────

/// Capture full screen, downscaling if wider than [`DEFAULT_MAX_WIDTH`].
/// Temporarily hides Quick Bar during capture.
#[tauri::command]
pub async fn capture_screen(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let qb_opt = app.get_webview_window(QUICK_BAR_LABEL);
        if let Some(ref qb) = qb_opt {
            let _ = qb.hide();
        }
        std::thread::sleep(Duration::from_millis(150));

        let raw = capture_primary_screen();

        if let Some(ref qb) = qb_opt {
            let _ = qb.show();
            let _ = qb.set_focus();
        }

        let raw_img = raw?;
        let resized = resize_if_needed(raw_img, DEFAULT_MAX_WIDTH);
        encode_jpeg_base64(&resized, DEFAULT_JPEG_QUALITY)
    })
    .await
    .map_err(|e| format!("capture task panicked: {e}"))?
}

/// Pre-create or retrieve the region-selection overlay window.
///
/// Created initially hidden (`visible: false`) so WebView2 finishes initializing
/// without popping up during startup.
pub fn get_or_create_overlay(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(w) = app.get_webview_window(OVERLAY_LABEL) {
        Ok(w)
    } else {
        WebviewWindowBuilder::new(
            app,
            OVERLAY_LABEL,
            WebviewUrl::App("screenshot-overlay.html".into()),
        )
        .title("Screenshot")
        .fullscreen(true)
        .decorations(false)
        .transparent(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()
        .map_err(|e| format!("failed to build overlay window: {e}"))
    }
}

/// Pre-warm the overlay window at startup so the first region capture does
/// not suffer from a cold WebView2 attach or a missed background event.
pub fn warm_up(app: &AppHandle) -> Result<(), String> {
    get_or_create_overlay(app).map(|_| ())
}

/// Begin region capture: hide target/source window, freeze screen, show overlay.
pub async fn begin_region_capture(app: &AppHandle, target: CaptureTarget) -> Result<(), String> {
    let raw_img = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || {
            match target {
                CaptureTarget::Main => {
                    if let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                        let _ = main.hide();
                    }
                    if let Some(qb) = app.get_webview_window(QUICK_BAR_LABEL) {
                        let _ = qb.hide();
                    }
                }
                CaptureTarget::QuickBar => {
                    if let Some(qb) = app.get_webview_window(QUICK_BAR_LABEL) {
                        let _ = qb.hide();
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(150));
            capture_primary_screen()
        }
    })
    .await
    .map_err(|e| format!("capture task panicked: {e}"))??;

    let base64_str = encode_jpeg_base64(&raw_img, 85)?;
    let data_url = format!("data:image/jpeg;base64,{base64_str}");

    let state = app.state::<ScreenshotState>();
    {
        let mut guard = state.frozen_image.lock().unwrap();
        *guard = Some(raw_img);
    }
    {
        let mut bg_guard = state.current_background.lock().unwrap();
        *bg_guard = Some(data_url.clone());
    }
    {
        let mut target_guard = state.target.lock().unwrap();
        *target_guard = target;
    }

    let win = get_or_create_overlay(app)?;
    let _ = win.set_fullscreen(true);
    win.show().map_err(|e| e.to_string())?;
    win.set_focus().map_err(|e| e.to_string())?;
    let _ = win.emit("screenshot://background", BackgroundPayload { data_url });

    Ok(())
}

/// Begin region capture via Tauri command.
/// Accepts optional `target` ("main" or "quick-bar"); defaults to "main" if main is visible.
#[tauri::command]
pub async fn start_region_capture(app: AppHandle, target: Option<String>) -> Result<(), String> {
    let resolved_target = match target.as_deref() {
        Some("main") => CaptureTarget::Main,
        Some("quick-bar" | "quickbar") => CaptureTarget::QuickBar,
        _ => {
            let main_visible = app
                .get_webview_window(MAIN_WINDOW_LABEL)
                .and_then(|w| w.is_visible().ok())
                .unwrap_or(false);
            if main_visible {
                CaptureTarget::Main
            } else {
                CaptureTarget::QuickBar
            }
        }
    };
    begin_region_capture(&app, resolved_target).await
}

/// Get the current screenshot background data URL.
/// Called proactively by the overlay frontend when mounting to ensure it
/// displays the background even if the `screenshot://background` event fired early.
#[tauri::command]
pub fn get_screenshot_background(state: State<'_, ScreenshotState>) -> Option<String> {
    state.current_background.lock().unwrap().clone()
}

/// Complete region capture: crop from frozen buffer, return cropped base64, restore target window.
#[tauri::command]
pub fn finish_region_capture(
    app: AppHandle,
    state: State<'_, ScreenshotState>,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    scale_factor: f64,
) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = overlay.hide();
    }

    let frozen = {
        let mut guard = state.frozen_image.lock().unwrap();
        guard.take()
    };
    {
        let mut bg_guard = state.current_background.lock().unwrap();
        *bg_guard = None;
    }
    let target = {
        let mut target_guard = state.target.lock().unwrap();
        let current = *target_guard;
        *target_guard = CaptureTarget::QuickBar;
        current
    };

    let Some(raw_img) = frozen else {
        match target {
            CaptureTarget::Main => {
                if let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                    let _ = main.show();
                    let _ = main.set_focus();
                }
            }
            CaptureTarget::QuickBar => {
                if let Some(qb) = app.get_webview_window(QUICK_BAR_LABEL) {
                    let _ = qb.show();
                    let _ = qb.set_focus();
                }
            }
        }
        return Err("no frozen screenshot found".to_string());
    };

    let (cx, cy, cw, ch) = compute_crop_rect(
        raw_img.width(),
        raw_img.height(),
        x,
        y,
        width,
        height,
        scale_factor,
    );

    let cropped = image::imageops::crop_imm(&raw_img, cx, cy, cw, ch).to_image();
    let final_img = resize_if_needed(cropped, DEFAULT_MAX_WIDTH);
    let base64_str = encode_jpeg_base64(&final_img, DEFAULT_JPEG_QUALITY)?;

    let result = RegionResult {
        base64: base64_str,
        mime_type: "image/jpeg".to_string(),
        width: final_img.width(),
        height: final_img.height(),
    };

    match target {
        CaptureTarget::Main => {
            if let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                let _ = main.show();
                let _ = main.set_focus();
                let _ = main.emit("main://screenshot-result", result);
            }
        }
        CaptureTarget::QuickBar => {
            if let Some(qb) = app.get_webview_window(QUICK_BAR_LABEL) {
                let _ = qb.show();
                let _ = qb.set_focus();
                let _ = qb.emit("quickbar://region-result", result);
            }
        }
    }

    Ok(())
}

/// Cancel region selection and re-show target window.
#[tauri::command]
pub fn cancel_region_capture(
    app: AppHandle,
    state: State<'_, ScreenshotState>,
) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = overlay.hide();
    }
    {
        let mut guard = state.frozen_image.lock().unwrap();
        *guard = None;
    }
    {
        let mut bg_guard = state.current_background.lock().unwrap();
        *bg_guard = None;
    }
    let target = {
        let mut target_guard = state.target.lock().unwrap();
        let current = *target_guard;
        *target_guard = CaptureTarget::QuickBar;
        current
    };

    match target {
        CaptureTarget::Main => {
            if let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                let _ = main.show();
                let _ = main.set_focus();
            }
        }
        CaptureTarget::QuickBar => {
            if let Some(qb) = app.get_webview_window(QUICK_BAR_LABEL) {
                let _ = qb.show();
                let _ = qb.set_focus();
            }
        }
    }

    Ok(())
}

// ── Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crop_rect_scaling() {
        let (x, y, w, h) = compute_crop_rect(1920, 1080, 100, 100, 200, 150, 2.0);
        assert_eq!((x, y, w, h), (200, 200, 400, 300));
    }

    #[test]
    fn crop_rect_clamps_to_boundary() {
        let (x, y, w, h) = compute_crop_rect(500, 500, 400, 400, 300, 300, 1.0);
        assert_eq!(x, 400);
        assert_eq!(y, 400);
        assert_eq!(w, 100);
        assert_eq!(h, 100);
    }

    #[test]
    fn resize_dims_preserves_aspect() {
        let (w, h) = compute_resize_dims(3840, 2160, 1920);
        assert_eq!(w, 1920);
        assert_eq!(h, 1080);
    }

    #[test]
    fn resize_dims_no_op_when_smaller() {
        let (w, h) = compute_resize_dims(1280, 720, 1920);
        assert_eq!(w, 1280);
        assert_eq!(h, 720);
    }

    #[test]
    fn encode_jpeg_round_trip() {
        let img = RgbaImage::new(10, 10);
        let res = encode_jpeg_base64(&img, 75);
        assert!(res.is_ok());
        let b64 = res.unwrap();
        assert!(!b64.is_empty());
    }

    #[test]
    fn screenshot_state_mutation() {
        let state = ScreenshotState::default();
        assert!(state.frozen_image.lock().unwrap().is_none());
        assert!(state.current_background.lock().unwrap().is_none());
        assert_eq!(*state.target.lock().unwrap(), CaptureTarget::QuickBar);

        *state.current_background.lock().unwrap() = Some("data:image/jpeg;base64,abc".to_string());
        *state.target.lock().unwrap() = CaptureTarget::Main;
        assert_eq!(
            state.current_background.lock().unwrap().as_deref(),
            Some("data:image/jpeg;base64,abc")
        );
        assert_eq!(*state.target.lock().unwrap(), CaptureTarget::Main);

        *state.current_background.lock().unwrap() = None;
        assert!(state.current_background.lock().unwrap().is_none());
    }
}
