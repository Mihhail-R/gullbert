//! Explicit, debug-only compatibility experiment. No renderer or autonomous entry point.
use std::{
    ffi::c_void,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut};

#[derive(Clone, Copy, Debug, Default, PartialEq)]
#[repr(C)]
struct Frame {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
impl Frame {
    fn valid(self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|n| n.is_finite())
            && self.width > 0.0
            && self.height > 0.0
    }
    fn matches(self, other: Self) -> bool {
        [
            self.x - other.x,
            self.y - other.y,
            self.width - other.width,
            self.height - other.height,
        ]
        .iter()
        .all(|n| n.abs() <= 1.0)
    }
    fn contains(self, other: Self, margin: f64) -> bool {
        other.valid()
            && other.x >= self.x + margin
            && other.y >= self.y + margin
            && other.x + other.width <= self.x + self.width - margin
            && other.y + other.height <= self.y + self.height - margin
    }
}
unsafe extern "C" {
    fn gsp_frontmost() -> i32;
    fn gsp_areas(areas: *mut Frame, capacity: i32) -> i32;
    fn gsp_buttons() -> bool;
    fn gsp_trusted() -> bool;
    fn gsp_select(pid: i32) -> *mut c_void;
    fn gsp_release(window: *mut c_void);
    fn gsp_frame(window: *mut c_void, frame: *mut Frame) -> i32;
    fn gsp_write(window: *mut c_void, frame: Frame, resize: bool) -> i32;
    fn gsp_observe(cancel: extern "C" fn());
}
struct Window(*mut c_void);
impl Drop for Window {
    fn drop(&mut self) {
        unsafe { gsp_release(self.0) };
    }
}
trait Target {
    fn wait(&self, duration: Duration);
    fn now(&self) -> Instant;
    fn buttons(&self) -> bool;
    fn frame(&self) -> Result<Frame, String>;
    fn write(&self, frame: Frame, resize: bool) -> Result<(), String>;
}
impl Target for Window {
    fn wait(&self, duration: Duration) {
        std::thread::sleep(duration);
    }
    fn now(&self) -> Instant {
        Instant::now()
    }
    fn buttons(&self) -> bool {
        unsafe { gsp_buttons() }
    }
    fn frame(&self) -> Result<Frame, String> {
        let mut frame = Frame::default();
        if unsafe { gsp_frame(self.0, &mut frame) } == 0 && frame.valid() {
            Ok(frame)
        } else {
            Err("frame unavailable (closed window, permission loss, or AX failure)".into())
        }
    }
    fn write(&self, frame: Frame, resize: bool) -> Result<(), String> {
        let began = Instant::now();
        let code = unsafe { gsp_write(self.0, frame, resize) };
        eprintln!(
            "Window spike: write resize={resize} latency={:?} AX={code}",
            began.elapsed()
        );
        if code == 0 {
            Ok(())
        } else {
            Err(format!("AX write error {code}"))
        }
    }
}
struct Control {
    cancelled: Option<Instant>,
    cleanup_deadline: Option<Instant>,
    user: bool,
    areas: Vec<Frame>,
    refreshed: Instant,
    deadline: Instant,
    quit: bool,
}
impl Control {
    fn cleanup_expired(&self, now: Instant) -> bool {
        self.cleanup_deadline.is_some_and(|until| now >= until)
            || self
                .cancelled
                .is_some_and(|at| now.saturating_duration_since(at) >= Duration::from_secs(1))
    }

