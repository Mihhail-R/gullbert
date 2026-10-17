#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod actions;
mod memory_store;
mod native_input;
mod roommate;
mod shortcuts;
mod state;
mod tray;
mod updates;
mod windows;
mod work_activity;

#[cfg(target_os = "macos")]
#[path = "single_instance_macos.rs"]
mod single_instance;
#[cfg(not(target_os = "macos"))]
use tauri_plugin_single_instance as single_instance;

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
    #[cfg(target_os = "macos")]
    {
        // Applies to this process only. Crash diagnostics and privileged live
        // memory inspection are separate OS facilities, not covered by RLIMIT_CORE.
        let limit = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };

        if unsafe { libc::setrlimit(libc::RLIMIT_CORE, &limit) } != 0 {
            panic!(
                "Could not disable core dumps: {}",
                std::io::Error::last_os_error()
            );
        }
    }

    tauri::Builder::default()
        .manage(State::default())
        .manage(updates::Runtime::default())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(native_input::Runtime::default())
        .plugin(single_instance::init(|app, args, _| {
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
            work_activity::work_activity,
            work_activity::stop_work_activity,
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
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();

                if window.label() == "controls" {
                    let _ = window.hide();
                } else {
                    report(native_input::dispatch(window.app_handle(), |app| {
                        report(native_input::set_visible(app, false));
                    }));
                }
            }
        })
        .setup(|app| {
            native_input::Runtime::watch(app.handle().clone());
            work_activity::install(app);

            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            roommate::restore(app.handle());
            state::restore(app.handle());
            tray::install(app)?;
            shortcuts::register(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Gullbert could not start")
        .run(|_app, _event| {});
}
