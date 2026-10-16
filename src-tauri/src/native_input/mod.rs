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
    begin_target, dispatch, eat_cursor, escape, interrupt, ready, replace_target, request,
    set_visible, Runtime,
};
pub(crate) use interaction::Rect;
pub(crate) use targeting::Purpose;

use crate::windows::{CursorPoint, Point};
use std::time::{Duration, Instant};
use targeting::Notice;

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
        cursor_id: Option<u64>,
    ) -> Result<(), String>;
    fn target_notice(&self, notice: Notice) -> Result<(), String>;
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
        self.replace_target(effects);
        effects.position_for_cursor()?;
        effects.capture(false)?;
        effects.all_workspaces()?;
        self.set_visible(effects, true)
    }

    fn reconcile(&mut self, effects: &impl Effects, point: Option<&CursorPoint>) {
        if self.targeting.is_active() {
            return;
        }
        let mut capture = false;
        if effects.visible() && !self.cursor.holding() {
            capture = self.pickup.active(effects.now())
                || self.interaction.hit(
                    point.filter(|p| p.inside).map(|p| (p.x, p.y)),
                    effects.now(),
                );
        }
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
        if !valid || !retaliate {
            self.cancel_cursor(effects);
            return None;
        }
        if paused || mischief == 0 {
            self.cancel_cursor(effects);
            return None;
        }
        if !effects.visible() || self.targeting.is_active() {
            self.cancel_cursor(effects);
            return None;
        }
        let duration = Duration::from_secs(10);
        let id = self
            .cursor
            .arm_reaction(effects.now(), duration, tug && mischief == 2);
        effects.schedule(Deadline::Cursor(id), duration);
        Some(id)
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

    // Clear ownership before OS effects or delivery. A failed successful-selection
    // delivery still has its captured id available for an explicit abandonment.
    fn release_target(&mut self, effects: &impl Effects) -> Option<(u64, Purpose)> {
        let id = self.targeting.id();
        let purpose = self.targeting.finish()?;
        self.pickup.cancel();
        self.interaction = interaction::Interaction::default();
        self.cancel_cursor(effects);
        if effects.window_exists() {
            if let Err(error) = effects.capture(false) {
                effects.emergency_hide(&error);
            }
            let _ = effects.focusable(false);
        }
        effects.release_escape();
        Some((id, purpose))
    }

    fn replace_target(&mut self, effects: &impl Effects) {
        if let Some((id, _)) = self.release_target(effects) {
            let _ = effects.target_notice(Notice::Replaced { id });
        }
    }
    fn abandon_target(&mut self, effects: &impl Effects) {
        if let Some((id, _)) = self.release_target(effects) {
            let _ = effects.target_notice(Notice::Abandoned { id });
        }
    }
    fn finish_target(&mut self, effects: &impl Effects) {
        if let Some((id, purpose)) = self.release_target(effects) {
            let notice = if purpose == Purpose::Tidy {
                Notice::FinishedTidying { id }
            } else {
                Notice::Abandoned { id }
            };
            let _ = effects.target_notice(notice);
        }
    }
    fn finish_target_id(&mut self, effects: &impl Effects, id: Option<u64>) {
        if id.is_none_or(|id| self.targeting.is_current(id)) {
            self.finish_target(effects);
        }
    }

    fn set_visible(&mut self, effects: &impl Effects, visible: bool) -> Result<(), String> {
        if !visible {
            self.replace_target(effects);
        }
        effects.visibility(visible)
    }

    fn begin_target(
        &mut self,
        effects: &impl Effects,
        purpose: Purpose,
        preparation: &'static str,
    ) -> Result<(), String> {
        self.replace_target(effects);
        self.interrupt(effects);
        let id = self.targeting.begin(purpose);
        let start = Notice::Started {
            id,
            purpose: purpose.name(),
            preparation,
        };
        let mut announced = false;
        let result = (|| {
            effects.position_for_target(purpose)?;
            self.set_visible(effects, true)?;
            effects.target_notice(start.clone())?;
            announced = true;
            if !effects.window_exists() {
                return Err("Pet window unavailable".into());
            }
            effects.escape(false)?;
            effects.focusable(true)?;
            effects.capture(true)?;
            effects.focus()?;
            effects.schedule(Deadline::Target(id), purpose.timeout());
            Ok(())
        })();
        if result.is_err() {
            if !announced {
                // Even early acquisition failure must cancel this preparation.
                // Repeating Started is safe if an earlier emission was delivered.
                let _ = effects.target_notice(start);
            }
            self.abandon_target(effects);
        }
        result
    }

    fn target_picked(
        &mut self,
        effects: &impl Effects,
        id: u64,
        point: Point,
    ) -> Result<(), String> {
        if !self.targeting.is_current(id) {
            return Ok(());
        }
        let purpose = self.targeting.purpose().unwrap();
        let result = (|| {
            let (size, scale) = effects.geometry()?;
            if !targeting::valid_point(point.x, point.y, size, scale) {
                return Err("Target outside screen".into());
            }
            if purpose != Purpose::Tidy {
                self.release_target(effects);
            }
            effects.target_notice(Notice::Selected { id, point })
        })();
        if result.is_err() {
            self.release_target(effects);
            // The lease may already be released; do not infer the failed session
            // from current state. Already delivered effects cannot be rolled back.
            let _ = effects.target_notice(Notice::Abandoned { id });
        }
        result
    }

    fn eat_cursor(&mut self, effects: &impl Effects) -> Result<(), String> {
        self.replace_target(effects);
        effects.position_for_cursor()?;
        self.set_visible(effects, true)?;
        let id = self.cursor.arm(effects.now());
        effects.schedule(Deadline::Cursor(id), cursor_bite::ENCOUNTER);
        effects.emit("eat_cursor", None, Some(id))
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
            self.replace_target(effects);
            effects.emit("cancel", None, None)?;
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
                let _ = effects.emit("cancel", None, None);
            }
            Deadline::Cursor(id) => self.release_cursor(effects, id),
            _ => {}
        }
    }

    fn watch(&mut self, effects: &impl Effects) {
        self.reconcile(effects, effects.pointer().as_ref());
    }
}
