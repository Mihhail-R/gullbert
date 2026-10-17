//! Visible foreground geometry only: no titles, text, or pixels.
use super::NativeSample;
use std::mem::size_of;
use windows_sys::Win32::{
    Foundation::RECT,
    Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS},
    System::Threading::GetCurrentProcessId,
    UI::WindowsAndMessaging::{
        GetDesktopWindow, GetForegroundWindow, GetShellWindow, GetWindowThreadProcessId, IsIconic,
        IsWindowVisible,
    },
};

pub(super) fn read() -> Option<NativeSample> {
    // Win32 owns the HWND; every query may fail if its owner closes it. The output
    // buffers below are exclusively owned, correctly sized, and never escape a call.
    unsafe {
        let window = GetForegroundWindow();

        if window.is_null() || IsWindowVisible(window) == 0 || IsIconic(window) != 0 {
            return None;
        }

        if window == GetDesktopWindow() || window == GetShellWindow() {
            return None;
        }

        let mut process_id = 0;
        GetWindowThreadProcessId(window, &mut process_id);

        if process_id == 0 || process_id == GetCurrentProcessId() {
            return None;
        }

        let mut cloaked: u32 = 0;
        let cloak_result = DwmGetWindowAttribute(
            window,
            DWMWA_CLOAKED as u32,
            (&mut cloaked as *mut u32).cast(),
            size_of::<u32>() as u32,
        );

        if cloak_result < 0 || cloaked != 0 {
            return None;
        }

        let mut bounds = RECT::default();
        let bounds_result = DwmGetWindowAttribute(
            window,
            DWMWA_EXTENDED_FRAME_BOUNDS as u32,
            (&mut bounds as *mut RECT).cast(),
            size_of::<RECT>() as u32,
        );

        if bounds_result < 0 || GetForegroundWindow() != window {
            return None;
        }

        if bounds.right <= bounds.left || bounds.bottom <= bounds.top {
            return None;
        }

        Some(NativeSample {
            // Windows HWND values have 32 significant bits, including on 64-bit Windows.
            // https://learn.microsoft.com/windows/win32/winprog64/interprocess-communication
            window_id: window as usize as u32,
            x: f64::from(bounds.left),
            y: f64::from(bounds.top),
            width: f64::from(bounds.right) - f64::from(bounds.left),
            height: f64::from(bounds.bottom) - f64::from(bounds.top),
            ..NativeSample::default()
        })
    }
}
