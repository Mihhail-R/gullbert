//! Read-only insertion-point geometry. No screenshots, text values, or key hooks.
use crate::{state::State, windows};
use serde::Serialize;
use std::sync::atomic::Ordering;
use tauri::Manager;

#[derive(Serialize)]
pub(crate) struct CaretSample {
    x: f64,
    y: f64,
    height: f64,
    context: String,
    position: String,
    source: &'static str,
    glyph: Option<String>,
}
#[derive(Clone)]
pub(crate) struct DesktopCaret {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) height: f64,
    pub(crate) context: String,
    pub(crate) position: String,
    pub(crate) source: &'static str,
    pub(crate) glyph: Option<String>,
}
#[derive(Serialize)]
pub(crate) struct Access {
    available: bool,
    platform: &'static str,
}
#[tauri::command]
pub(crate) fn caret_access(prompt: bool) -> Access {
    Access {
        available: platform::access(prompt),
        platform: std::env::consts::OS,
    }
}
fn enabled(app: &tauri::AppHandle) -> bool {
    let state = app.state::<State>();
    let settings = state.settings.lock().unwrap();
    state.visible.load(Ordering::SeqCst) && !settings.paused && settings.mischief > 0
}
#[tauri::command]
pub(crate) async fn caret_position(app: tauri::AppHandle) -> Option<CaretSample> {
    if !enabled(&app) {
        return None;
    }
    let window = windows::pet(&app).ok()?;
    let origin = window.inner_position().ok()?;
    let size = window.inner_size().ok()?;
    let scale = window.scale_factor().ok()?;
    // AX calls may involve another process. Never block the input dispatcher.
    let vision = app.state::<State>().settings.lock().unwrap().vision;
    let caret = if vision {
        crate::vision::read(&app).await?
    } else {
        tauri::async_runtime::spawn_blocking(platform::read)
            .await
            .ok()??
    };
    if app.state::<State>().settings.lock().unwrap().vision != vision || !enabled(&app) {
        return None;
    }
    if window.inner_position().ok()? != origin
        || window.inner_size().ok()? != size
        || window.scale_factor().ok()? != scale
    {
        return None;
    }
    #[cfg(target_os = "macos")]
    let coordinate_scale = 1.0; // AX uses global top-left logical points.
    #[cfg(not(target_os = "macos"))]
    let coordinate_scale = scale; // Win32 in this DPI-aware process uses pixels.
    local(
        caret,
        (origin.x, origin.y),
        (size.width, size.height),
        scale,
        coordinate_scale,
    )
}
fn local(
    caret: DesktopCaret,
    origin: (i32, i32),
    size: (u32, u32),
    scale: f64,
    coordinate_scale: f64,
) -> Option<CaretSample> {
    if !scale.is_finite() || scale <= 0.0 {
        return None;
    }
    if !coordinate_scale.is_finite() || coordinate_scale <= 0.0 {
        return None;
    }
    let x = caret.x / coordinate_scale - f64::from(origin.0) / scale;
    let y = caret.y / coordinate_scale - f64::from(origin.1) / scale;
    let height = caret.height / coordinate_scale;
    if !x.is_finite() || !y.is_finite() {
        return None;
    }
    if !height.is_finite() || height <= 0.0 || height > 160.0 {
        return None;
    }
    if x < 0.0 || x >= f64::from(size.0) / scale {
        return None;
    }
    if y < 0.0 || y >= f64::from(size.1) / scale {
        return None;
    }
    Some(CaretSample {
        x,
        y,
        height,
        context: caret.context,
        position: caret.position,
        source: caret.source,
        glyph: caret.glyph,
    })
}

