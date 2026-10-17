use super::*;
use std::cell::{Cell, RefCell};

type Message = (String, Option<(f64, f64)>, Option<u64>);
struct Recording {
    now: Cell<Instant>,
    visible: Cell<bool>,
    settings: Cell<(bool, u8)>,
    capture: Cell<bool>,
    focusable: Cell<bool>,
    escape: Cell<bool>,
    pointer: Cell<Option<(f64, f64, bool)>>,
    scale: Cell<f64>,
    fail: Cell<Option<&'static str>>,
    events: RefCell<Vec<String>>,
    messages: RefCell<Vec<Message>>,
    deadlines: RefCell<Vec<(Instant, Deadline)>>,
    stream: RefCell<Vec<serde_json::Value>>,
}
impl Default for Recording {
    fn default() -> Self {
        Self {
            now: Cell::new(Instant::now()),
            visible: Cell::new(true),
            settings: Cell::new((false, 2)),
            capture: Cell::new(false),
            focusable: Cell::new(false),
            escape: Cell::new(false),
            pointer: Cell::new(Some((20.0, 30.0, true))),
            scale: Cell::new(2.0),
            fail: Cell::new(None),
            events: RefCell::new(vec![]),
            messages: RefCell::new(vec![]),
            deadlines: RefCell::new(vec![]),
            stream: RefCell::new(vec![]),
        }
    }
}
impl Recording {
    fn effect(&self, name: &str) -> Result<(), String> {
        self.events.borrow_mut().push(name.into());
        if self.fail.get() == Some(name) {
            self.fail.set(None);
            Err(format!("failed {name}"))
        } else {
            Ok(())
        }
    }
    fn advance(&self, duration: Duration) {
        self.now.set(self.now.get() + duration);
    }
    fn actions(&self) -> Vec<String> {
        self.stream
            .borrow()
            .iter()
            .filter(|event| event["event"] != "gullbert-visible")
            .map(|event| {
                let payload = &event["payload"];
                payload["action"]
                    .as_str()
                    .or(payload["outcome"].as_str())
                    .unwrap()
                    .into()
            })
            .collect()
    }
    fn clear(&self) {
        self.events.borrow_mut().clear();
        self.messages.borrow_mut().clear();
        self.stream.borrow_mut().clear();
    }
    fn latest(&self) -> Deadline {
        self.deadlines.borrow().last().unwrap().1
    }
    fn fire_due(&self, input: &mut Input) {
        let due: Vec<_> = self
            .deadlines
            .borrow()
            .iter()
            .filter(|(at, _)| *at <= self.now())
            .map(|(_, d)| *d)
            .collect();
        self.deadlines
            .borrow_mut()
            .retain(|(at, _)| *at > self.now());
        for deadline in due {
            input.expired(self, deadline);
        }
    }
    fn assert_released(&self) {
        assert!(!self.capture.get(), "capture must be released");
        assert!(
            !self.focusable.get(),
            "overlay must not retain focusability"
        );
        assert!(!self.escape.get(), "Escape must be released");
    }
}
impl Effects for Recording {
    fn now(&self) -> Instant {
        self.now.get()
    }
    fn visible(&self) -> bool {
        self.visible.get()
    }
    fn settings(&self) -> (bool, u8) {
        self.settings.get()
    }
    fn window_exists(&self) -> bool {
        true
    }
    fn geometry(&self) -> Result<((u32, u32), f64), String> {
        self.effect("geometry")?;
        Ok(((1600, 1200), self.scale.get()))
    }
    fn pointer(&self) -> Option<CursorPoint> {
        if !self.visible() {
            return None;
        }
        self.pointer
            .get()
            .map(|(x, y, inside)| CursorPoint { x, y, inside })
    }
    fn capture(&self, enabled: bool) -> Result<(), String> {
        self.effect(if enabled { "capture:on" } else { "capture:off" })?;
        self.capture.set(enabled);
        Ok(())
    }
    fn focusable(&self, enabled: bool) -> Result<(), String> {
        self.effect(if enabled {
            "focusable:on"
        } else {
            "focusable:off"
        })?;
        self.focusable.set(enabled);
        Ok(())
    }
    fn focus(&self) -> Result<(), String> {
        self.effect("focus")
    }
    fn all_workspaces(&self) -> Result<(), String> {
        self.effect("workspaces")
    }
    fn escape(&self, only_if_missing: bool) -> Result<(), String> {
        if only_if_missing && self.escape.get() {
            return Ok(());
        }
        self.effect("escape:on")?;
        self.escape.set(true);
        Ok(())
    }
    fn release_escape(&self) {
        self.effect("escape:off").unwrap();
        self.escape.set(false);
    }
    fn move_cursor(&self, point: Point) -> Result<(), String> {
        self.effect("move")?;
        self.pointer.set(Some((point.x, point.y, true)));
        Ok(())
    }
    fn visibility(&self, visible: bool) -> Result<(), String> {
        self.visible.set(visible);
        self.effect(if visible { "visible:on" } else { "visible:off" })?;
        self.stream
            .borrow_mut()
            .push(serde_json::json!({ "event": "gullbert-visible", "payload": visible }));
        Ok(())
    }
    fn emergency_hide(&self, _error: &str) {
        self.visible.set(false);
        self.effect("hide:fallback").unwrap();
    }
    fn emit(
        &self,
        action: &str,
        point: Option<Point>,
        cursor_id: Option<u64>,
    ) -> Result<(), String> {
        self.effect(&format!("emit:{action}"))?;
        self.stream.borrow_mut().push(serde_json::json!({
            "event": "gullbert-action", "payload": { "action": action, "point": point, "cursor_id": cursor_id }
        }));
        self.messages
            .borrow_mut()
            .push((action.into(), point.map(|p| (p.x, p.y)), cursor_id));
        Ok(())
    }
    fn target_notice(&self, notice: Notice) -> Result<(), String> {
        let payload = serde_json::to_value(notice).unwrap();
        self.effect(&format!("emit:{}", payload["outcome"].as_str().unwrap()))?;
        self.stream
            .borrow_mut()
            .push(serde_json::json!({ "event": "gullbert-target", "payload": payload }));
        Ok(())
    }
    fn schedule(&self, deadline: Deadline, delay: Duration) {
        self.deadlines
            .borrow_mut()
            .push((self.now() + delay, deadline));
    }
    fn position_for_target(&self, _purpose: Purpose) -> Result<(), String> {
        self.effect("position:target")
    }
    fn position_for_cursor(&self) -> Result<(), String> {
        self.effect("position:cursor")
    }
}
fn rect() -> Rect {
    Rect {
        x: 10.0,
        y: 20.0,
        width: 40.0,
        height: 40.0,
    }
}
fn point() -> Point {
    Point { x: 20.0, y: 30.0 }
}
fn cursor(input: &mut Input, effects: &Recording) -> u64 {
    input.eat_cursor(effects).unwrap();
    effects.messages.borrow().last().unwrap().2.unwrap()
}

