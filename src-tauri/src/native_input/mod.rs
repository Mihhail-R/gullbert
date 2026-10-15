//! Native input ownership. Callers express interactions, never inspect leases.
//! The desktop adapter serializes entry points; effects and clock are replaceable
//! inside this module so tests exercise the same complete lifecycle as the app.
mod cursor_bite;
pub(crate) mod desktop;
mod interaction;
mod queue;
mod targeting;
#[cfg(test)]
mod tests;
#[cfg(all(debug_assertions, target_os = "macos"))]
pub(crate) mod window_spike;

pub(crate) use desktop::{
    begin_target, cancel_target, dispatch, eat_cursor, escape, interrupt, ready, request,
    set_visible, Runtime,
};
pub(crate) use interaction::Rect;
pub(crate) use targeting::Purpose;

use crate::windows::{CursorPoint, Point};
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Deadline {
    Target(u64),
    Pickup(u64),
    Cursor(u64),
}

// Internal seam: desktop effects in production, recorded effects in tests.
trait Effects {
    fn now(&self) -> Instant;
    fn visible(&self) -> bool;
    fn settings(&self) -> (bool, u8);
    fn window_exists(&self) -> bool;
    fn geometry(&self) -> Result<((u32, u32), f64), String>;
    fn pointer(&self) -> Option<CursorPoint>;
    fn capture(&self, enabled: bool) -> Result<(), String>;
    fn focusable(&self, enabled: bool) -> Result<(), String>;
    fn focus(&self) -> Result<(), String>;
    fn all_workspaces(&self) -> Result<(), String>;
    fn escape(&self, only_if_missing: bool) -> Result<(), String>;
    fn release_escape(&self);
    fn move_cursor(&self, point: Point) -> Result<(), String>;
    fn visibility(&self, visible: bool) -> Result<(), String>;
    fn emergency_hide(&self, error: &str);
    fn emit(
        &self,
        action: &str,
        point: Option<Point>,
        purpose: Option<Purpose>,
        cursor_id: Option<u64>,
    ) -> Result<(), String>;
    fn schedule(&self, deadline: Deadline, delay: Duration);
    // Display selection is supplied by the application, not decided here.
    fn position_for_target(&self, purpose: Purpose) -> Result<(), String>;
    fn position_for_cursor(&self) -> Result<(), String>;
}

#[derive(Default)]
struct Input {
    targeting: targeting::Targeting,
    interaction: interaction::Interaction,
    pickup: interaction::PickupLease,
    cursor: cursor_bite::CursorBite,
}

impl Input {
    fn ready(&mut self, effects: &impl Effects) -> Result<(), String> {
        self.cancel_target(effects);
        effects.position_for_cursor()?;
        effects.capture(false)?;
        effects.all_workspaces()?;
        self.set_visible(effects, true)
    }

    fn reconcile(&mut self, effects: &impl Effects, point: Option<&CursorPoint>) {
        if self.targeting.is_active() {
            return;
        }
        let capture = effects.visible()
            && !self.cursor.holding()
            && (self.pickup.active(effects.now())
                || self.interaction.hit(
                    point.filter(|p| p.inside).map(|p| (p.x, p.y)),
                    effects.now(),
                ));
        if capture == self.interaction.capturing || !effects.window_exists() {
            return;
        }
        match effects.capture(capture) {
            Ok(()) => self.interaction.capturing = capture,
            Err(error) => {
                self.interaction.capturing = false;
                self.interaction.rects.clear();
                effects.emergency_hide(&error);
            }
        }
    }

    fn sync_interaction(
        &mut self,
        effects: &impl Effects,
        rects: Vec<Rect>,
        pickup_id: Option<u64>,
    ) -> Option<CursorPoint> {
        self.interaction.rects = if rects.len() <= 32 && rects.iter().all(Rect::valid) {
            rects
        } else {
            vec![]
        };
        self.interaction.refreshed = Some(effects.now());
        let valid = pickup_id.is_none_or(|id| self.pickup.refresh(id, effects.now()));
        let point = effects.pointer();
        self.reconcile(effects, point.as_ref());
        if valid {
            point
        } else {
            None
        }
    }

    fn begin_pickup(&mut self, effects: &impl Effects, rect: Rect) -> Option<u64> {
        if !rect.valid() || !effects.visible() || self.targeting.is_active() {
            return None;
        }
        self.cancel_cursor(effects);
        effects.escape(true).ok()?;
        let id = self.pickup.begin(effects.now());
        self.reconcile(effects, effects.pointer().as_ref());
        effects.schedule(Deadline::Pickup(id), interaction::PICKUP_LIMIT);
        Some(id)
    }

    fn end_pickup(
        &mut self,
        effects: &impl Effects,
        id: u64,
        retaliate: bool,
        tug: bool,
    ) -> Option<u64> {
        if self.pickup.id != id {
            return None;
        }
        let valid = self.pickup.finish(id, effects.now());
        self.reconcile(effects, None);
        let (paused, mischief) = effects.settings();
        if valid
            && retaliate
            && !paused
            && mischief > 0
            && effects.visible()
            && !self.targeting.is_active()
        {
            let duration = Duration::from_secs(10);
            let id = self
                .cursor
                .arm_reaction(effects.now(), duration, tug && mischief == 2);
            effects.schedule(Deadline::Cursor(id), duration);
            Some(id)
        } else {
            self.cancel_cursor(effects);
            None
        }
    }

