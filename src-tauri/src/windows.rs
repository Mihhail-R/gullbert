//! Overlay geometry, monitor selection, and access to the application's windows.
use crate::{native_input::Purpose as TargetPurpose, state::State};
use serde::Serialize;
use std::sync::atomic::Ordering;
use tauri::Manager;

#[derive(Clone, Serialize)]
pub(crate) struct Point {
    pub(crate) x: f64,
    pub(crate) y: f64,
}
#[derive(Debug, Serialize)]
pub(crate) struct CursorPoint {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) inside: bool,
}
pub(crate) fn pet(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window("pet")
        .ok_or("Pet window unavailable".into())
}
// Tauri/tao on macOS scales the global pointer by the primary display's
// scale, but the window origin by its own display's scale. Normalize both
// into desktop logical coordinates before subtracting. On Windows/Linux
// both inputs share physical coordinates, so both scales are the window's.
fn local_cursor(
    cursor: (f64, f64),
    origin: (i32, i32),
    size: (u32, u32),
    scale: f64,
    cursor_scale: f64,
) -> Option<CursorPoint> {
    if !cursor.0.is_finite() || !cursor.1.is_finite() {
        return None;
    }
    if !scale.is_finite() || scale <= 0.0 {
        return None;
    }
    if !cursor_scale.is_finite() || cursor_scale <= 0.0 {
        return None;
    }
    if size.0 == 0 || size.1 == 0 {
        return None;
    }
    let x = cursor.0 / cursor_scale - f64::from(origin.0) / scale;
    let y = cursor.1 / cursor_scale - f64::from(origin.1) / scale;
    let within_width = x >= 0.0 && x < f64::from(size.0) / scale;
    let within_height = y >= 0.0 && y < f64::from(size.1) / scale;
    Some(CursorPoint {
        x,
        y,
        inside: within_width && within_height,
    })
}
#[tauri::command]
pub(crate) fn cursor_position(app: tauri::AppHandle) -> Option<CursorPoint> {
    let state = app.state::<State>();
    if !state.visible.load(Ordering::SeqCst) {
        return None;
    }
    // Position only; no input hooks or screen contents. The frontend samples
    // at 10 Hz while visible; local click capture also checks its exit at 20 Hz.
    let window = pet(&app).ok()?;
    let origin = window.inner_position().ok()?;
    let size = window.inner_size().ok()?;
    let scale = window.scale_factor().ok()?;
    let cursor = window.cursor_position().ok()?;
    #[cfg(target_os = "macos")]
    let cursor_scale = window.primary_monitor().ok()??.scale_factor();
    #[cfg(not(target_os = "macos"))]
    let cursor_scale = scale;
    local_cursor(
        (cursor.x, cursor.y),
        (origin.x, origin.y),
        (size.width, size.height),
        scale,
        cursor_scale,
    )
}

pub(crate) fn controls(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("controls") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}
pub(crate) fn fit_to_cursor_monitor(app: &tauri::AppHandle) -> Result<Point, String> {
    let w = pet(app)?;
    let cursor = w.cursor_position().map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    let cursor_scale = w
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("No primary display available")?
        .scale_factor();
    // tao's macOS monitor lookup takes Cocoa points, not backing pixels.
    #[cfg(target_os = "macos")]
    let lookup = (cursor.x / cursor_scale, cursor.y / cursor_scale);
    #[cfg(not(target_os = "macos"))]
    let lookup = (cursor.x, cursor.y);
    let monitor = w
        .monitor_from_point(lookup.0, lookup.1)
        .map_err(|e| e.to_string())?
        .or(w.primary_monitor().map_err(|e| e.to_string())?)
        .ok_or("No display available")?;
    let scale = monitor.scale_factor();
    // Cocoa window positioning converts physical values with the current
    // window scale, which may still belong to the previous display.
    #[cfg(target_os = "macos")]
    w.set_position(tauri::LogicalPosition::new(
        f64::from(monitor.position().x) / scale,
        f64::from(monitor.position().y) / scale,
    ))
    .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    w.set_position(*monitor.position())
        .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    let cursor_scale = scale;
    // A hidden window can still report its old backing scale. Size in logical
    // units using the destination display, rather than that stale window scale.
    w.set_size(tauri::LogicalSize::new(
        monitor.size().width as f64 / scale,
        monitor.size().height as f64 / scale,
    ))
    .map_err(|e| e.to_string())?;
    let p = local_cursor(
        (cursor.x, cursor.y),
        (monitor.position().x, monitor.position().y),
        (monitor.size().width, monitor.size().height),
        scale,
        cursor_scale,
    )
    .ok_or("Invalid display geometry")?;
    Ok(Point { x: p.x, y: p.y })
}

// Display policy stays outside the input module. Tidy keeps the current display
// unless hidden; ordinary placement follows the cursor's display.
pub(crate) fn position_for_target(
    app: &tauri::AppHandle,
    purpose: TargetPurpose,
) -> Result<(), String> {
    if purpose != TargetPurpose::Tidy || !app.state::<State>().visible.load(Ordering::SeqCst) {
        fit_to_cursor_monitor(app)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::local_cursor;

    #[test]
    fn cursor_uses_client_origin_before_retina_scaling() {
        let p = local_cursor((2400.0, 500.0), (2000, 100), (2880, 1800), 2.0, 2.0).unwrap();
        assert_eq!((p.x, p.y, p.inside), (200.0, 200.0, true));
    }

    #[test]
    fn cursor_supports_negative_secondary_display_origins_and_fractional_scaling() {
        let p = local_cursor((-1650.0, -650.0), (-2400, -900), (2400, 1500), 1.25, 1.25).unwrap();
        assert_eq!((p.x, p.y, p.inside), (600.0, 200.0, true));
    }

    #[test]
    fn macos_cursor_and_window_can_use_different_display_scales() {
        // Primary Retina pointer coordinates, secondary 1x window above/left.
        let p = local_cursor((-3300.0, -1300.0), (-2400, -900), (2400, 1500), 1.0, 2.0).unwrap();
        assert_eq!((p.x, p.y, p.inside), (750.0, 250.0, true));
        // Secondary Retina window to the right of a primary 1x display.
        let p = local_cursor((2220.0, 150.0), (3840, 0), (2880, 1800), 2.0, 1.0).unwrap();
        assert_eq!((p.x, p.y, p.inside), (300.0, 150.0, true));
    }

    #[test]
    fn cursor_outside_overlay_stays_outside_instead_of_being_clamped() {
        for cursor in [(-1.0, 30.0), (30.0, -1.0), (1920.0, 30.0), (30.0, 1080.0)] {
            let p = local_cursor(cursor, (0, 0), (1920, 1080), 1.0, 1.0).unwrap();
            assert!(!p.inside);
        }
        assert!(
            local_cursor((0.0, 0.0), (0, 0), (1920, 1080), 1.0, 1.0)
                .unwrap()
                .inside
        );
    }

    #[test]
    fn invalid_geometry_skips_cursor_tracking() {
        for scale in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert!(local_cursor((100.0, 100.0), (0, 0), (1920, 1080), scale, scale).is_none());
        }
        assert!(local_cursor((f64::NAN, 100.0), (0, 0), (1920, 1080), 1.0, 1.0).is_none());
        assert!(local_cursor((100.0, f64::INFINITY), (0, 0), (1920, 1080), 1.0, 1.0).is_none());
        assert!(local_cursor((100.0, 100.0), (0, 0), (0, 1080), 1.0, 1.0).is_none());
    }
}