#[test]
fn targeting_preempts_pickup_and_stale_pickup_work_cannot_release_it() {
    let mut input = Input::default();
    let effects = Recording::default();
    let pickup = input.begin_pickup(&effects, rect()).unwrap();
    let old = effects.latest();
    input.begin_target(&effects, Purpose::Tidy, "tidy").unwrap();
    effects.clear();
    assert!(input.begin_pickup(&effects, rect()).is_none());
    assert!(input.end_pickup(&effects, pickup, true, true).is_none());
    assert!(input
        .sync_interaction(&effects, vec![], Some(pickup))
        .is_none());
    input.expired(&effects, old);
    assert!(effects.capture.get());
    assert!(effects.escape.get());
    assert!(effects.actions().is_empty());
    input
        .target_picked(&effects, input.targeting.id(), point())
        .unwrap();
    assert_eq!(effects.actions(), ["selected"]);
}

#[test]
fn completion_and_cancellation_have_distinct_tidy_outcomes() {
    for purpose in [Purpose::Tidy, Purpose::Placement("place_bag")] {
        for ending in ["done", "escape", "timeout", "replacement", "hide"] {
            let mut input = Input::default();
            let effects = Recording::default();
            input.begin_target(&effects, purpose, "cancel").unwrap();
            effects.clear();
            match ending {
                "done" => input.finish_target(&effects),
                "escape" => input.escape(&effects).unwrap(),
                "timeout" => {
                    effects.advance(purpose.timeout());
                    effects.fire_due(&mut input);
                }
                "replacement" => input.replace_target(&effects),
                "hide" => input.set_visible(&effects, false).unwrap(),
                _ => unreachable!(),
            }
            effects.assert_released();
            let complete = matches!(ending, "done" | "escape" | "timeout");
            assert_eq!(
                effects.actions(),
                [if purpose == Purpose::Tidy && complete {
                    "finished_tidying"
                } else if complete {
                    "abandoned"
                } else {
                    "replaced"
                }],
                "{purpose:?} {ending}"
            );
        }
    }
}