    fn cancel_cursor(&mut self, effects: &impl Effects) {
        self.cursor.cancel();
        if !self.targeting.is_active() && !self.pickup.active(effects.now()) {
            effects.release_escape();
        }
    }

    fn release_cursor(&mut self, effects: &impl Effects, id: u64) {
        if self.cursor.id == id {
            self.cancel_cursor(effects);
        }
    }

    fn tug_cursor(&mut self, effects: &impl Effects, id: u64, point: Point) -> bool {
        if self.cursor.id != id {
            return false;
        }
        let attempt = |input: &mut Self| -> Result<(), String> {
            if !effects.visible() || input.targeting.is_active() || effects.settings().0 {
                return Err("Encounter ended".into());
            }
            let (size, scale) = effects.geometry()?;
            if !targeting::valid_point(point.x, point.y, size, scale) {
                return Err("Outside display".into());
            }
            let first = !input.cursor.holding();
            if first {
                let cursor = effects.pointer().ok_or("Pointer unavailable")?;
                if !cursor.inside || (cursor.x - point.x).hypot(cursor.y - point.y) >= 30.0 {
                    return Err("Pointer escaped".into());
                }
                effects.escape(true)?;
            }
            if !input.cursor.update(id, effects.now(), (point.x, point.y)) {
                return Err("Bite expired".into());
            }
            if first {
                effects.schedule(Deadline::Cursor(id), cursor_bite::HOLD);
            }
            effects.move_cursor(point)
        };
        if attempt(self).is_err() {
            self.cancel_cursor(effects);
            false
        } else {
            true
        }
    }

    fn end_target(&mut self, effects: &impl Effects, completed: bool) {
        self.pickup.cancel();
        self.interaction = interaction::Interaction::default();
        let purpose = self.targeting.finish();
        self.cancel_cursor(effects);
        if effects.window_exists() {
            if let Err(error) = effects.capture(false) {
                effects.emergency_hide(&error);
            }
            let _ = effects.focusable(false);
        }
        effects.release_escape();
        if let Some(purpose) = purpose {
            let action = if completed && purpose == Purpose::Tidy {
                "tidy_done"
            } else {
                "cancel_target"
            };
            let _ = effects.emit(action, None, None, None);
        }
    }

    fn cancel_target(&mut self, effects: &impl Effects) {
        self.end_target(effects, false);
    }
    fn finish_target(&mut self, effects: &impl Effects) {
        self.end_target(effects, true);
    }

    fn set_visible(&mut self, effects: &impl Effects, visible: bool) -> Result<(), String> {
        if !visible {
            self.cancel_target(effects);
        }
        effects.visibility(visible)
    }

    fn begin_target(&mut self, effects: &impl Effects, purpose: Purpose) -> Result<(), String> {
        self.cancel_target(effects);
        let result = (|| {
            effects.position_for_target(purpose)?;
            self.set_visible(effects, true)?;
            let generation = self.targeting.begin(purpose);
            if !effects.window_exists() {
                return Err("Pet window unavailable".into());
            }
            effects.escape(false)?;
            effects.focusable(true)?;
            effects.capture(true)?;
            effects.focus()?;
            effects.emit("target", None, Some(purpose), None)?;
            effects.schedule(Deadline::Target(generation), purpose.timeout());
            Ok(())
        })();
        if result.is_err() {
            self.cancel_target(effects);
        }
        result
    }

    fn target_picked(&mut self, effects: &impl Effects, point: Point) -> Result<(), String> {
        let result = (|| {
            let purpose = self.targeting.purpose().ok_or("Targeting has ended")?;
            let (size, scale) = effects.geometry()?;
            if !targeting::valid_point(point.x, point.y, size, scale) {
                return Err("Target outside screen".into());
            }
            if purpose != Purpose::Tidy {
                self.cancel_target(effects);
            }
            effects.emit(purpose.pick_action(), Some(point), None, None)
        })();
        if result.is_err() {
            self.cancel_target(effects);
        }
        result
    }

    fn eat_cursor(&mut self, effects: &impl Effects) -> Result<(), String> {
        self.cancel_target(effects);
        effects.position_for_cursor()?;
        self.set_visible(effects, true)?;
        let id = self.cursor.arm(effects.now());
        effects.schedule(Deadline::Cursor(id), cursor_bite::ENCOUNTER);
        effects.emit("eat_cursor", None, None, Some(id))
    }

    // Used for every replacement command and when pause/mischief changes.
    fn interrupt(&mut self, effects: &impl Effects) {
        self.pickup.cancel();
        self.reconcile(effects, None);
        self.cancel_cursor(effects);
    }

    fn escape(&mut self, effects: &impl Effects) -> Result<(), String> {
        if self.targeting.is_active() {
            self.finish_target(effects);
        } else if self.cursor.armed() || self.pickup.active(effects.now()) {
            self.interrupt(effects);
            self.cancel_target(effects);
            effects.emit("cancel", None, None, None)?;
        }
        Ok(())
    }

    fn expired(&mut self, effects: &impl Effects, deadline: Deadline) {
        match deadline {
            Deadline::Target(id) if self.targeting.is_current(id) => self.finish_target(effects),
            Deadline::Pickup(id) if self.pickup.id == id => {
                self.pickup.cancel();
                self.reconcile(effects, None);
                self.cancel_cursor(effects);
                let _ = effects.emit("cancel", None, None, None);
            }
            Deadline::Cursor(id) => self.release_cursor(effects, id),
            _ => {}
        }
    }

    fn watch(&mut self, effects: &impl Effects) {
        self.reconcile(effects, effects.pointer().as_ref());
    }
}
