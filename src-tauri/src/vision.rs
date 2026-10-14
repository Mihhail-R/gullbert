//! Optional local screen OCR. The cache contains geometry and one display glyph only.
use crate::{caret::DesktopCaret, state::State};
use serde::Serialize;
use std::{
    sync::atomic::Ordering,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::Manager;
#[cfg(any(target_os = "windows", test))]
mod geometry;
#[cfg(target_os = "windows")]
mod ocr;
#[cfg(target_os = "windows")]
mod windows;

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
    #[cfg(target_os = "windows")]
    {
        let _ = prompt;
        windows::access()
    }
    #[cfg(target_os = "macos")]
    unsafe {
        gullbert_vision_access(i32::from(prompt))
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = prompt;
        0
    }
}
fn capture() -> RawResult {
    #[cfg(target_os = "windows")]
    {
        windows::capture()
    }
    #[cfg(target_os = "macos")]
    unsafe {
        gullbert_vision_read()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
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
    cache.reset();
}
impl Cache {
    fn reset(&mut self) {
        self.generation += 1;
        self.at = None;
        self.sample = None;
        self.status = "waiting";
        // A running capture owns its slot until its callback returns.
    }
    fn begin(&mut self, now: Instant) -> Option<u64> {
        if self.pending
            || self
                .at
                .is_some_and(|at| now.duration_since(at) < Duration::from_secs(2))
        {
            return None;
        }
        self.pending = true;
        Some(self.generation)
    }
    fn finish(&mut self, generation: u64, raw: RawResult, now: Instant) -> Option<DesktopCaret> {
        self.pending = false;
        if self.generation != generation {
            return None;
        }
        self.at = Some(now);
        self.status = match raw.status {
            1 => "unsupported",
            2 => "permission",
            3 => "no_text",
            4 => "text_found",
            _ => "failed",
        };
        self.sample = sample(raw);
        self.sample.clone()
    }
}
pub(crate) async fn read(app: &tauri::AppHandle) -> Option<DesktopCaret> {
    let generation;
    {
        let runtime = app.state::<Runtime>();
        let mut cache = runtime.cache.lock().unwrap();
        let Some(started) = cache.begin(Instant::now()) else {
            return cache.sample.clone();
        };
        generation = started;
    }
    let raw = tauri::async_runtime::spawn_blocking(capture)
        .await
        .unwrap_or_default();
    let runtime = app.state::<Runtime>();
    let mut cache = runtime.cache.lock().unwrap();
    cache.finish(generation, raw, Instant::now())
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
    fn cancellation_discards_late_result_but_keeps_single_flight_slot() {
        let now = Instant::now();
        let mut cache = Cache::default();
        let old = cache.begin(now).unwrap();
        cache.reset(); // pause, hide/show, or settings change
        assert!(cache.begin(now + Duration::from_secs(10)).is_none());
        assert!(cache
            .finish(
                old,
                RawResult {
                    status: 4,
                    height: 20.0,
                    glyph: 'a' as u32,
                    ..RawResult::default()
                },
                now
            )
            .is_none());
        assert!(cache.sample.is_none());
        assert_eq!(cache.status, "waiting");
        assert!(cache.begin(now).is_some());
    }
    #[test]
    fn throttles_from_completion_and_failure_clears_old_target() {
        let now = Instant::now();
        let mut cache = Cache::default();
        let generation = cache.begin(now).unwrap();
        assert!(cache.begin(now + Duration::from_secs(10)).is_none());
        let completed = now + Duration::from_secs(20);
        assert!(cache
            .finish(
                generation,
                RawResult {
                    status: 4,
                    height: 20.0,
                    ..RawResult::default()
                },
                completed
            )
            .is_some());
        assert!(cache
            .begin(completed + Duration::from_millis(1999))
            .is_none());
        let generation = cache.begin(completed + Duration::from_secs(2)).unwrap();
        assert!(cache
            .finish(
                generation,
                RawResult::default(),
                completed + Duration::from_secs(3)
            )
            .is_none());
        assert!(cache.sample.is_none());
        assert_eq!(cache.status, "failed");
        cache.reset();
        assert!(cache.sample.is_none());
    }
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