#[test]
fn placement_releases_before_delivery_but_tidy_picks_do_not_renew_deadline() {
    let mut input = Input::default();
    let effects = Recording::default();
    input
        .begin_target(&effects, Purpose::Placement("place_bag"), "cancel")
        .unwrap();
    assert_eq!(
        effects.deadlines.borrow()[0].0 - effects.now(),
        Duration::from_secs(12)
    );
    effects.clear();
    input
        .target_picked(&effects, input.targeting.id(), point())
        .unwrap();
    assert_eq!(effects.actions(), ["selected"]);
    effects.assert_released();
    assert_eq!(
        effects.stream.borrow().last().unwrap()["payload"]["point"],
        serde_json::json!({"x":20.0,"y":30.0})
    );
    input.begin_target(&effects, Purpose::Tidy, "tidy").unwrap();
    let count = effects.deadlines.borrow().len();
    effects.clear();
    for _ in 0..3 {
        effects.advance(Duration::from_secs(9));
        input
            .target_picked(&effects, input.targeting.id(), point())
            .unwrap();
    }
    assert_eq!(effects.deadlines.borrow().len(), count);
    assert!(effects.capture.get());
    effects.advance(Duration::from_secs(3));
    effects.fire_due(&mut input);
    assert_eq!(
        effects.actions(),
        ["selected", "selected", "selected", "finished_tidying"]
    );
    effects.assert_released();
}

#[test]
fn invalid_target_or_failed_delivery_cancels_without_completing_tidy() {
    for failure in ["coordinate", "geometry", "emit:selected"] {
        let mut input = Input::default();
        let effects = Recording::default();
        input.begin_target(&effects, Purpose::Tidy, "tidy").unwrap();
        effects.clear();
        let target = if failure == "coordinate" {
            Point { x: 800.0, y: 10.0 }
        } else {
            effects.fail.set(Some(failure));
            point()
        };
        assert!(input
            .target_picked(&effects, input.targeting.id(), target)
            .is_err());
        assert_eq!(effects.actions(), ["abandoned"]);
        effects.assert_released();
    }
}

#[test]
fn every_target_acquisition_failure_rolls_back_capture_focus_and_escape() {
    for failure in [
        "position:target",
        "visible:on",
        "escape:on",
        "focusable:on",
        "capture:on",
        "focus",
        "emit:started",
    ] {
        let mut input = Input::default();
        let effects = Recording::default();
        effects.fail.set(Some(failure));
        assert!(
            input.begin_target(&effects, Purpose::Tidy, "tidy").is_err(),
            "{failure}"
        );
        effects.assert_released();
        assert!(effects.deadlines.borrow().is_empty());
        assert!(!effects
            .actions()
            .iter()
            .any(|a| a == "selected" || a == "finished_tidying"));
        // Recovery leaves the module usable for a later explicit request.
        input
            .begin_target(&effects, Purpose::Placement("poop"), "cancel")
            .unwrap();
        assert!(effects.capture.get());
        assert!(effects.escape.get());
    }
}

