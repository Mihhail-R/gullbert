//! Shared action routing for frontend commands, tray events, shortcuts, and launchers.
use crate::{
    native_input::{self, cancel_target, set_visible, Purpose as TargetPurpose},
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
    pub(crate) purpose: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) cursor_id: Option<u64>,
}
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Action {
    Summon,
    Hide,
    Show,
    Feed,
    Squawk,
    Nap,
    Preen,
    Tilt,
    Stretch,
    Poop,
    PoopAtCursor,
    Target,
    PlaceBag,
    BringGift,
    PlacePerch,
    ClearPerch,
    Perch,
    SearchSnack,
    NibbleCursor,
    EatCursor,
    StealBag,
    Caught,
    BagCaper,
    BlowBubbles,
    BathTime,
    ChipToss,
    InvitePigeon,
    GullArgument,
    BaguetteParade,
    PretendLeave,
    CursorEgg,
    MunicipalGull,
    Apology,
    Postcards,
    Tidy,
    Cancel,
    Clean,
    Controls,
    Quit,
}

fn emit_action(app: &tauri::AppHandle, action: &str, point: Option<Point>) -> Result<(), String> {
    pet(app)?
        .emit(
            "gullbert-action",
            Message {
                action: action.into(),
                point,
                purpose: None,
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
    native_input::interrupt(&app);
    match action {
        Action::EatCursor => native_input::eat_cursor(&app),
        Action::Summon => {
            cancel_target(&app);
            let p = fit_to_cursor_monitor(&app)?;
            set_visible(&app, true)?;
            emit_action(&app, "summon", Some(p))
        }
        Action::Hide => set_visible(&app, false),
        Action::Show => {
            cancel_target(&app);
            set_visible(&app, true)
        }
        Action::PoopAtCursor => {
            cancel_target(&app);
            let point = fit_to_cursor_monitor(&app)?;
            set_visible(&app, true)?;
            emit_action(&app, "poop", Some(point))
        }
        Action::Target
        | Action::PlaceBag
        | Action::PlacePerch
        | Action::ChipToss
        | Action::Tidy => {
            let purpose = match action {
                Action::Tidy => TargetPurpose::Tidy,
                Action::ChipToss => TargetPurpose::Placement("chip_toss"),
                Action::PlaceBag => TargetPurpose::Placement("place_bag"),
                Action::PlacePerch => TargetPurpose::Placement("place_perch"),
                _ => TargetPurpose::Placement("poop"),
            };
            native_input::begin_target(&app, purpose)
        }
        Action::Cancel | Action::Clean => {
            cancel_target(&app);
            emit_action(
                &app,
                if matches!(action, Action::Clean) {
                    "clean"
                } else {
                    "cancel"
                },
                None,
            )
        }
        Action::Controls => {
            cancel_target(&app);
            controls(&app);
            Ok(())
        }
        Action::Quit => {
            cancel_target(&app);
            app.exit(0);
            Ok(())
        }
        Action::Feed
        | Action::Squawk
        | Action::Poop
        | Action::Nap
        | Action::Preen
        | Action::Tilt
        | Action::Stretch
        | Action::SearchSnack
        | Action::NibbleCursor
        | Action::StealBag
        | Action::Caught
        | Action::BlowBubbles
        | Action::BathTime
        | Action::InvitePigeon
        | Action::GullArgument
        | Action::BaguetteParade
        | Action::PretendLeave
        | Action::CursorEgg
        | Action::MunicipalGull
        | Action::Apology
        | Action::Postcards
        | Action::BagCaper
        | Action::BringGift
        | Action::ClearPerch
        | Action::Perch => {
            cancel_target(&app);
            if !app.state::<State>().visible.load(Ordering::SeqCst) {
                fit_to_cursor_monitor(&app)?;
            }
            set_visible(&app, true)?;
            emit_action(
                &app,
                match action {
                    Action::Feed => "feed",
                    Action::Squawk => "squawk",
                    Action::Nap => "nap",
                    Action::Preen => "preen",
                    Action::Tilt => "tilt",
                    Action::Stretch => "stretch",
                    Action::SearchSnack => "search_snack",
                    Action::NibbleCursor => "nibble_cursor",
                    Action::StealBag => "steal_bag",
                    Action::Caught => "caught",
                    Action::BagCaper => "bag_caper",
                    Action::BlowBubbles => "blow_bubbles",
                    Action::BathTime => "bath_time",
                    Action::InvitePigeon => "invite_pigeon",
                    Action::GullArgument => "gull_argument",
                    Action::BaguetteParade => "baguette_parade",
                    Action::PretendLeave => "pretend_leave",
                    Action::CursorEgg => "cursor_egg",
                    Action::MunicipalGull => "municipal_gull",
                    Action::Apology => "apology",
                    Action::Postcards => "postcards",
                    Action::BringGift => "bring_gift",
                    Action::ClearPerch => "clear_perch",
                    Action::Perch => "perch",
                    _ => "poop",
                },
                None,
            )
        }
    }
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

pub(crate) fn from_cli(flag: Option<&str>) -> Action {
    match flag {
        Some("--summon") => Action::Summon,
        Some("--hide") => Action::Hide,
        Some("--show") => Action::Show,
        Some("--clean") => Action::Clean,
        Some("--poop-here") => Action::PoopAtCursor,
        Some("--place-bag") => Action::PlaceBag,
        Some("--find-snack") => Action::SearchSnack,
        Some("--nibble-cursor") => Action::NibbleCursor,
        Some("--eat-cursor") => Action::EatCursor,
        Some("--steal-bag") => Action::StealBag,
        Some("--caught") => Action::Caught,
        Some("--bag-caper") => Action::BagCaper,
        Some("--blow-bubbles") => Action::BlowBubbles,
        Some("--bath-time") => Action::BathTime,
        Some("--chip-toss") => Action::ChipToss,
        Some("--invite-pigeon") => Action::InvitePigeon,
        Some("--gull-argument") => Action::GullArgument,
        Some("--baguette-parade") => Action::BaguetteParade,
        Some("--pretend-leave") => Action::PretendLeave,
        Some("--cursor-egg") => Action::CursorEgg,
        Some("--municipal-gull") => Action::MunicipalGull,
        Some("--apology") => Action::Apology,
        Some("--postcards") => Action::Postcards,
        Some("--tidy") => Action::Tidy,
        Some("--feed") => Action::Feed,
        Some("--bring-gift") => Action::BringGift,
        Some("--place-perch") => Action::PlacePerch,
        Some("--clear-perch") => Action::ClearPerch,
        Some("--perch") => Action::Perch,
        Some("--cancel") => Action::Cancel,
        _ => Action::Controls,
    }
}

#[cfg(test)]
mod tests {
    use super::Action;

    #[test]
    fn theatre_actions_are_accepted_by_native_bridge() {
        for name in [
            "blow_bubbles",
            "bath_time",
            "chip_toss",
            "invite_pigeon",
            "gull_argument",
            "baguette_parade",
            "pretend_leave",
            "cursor_egg",
            "municipal_gull",
            "apology",
            "postcards",
            "tidy",
        ] {
            assert!(serde_json::from_str::<Action>(&format!("\"{name}\"")).is_ok());
        }
    }
}
