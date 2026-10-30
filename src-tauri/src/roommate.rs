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

/// Recovery for memories that cannot be read: keep the originals beside the new
/// store and restart, instead of leaving every launch stuck on the same error.
#[tauri::command]
pub(crate) async fn start_fresh(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    if window.label() != "controls" {
        return Err("Only the control room can set memories aside".into());
    }

    let worker = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = worker.state::<State>();
        let mut cached = state.roommate.lock().unwrap();

        if cached.is_ok() {
            return Err("Gullbert's memories are readable; nothing was set aside.".to_string());
        }

        let dir = worker.path().app_config_dir().map_err(|e| e.to_string())?;
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_secs();
        memory_store::set_aside(&dir, stamp)?;
        // The running pet never restored, so it has nothing to save before restarting.
        *cached = Err("Memories were set aside; restarting".into());
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;

    let prepared = crate::shutdown::prepare(&app).await.map_err(|error| {
        crate::shutdown::show_error(&app, &error);
        error
    })?;
    prepared.allow_exit();
    app.restart();
}

pub(crate) fn restore(app: &tauri::AppHandle) {
    *app.state::<State>().roommate.lock().unwrap() = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())
        .and_then(|dir| memory_store::load(&dir));
}