#[test]
fn failed_restoration_hides_instead_of_leaving_an_interactive_overlay() {
    let mut input = Input::default();
    let effects = Recording::default();
    input.begin_target(&effects, Purpose::Tidy, "tidy").unwrap();
    effects.clear();
    effects.fail.set(Some("capture:off"));
    input.finish_target(&effects);
    assert!(!effects.visible());
    assert!(!effects.escape.get());
    assert!(!effects.focusable.get());
    let events = effects.events.borrow();
    assert!(
        events.iter().position(|e| e == "hide:fallback").unwrap()
            < events
                .iter()
                .position(|e| e == "emit:finished_tidying")
                .unwrap()
    );
}

#[test]
fn showing_after_failed_target_release_restores_click_through_first() {
    let mut input = Input::default();
    let effects = Recording::default();
    input.begin_target(&effects, Purpose::Tidy, "tidy").unwrap();
    effects.fail.set(Some("capture:off"));
    input.finish_target(&effects);
    assert!(!effects.visible());
    assert!(effects.capture.get());
    effects.clear();

    crate::actions::Action::named("show")
        .unwrap()
        .perform(&mut Routing {
            input: &mut input,
            effects: &effects,
        })
        .unwrap();
    input.sync_interaction(&effects, vec![], None);

    assert!(effects.visible());
    effects.assert_released();
    let events = effects.events.borrow();
    let release = events
        .iter()
        .position(|event| event == "capture:off")
        .unwrap();
    let show = events
        .iter()
        .position(|event| event == "visible:on")
        .unwrap();
    assert!(release < show);
}

#[test]
fn showing_stays_hidden_while_capture_recovery_still_fails() {
    let mut input = Input::default();
    let effects = Recording::default();
    input.begin_target(&effects, Purpose::Tidy, "tidy").unwrap();
    effects.fail.set(Some("capture:off"));
    input.finish_target(&effects);
    effects.clear();
    effects.fail.set(Some("capture:off"));

    assert!(input.set_visible(&effects, true).is_err());
    assert!(!effects.visible());
    assert!(effects.capture.get());
    assert!(!effects
        .events
        .borrow()
        .iter()
        .any(|event| event == "visible:on"));

    input.set_visible(&effects, true).unwrap();
    assert!(effects.visible());
    effects.assert_released();
}

#[test]
fn watcher_retries_failed_hover_release_while_the_overlay_is_hidden() {
    let mut input = Input::default();
    let effects = Recording::default();
    input.sync_interaction(&effects, vec![rect()], None);
    assert!(effects.capture.get());
    effects.pointer.set(None);
    effects.fail.set(Some("capture:off"));

    input.watch(&effects);
    assert!(!effects.visible());
    assert!(effects.capture.get());
    input.watch(&effects);

    assert!(!effects.visible());
    effects.assert_released();
}

#[test]
fn stale_target_and_cursor_deadlines_do_not_affect_replacements() {
    let mut input = Input::default();
    let effects = Recording::default();
    input
        .begin_target(&effects, Purpose::Placement("poop"), "cancel")
        .unwrap();
    let old_target = effects.latest();
    input.begin_target(&effects, Purpose::Tidy, "tidy").unwrap();
    effects.clear();
    input.expired(&effects, old_target);
    assert!(effects.capture.get());
    assert!(effects.escape.get());
    assert!(effects.actions().is_empty());
    let old_cursor = cursor(&mut input, &effects);
    let old_deadline = effects.latest();
    let new_cursor = cursor(&mut input, &effects);
    input.expired(&effects, old_deadline);
    input.release_cursor(&effects, old_cursor);
    assert!(input.tug_cursor(&effects, new_cursor, point()));
    assert!(effects.escape.get());
}

