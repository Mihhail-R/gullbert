//! Global shortcut registration and routing, including temporary Escape ownership.
use crate::{
    actions::{dispatch_action, report, Action},
    native_input,
    state::State,
};
use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, ShortcutState};

pub(crate) fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            if shortcut.matches(Modifiers::CONTROL | Modifiers::ALT, Code::KeyG) {
                dispatch_action(app, Action::Summon);
            } else if shortcut.matches(
                Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT,
                Code::KeyG,
            ) {
                dispatch_action(app, Action::Hide);
            } else if shortcut.matches(Modifiers::CONTROL | Modifiers::ALT, Code::KeyX) {
                dispatch_action(app, Action::Clean);
            } else if shortcut.matches(Modifiers::CONTROL | Modifiers::ALT, Code::KeyP) {
                dispatch_action(app, Action::PoopAtCursor);
            } else if shortcut.matches(Modifiers::empty(), Code::Escape) {
                report(native_input::dispatch(app, |app| {
                    report(native_input::escape(app));
                }));
            }
        })
        .build()
}

pub(crate) fn register(app: &tauri::AppHandle) {
    for shortcut in ["Ctrl+Alt+G", "Ctrl+Alt+Shift+G", "Ctrl+Alt+X", "Ctrl+Alt+P"] {
        if let Err(e) = app.global_shortcut().register(shortcut) {
            app.state::<State>()
                .shortcut_errors
                .lock()
                .unwrap()
                .push(format!("{shortcut}: {e}"));
        }
    }
}