    fn cancel(&mut self, user: bool, now: Instant) {
        self.cancelled.get_or_insert(now);
        self.user |= user;
    }
    fn forward(&mut self, now: Instant) -> Result<(), String> {
        if now >= self.deadline
            || now.saturating_duration_since(self.refreshed) > Duration::from_millis(250)
        {
            self.cancel(false, now);
        }
        if self.cancelled.is_some() {
            Err("cancelled".into())
        } else {
            Ok(())
        }
    }
    fn restore(&self, original: Frame, until: Instant, now: Instant) -> Result<(), String> {
        if now >= until {
            return Err("restore_failed: deadline".into());
        }
        if self.user {
            return Err("yielded_to_user".into());
        }
        if !self.areas.iter().any(|area| area.contains(original, 0.0))
            || now.saturating_duration_since(self.refreshed) > Duration::from_millis(250)
        {
            return Err("restore_failed: display geometry unavailable".into());
        }
        Ok(())
    }
}
type Shared = Arc<Mutex<Control>>;
static ACTIVE: Mutex<Option<Shared>> = Mutex::new(None);
pub(crate) fn trusted() -> bool {
    unsafe { gsp_trusted() }
}
pub(crate) fn active() -> bool {
    ACTIVE.lock().unwrap().is_some()
}
pub(crate) fn cancel() {
    if let Some(control) = ACTIVE.lock().unwrap().as_ref() {
        control.lock().unwrap().cancel(false, Instant::now());
    }
}
extern "C" fn session_inactive() {
    cancel();
}
pub(crate) fn quit() -> bool {
    if let Some(control) = ACTIVE.lock().unwrap().as_ref() {
        let mut state = control.lock().unwrap();
        state.cancel(false, Instant::now());
        state.quit = true;
        state
            .cancelled
            .is_some_and(|at| at.elapsed() < Duration::from_secs(1))
    } else {
        false
    }
}
fn areas() -> Vec<Frame> {
    let mut frames = [Frame::default(); 32];
    let count = unsafe { gsp_areas(frames.as_mut_ptr(), 32) };
    frames[..count.max(0) as usize].to_vec()
}
fn gate(control: &Shared, buttons: bool, now: Instant) -> Result<(), String> {
    let mut state = control.lock().unwrap();
    if buttons {
        state.cancel(true, now);
    }
    state.forward(now)
}
// The pending requested frame remains available even if the OS reports failure.
// No lock is held during AX. Cancellation during a write always reaches cleanup.
fn antic(
    target: &impl Target,
    control: &Shared,
    original: Frame,
    resize: bool,
    hold: Duration,
) -> Result<(), String> {
    gate(control, target.buttons(), target.now())?;
    if !target.frame()?.matches(original) {
        return Err("yielded_to_user".into());
    }
    let mut requested = original;
    if resize {
        requested.width -= 16.0;
        requested.height -= 16.0;
    } else {
        requested.x += 16.0;
        requested.y += 16.0;
    }
    gate(control, target.buttons(), target.now())?;
    let forward = (|| {
        target.write(requested, resize)?;
        if !target.frame()?.matches(requested) {
            return Err("clamped or shifted readback".into());
        }
        let until = target.now() + hold;
        while target.now() < until {
            gate(control, target.buttons(), target.now())?;
            target.wait(Duration::from_millis(20));
        }
        Ok::<_, String>(())
    })();
    let until = {
        let mut state = control.lock().unwrap();
        let until = state.cancelled.unwrap_or_else(|| target.now()) + Duration::from_secs(1);
        state.cleanup_deadline = Some(until);
        until
    };
    let restore_gate = || {
        let buttons = target.buttons();
        let now = target.now();
        let mut state = control.lock().unwrap();
        if buttons {
            state.cancel(true, now);
        }
        state.restore(original, until, now)
    };
    restore_gate()?;
    let current = target.frame().map_err(|e| format!("restore_failed: {e}"))?;
    if !current.matches(original) && !current.matches(requested) {
        return Err("yielded_to_user: unexpected frame".into());
    }
    if !current.matches(original) {
        restore_gate()?;
        // One operation per antic; do not fight a user or retry an uncertain write.
        let write_result = target.write(original, resize);
        let actual = target.frame().map_err(|e| format!("restore_failed: {e}"))?;
        if !actual.matches(original) {
            return Err(format!(
                "restore_failed: {write_result:?}, readback={actual:?}"
            ));
        }
    }
    // AppKit can acknowledge the destination before its animation has settled.
    // Do not let a subsequent resize interrupt a still-running position restore.
    let settled_at = target.now() + Duration::from_millis(200);
    loop {
        restore_gate()?;
        if !target
            .frame()
            .map_err(|e| format!("restore_failed: {e}"))?
            .matches(original)
        {
            return Err("restore_failed: frame changed during settling".into());
        }
        if target.now() >= settled_at {
            break;
        }
        target.wait(Duration::from_millis(20));
    }
    if target.now() >= until {
        return Err("restore_failed: late readback".into());
    }
    control.lock().unwrap().cleanup_deadline = None;
    eprintln!("Window spike: restored resize={resize} original={original:?}");
    forward
}
pub(crate) fn start(app: &tauri::AppHandle, mutate: bool) -> Result<(), String> {
    if active() {
        return Err("Window spike is still cleaning up".into());
    }
    if !trusted() {
        return Err("Window spike: Gullbert lacks Accessibility permission".into());
    }
    let pid = unsafe { gsp_frontmost() };
    if pid == 0 {
        return Err("Focus an ordinary external application first".into());
    }
    let initial = areas();
    let shortcut = Shortcut::new(None, Code::Escape);
    app.global_shortcut()
        .register(shortcut)
        .map_err(|e| e.to_string())?;
    static OBSERVERS: OnceLock<()> = OnceLock::new();
    OBSERVERS.get_or_init(|| unsafe { gsp_observe(session_inactive) });
    let control = Arc::new(Mutex::new(Control {
        cancelled: None,
        cleanup_deadline: None,
        user: false,
        areas: initial.clone(),
        refreshed: Instant::now(),
        deadline: Instant::now() + Duration::from_secs(5),
        quit: false,
    }));
    *ACTIVE.lock().unwrap() = Some(control.clone());
    let handle = app.clone();
    let watch = control.clone();
    // Independent of AX: samples physical input and queues at most one main-thread refresh.
    std::thread::spawn(move || {
        let mut reported_timeout = false;
        while ACTIVE
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, &watch))
        {
            if unsafe { gsp_buttons() } {
                watch.lock().unwrap().cancel(true, Instant::now());
            }
            let (send, receive) = std::sync::mpsc::channel();
            let state = watch.clone();
            let initial = initial.clone();
            if super::dispatch(&handle, move |_| {
                let current = areas();
                let mut state = state.lock().unwrap();
                if current != initial {
                    state.cancel(false, Instant::now());
                }
                state.areas = current;
                state.refreshed = Instant::now();
                let _ = send.send(());
            })
            .is_err()
            {
                watch.lock().unwrap().cancel(false, Instant::now());
                break;
            }
            loop {
                match receive.recv_timeout(Duration::from_millis(50)) {
                    Ok(()) => break,
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                        watch.lock().unwrap().cancel(false, Instant::now());
                        return;
                    }
                    Err(_) => {
                        let _ = watch.lock().unwrap().forward(Instant::now());
                    }
                }
            }
            let (overdue, quit) = {
                let mut state = watch.lock().unwrap();
                let _ = state.forward(Instant::now());
                (state.cleanup_expired(Instant::now()), state.quit)
            };
            if overdue && !reported_timeout {
                reported_timeout = true;
                eprintln!("Window spike: restore_failed: cleanup budget expired; worker quarantined until return");
            }
            if overdue && quit {
                let _ = super::dispatch(&handle, |app| app.exit(0));
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    });
    let handle = app.clone();
    std::thread::spawn(move || {
        let result = (|| {
            gate(&control, unsafe { gsp_buttons() }, Instant::now())?;
            let raw = unsafe { gsp_select(pid) };
            if raw.is_null() {
                return Err("ineligible or unavailable focused window".into());
            }
            let target = Window(raw);
            gate(&control, unsafe { gsp_buttons() }, Instant::now())?;
            let original = target.frame()?;
            eprintln!("Window spike: candidate pid={pid} frame={original:?}");
            if original.width < 400.0
                || original.height < 280.0
                || !control
                    .lock()
                    .unwrap()
                    .areas
                    .iter()
                    .any(|area| area.contains(original, 24.0))
            {
                return Err("window too small, near work-area edge, tiled, or ambiguous".into());
            }
            eprintln!("Window spike: eligible pid={pid} frame={original:?} mutate={mutate}");
            if mutate {
                for resize in [false, true] {
                    antic(
                        &target,
                        &control,
                        original,
                        resize,
                        Duration::from_millis(600),
                    )?;
                }
            }
            Ok::<_, String>(())
        })();
        eprintln!("Window spike: finished {result:?}");
        let _ = super::dispatch(&handle, move |app| {
            let quit = control.lock().unwrap().quit;
            *ACTIVE.lock().unwrap() = None;
            // Reconcile Escape with any ordinary lease acquired during cleanup.
            super::desktop::finish_window_spike(app);
            if quit {
                app.exit(0);
            }
        });
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    struct RecordingTarget {
        now: Cell<Instant>,
        late_frame: Cell<Option<Frame>>,
        frame: Cell<Frame>,
        writes: RefCell<Vec<Frame>>,
        after_first: Box<dyn Fn(&Cell<Frame>)>,
        ambiguous: bool,
    }
    impl Target for RecordingTarget {
        fn wait(&self, duration: Duration) {
            self.now.set(self.now.get() + duration);
            if self.writes.borrow().len() >= 2 {
                if let Some(frame) = self.late_frame.take() {
                    self.frame.set(frame);
                }
            }
        }
        fn now(&self) -> Instant {
            self.now.get()
        }
        fn buttons(&self) -> bool {
            false
        }
        fn frame(&self) -> Result<Frame, String> {
            Ok(self.frame.get())
        }
        fn write(&self, frame: Frame, _: bool) -> Result<(), String> {
            self.frame.set(frame);
            self.writes.borrow_mut().push(frame);
            if self.writes.borrow().len() == 1 {
                (self.after_first)(&self.frame);
                if self.ambiguous {
                    return Err("timeout after mutation".into());
                }
            }
            Ok(())
        }
    }
    fn setup() -> (Shared, RecordingTarget, Frame) {
        let original = Frame {
            x: 100.0,
            y: 100.0,
            width: 600.0,
            height: 400.0,
        };
        let control = Arc::new(Mutex::new(Control {
            cancelled: None,
            cleanup_deadline: None,
            user: false,
            areas: vec![Frame {
                x: 0.0,
                y: 0.0,
                width: 1600.0,
                height: 1000.0,
            }],
            refreshed: Instant::now(),
            deadline: Instant::now() + Duration::from_secs(5),
            quit: false,
        }));
        let target = RecordingTarget {
            now: Cell::new(control.lock().unwrap().refreshed),
            late_frame: Cell::new(None),
            frame: Cell::new(original),
            writes: RefCell::new(vec![]),
            after_first: Box::new(|_| {}),
            ambiguous: false,
        };
        (control, target, original)
    }
    #[test]
    fn each_antic_restores_before_the_next_starts() {
        let (control, target, original) = setup();
        antic(&target, &control, original, false, Duration::ZERO).unwrap();
        control.lock().unwrap().refreshed = target.now();
        antic(&target, &control, original, true, Duration::ZERO).unwrap();
        assert_eq!(target.writes.borrow().len(), 4);
        assert_eq!(target.writes.borrow()[1], original);
        assert_eq!(target.writes.borrow()[3], original);
    }
    #[test]
    fn cancellation_during_ambiguous_write_still_restores() {
        let (control, mut target, original) = setup();
        let cancel = control.clone();
        target.after_first = Box::new(move |_| {
            let mut state = cancel.lock().unwrap();
            let now = state.refreshed;
            state.cancel(false, now);
        });
        target.ambiguous = true;
        assert!(antic(&target, &control, original, false, Duration::ZERO).is_err());
        assert_eq!(target.frame.get(), original);
        assert_eq!(target.writes.borrow().len(), 2);
        assert!(antic(&target, &control, original, true, Duration::ZERO).is_err());
        assert_eq!(target.writes.borrow().len(), 2);
    }
    #[test]
    fn user_takeover_prevents_restoration() {
        let (control, mut target, original) = setup();
        let cancel = control.clone();
        target.after_first = Box::new(move |_| {
            let mut state = cancel.lock().unwrap();
            let now = state.refreshed;
            state.cancel(true, now);
        });
        assert_eq!(
            antic(&target, &control, original, false, Duration::ZERO).unwrap_err(),
            "yielded_to_user"
        );
        assert_eq!(target.writes.borrow().len(), 1);
    }
    #[test]
    fn unexpected_frame_is_never_overwritten() {
        let (control, mut target, original) = setup();
        target.after_first = Box::new(|frame| {
            let mut changed = frame.get();
            changed.x += 100.0;
            frame.set(changed);
        });
        assert!(antic(&target, &control, original, true, Duration::ZERO)
            .unwrap_err()
            .contains("yielded_to_user"));
        assert_eq!(target.writes.borrow().len(), 1);
    }
    #[test]
    fn late_completion_cannot_restore_after_cleanup_budget() {
        let (control, mut target, original) = setup();
        let cancel = control.clone();
        target.after_first = Box::new(move |_| {
            let mut state = cancel.lock().unwrap();
            state.cancelled = Some(state.refreshed - Duration::from_secs(2));
        });
        assert!(antic(&target, &control, original, false, Duration::ZERO)
            .unwrap_err()
            .contains("deadline"));
        assert_eq!(target.writes.borrow().len(), 1);
    }
    #[test]
    fn normal_cleanup_deadline_is_visible_to_watchdog() {
        let (control, target, _) = setup();
        let mut state = control.lock().unwrap();
        state.cleanup_deadline = Some(target.now() + Duration::from_secs(1));
        assert!(!state.cleanup_expired(target.now() + Duration::from_millis(999)));
        assert!(state.cleanup_expired(target.now() + Duration::from_secs(1)));
        assert!(state.cancelled.is_none());
    }
    #[test]
    fn delayed_frame_change_prevents_false_restoration_success() {
        let (control, target, original) = setup();
        target.late_frame.set(Some(Frame {
            x: 116.0,
            ..original
        }));
        assert!(antic(&target, &control, original, false, Duration::ZERO)
            .unwrap_err()
            .contains("settling"));
        assert_eq!(target.writes.borrow().len(), 2);
    }
    #[test]
    fn main_thread_stall_prevents_any_mutation() {
        let (control, target, original) = setup();
        control.lock().unwrap().refreshed = target.now() - Duration::from_secs(1);
        assert!(antic(&target, &control, original, false, Duration::ZERO).is_err());
        assert!(target.writes.borrow().is_empty());
    }
}