#[test]
fn pickup_heartbeat_expiry_releases_capture_and_escape_without_waiting_for_deadline() {
    let mut input = Input::default();
    let effects = Recording::default();
    let id = input.begin_pickup(&effects, rect()).unwrap();
    effects.pointer.set(None); // A valid pickup retains capture away from the gull.
    input.watch(&effects);
    assert!(effects.capture.get());
    effects.advance(Duration::from_millis(350));
    input.watch(&effects);
    effects.assert_released();
    assert_eq!(effects.actions(), ["cancel"]);
    assert!(input.sync_interaction(&effects, vec![], Some(id)).is_none());
    input.escape(&effects).unwrap();
    effects.advance(Duration::from_millis(29650));
    effects.fire_due(&mut input);
    assert_eq!(effects.actions(), ["cancel"]);
    effects.assert_released();
}

#[test]
fn late_heartbeat_or_escape_finishes_expired_pickup_without_canceling_its_replacement() {
    for trigger in ["heartbeat", "escape"] {
        let mut input = Input::default();
        let effects = Recording::default();
        let old_id = input.begin_pickup(&effects, rect()).unwrap();
        let old_deadline = effects.latest();
        effects.advance(Duration::from_millis(350));

        match trigger {
            "heartbeat" => {
                assert!(input
                    .sync_interaction(&effects, vec![], Some(old_id))
                    .is_none());
            }

            "escape" => input.escape(&effects).unwrap(),

            _ => unreachable!(),
        }

        effects.assert_released();
        assert_eq!(effects.actions(), ["cancel"]);
        let new_id = input.begin_pickup(&effects, rect()).unwrap();
        effects.clear();
        input.expired(&effects, old_deadline);
        assert!(input.end_pickup(&effects, old_id, true, true).is_none());
        assert!(effects.actions().is_empty());
        assert!(effects.capture.get());
        assert!(effects.escape.get());

        input.end_pickup(&effects, new_id, false, false);
        effects.assert_released();
    }
}

#[test]
fn old_pickup_release_and_timeout_cannot_touch_a_new_gesture() {
    let mut input = Input::default();
    let effects = Recording::default();
    let old = input.begin_pickup(&effects, rect()).unwrap();
    let timeout = effects.latest();
    let new = input.begin_pickup(&effects, rect()).unwrap();
    effects.clear();
    assert!(input.end_pickup(&effects, old, true, true).is_none());
    input.expired(&effects, timeout);
    assert!(effects.capture.get());
    assert!(effects.escape.get());
    assert!(effects.actions().is_empty());
    assert!(input.end_pickup(&effects, new, false, false).is_none());
    effects.assert_released();
}

#[test]
fn pickup_reaction_retains_escape_but_authorizes_movement_separately() {
    for level in 0..=2 {
        for wants_tug in [false, true] {
            let mut input = Input::default();
            let effects = Recording::default();
            effects.settings.set((false, level));
            let pickup = input.begin_pickup(&effects, rect()).unwrap();
            let reaction = input.end_pickup(&effects, pickup, true, wants_tug);
            assert_eq!(reaction.is_some(), level > 0);
            assert!(!effects.capture.get());
            assert_eq!(effects.escape.get(), level > 0);
            if let Some(id) = reaction {
                assert_eq!(
                    effects.deadlines.borrow().last().unwrap().0 - effects.now(),
                    Duration::from_secs(10)
                );
                assert_eq!(
                    input.tug_cursor(&effects, id, point()),
                    level == 2 && wants_tug
                );
                input.escape(&effects).unwrap();
            }
            effects.assert_released();
        }
    }
}

#[test]
fn pause_or_mischief_change_interrupts_pickup_and_cursor_without_ending_targeting() {
    let mut input = Input::default();
    let effects = Recording::default();
    let pickup = input.begin_pickup(&effects, rect()).unwrap();
    input.interrupt(&effects);
    assert!(input.end_pickup(&effects, pickup, true, true).is_none());
    effects.assert_released();
    let id = cursor(&mut input, &effects);
    input.interrupt(&effects);
    assert!(!input.tug_cursor(&effects, id, point()));
    input.begin_target(&effects, Purpose::Tidy, "tidy").unwrap();
    effects.clear();
    input.interrupt(&effects);
    assert!(effects.capture.get());
    assert!(effects.escape.get());
    assert!(effects.actions().is_empty());
    input
        .target_picked(&effects, input.targeting.id(), point())
        .unwrap();
    assert_eq!(effects.actions(), ["selected"]);
}

