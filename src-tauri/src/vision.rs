//! Optional macOS screen OCR. The cache contains geometry and one display glyph only.
use crate::{caret::DesktopCaret, state::State};
use serde::Serialize;
use std::{
    sync::atomic::Ordering,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::Manager;

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct RawResult {
    status: i32,
    display: u32,
    x: f64,
    y: f64,
    height: f64,
    glyph: u32,
}
#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn gullbert_vision_access(prompt: i32) -> i32;
    fn gullbert_vision_read() -> RawResult;
}
fn access(prompt: bool) -> i32 {
    #[cfg(target_os = "macos")]
    unsafe {
        gullbert_vision_access(i32::from(prompt))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = prompt;
        0
    }
}
fn capture() -> RawResult {
    #[cfg(target_os = "macos")]
    unsafe {
        gullbert_vision_read()
    }
    #[cfg(not(target_os = "macos"))]
    {
        RawResult {
            status: 1,
            ..RawResult::default()
        }
    }
}
#[derive(Default)]
struct Cache {
    generation: u64,
    pending: bool,
    at: Option<Instant>,
    status: &'static str,
    sample: Option<DesktopCaret>,
}
#[derive(Default)]
pub(crate) struct Runtime {
    cache: Mutex<Cache>,
}
#[derive(Serialize)]
pub(crate) struct Status {
    supported: bool,
    granted: bool,
    state: &'static str,
}
#[tauri::command]
pub(crate) fn vision_status(app: tauri::AppHandle, prompt: bool) -> Status {
    let flags = access(prompt);
    let state = app.state::<State>();
    let settings = state.settings.lock().unwrap();
    let runtime = app.state::<Runtime>();
    let cache = runtime.cache.lock().unwrap();
    let status = if flags & 1 == 0 {
        "unsupported"
    } else if !settings.vision {
        "off"
    } else if flags & 2 == 0 {
        "permission"
    } else if settings.paused || settings.mischief == 0 || !state.visible.load(Ordering::SeqCst) {
        "paused"
    } else if cache.pending {
        "scanning"
    } else if cache
        .at
        .is_none_or(|at| at.elapsed() > Duration::from_secs(5))
    {
        "waiting"
    } else {
        cache.status
    };
    Status {
        supported: flags & 1 != 0,
        granted: flags & 2 != 0,
        state: status,
    }
}
pub(crate) fn reset(app: &tauri::AppHandle) {
    let runtime = app.state::<Runtime>();
    let mut cache = runtime.cache.lock().unwrap();
    cache.generation += 1;
    cache.at = None;
    cache.sample = None;
    cache.status = "waiting";
    // A running capture owns its slot until its callback returns.
}
pub(crate) async fn read(app: &tauri::AppHandle) -> Option<DesktopCaret> {
    let generation;
    {
        let runtime = app.state::<Runtime>();
        let mut cache = runtime.cache.lock().unwrap();
        if cache.pending
            || cache
                .at
                .is_some_and(|at| at.elapsed() < Duration::from_secs(2))
        {
            return cache.sample.clone();
        }
        cache.pending = true;
        generation = cache.generation;
    }
    let raw = tauri::async_runtime::spawn_blocking(capture)
        .await
        .unwrap_or_default();
    let runtime = app.state::<Runtime>();
    let mut cache = runtime.cache.lock().unwrap();
    cache.pending = false;
    if cache.generation != generation {
        return None;
    }
    cache.at = Some(Instant::now());
    cache.status = match raw.status {
        1 => "unsupported",
        2 => "permission",
        3 => "no_text",
        4 => "text_found",
        _ => "failed",
    };
    cache.sample = sample(raw);
    cache.sample.clone()
}
fn sample(raw: RawResult) -> Option<DesktopCaret> {
    if raw.status != 4
        || !raw.x.is_finite()
        || !raw.y.is_finite()
        || !raw.height.is_finite()
        || raw.height <= 0.0
    {
        return None;
    }
    let glyph = char::from_u32(raw.glyph)
        .filter(|c| c.is_ascii_graphic())
        .unwrap_or('o');
    Some(DesktopCaret {
        x: raw.x,
        y: raw.y,
        height: raw.height,
        context: format!("vision:{}", raw.display),
        position: format!("{:.0}:{:.0}", raw.x, raw.y),
        source: "vision",
        glyph: Some(glyph.to_string()),
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failed_or_invalid_ocr_never_becomes_a_target() {
        assert!(sample(RawResult::default()).is_none());
        assert!(sample(RawResult {
            status: 4,
            x: f64::NAN,
            height: 20.0,
            ..RawResult::default()
        })
        .is_none());
    }
    #[test]
    fn vision_exports_geometry_and_one_printable_glyph() {
        let result = sample(RawResult {
            status: 4,
            display: 7,
            x: -100.0,
            y: 20.0,
            height: 15.0,
            glyph: 'x' as u32,
        })
        .unwrap();
        assert_eq!(result.source, "vision");
        assert_eq!(result.context, "vision:7");
        assert_eq!(result.glyph.as_deref(), Some("x"));
    }
}
