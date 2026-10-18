//! Browser policy for the overlay, applied before its interactive document loads.
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;

#[derive(Default)]
pub(crate) struct Runtime {
    configured: AtomicBool,
    ready: AtomicBool,
}

impl Runtime {
    fn finish_navigation(&self) -> Result<(), String> {
        if !self.configured.load(Ordering::SeqCst) {
            return Err("Pet browser protection is not configured".into());
        }

        self.ready.store(true, Ordering::SeqCst);
        Ok(())
    }
}

pub(crate) fn finish_navigation(app: &tauri::AppHandle) -> Result<(), String> {
    app.state::<Runtime>().finish_navigation()
}

pub(crate) fn is_ready(app: &tauri::AppHandle) -> bool {
    app.state::<Runtime>().ready.load(Ordering::SeqCst)
}

pub(crate) fn ensure_ready(app: &tauri::AppHandle) -> Result<(), String> {
    if !is_ready(app) {
        return Err("Pet browser is still starting".into());
    }

    Ok(())
}

#[tauri::command]
pub(crate) async fn prepare_pet_browser(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if window.label() != "pet" {
        return Err("Browser protection is only available to the pet overlay".into());
    }

    if is_ready(&app) {
        return Err("Pet browser has already started".into());
    }

    let configuration = async {
        window
            .set_ignore_cursor_events(true)
            .map_err(|error| error.to_string())?;
        configure(&window).await
    }
    .await;

    if let Err(error) = configuration {
        eprintln!("Gullbert: could not protect the pet browser: {error}");
        return Err(error);
    }

    app.state::<Runtime>()
        .configured
        .store(true, Ordering::SeqCst);
    Ok(())
}

#[cfg(target_os = "windows")]
async fn configure(window: &tauri::WebviewWindow) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows_core::Interface;

    let (send, mut receive) = tauri::async_runtime::channel(1);
    window
        .with_webview(move |webview| {
            // Tauri runs this on the UI thread. Only this controller is affected;
            // neither the controls webview nor another application's input changes.
            let result = (|| -> windows_core::Result<()> {
                unsafe {
                    let core = webview.controller().CoreWebView2()?;
                    let settings = core.Settings()?;
                    settings.SetAreDefaultContextMenusEnabled(false)?;
                    let shortcuts = settings.cast::<ICoreWebView2Settings3>()?;
                    shortcuts.SetAreBrowserAcceleratorKeysEnabled(false)?;
                }

                Ok(())
            })();
            let _ = send.try_send(result.map_err(|error| error.to_string()));
        })
        .map_err(|error| error.to_string())?;

    receive
        .recv()
        .await
        .ok_or_else(|| "Pet browser configuration ended unexpectedly".to_string())?
}

#[cfg(not(target_os = "windows"))]
async fn configure(_window: &tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pet_cannot_become_ready_before_browser_configuration_succeeds() {
        let runtime = Runtime::default();
        assert!(runtime.finish_navigation().is_err());
        assert!(!runtime.ready.load(Ordering::SeqCst));

        runtime.configured.store(true, Ordering::SeqCst);
        assert!(!runtime.ready.load(Ordering::SeqCst));
        assert!(runtime.finish_navigation().is_ok());
        assert!(runtime.ready.load(Ordering::SeqCst));
        assert!(runtime.finish_navigation().is_ok());
    }
}
