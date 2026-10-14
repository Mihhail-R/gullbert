//! Windows desktop capture + embedded Ocrs models. No WinRT package identity,
//! subprocesses, temporary screenshots, or runtime network/model discovery.
use super::{
    geometry::{self, Rect},
    RawResult,
};
use std::{
    mem::{size_of, zeroed},
    ptr::null_mut,
    sync::OnceLock,
};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, POINT},
    Graphics::{
        Dwm::{DwmFlush, DwmIsCompositionEnabled},
        Gdi::*,
    },
    System::SystemInformation::OSVERSIONINFOW,
    UI::{HiDpi::*, WindowsAndMessaging::*},
};

#[link(name = "ntdll")]
unsafe extern "system" {
    fn RtlGetVersion(version: *mut OSVERSIONINFOW) -> i32;
}

pub(super) fn access() -> i32 {
    static SUPPORTED: OnceLock<bool> = OnceLock::new();
    if *SUPPORTED.get_or_init(|| unsafe {
        let mut version: OSVERSIONINFOW = zeroed();
        version.dwOSVersionInfoSize = size_of::<OSVERSIONINFOW>() as u32;
        RtlGetVersion(&mut version) == 0
            && (version.dwMajorVersion > 10
                || (version.dwMajorVersion == 10 && version.dwBuildNumber >= 19041))
    }) {
        3
    } else {
        0
    }
}

pub(super) fn capture() -> RawResult {
    if access() == 0 {
        return RawResult {
            status: 1,
            ..RawResult::default()
        };
    }
    read().unwrap_or(RawResult {
        status: 5,
        ..RawResult::default()
    })
}

fn read() -> Option<RawResult> {
    // Initialize before taking a screenshot; retain only immutable model weights
    // between scans. OCR inputs, activations, and recognized characters are local.
    super::ocr::engine()?;
    let frame = unsafe { capture_region()? };
    super::ocr::recognize(&frame.rgb, frame.crop, frame.pointer, frame.display)
}

struct Frame {
    rgb: Vec<u8>,
    crop: Rect,
    pointer: (i32, i32),
    display: u32,
}

// Restore thread DPI and every GDI object on all error paths. A selected bitmap
// must be deselected before deletion; the desktop DC is released, not deleted.
struct CaptureResources {
    dpi: DPI_AWARENESS_CONTEXT,
    screen: HDC,
    memory: HDC,
    bitmap: HBITMAP,
    previous: HGDIOBJ,
}
impl Drop for CaptureResources {
    fn drop(&mut self) {
        unsafe {
            if !self.previous.is_null() {
                SelectObject(self.memory, self.previous);
            }
            if !self.bitmap.is_null() {
                DeleteObject(self.bitmap);
            }
            if !self.memory.is_null() {
                DeleteDC(self.memory);
            }
            if !self.screen.is_null() {
                ReleaseDC(null_mut(), self.screen);
            }
            if !self.dpi.is_null() {
                SetThreadDpiAwarenessContext(self.dpi);
            }
        }
    }
}

unsafe extern "system" fn exclude_window(window: HWND, result: LPARAM) -> i32 {
    let mut pid = 0;
    GetWindowThreadProcessId(window, &mut pid);
    if pid == std::process::id() && IsWindowVisible(window) != 0 {
        let mut affinity = 0;
        if SetWindowDisplayAffinity(window, WDA_EXCLUDEFROMCAPTURE) == 0
            || GetWindowDisplayAffinity(window, &mut affinity) == 0
            || affinity != WDA_EXCLUDEFROMCAPTURE
        {
            *(result as *mut bool) = false;
            return 0;
        }
    }
    1
}

unsafe fn capture_region() -> Option<Frame> {
    let mut resources = CaptureResources {
        dpi: null_mut(),
        screen: null_mut(),
        memory: null_mut(),
        bitmap: null_mut(),
        previous: null_mut(),
    };
    resources.dpi = SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    if resources.dpi.is_null() {
        return None;
    }
    let mut composed = 0;
    if DwmIsCompositionEnabled(&mut composed) < 0 || composed == 0 {
        return None;
    }
    let mut excluded = true;
    if EnumWindows(Some(exclude_window), (&mut excluded as *mut bool) as LPARAM) == 0 || !excluded {
        return None;
    }
    // Wait for affinity changes to reach the compositor before reading pixels.
    if DwmFlush() < 0 {
        return None;
    }
    let mut pointer: POINT = zeroed();
    if GetCursorPos(&mut pointer) == 0 {
        return None;
    }
    let monitor = MonitorFromPoint(pointer, MONITOR_DEFAULTTONULL);
    if monitor.is_null() {
        return None;
    }
    let mut info: MONITORINFO = zeroed();
    info.cbSize = size_of::<MONITORINFO>() as u32;
    if GetMonitorInfoW(monitor, &mut info) == 0 {
        return None;
    }
    let rect = info.rcMonitor;
    let crop = geometry::crop(
        Rect {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
        },
        (pointer.x, pointer.y),
    )?;
    resources.screen = GetDC(null_mut());
    if resources.screen.is_null() {
        return None;
    }
    resources.memory = CreateCompatibleDC(resources.screen);
    if resources.memory.is_null() {
        return None;
    }
    let mut bitmap_info: BITMAPINFO = zeroed();
    bitmap_info.bmiHeader.biSize = size_of::<BITMAPINFOHEADER>() as u32;
    bitmap_info.bmiHeader.biWidth = crop.width();
    bitmap_info.bmiHeader.biHeight = -crop.height(); // top-down BGRA
    bitmap_info.bmiHeader.biPlanes = 1;
    bitmap_info.bmiHeader.biBitCount = 32;
    bitmap_info.bmiHeader.biCompression = BI_RGB;
    let mut pixels = null_mut();
    resources.bitmap = CreateDIBSection(
        resources.screen,
        &bitmap_info,
        DIB_RGB_COLORS,
        &mut pixels,
        null_mut(),
        0,
    );
    if resources.bitmap.is_null() || pixels.is_null() {
        return None;
    }
    let previous = SelectObject(resources.memory, resources.bitmap);
    if previous.is_null() || previous as isize == -1 {
        return None;
    }
    resources.previous = previous;
    if BitBlt(
        resources.memory,
        0,
        0,
        crop.width(),
        crop.height(),
        resources.screen,
        crop.left,
        crop.top,
        SRCCOPY | CAPTUREBLT,
    ) == 0
        || GdiFlush() == 0
    {
        return None;
    }
    let bytes = std::slice::from_raw_parts(
        pixels as *const u8,
        (crop.width() * crop.height() * 4) as usize,
    );
    let mut rgb = Vec::with_capacity((crop.width() * crop.height() * 3) as usize);
    for pixel in bytes.chunks_exact(4) {
        rgb.extend_from_slice(&[pixel[2], pixel[1], pixel[0]]);
    }
    Some(Frame {
        rgb,
        crop,
        pointer: (pointer.x, pointer.y),
        display: monitor as usize as u32,
    })
}
