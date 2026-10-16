//! Durable belongings and status messages shared by the pet and control room.
use crate::{memory_store, state::State, windows::pet};
use tauri::{Emitter, Manager};

// The simulation is the only writer. State caches the last committed snapshot;
// SQLite keeps the snapshot and its bounded experience history in one transaction.
#[tauri::command]
pub(crate) fn load_roommate(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    app.state::<State>().roommate.lock().unwrap().clone()
}
#[tauri::command]
pub(crate) async fn save_roommate(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    memory: serde_json::Value,
) -> Result<(), String> {
    if window.label() != "pet" {
        return Err("Only Gullbert can save his belongings".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<State>();
        let mut cached = state.roommate.lock().unwrap();
        // Never replace a database or legacy file that could not be read.
        cached.as_ref().map_err(Clone::clone)?;
        let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
        memory_store::save(&dir, &memory)?;
        *cached = Ok(memory);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
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
    *app.state::<State>().roommate.lock().unwrap() = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())
        .and_then(|dir| memory_store::load(&dir));
}
