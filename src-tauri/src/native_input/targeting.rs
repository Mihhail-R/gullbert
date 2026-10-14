use std::time::Duration;

pub fn valid_point(x: f64, y: f64, size: (u32, u32), scale: f64) -> bool {
    x.is_finite()
        && y.is_finite()
        && scale.is_finite()
        && scale > 0.0
        && x >= 0.0
        && y >= 0.0
        && x < f64::from(size.0) / scale
        && y < f64::from(size.1) / scale
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Purpose {
    Placement(&'static str),
    Tidy,
}

impl Purpose {
    pub fn name(self) -> &'static str {
        match self {
            Self::Placement(name) => name,
            Self::Tidy => "tidy",
        }
    }

    pub fn timeout(self) -> Duration {
        Duration::from_secs(if self == Self::Tidy { 30 } else { 12 })
    }

    pub fn pick_action(self) -> &'static str {
        if self == Self::Tidy {
            "tidy_pick"
        } else {
            self.name()
        }
    }
}

// The native capture lease is independent of webview timers. Clicks never
// renew it, and a callback from an older lease cannot finish a newer session.
#[derive(Default)]
pub struct Targeting {
    purpose: Option<Purpose>,
    generation: u64,
}

impl Targeting {
    pub fn purpose(&self) -> Option<Purpose> {
        self.purpose
    }

    pub fn is_active(&self) -> bool {
        self.purpose.is_some()
    }

    pub fn begin(&mut self, purpose: Purpose) -> u64 {
        self.generation = self.generation.wrapping_add(1);
        self.purpose = Some(purpose);
        self.generation
    }

    pub fn is_current(&self, generation: u64) -> bool {
        self.is_active() && generation == self.generation
    }

    pub fn finish(&mut self) -> Option<Purpose> {
        self.generation = self.generation.wrapping_add(1);
        self.purpose.take()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn click_coordinates_are_local_logical_pixels_with_exclusive_screen_edges() {
        assert!(valid_point(1919.0, 1079.0, (3840, 2160), 2.0));
        assert!(valid_point(0.0, 0.0, (2400, 1500), 1.25));
        for point in [(-1.0, 0.0), (1920.0, 0.0), (0.0, 1080.0), (f64::NAN, 0.0)] {
            assert!(!valid_point(point.0, point.1, (3840, 2160), 2.0));
        }
        for scale in [0.0, -1.0, f64::INFINITY, f64::NAN] {
            assert!(!valid_point(0.0, 0.0, (3840, 2160), scale));
        }
        assert!(!valid_point(0.0, 0.0, (0, 0), 1.0));
    }

    #[test]
    fn ordinary_placement_and_tidy_have_separate_fixed_deadlines() {
        assert_eq!(
            Purpose::Placement("poop").timeout(),
            Duration::from_secs(12)
        );
        assert_eq!(Purpose::Tidy.timeout(), Duration::from_secs(30));
    }

    #[test]
    fn repeated_tidy_picks_keep_the_same_capture_lease() {
        let mut session = Targeting::default();
        let generation = session.begin(Purpose::Tidy);
        for _ in 0..5 {
            assert_eq!(session.purpose().unwrap().pick_action(), "tidy_pick");
            assert!(session.is_current(generation));
        }
        assert_eq!(session.finish(), Some(Purpose::Tidy));
        assert!(!session.is_active());
        assert!(!session.is_current(generation));
    }

    #[test]
    fn cancelled_and_replaced_sessions_invalidate_old_timeouts() {
        let mut session = Targeting::default();
        let first = session.begin(Purpose::Tidy);
        session.finish();
        let second = session.begin(Purpose::Placement("place_perch"));
        assert!(!session.is_current(first));
        assert!(session.is_current(second));
        assert_eq!(session.purpose().unwrap().pick_action(), "place_perch");
        session.finish();
        assert!(!session.is_current(second));
    }
}