#[test]
fn unavailable_escape_prevents_pickup_and_first_cursor_movement() {
    let mut input = Input::default();
    let effects = Recording::default();
    effects.fail.set(Some("escape:on"));
    assert!(input.begin_pickup(&effects, rect()).is_none());
    effects.assert_released();
    assert!(effects.deadlines.borrow().is_empty());
    let id = cursor(&mut input, &effects);
    effects.fail.set(Some("escape:on"));
    effects.clear();
    assert!(!input.tug_cursor(&effects, id, point()));
    assert!(!effects.events.borrow().iter().any(|e| e == "move"));
    effects.assert_released();
}

#[test]
fn cursor_hold_has_its_own_deadline_and_movement_failure_releases_escape() {
    let mut input = Input::default();
    let effects = Recording::default();
    let id = cursor(&mut input, &effects);
    assert!(input.tug_cursor(&effects, id, point()));
    effects.advance(Duration::from_millis(1199));
    effects.fire_due(&mut input);
    assert!(effects.escape.get());
    effects.advance(Duration::from_millis(1));
    effects.fire_due(&mut input);
    assert!(!input.tug_cursor(&effects, id, point()));
    effects.assert_released();
    let id = cursor(&mut input, &effects);
    effects.fail.set(Some("move"));
    assert!(!input.tug_cursor(&effects, id, point()));
    effects.assert_released();
}

#[test]
fn first_tug_requires_nearby_pointer_and_bounded_display_coordinates() {
    for (x, y, inside) in [(50.0, 30.0, true), (20.0, 30.0, false)] {
        let mut input = Input::default();
        let effects = Recording::default();
        let id = cursor(&mut input, &effects);
        effects.pointer.set(Some((x, y, inside)));
        assert!(!input.tug_cursor(&effects, id, point()));
        effects.assert_released();
    }
    for point in [
        Point {
            x: f64::NAN,
            y: 0.0,
        },
        Point { x: 800.0, y: 0.0 },
        Point { x: -1.0, y: 0.0 },
    ] {
        let mut input = Input::default();
        let effects = Recording::default();
        let id = cursor(&mut input, &effects);
        assert!(!input.tug_cursor(&effects, id, point));
        effects.assert_released();
    }
}

#[test]
fn invalid_display_scale_releases_cursor_authorization_without_moving() {
    for scale in [0.0, -1.0, f64::NAN, f64::INFINITY] {
        for holding in [false, true] {
            let mut input = Input::default();
            let effects = Recording::default();
            let id = cursor(&mut input, &effects);
            if holding {
                assert!(input.tug_cursor(&effects, id, point()));
            }
            effects.scale.set(scale);
            effects.clear();
            assert!(!input.tug_cursor(&effects, id, point()));
            assert!(!effects.events.borrow().iter().any(|event| event == "move"));
            effects.assert_released();
            effects.scale.set(2.0);
            assert!(!input.tug_cursor(&effects, id, point()));
        }
    }
}

#[test]
fn ordinary_capture_is_local_and_failure_hides_without_clearing_pickup_bookkeeping() {
    let mut input = Input::default();
    let effects = Recording::default();
    input.sync_interaction(&effects, vec![rect()], None);
    assert!(effects.capture.get());
    effects.pointer.set(None);
    input.watch(&effects);
    assert!(!effects.capture.get());
    effects.fail.set(Some("capture:on"));
    let id = input.begin_pickup(&effects, rect()).unwrap();
    assert!(!effects.visible());
    assert!(effects.escape.get());
    // Existing fail-safe hiding is distinct from an explicit Hide command.
    // The valid pickup remains cancellable with Escape until its deadline.
    effects.clear();
    input.escape(&effects).unwrap();
    assert_eq!(effects.actions(), ["cancel"]);
    assert!(input.end_pickup(&effects, id, true, true).is_none());
}

