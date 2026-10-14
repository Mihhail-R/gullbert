#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod actions;
mod caret;
mod native_input;
mod roommate;
mod shortcuts;
mod state;
mod tray;
mod updates;
mod vision;
mod windows;

use actions::report;
use state::{Snapshot, State};
use tauri::Manager;

#[tauri::command]
async fn pet_ready(app: tauri::AppHandle) -> Result<Snapshot, String> {
    native_input::request(app, |app| prepare_pet(app.clone())).await?
}
fn prepare_pet(app: tauri::AppHandle) -> Result<Snapshot, String> {
    native_input::ready(&app)?;
    Ok(state::snapshot(app))
}
fn main() {
    tauri::Builder::default()
        .manage(State::default())
        .manage(updates::Runtime::default())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(vision::Runtime::default())
        .manage(native_input::Runtime::default())
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            actions::dispatch_action(app, actions::from_cli(args.get(1).map(String::as_str)));
        }))
        .plugin(shortcuts::plugin())
        .invoke_handler(tauri::generate_handler![
            state::snapshot,
            updates::app_version,
            updates::check_update,
            updates::install_update,
            pet_ready,
            state::update_settings,
            actions::act,
            native_input::desktop::target_picked,
            native_input::desktop::cancel_targeting,
            windows::cursor_position,
            caret::caret_position,
            caret::caret_access,
            vision::vision_status,
            native_input::desktop::sync_interaction,
            native_input::desktop::begin_pickup,
            native_input::desktop::end_pickup,
            native_input::desktop::tug_cursor,
            native_input::desktop::release_cursor,
            roommate::load_roommate,
            roommate::save_roommate,
            roommate::request_roommate,
            roommate::publish_roommate
        ])
        .on_window_event(|w, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if w.label() == "controls" {
                    let _ = w.hide();
                } else {
                    report(native_input::dispatch(w.app_handle(), |app| {
                        report(native_input::set_visible(app, false));
                    }));
                }
            }
        })
        .setup(|app| {
            native_input::Runtime::watch(app.handle().clone());
            // Protect even initially hidden controls before their first show.
            // Capture rechecks visible windows and fails closed on any error.
            #[cfg(target_os = "windows")]
            for window in app.webview_windows().values() {
                let _ = window.set_content_protected(true);
            }
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            roommate::restore(app.handle());
            state::restore(app.handle());
            tray::install(app)?;
            shortcuts::register(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Gullbert could not start");
}
