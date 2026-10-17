//! Ephemeral aggregate keyboard activity and window bounds, never text or pixels.
use crate::{native_input, state::State, windows};
use serde::Serialize;
use std::sync::atomic::Ordering;
use tauri::Manager;

#[cfg(target_os = "windows")]
mod foreground;
#[cfg(any(target_os = "windows", test))]
mod keyboard;

#[derive(Clone, Debug, Serialize)]
pub(crate) struct WorkWindow {
    id: u32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkSample {
    window: WorkWindow,
    key_down_count: u32,
    idle_seconds: f64,
}

#[repr(C)]
#[derive(Default)]
struct NativeSample {
    window_id: u32,
    key_down_count: u32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    idle_seconds: f64,
}

fn local_sample(
    sample: NativeSample,
    origin: (i32, i32),
    size: (u32, u32),
    scale: f64,
    bounds_scale: f64,
) -> Option<WorkSample> {
    if sample.window_id == 0 || !scale.is_finite() || scale <= 0.0 {
        return None;
    }

    if !sample.idle_seconds.is_finite() || sample.idle_seconds < 0.0 {
        return None;
    }

    if !bounds_scale.is_finite() || bounds_scale <= 0.0 {
        return None;
    }

    let coordinates = [sample.x, sample.y, sample.width, sample.height];

    if coordinates.iter().any(|coordinate| !coordinate.is_finite()) {
        return None;
    }

    let width = sample.width / bounds_scale;
    let height = sample.height / bounds_scale;

    if width < 200.0 || height < 120.0 {
        return None;
    }

    // Quartz supplies desktop points; DWM and the Tauri overlay use physical pixels.
    // Normalize both origins and dimensions into the overlay's logical coordinates.
    let x = sample.x / bounds_scale - f64::from(origin.0) / scale;
    let y = sample.y / bounds_scale - f64::from(origin.1) / scale;
    let right = (x + width).min(f64::from(size.0) / scale);
    let bottom = (y + height).min(f64::from(size.1) / scale);
    let left = x.max(0.0);

    // Do not invent a top edge for a window above this display, or chase windows
    // onto another display. Use only a substantial visible portion on this overlay.
    if y < 0.0 || right - left < 200.0 || bottom - y < 120.0 {
        return None;
    }

    Some(WorkSample {
        window: WorkWindow {
            id: sample.window_id,
            x: left,
            y,
            width: right - left,
            height: bottom - y,
        },
        key_down_count: sample.key_down_count,
        idle_seconds: sample.idle_seconds,
    })
}

#[cfg(target_os = "macos")]
fn read_sample(_app: &tauri::AppHandle) -> Option<NativeSample> {
    unsafe extern "C" {
        fn gullbert_work_sample(sample: *mut NativeSample) -> bool;
    }

    let mut sample = NativeSample::default();
    // Called on the main thread, with an exclusively owned matching C layout.
    let available = unsafe { gullbert_work_sample(&mut sample) };
    available.then_some(sample)
}

#[cfg(target_os = "windows")]
fn read_sample(app: &tauri::AppHandle) -> Option<NativeSample> {
    let Some(mut sample) = foreground::read() else {
        stop(app);
        return None;
    };

    let (count, idle_seconds) = keyboard::sample(app)?;
    sample.key_down_count = count;
    sample.idle_seconds = idle_seconds;
    Some(sample)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn read_sample(_app: &tauri::AppHandle) -> Option<NativeSample> {
    None
}

pub(crate) fn install(_app: &mut tauri::App) {
    #[cfg(target_os = "windows")]
    keyboard::install(_app);
}

pub(crate) fn stop(_app: &tauri::AppHandle) {
    #[cfg(target_os = "windows")]
    keyboard::stop(_app);
}

#[tauri::command]
pub(crate) async fn stop_work_activity(app: tauri::AppHandle, window: tauri::WebviewWindow) {
    if window.label() != "pet" {
        return;
    }

    let _ = native_input::request(app, stop).await;
}

#[tauri::command]
pub(crate) async fn work_activity(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Option<WorkSample> {
    if window.label() != "pet" {
        return None;
    }

    native_input::request(app, |app| {
        let state = app.state::<State>();

        if !state.visible.load(Ordering::SeqCst) {
            stop(app);
            return None;
        }

        let enabled = {
            let settings = state.settings.lock().unwrap();
            !settings.paused && settings.mischief > 0
        };

        if !enabled {
            stop(app);
            return None;
        }

        let overlay = windows::pet(app).ok()?;
        let origin = overlay.inner_position().ok()?;
        let size = overlay.inner_size().ok()?;
        let scale = overlay.scale_factor().ok()?;
        let bounds_scale = if cfg!(target_os = "windows") {
            scale
        } else {
            1.0
        };

        local_sample(
            read_sample(app)?,
            (origin.x, origin.y),
            (size.width, size.height),
            scale,
            bounds_scale,
        )
    })
    .await
    .ok()
    .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> NativeSample {
        NativeSample {
            window_id: 17,
            key_down_count: 123,
            x: -1100.0,
            y: 160.0,
            width: 800.0,
            height: 500.0,
            idle_seconds: 0.5,
        }
    }

    #[test]
    fn normalizes_negative_retina_origins_and_clips_to_overlay() {
        let value = local_sample(sample(), (-2400, 0), (1600, 1200), 2.0, 1.0).unwrap();
        assert_eq!((value.window.x, value.window.y), (100.0, 160.0));
        assert_eq!((value.window.width, value.window.height), (700.0, 440.0));
        assert_eq!(value.key_down_count, 123);
    }

    #[test]
    fn rejects_offscreen_windows_and_invalid_activity() {
        assert!(local_sample(sample(), (0, 0), (1600, 1200), 1.0, 1.0).is_none());
        let mut invalid = sample();
        invalid.idle_seconds = f64::NAN;
        assert!(local_sample(invalid, (-1200, 0), (1600, 1200), 1.0, 1.0).is_none());
        let mut above = sample();
        above.y = -10.0;
        assert!(local_sample(above, (-1200, 0), (1600, 1200), 1.0, 1.0).is_none());
    }

    #[test]
    fn windows_bounds_use_physical_origins_and_fractional_display_scaling() {
        let sample = NativeSample {
            x: -1650.0,
            y: -650.0,
            width: 1500.0,
            height: 1000.0,
            ..sample()
        };
        let value = local_sample(sample, (-2400, -900), (2000, 1200), 1.25, 1.25).unwrap();
        assert_eq!((value.window.x, value.window.y), (600.0, 200.0));
        assert_eq!((value.window.width, value.window.height), (1000.0, 760.0));
    }

    #[test]
    fn windows_minimum_size_is_logical_and_invalid_scales_are_rejected() {
        for scale in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert!(local_sample(sample(), (-1200, 0), (1600, 1200), 1.0, scale).is_none());
        }

        let small = NativeSample {
            width: 300.0,
            ..sample()
        };
        assert!(local_sample(small, (-1200, 0), (1600, 1200), 2.0, 2.0).is_none());
    }
}