#[test]
fn startup_prepares_geometry_and_click_through_before_showing_the_overlay() {
    let mut input = Input::default();
    let effects = Recording::default();
    effects.visible.set(false);
    input.ready(&effects).unwrap();
    assert!(effects.visible());
    effects.assert_released();
    let events = effects.events.borrow();
    let positioning = events.iter().position(|e| e == "position:cursor").unwrap();
    assert_eq!(
        &events[positioning..],
        ["position:cursor", "capture:off", "workspaces", "visible:on"]
    );
    drop(events);
    effects.visible.set(false);
    effects.clear();
    effects.fail.set(Some("workspaces"));
    assert!(input.ready(&effects).is_err());
    assert!(!effects.visible());
    assert!(!effects.events.borrow().iter().any(|e| e == "visible:on"));
}

struct Routing<'a> {
    input: &'a mut Input,
    effects: &'a Recording,
}
impl crate::actions::Effects for Routing<'_> {
    fn interrupt(&mut self) {
        self.input.interrupt(self.effects);
    }
    fn replace_target(&mut self) {
        self.input.replace_target(self.effects);
    }
    fn visible(&self) -> bool {
        self.effects.visible()
    }
    fn position(&mut self) -> Result<Point, String> {
        self.effects.position_for_cursor()?;
        Ok(point())
    }
    fn visibility(&mut self, visible: bool) -> Result<(), String> {
        self.input.set_visible(self.effects, visible)
    }
    fn command(&mut self, command: &str, point: Option<Point>) -> Result<(), String> {
        self.effects.emit(command, point, None)
    }
    fn target(&mut self, purpose: Purpose, preparation: &'static str) -> Result<(), String> {
        self.input.begin_target(self.effects, purpose, preparation)
    }
    fn cursor(&mut self) -> Result<(), String> {
        self.input.eat_cursor(self.effects)
    }
    fn controls(&mut self) {
        self.effects.effect("controls").unwrap();
    }
    fn quit(&mut self) {
        self.effects.effect("quit").unwrap();
    }
}

// Export real routing/input event delivery for the application + Gullbert tests.
// No Node or frontend build is needed to run this native test on its own.
#[test]
fn application_routing_traces() {
    let scenarios: serde_json::Value =
        serde_json::from_str(include_str!("../../../tests/action-scenarios.json")).unwrap();
    let mut traces = serde_json::Map::new();
    for (name, steps) in scenarios.as_object().unwrap() {
        let mut input = Input::default();
        let effects = Recording::default();
        let mut trace = vec![];
        for step in steps.as_array().unwrap() {
            effects.clear();
            let mut result = Ok(());
            if let Some(action) = step["action"].as_str() {
                let action = crate::actions::Action::named(action).unwrap();
                result = action.perform(&mut Routing {
                    input: &mut input,
                    effects: &effects,
                });
            } else if let Some(point) = step["pick"].as_array() {
                let id = input.targeting.id();
                result = input.target_picked(
                    &effects,
                    id,
                    Point {
                        x: point[0].as_f64().unwrap(),
                        y: point[1].as_f64().unwrap(),
                    },
                );
            } else if step["escape"] == true {
                result = input.escape(&effects);
            } else if step["deadline"] == true {
                effects.advance(input.targeting.purpose().unwrap().timeout());
                effects.fire_due(&mut input);
            } else if let Some(failure) = step["fail"].as_str() {
                effects.fail.set(Some(match failure {
                    "emit:selected" => "emit:selected",
                    "capture:on" => "capture:on",
                    _ => panic!("unknown failure"),
                }));
            }
            assert_eq!(result.is_err(), step["error"] == true, "{name}: {step}");
            trace.push(
                serde_json::json!({ "events": *effects.stream.borrow(), "error": result.err() }),
            );
        }
        traces.insert(name.clone(), serde_json::json!(trace));
    }
    println!(
        "GULLBERT_ROUTING_TRACES={}",
        serde_json::Value::Object(traces)
    );
}

