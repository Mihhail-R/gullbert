//! Application state, preference persistence, and snapshots for the control room.
use crate::native_input;
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{Emitter, Manager};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub(crate) struct Settings {
    pub(crate) paused: bool,
    pub(crate) vision: bool,
    sound: bool,
    pub(crate) mischief: u8,
    hat: String,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            paused: false,
            vision: false,
            sound: false,
            mischief: 1,
            hat: "none".into(),
        }
    }
}
pub(crate) struct State {
    pub(crate) settings: Mutex<Settings>,
    pub(crate) visible: AtomicBool,
    pub(crate) shortcut_errors: Mutex<Vec<String>>,
    pub(crate) roommate: Mutex<Result<serde_json::Value, String>>,
}
impl Default for State {
    fn default() -> Self {
        Self {
            settings: Mutex::new(Settings::default()),
            visible: AtomicBool::new(true),
            shortcut_errors: Mutex::new(vec![]),
            roommate: Mutex::new(Err("Memory has not been loaded".into())),
        }
    }
}
#[derive(Serialize)]
pub(crate) struct Snapshot {
    settings: Settings,
    visible: bool,
    shortcut_errors: Vec<String>,
}
#[tauri::command]
pub(crate) fn snapshot(app: tauri::AppHandle) -> Snapshot {
    let s = app.state::<State>();
    let settings = s.settings.lock().unwrap().clone();
    let shortcut_errors = s.shortcut_errors.lock().unwrap().clone();
    Snapshot {
        settings,
        visible: s.visible.load(Ordering::SeqCst),
        shortcut_errors,
    }
}
#[tauri::command]
pub(crate) async fn update_settings(
    app: tauri::AppHandle,
    settings: Settings,
) -> Result<(), String> {
    native_input::request(app, move |app| save_settings(app.clone(), settings)).await?
}
fn save_settings(app: tauri::AppHandle, settings: Settings) -> Result<(), String> {
    if settings.mischief > 2 {
        return Err("Mischief must be 0, 1 or 2".into());
    }
    if !matches!(
        settings.hat.as_str(),
        "none" | "captain" | "cone" | "beanie" | "paper-crown" | "fried-egg"
    ) {
        return Err("Unknown hat".into());
    }
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let temp = dir.join("settings.tmp");
    std::fs::write(
        &temp,
        serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::rename(temp, dir.join("settings.json")).map_err(|e| e.to_string())?;
    if settings.paused
        || settings.mischief != app.state::<State>().settings.lock().unwrap().mischief
    {
        native_input::interrupt(&app);
    }
    crate::vision::reset(&app);
    *app.state::<State>().settings.lock().unwrap() = settings.clone();
    app.emit("gullbert-settings", settings)
        .map_err(|e| e.to_string())
}

pub(crate) fn restore(app: &tauri::AppHandle) {
    if let Ok(dir) = app.path().app_config_dir() {
        if let Ok(bytes) = std::fs::read(dir.join("settings.json")) {
            if let Ok(mut settings) = serde_json::from_slice::<Settings>(&bytes) {
                settings.mischief = settings.mischief.min(2);
                if !matches!(
                    settings.hat.as_str(),
                    "none" | "captain" | "cone" | "beanie" | "paper-crown" | "fried-egg"
                ) {
                    settings.hat = "none".into();
                }
                *app.state::<State>().settings.lock().unwrap() = settings;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Settings;

    #[test]
    fn wardrobe_survives_roundtrip_and_old_preferences_default_to_none() {
        let old: Settings =
            serde_json::from_str(r#"{"paused":true,"sound":true,"mischief":2}"#).unwrap();
        assert_eq!(old.hat, "none");
        for hat in [
            "none",
            "captain",
            "cone",
            "beanie",
            "paper-crown",
            "fried-egg",
        ] {
            let settings = Settings {
                hat: hat.into(),
                ..old.clone()
            };
            let restored: Settings =
                serde_json::from_slice(&serde_json::to_vec(&settings).unwrap()).unwrap();
            assert_eq!(restored.hat, hat);
            assert!(restored.paused && restored.sound);
            assert_eq!(restored.mischief, 2);
        }
    }
}
