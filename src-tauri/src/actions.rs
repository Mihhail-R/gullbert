//! Shared action routing for frontend commands, tray events, shortcuts, and launchers.
use crate::{
    native_input::{self, replace_target, set_visible, Purpose as TargetPurpose},
    state::State,
    windows::{controls, fit_to_cursor_monitor, pet, Point},
};
use serde::{Deserialize, Serialize};
use std::sync::atomic::Ordering;
use tauri::{Emitter, Manager};

#[derive(Clone, Serialize)]
pub(crate) struct Message {
    pub(crate) action: String,
    pub(crate) point: Option<Point>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) cursor_id: Option<u64>,
}
#[derive(Clone, Copy)]
enum Visibility {
    Show,
    Hide,
    Preserve,
}
enum Route {
    Command(&'static str),
    Pointer(&'static str),
    Target(TargetPurpose, &'static str),
    Cursor,
    Visibility,
    Controls,
    Quit,
    #[cfg(all(debug_assertions, target_os = "macos"))]
    WindowProbe,
    #[cfg(all(debug_assertions, target_os = "macos"))]
    WindowSpike,
}
include!(concat!(env!("OUT_DIR"), "/actions.rs"));

// Private effect seam shared by desktop routing and lifecycle tests.
pub(crate) trait Effects {
    fn interrupt(&mut self);
    fn replace_target(&mut self);
    fn visible(&self) -> bool;
    fn position(&mut self) -> Result<Point, String>;
    fn visibility(&mut self, visible: bool) -> Result<(), String>;
    fn command(&mut self, command: &str, point: Option<Point>) -> Result<(), String>;
    fn target(&mut self, purpose: TargetPurpose, preparation: &'static str) -> Result<(), String>;
    fn cursor(&mut self) -> Result<(), String>;
    fn controls(&mut self);
    fn quit(&mut self);
    #[cfg(all(debug_assertions, target_os = "macos"))]
    fn window_probe(&mut self, spike: bool) -> Result<(), String>;
}
impl Action {
    pub(crate) fn perform(self, effects: &mut impl Effects) -> Result<(), String> {
        let (visibility, route, preparation) = self.routing();
        effects.interrupt();
        effects.replace_target();
        // Targeting and Cursor position and acquire through their native owner.
        match route {
            Route::Target(purpose, preparation) => return effects.target(purpose, preparation),
            Route::Cursor => return effects.cursor(),
            _ => {}
        }
        if let Some(command) = preparation {
            effects.command(command, None)?;
        }
        let point = match route {
            Route::Pointer(_) => Some(effects.position()?),
            Route::Command(_) if matches!(visibility, Visibility::Show) && !effects.visible() => {
                effects.position()?;
                None
            }
            _ => None,
        };
        match visibility {
            Visibility::Show => effects.visibility(true)?,
            Visibility::Hide => effects.visibility(false)?,
            Visibility::Preserve => {}
        }
        match route {
            Route::Command(command) | Route::Pointer(command) => effects.command(command, point),
            Route::Controls => {
                effects.controls();
                Ok(())
            }
            Route::Quit => {
                effects.quit();
                Ok(())
            }
            #[cfg(all(debug_assertions, target_os = "macos"))]
            Route::WindowProbe => effects.window_probe(false),
            #[cfg(all(debug_assertions, target_os = "macos"))]
            Route::WindowSpike => effects.window_probe(true),
            _ => Ok(()),
        }
    }
}

struct Desktop<'a>(&'a tauri::AppHandle);
impl Effects for Desktop<'_> {
    fn interrupt(&mut self) {
        native_input::interrupt(self.0);
    }
    fn replace_target(&mut self) {
        replace_target(self.0);
    }
    fn visible(&self) -> bool {
        self.0.state::<State>().visible.load(Ordering::SeqCst)
    }
    fn position(&mut self) -> Result<Point, String> {
        fit_to_cursor_monitor(self.0)
    }
    fn visibility(&mut self, visible: bool) -> Result<(), String> {
        set_visible(self.0, visible)
    }
    fn command(&mut self, command: &str, point: Option<Point>) -> Result<(), String> {
        emit_action(self.0, command, point)
    }
    fn target(&mut self, purpose: TargetPurpose, preparation: &'static str) -> Result<(), String> {
        native_input::begin_target(self.0, purpose, preparation)
    }
    fn cursor(&mut self) -> Result<(), String> {
        native_input::eat_cursor(self.0)
    }
    fn controls(&mut self) {
        controls(self.0);
    }
    fn quit(&mut self) {
        #[cfg(all(debug_assertions, target_os = "macos"))]
        if native_input::window_spike::quit() {
            return;
        }
        self.0.exit(0);
    }
    #[cfg(all(debug_assertions, target_os = "macos"))]
    fn window_probe(&mut self, spike: bool) -> Result<(), String> {
        native_input::window_spike::start(self.0, spike)
    }
}

fn emit_action(app: &tauri::AppHandle, action: &str, point: Option<Point>) -> Result<(), String> {
    pet(app)?
        .emit(
            "gullbert-action",
            Message {
                action: action.into(),
                point,
                cursor_id: None,
            },
        )
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub(crate) async fn act(app: tauri::AppHandle, action: Action) -> Result<(), String> {
    native_input::request(app, move |app| perform_action(app.clone(), action)).await?
}
fn perform_action(app: tauri::AppHandle, action: Action) -> Result<(), String> {
    action.perform(&mut Desktop(&app))
}
pub(crate) fn dispatch_action(app: &tauri::AppHandle, action: Action) {
    report(native_input::dispatch(app, move |app| {
        report(perform_action(app.clone(), action));
    }));
}
pub(crate) fn report(result: Result<(), String>) {
    if let Err(e) = result {
        eprintln!("Gullbert: {e}");
    }
}

#[cfg(test)]
#[path = "../action_catalog.rs"]
mod action_catalog;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launcher_aliases_preserve_their_historical_meanings_and_fallback() {
        assert_eq!(from_cli(Some("--feed-here")), Action::FeedAtCursor);
        assert_eq!(from_cli(Some("--place-chip")), Action::FeedHere);
        assert_eq!(from_cli(Some("--poop-here")), Action::PoopAtCursor);
        assert_eq!(from_cli(Some("--find-snack")), Action::SearchSnack);
        assert_eq!(from_cli(Some("--play-cap")), Action::PlayCap);
        for flag in [
            None,
            Some("--feed_here"),
            Some("--feed-at-cursor"),
            Some("--unknown"),
            Some("--quit"),
        ] {
            assert_eq!(from_cli(flag), Action::Controls);
        }
        assert!(Action::named("prepare_chip").is_none());
        assert!(Action::named("unknown").is_none());
        assert!(serde_json::from_str::<Action>("\"unknown\"").is_err());
    }

    #[test]
    fn debug_actions_are_only_accepted_in_debug_macos_builds() {
        let available = cfg!(all(debug_assertions, target_os = "macos"));
        for name in ["window_probe", "window_spike"] {
            assert_eq!(Action::named(name).is_some(), available);
            assert_eq!(
                serde_json::from_value::<Action>(serde_json::json!(name)).is_ok(),
                available
            );
        }
    }

    #[test]
    fn malformed_definitions_fail_generation() {
        let source = include_str!("../../src/actions/catalog.json");
        action_catalog::generate(source).unwrap();
        for mutation in [
            "alias",
            "purpose",
            "preparation",
            "visibility",
            "extra",
            "variant",
            "debug",
        ] {
            let mut catalog: serde_json::Value = serde_json::from_str(source).unwrap();
            match mutation {
                "alias" => catalog["feed"]["aliases"] = serde_json::json!(["--place-chip"]),
                "purpose" => catalog["feed_here"]["purpose"] = serde_json::json!("tidy"),
                "preparation" => catalog["feed_here"]["preparation"] = serde_json::json!("cancel"),
                "visibility" => catalog["feed_here"]["visibility"] = serde_json::json!("preserve"),
                "extra" => catalog["feed"]["purpose"] = serde_json::json!("tidy"),
                "variant" => catalog["feed"]["variant"] = serde_json::json!("Quit"),
                "debug" => catalog["window_probe"]["availability"] = serde_json::json!("all"),
                _ => unreachable!(),
            }
            assert!(
                action_catalog::generate(&catalog.to_string()).is_err(),
                "{mutation}"
            );
        }
        for source in ["null", "[]", "{}", "{", r#"{"feed":3}"#] {
            assert!(action_catalog::generate(source).is_err());
        }
    }
}
