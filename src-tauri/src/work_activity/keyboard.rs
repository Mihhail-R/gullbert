//! Reduce Tao's shared Windows keyboard events to an ephemeral count and timestamp.
use std::time::{Duration, Instant};

const POLL_LEASE: Duration = Duration::from_millis(1500);

#[derive(Default)]
struct Counter {
    count: u32,
    last_press: Option<Instant>,
    lease_until: Option<Instant>,
}

impl Counter {
    fn active(&self, now: Instant) -> bool {
        self.lease_until.is_some_and(|deadline| now < deadline)
    }

    fn renew(&mut self, now: Instant) -> (bool, Option<(u32, f64)>) {
        let was_active = self.active(now);

        if !was_active {
            self.stop();
        }

        self.lease_until = Some(now + POLL_LEASE);
        let sample = self
            .last_press
            .map(|last_press| (self.count, now.duration_since(last_press).as_secs_f64()));
        (!was_active, sample)
    }

    fn press(&mut self, now: Instant) {
        if !self.active(now) {
            self.stop();
            return;
        }

        // Held-key repeats count as activity. We never retain key identities to deduplicate them.
        self.count = self.count.wrapping_add(1);
        self.last_press = Some(now);
    }

    fn expire(&mut self, now: Instant) -> bool {
        if self.active(now) {
            return false;
        }

        self.stop()
    }

    fn stop(&mut self) -> bool {
        let was_enabled = self.lease_until.is_some();
        *self = Self::default();
        was_enabled
    }
}

#[cfg(target_os = "windows")]
mod windows {
    use super::Counter;
    use crate::state::State;
    use std::sync::{atomic::Ordering, Arc, Mutex};
    use std::time::Instant;
    use tauri::{App, AppHandle, DeviceEventFilter, EventLoopMessage, Manager};
    use tauri_runtime_wry::tao::{
        event::{DeviceEvent, ElementState, Event},
        event_loop::{ControlFlow, EventLoopProxy, EventLoopWindowTarget},
    };
    use tauri_runtime_wry::{
        Context, EventLoopIterationContext, Message, Plugin, PluginBuilder, WebContextStore,
    };

    struct Activity(Arc<Mutex<Counter>>);

    struct Observer {
        app: AppHandle,
        counter: Arc<Mutex<Counter>>,
    }

    fn enabled(app: &AppHandle) -> bool {
        let state = app.state::<State>();

        if !state.visible.load(Ordering::SeqCst) {
            return false;
        }

        let settings = state.settings.lock().unwrap();
        !settings.paused && settings.mischief > 0
    }

    impl PluginBuilder<EventLoopMessage> for Observer {
        type Plugin = Self;

        fn build(self, _context: Context<EventLoopMessage>) -> Self {
            self
        }
    }

    impl Plugin<EventLoopMessage> for Observer {
        fn on_event(
            &mut self,
            event: &Event<Message<EventLoopMessage>>,
            _event_loop: &EventLoopWindowTarget<Message<EventLoopMessage>>,
            _proxy: &EventLoopProxy<Message<EventLoopMessage>>,
            _control_flow: &mut ControlFlow,
            _context: EventLoopIterationContext<'_, EventLoopMessage>,
            _web_context: &WebContextStore,
        ) -> bool {
            let now = Instant::now();
            let expired = self.counter.lock().unwrap().expire(now);

            if expired {
                self.app
                    .set_device_event_filter(DeviceEventFilter::Unfocused);
            }

            let Event::DeviceEvent {
                event: DeviceEvent::Key(key),
                ..
            } = event
            else {
                return false;
            };

            if key.state != ElementState::Pressed {
                return false;
            }

            if !enabled(&self.app) {
                stop(&self.app);
                return false;
            }

            // Inspect only the transition; no key, device, or text is copied into our state.
            self.counter.lock().unwrap().press(now);
            false
        }
    }

    pub(crate) fn install(app: &mut App) {
        let counter = Arc::new(Mutex::new(Counter::default()));
        app.manage(Activity(counter.clone()));
        app.wry_plugin(Observer {
            app: app.handle().clone(),
            counter,
        });
    }

    pub(crate) fn sample(app: &AppHandle) -> Option<(u32, f64)> {
        if !enabled(app) {
            stop(app);
            return None;
        }

        let activity = app.state::<Activity>();
        let (started, sample) = activity.0.lock().unwrap().renew(Instant::now());

        if started {
            // Tao owns registration for the process; reuse its receiver instead of replacing it.
            // Tao also delivers mouse events in this mode. This observer ignores them entirely.
            app.set_device_event_filter(DeviceEventFilter::Never);
        }

        sample
    }

    pub(crate) fn stop(app: &AppHandle) {
        let Some(activity) = app.try_state::<Activity>() else {
            return;
        };
        let stopped = activity.0.lock().unwrap().stop();

        if stopped {
            // Restore Tao's default: ordinary foreground events only.
            app.set_device_event_filter(DeviceEventFilter::Unfocused);
        }
    }
}

#[cfg(target_os = "windows")]
pub(crate) use windows::{install, sample, stop};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_only_during_a_live_poll_lease() {
        let now = Instant::now();
        let mut counter = Counter::default();
        counter.press(now);
        assert_eq!(counter.count, 0);
        assert_eq!(counter.renew(now), (true, None));

        counter.press(now + Duration::from_millis(100));
        counter.press(now + Duration::from_millis(200));
        let (started, sample) = counter.renew(now + Duration::from_millis(500));
        assert!(!started);
        assert_eq!(sample, Some((2, 0.3)));
    }

    #[test]
    fn stop_discards_counts_and_requires_fresh_activity() {
        let now = Instant::now();
        let mut counter = Counter::default();
        counter.renew(now);
        counter.press(now);
        assert!(counter.stop());
        assert!(!counter.stop());
        counter.press(now + Duration::from_millis(100));
        assert_eq!(
            counter.renew(now + Duration::from_millis(200)),
            (true, None)
        );
    }

    #[test]
    fn expired_lease_discards_stale_activity_before_resuming() {
        let now = Instant::now();
        let mut counter = Counter::default();
        counter.renew(now);
        counter.press(now);
        assert!(!counter.expire(now + Duration::from_millis(1499)));
        assert!(counter.expire(now + POLL_LEASE));
        assert!(!counter.expire(now + POLL_LEASE));
        assert_eq!(counter.renew(now + POLL_LEASE), (true, None));

        counter.press(now + POLL_LEASE);
        assert_eq!(counter.renew(now + POLL_LEASE * 2), (true, None));
    }

    #[test]
    fn delayed_event_cannot_revive_an_expired_lease() {
        let now = Instant::now();
        let mut counter = Counter::default();
        counter.renew(now);
        counter.press(now + POLL_LEASE);

        let resumed = now + POLL_LEASE + Duration::from_millis(1);
        assert_eq!(counter.renew(resumed), (true, None));
        counter.press(resumed);
        assert_eq!(counter.renew(resumed), (false, Some((1, 0.0))));
    }

    #[test]
    fn count_wraps_without_retaining_event_details() {
        let now = Instant::now();
        let mut counter = Counter {
            count: u32::MAX,
            last_press: Some(now),
            lease_until: Some(now + POLL_LEASE),
        };
        counter.press(now);
        assert_eq!(counter.renew(now), (false, Some((0, 0.0))));
    }
}
