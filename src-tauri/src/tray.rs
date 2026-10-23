//! Tray presentation and menu events. Actions use the shared dispatch path.
use crate::{
    actions::{dispatch_action, Action},
    state::State,
};
use std::sync::atomic::Ordering;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    Emitter, Listener, Manager,
};

pub(crate) fn install(app: &tauri::App) -> tauri::Result<()> {
    let menu = Menu::new(app)?;
    for (id, label) in [
        ("controls", "Open control room"),
        ("updates", "App updates…"),
        ("summon", "Summon Gullbert  ·  Ctrl+Alt+G"),
    ] {
        menu.append(&MenuItem::with_id(app, id, label, true, None::<&str>)?)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    let groups: &[(&str, &[(&str, &str)])] = &[
        (
            "Snacks",
            &[
                ("feed", "Offer a chip"),
                ("feed_here", "Leave a chip here…  ·  Ctrl+Alt+F at pointer"),
                ("place_bag", "Place chip bag…"),
                ("search_snack", "Find a snack"),
                ("chip_toss", "Chip toss…"),
            ],
        ),
        (
            "Bird routines",
            &[
                ("squawk", "Have a word"),
                ("nap", "Take a nap"),
                ("preen", "Preen feathers"),
                ("tilt", "Tilt his head"),
                ("stretch", "Stretch wings"),
            ],
        ),
        (
            "Mischief",
            &[
                ("nibble_cursor", "Nibble cursor"),
                ("eat_cursor", "Eat cursor (Esc releases)"),
                ("bag_caper", "Bag caper"),
                ("steal_bag", "Steal bag"),
                ("caught", "Caught you!"),
                ("poop", "Leave a gift"),
                ("target", "Poop here…"),
            ],
        ),
        ("Play", &[("play_cap", "Play with a cap")]),
        (
            "Tricks",
            &[
                ("trick_come", "Come here…"),
                ("trick_spin", "Spin"),
                ("trick_dead", "Play dead"),
            ],
        ),
        (
            "Theatre",
            &[
                ("blow_bubbles", "Blow bubbles"),
                ("bath_time", "Bath time"),
                ("invite_pigeon", "Invite pigeon"),
                ("gull_argument", "Gull argument"),
                ("baguette_parade", "Baguette parade"),
                ("pretend_leave", "Pretend to leave"),
                ("cursor_egg", "Cursor egg"),
                ("municipal_gull", "Municipal gull"),
                ("apology", "The apology"),
                ("postcards", "Poop postcards"),
            ],
        ),
        (
            "Gifts && favourite spot",
            &[
                ("bring_gift", "Bring me something"),
                ("place_nest", "Place nest…"),
                ("visit_nest", "Visit nest"),
                ("build_something", "Build something"),
                ("clear_nest", "Remove nest"),
                ("place_perch", "Favourite spot…"),
                ("perch", "Perch"),
                ("clear_perch", "Clear favourite spot"),
            ],
        ),
        (
            "Tidying",
            &[
                ("tidy", "Focused tidy mode…"),
                ("clean", "Clean the evidence  ·  Ctrl+Alt+X"),
            ],
        ),
    ];
    for (label, entries) in groups {
        let submenu = Submenu::new(app, *label, true)?;
        for (id, text) in *entries {
            submenu.append(&MenuItem::with_id(app, *id, *text, true, None::<&str>)?)?;
        }
        menu.append(&submenu)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(
        app,
        "cancel",
        "Stop routine",
        true,
        None::<&str>,
    )?)?;
    let visibility = MenuItem::with_id(
        app,
        "visibility",
        "Send him away  ·  Ctrl+Alt+Shift+G",
        true,
        None::<&str>,
    )?;
    menu.append(&visibility)?;
    // All visibility paths (including shortcuts and safety fallbacks) emit this event.
    app.listen("gullbert-visible", move |event| {
        let label = if event.payload() == "true" {
            "Send him away  ·  Ctrl+Alt+Shift+G"
        } else {
            "Return / resume"
        };
        if let Err(error) = visibility.set_text(label) {
            eprintln!("Gullbert: unable to update tray visibility: {error}");
        }
    });
    menu.append(&MenuItem::with_id(
        app,
        "quit",
        "Quit Gullbert",
        true,
        None::<&str>,
    )?)?;
    TrayIconBuilder::new()
        .tooltip("Gullbert — your local nuisance")
        .icon(tauri::image::Image::from_bytes(include_bytes!(
            "../icons/32x32.png"
        ))?)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, e| {
            if e.id.as_ref() == "updates" {
                dispatch_action(app, Action::Controls);
                if let Some(window) = app.get_webview_window("controls") {
                    let _ = window.emit("gullbert-open-updates", ());
                }
                return;
            }
            let action = match e.id.as_ref() {
                "visibility" => {
                    if app.state::<State>().visible.load(Ordering::SeqCst) {
                        Action::Hide
                    } else {
                        Action::Show
                    }
                }
                name => match Action::named(name) {
                    Some(action) => action,
                    None => return,
                },
            };
            dispatch_action(app, action);
        })
        .build(app)?;
    Ok(())
}
