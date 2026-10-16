use serde::Deserialize;
use std::time::{Duration, Instant};

#[derive(Clone, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
impl Rect {
    pub fn valid(&self) -> bool {
        if ![self.x, self.y, self.width, self.height]
            .iter()
            .all(|v| v.is_finite())
        {
            return false;
        }
        if self.width <= 0.0 || self.width > 160.0 {
            return false;
        }
        self.height > 0.0 && self.height <= 160.0
    }
    fn contains(&self, x: f64, y: f64) -> bool {
        let within_width = x >= self.x && x <= self.x + self.width;
        let within_height = y >= self.y && y <= self.y + self.height;
        within_width && within_height
    }
}
#[derive(Default)]
pub struct Interaction {
    pub rects: Vec<Rect>,
    pub refreshed: Option<Instant>,
    pub capturing: bool,
}
impl Interaction {
    pub fn hit(&self, point: Option<(f64, f64)>, now: Instant) -> bool {
        self.refreshed
            .is_some_and(|at| now.duration_since(at) < Duration::from_millis(350))
            && point.is_some_and(|(x, y)| self.rects.iter().any(|rect| rect.contains(x, y)))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn capture_is_local_and_expires_without_frontend_heartbeat() {
        let now = Instant::now();
        let state = Interaction {
            rects: vec![Rect {
                x: 10.0,
                y: 20.0,
                width: 40.0,
                height: 30.0,
            }],
            refreshed: Some(now),
            capturing: false,
        };
        assert!(state.hit(Some((25.0, 25.0)), now));
        assert!(!state.hit(Some((0.0, 0.0)), now));
        assert!(!state.hit(None, now));
        assert!(!state.hit(Some((25.0, 25.0)), now + Duration::from_millis(350)));
    }
    #[test]
    fn oversized_or_invalid_capture_rectangles_are_rejected() {
        for (width, height) in [(f64::NAN, 40.0), (0.0, 40.0), (1920.0, 1080.0), (-1.0, 5.0)] {
            assert!(!Rect {
                x: 0.0,
                y: 0.0,
                width,
                height
            }
            .valid());
        }
    }
}

pub const PICKUP_LIMIT: Duration = Duration::from_secs(30);
#[derive(Default)]
pub struct PickupLease {
    pub id: u64,
    started: Option<Instant>,
    refreshed: Option<Instant>,
}
impl PickupLease {
    pub fn cancel(&mut self) {
        self.id += 1;
        self.started = None;
        self.refreshed = None;
    }
    pub fn begin(&mut self, now: Instant) -> u64 {
        self.cancel();
        self.started = Some(now);
        self.refreshed = Some(now);
        self.id
    }
    pub fn active(&self, now: Instant) -> bool {
        self.started
            .is_some_and(|at| now.duration_since(at) < PICKUP_LIMIT)
            && self
                .refreshed
                .is_some_and(|at| now.duration_since(at) < Duration::from_millis(350))
    }
    pub fn refresh(&mut self, id: u64, now: Instant) -> bool {
        if id != self.id {
            return false;
        }
        if !self.active(now) {
            return false;
        }
        self.refreshed = Some(now);
        true
    }
    pub fn finish(&mut self, id: u64, now: Instant) -> bool {
        if id != self.id {
            return false;
        }
        let valid = self.active(now);
        self.cancel();
        valid
    }
}
#[cfg(test)]
mod pickup_tests {
    use super::*;
    #[test]
    fn heartbeat_cannot_revive_expired_or_extend_total_capture() {
        let now = Instant::now();
        let mut lease = PickupLease::default();
        let id = lease.begin(now);
        assert!(!lease.refresh(id, now + Duration::from_millis(350)));
        assert!(!lease.refresh(id, now + Duration::from_millis(351)));
        let id = lease.begin(now);
        for i in 1..300 {
            assert!(lease.refresh(id, now + Duration::from_millis(i * 100)));
        }
        assert!(!lease.refresh(id, now + PICKUP_LIMIT));
    }
    #[test]
    fn old_release_cannot_cancel_new_drag() {
        let now = Instant::now();
        let mut lease = PickupLease::default();
        let old = lease.begin(now);
        let new = lease.begin(now);
        assert!(!lease.finish(old, now));
        assert!(lease.active(now));
        assert!(lease.finish(new, now));
        assert!(!lease.active(now));
    }
}
