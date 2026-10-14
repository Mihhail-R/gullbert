//! Durable belongings and status messages shared by the pet and control room.
use crate::{state::State, windows::pet};
use tauri::{Emitter, Manager};

// Roommate memory has one writer (the simulation webview) and its own file,
// so saving a discovery cannot overwrite preferences. Invalid data is normalized
// by the shared simulation on restoration, in both native and browser builds.
#[tauri::command]
pub(crate) fn load_roommate(app: tauri::AppHandle) -> serde_json::Value {
    app.state::<State>().roommate.lock().unwrap().clone()
}
#[tauri::command]
pub(crate) fn save_roommate(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    memory: serde_json::Value,
) -> Result<(), String> {
    if window.label() != "pet" {
        return Err("Only Gullbert can save his belongings".into());
    }
    let bytes = serde_json::to_vec_pretty(&memory).map_err(|e| e.to_string())?;
    if bytes.len() > 16384 || !memory.is_object() {
        return Err("Invalid roommate memory".into());
    }
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let temp = dir.join("roommate.tmp");
    std::fs::write(&temp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(temp, dir.join("roommate.json")).map_err(|e| e.to_string())?;
    *app.state::<State>().roommate.lock().unwrap() = memory;
    Ok(())
}
#[tauri::command]
pub(crate) fn publish_roommate(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    status: serde_json::Value,
) -> Result<(), String> {
    if window.label() != "pet" {
        return Err("Only Gullbert can report his mood".into());
    }
    app.emit("gullbert-roommate", status)
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub(crate) fn request_roommate(app: tauri::AppHandle) -> Result<(), String> {
    pet(&app)?
        .emit("gullbert-roommate-request", ())
        .map_err(|e| e.to_string())
}

pub(crate) fn restore(app: &tauri::AppHandle) {
    if let Ok(dir) = app.path().app_config_dir() {
        if let Ok(bytes) = std::fs::read(dir.join("roommate.json")) {
            if bytes.len() <= 16384 {
                if let Ok(memory) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                    *app.state::<State>().roommate.lock().unwrap() = memory;
                }
            }
        }
    }
}
