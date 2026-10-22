use std::time::{Duration, Instant};

pub const HOLD: Duration = Duration::from_millis(1200);
pub const REVENGE_HOLD: Duration = Duration::from_millis(2000);
pub const ENCOUNTER: Duration = Duration::from_secs(8);

// A one-shot authorization from Eat cursor or a completed Public enemy pickup. Renderer
// updates cannot extend it, reopen it, or move the pointer across the desktop.
#[derive(Default)]
pub struct CursorBite {
    pub id: u64,
    armed: Option<Instant>,
    encounter: Duration,
    hold: Duration,
    movable: bool,
    caught: Option<(Instant, (f64, f64))>,
}
impl CursorBite {
    pub fn cancel(&mut self) {
        self.id += 1;
        self.armed = None;
        self.caught = None;
    }
    pub fn arm(&mut self, now: Instant) -> u64 {
        let id = self.arm_reaction(now, ENCOUNTER, true);
        self.hold = HOLD;
        id
    }
    pub fn arm_reaction(&mut self, now: Instant, encounter: Duration, movable: bool) -> u64 {
        self.cancel();
        self.movable = movable;
        self.encounter = encounter;
        self.hold = REVENGE_HOLD;
        self.armed = Some(now);
        self.id
    }
    pub fn armed(&self) -> bool {
        self.armed.is_some()
    }
    pub fn hold_duration(&self) -> Duration {
        self.hold
    }
    pub fn holding(&self) -> bool {
        self.caught.is_some()
    }
    pub fn update(&mut self, id: u64, now: Instant, point: (f64, f64)) -> bool {
        if !self.movable || id != self.id {
            return false;
        }

        if !point.0.is_finite() || !point.1.is_finite() {
            return false;
        }

        let Some(armed) = self.armed else {
            return false;
        };

        if now.duration_since(armed) >= self.encounter {
            self.cancel();
            return false;
        }

        let (started, origin) = *self.caught.get_or_insert((now, point));
        if now.duration_since(started) >= self.hold
            || (point.0 - origin.0).hypot(point.1 - origin.1) > 80.0
        {
            self.cancel();
            return false;
        }

        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn non_cursor_revenge_keeps_escape_without_authorizing_movement() {
        let now = Instant::now();
        let mut bite = CursorBite::default();
        let id = bite.arm_reaction(now, Duration::from_secs(10), false);
        assert!(bite.armed());
        assert!(!bite.update(id, now, (10.0, 10.0)));
        bite.cancel();
        assert!(!bite.armed());
    }
    #[test]
    fn cannot_start_without_explicit_command_or_reuse_a_cancelled_id() {
        let now = Instant::now();
        let mut bite = CursorBite::default();
        assert!(!bite.update(0, now, (0.0, 0.0)));
        let id = bite.arm(now);
        bite.cancel();
        assert!(!bite.update(id, now, (0.0, 0.0)));
        let next = bite.arm(now);
        assert!(!bite.update(id, now, (0.0, 0.0)));
        assert!(bite.update(next, now, (0.0, 0.0)));
    }
    #[test]
    fn updates_never_extend_the_wall_clock_limit() {
        let now = Instant::now();
        let mut bite = CursorBite::default();
        let id = bite.arm(now);
        assert!(bite.update(id, now, (100.0, 100.0)));
        assert!(bite.update(id, now + HOLD / 2, (120.0, 100.0)));
        assert!(!bite.update(id, now + HOLD, (130.0, 100.0)));
        assert!(!bite.update(id, now + HOLD, (100.0, 100.0)));
    }
    #[test]
    fn stale_encounters_and_large_or_invalid_moves_are_rejected() {
        let now = Instant::now();
        let mut bite = CursorBite::default();
        let id = bite.arm(now);
        assert!(!bite.update(id, now + ENCOUNTER, (0.0, 0.0)));
        let id = bite.arm(now);
        assert!(!bite.update(id, now, (f64::NAN, 0.0)));
        assert!(bite.update(id, now, (100.0, 100.0)));
        assert!(!bite.update(id, now, (181.0, 100.0)));
        assert!(!bite.update(id, now, (100.0, 100.0)));
    }
}