#[cfg(target_os = "macos")]
mod platform {
    use super::DesktopCaret;
    use std::{
        ffi::{c_char, c_void},
        ptr,
    };
    type Ref = *const c_void;
    #[repr(C)]
    #[derive(Default)]
    struct Range {
        location: isize,
        length: isize,
    }
    #[repr(C)]
    #[derive(Default)]
    struct Rect {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    }
    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: Ref) -> bool;
        static kAXTrustedCheckOptionPrompt: Ref;
        fn AXUIElementCreateSystemWide() -> Ref;
        fn AXUIElementGetTypeID() -> usize;
        fn AXUIElementGetPid(element: Ref, pid: *mut i32) -> i32;
        fn AXUIElementSetMessagingTimeout(element: Ref, seconds: f32) -> i32;
        fn AXUIElementCopyAttributeValue(element: Ref, name: Ref, result: *mut Ref) -> i32;
        fn AXUIElementCopyParameterizedAttributeValue(
            element: Ref,
            name: Ref,
            parameter: Ref,
            result: *mut Ref,
        ) -> i32;
        fn AXValueGetTypeID() -> usize;
        fn AXValueGetValue(value: Ref, kind: u32, result: *mut c_void) -> bool;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFRelease(value: Ref);
        fn CFGetTypeID(value: Ref) -> usize;
        fn CFHash(value: Ref) -> usize;
        fn CFEqual(a: Ref, b: Ref) -> bool;
        fn CFStringCreateWithCString(allocator: Ref, text: *const c_char, encoding: u32) -> Ref;
        fn CFDictionaryCreate(
            allocator: Ref,
            keys: *const Ref,
            values: *const Ref,
            count: isize,
            key_callbacks: Ref,
            value_callbacks: Ref,
        ) -> Ref;
        static kCFBooleanTrue: Ref;
    }
    struct Owned(Ref);
    impl Owned {
        fn new(value: Ref) -> Option<Self> {
            if value.is_null() {
                None
            } else {
                Some(Self(value))
            }
        }
    }
    impl Drop for Owned {
        fn drop(&mut self) {
            unsafe {
                CFRelease(self.0);
            }
        }
    }
    fn string(text: &std::ffi::CStr) -> Option<Owned> {
        Owned::new(unsafe { CFStringCreateWithCString(ptr::null(), text.as_ptr(), 0x08000100) })
    }
    fn attribute(element: Ref, name: &std::ffi::CStr) -> Option<Owned> {
        let name = string(name)?;
        let mut result = ptr::null();
        let error = unsafe { AXUIElementCopyAttributeValue(element, name.0, &mut result) };
        let owned = Owned::new(result);
        if error == 0 {
            owned
        } else {
            None
        }
    }
    pub(super) fn access(prompt: bool) -> bool {
        unsafe {
            if !prompt {
                return AXIsProcessTrusted();
            }
            // Non-retaining dictionary is safe: both entries are framework constants.
            let key = kAXTrustedCheckOptionPrompt;
            let value = kCFBooleanTrue;
            let Some(options) = Owned::new(CFDictionaryCreate(
                ptr::null(),
                &key,
                &value,
                1,
                ptr::null(),
                ptr::null(),
            )) else {
                return false;
            };
            AXIsProcessTrustedWithOptions(options.0)
        }
    }
    pub(super) fn read() -> Option<DesktopCaret> {
        if !access(false) {
            return None;
        }
        unsafe {
            let system = Owned::new(AXUIElementCreateSystemWide())?;
            AXUIElementSetMessagingTimeout(system.0, 0.12);
            let focused = attribute(system.0, c"AXFocusedUIElement")?;
            if CFGetTypeID(focused.0) != AXUIElementGetTypeID() {
                return None;
            }
            AXUIElementSetMessagingTimeout(focused.0, 0.12);
            let mut pid = 0;
            if AXUIElementGetPid(focused.0, &mut pid) != 0 || pid == std::process::id() as i32 {
                return None;
            }
            if let Some(subrole) = attribute(focused.0, c"AXSubrole") {
                let secure = string(c"AXSecureTextField")?;
                if CFEqual(subrole.0, secure.0) {
                    return None;
                }
            }
            let range_value = attribute(focused.0, c"AXSelectedTextRange")?;
            if CFGetTypeID(range_value.0) != AXValueGetTypeID() {
                return None;
            }
            let mut range = Range::default();
            if !AXValueGetValue(range_value.0, 4, (&mut range as *mut Range).cast())
                || range.length != 0
                || range.location < 0
            {
                return None;
            }
            let name = string(c"AXBoundsForRange")?;
            let mut value = ptr::null();
            let error = AXUIElementCopyParameterizedAttributeValue(
                focused.0,
                name.0,
                range_value.0,
                &mut value,
            );
            let bounds = Owned::new(value)?;
            if error != 0 || CFGetTypeID(bounds.0) != AXValueGetTypeID() {
                return None;
            }
            let mut rect = Rect::default();
            if !AXValueGetValue(bounds.0, 3, (&mut rect as *mut Rect).cast()) || rect.width > 20.0 {
                return None;
            }
            // Reject a result if focus changed during the round trip.
            let current = attribute(system.0, c"AXFocusedUIElement")?;
            if !CFEqual(focused.0, current.0) {
                return None;
            }
            Some(DesktopCaret {
                x: rect.x,
                y: rect.y,
                height: rect.height,
                context: format!("{pid}:{}", CFHash(focused.0)),
                position: range.location.to_string(),
                source: "caret",
                glyph: None,
            })
        }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::DesktopCaret;
    use std::ffi::c_void;
    type Hwnd = *mut c_void;
    #[repr(C)]
    #[derive(Default)]
    struct Point {
        x: i32,
        y: i32,
    }
    #[repr(C)]
    #[derive(Default)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }
    #[repr(C)]
    struct GuiThreadInfo {
        size: u32,
        flags: u32,
        active: Hwnd,
        focus: Hwnd,
        capture: Hwnd,
        menu: Hwnd,
        move_size: Hwnd,
        caret: Hwnd,
        rect: Rect,
    }
    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetGUIThreadInfo(thread: u32, info: *mut GuiThreadInfo) -> i32;
        fn ClientToScreen(window: Hwnd, point: *mut Point) -> i32;
        fn GetForegroundWindow() -> Hwnd;
        fn GetWindowThreadProcessId(window: Hwnd, pid: *mut u32) -> u32;
    }
    pub(super) fn access(_prompt: bool) -> bool {
        true
    }
    pub(super) fn read() -> Option<DesktopCaret> {
        unsafe {
            let foreground = GetForegroundWindow();
            let mut pid = 0;
            GetWindowThreadProcessId(foreground, &mut pid);
            if pid == 0 || pid == std::process::id() {
                return None;
            }
            let mut info: GuiThreadInfo = std::mem::zeroed();
            info.size = std::mem::size_of::<GuiThreadInfo>() as u32;
            if GetGUIThreadInfo(0, &mut info) == 0 || info.caret.is_null() {
                return None;
            }
            let mut point = Point {
                x: info.rect.left,
                y: info.rect.top,
            };
            if ClientToScreen(info.caret, &mut point) == 0 || foreground != GetForegroundWindow() {
                return None;
            }
            Some(DesktopCaret {
                x: point.x as f64,
                y: point.y as f64,
                height: (info.rect.bottom - info.rect.top) as f64,
                context: format!("{pid}:{:p}", info.caret),
                position: format!("{}:{}", point.x, point.y),
                source: "caret",
                glyph: None,
            })
        }
    }
}
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    pub(super) fn access(_prompt: bool) -> bool {
        false
    }
    pub(super) fn read() -> Option<super::DesktopCaret> {
        None
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn sample(x: f64, y: f64) -> DesktopCaret {
        DesktopCaret {
            x,
            y,
            height: 20.0,
            context: "field".into(),
            position: "4".into(),
            source: "caret",
            glyph: None,
        }
    }
    #[test]
    fn mixed_scale_mac_caret_is_already_logical() {
        let caret = local(sample(2220.0, 150.0), (3840, 0), (2880, 1800), 2.0, 1.0).unwrap();
        assert_eq!((caret.x, caret.y, caret.height), (300.0, 150.0, 20.0));
    }
    #[test]
    fn windows_physical_coordinates_and_negative_origins() {
        let caret = local(
            sample(-1650.0, -650.0),
            (-2400, -900),
            (2400, 1500),
            1.25,
            1.25,
        )
        .unwrap();
        assert_eq!((caret.x, caret.y, caret.height), (600.0, 200.0, 16.0));
    }
    #[test]
    fn vision_pixels_convert_once_at_each_windows_display_scale() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let mut target = sample(-1200.0, -600.0);
            target.source = "vision";
            target.glyph = Some("x".into());
            let result = local(target, (-1600, -900), (1600, 900), scale, scale).unwrap();
            assert!((result.x - 400.0 / scale).abs() < 0.001);
            assert!((result.y - 300.0 / scale).abs() < 0.001);
            assert_eq!(result.height, 20.0 / scale);
            assert_eq!(result.glyph.as_deref(), Some("x"));
        }
    }
    #[test]
    fn rejects_offscreen_and_invalid_geometry() {
        for (x, y) in [
            (-1.0, 20.0),
            (20.0, -1.0),
            (900.0, 20.0),
            (20.0, 650.0),
            (f64::NAN, 1.0),
        ] {
            assert!(local(sample(x, y), (0, 0), (900, 650), 1.0, 1.0).is_none());
        }
        assert!(local(sample(1.0, 1.0), (0, 0), (900, 650), 0.0, 1.0).is_none());
    }
}