#[test]
fn duplicate_and_stale_target_requests_cannot_end_another_session() {
    let mut input = Input::default();
    let effects = Recording::default();
    input
        .begin_target(&effects, Purpose::Placement("feed_here"), "prepare_chip")
        .unwrap();
    let first = input.targeting.id();
    input.finish_target_id(&effects, Some(first));
    effects.clear();
    input.finish_target_id(&effects, Some(first));
    input.escape(&effects).unwrap();
    input.target_picked(&effects, first, point()).unwrap();
    assert!(effects.actions().is_empty());
    input.begin_target(&effects, Purpose::Tidy, "tidy").unwrap();
    effects.clear();
    input.finish_target_id(&effects, Some(first));
    input.target_picked(&effects, first, point()).unwrap();
    input.expired(&effects, Deadline::Target(first));
    assert!(effects.actions().is_empty());
    assert!(effects.capture.get());
}

#[test]
fn failed_selection_delivery_reports_its_released_identity_and_cleans_up() {
    let mut input = Input::default();
    let effects = Recording::default();
    input
        .begin_target(&effects, Purpose::Placement("feed_here"), "prepare_chip")
        .unwrap();
    let id = input.targeting.id();
    effects.clear();
    effects.fail.set(Some("emit:selected"));
    assert!(input.target_picked(&effects, id, point()).is_err());
    effects.assert_released();
    assert_eq!(effects.actions(), ["abandoned"]);
    assert_eq!(effects.stream.borrow()[0]["payload"]["id"], id);
    let events = effects.events.borrow();
    assert!(
        events.iter().position(|e| e == "capture:off").unwrap()
            < events.iter().position(|e| e == "emit:selected").unwrap()
    );
}

#[test]
fn public_routing_preserves_pointer_positioning_and_visibility_policy() {
    use crate::actions::Action;
    let mut input = Input::default();
    let effects = Recording::default();
    Action::Summon
        .perform(&mut Routing {
            input: &mut input,
            effects: &effects,
        })
        .unwrap();
    assert_eq!(
        effects.messages.borrow().last().unwrap().1,
        Some((20.0, 30.0))
    );
    for action in [Action::Clean, Action::Cancel] {
        effects.visible.set(false);
        effects.clear();
        action
            .perform(&mut Routing {
                input: &mut input,
                effects: &effects,
            })
            .unwrap();
        assert!(!effects.visible());
        assert!(!effects
            .events
            .borrow()
            .iter()
            .any(|event| event == "position:cursor"));
    }
    effects.clear();
    Action::Feed
        .perform(&mut Routing {
            input: &mut input,
            effects: &effects,
        })
        .unwrap();
    assert!(effects.visible());
    let events = effects.events.borrow();
    let position = events
        .iter()
        .position(|event| event == "position:cursor")
        .unwrap();
    let visible = events
        .iter()
        .position(|event| event == "visible:on")
        .unwrap();
    let command = events
        .iter()
        .position(|event| event == "emit:feed")
        .unwrap();
    assert!(position < visible && visible < command);
}

#[test]
fn shutdown_releases_every_input_mode_and_old_hit_regions_cannot_recapture() {
    for mode in ["target", "pickup", "cursor"] {
        let mut input = Input::default();
        let effects = Recording::default();
        input.sync_interaction(&effects, vec![rect()], None);

        match mode {
            "target" => input.begin_target(&effects, Purpose::Tidy, "tidy").unwrap(),

            "pickup" => {
                input.begin_pickup(&effects, rect()).unwrap();
            }

            "cursor" => {
                let id = cursor(&mut input, &effects);
                assert!(input.tug_cursor(&effects, id, point()));
            }

            _ => unreachable!(),
        }

        super::desktop::quiesce_input(&mut input, &effects);
        effects.assert_released();
        input.reconcile(&effects, effects.pointer().as_ref());
        effects.assert_released();
    }
}
