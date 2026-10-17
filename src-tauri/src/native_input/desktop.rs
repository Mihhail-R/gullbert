use super::{queue::Queue, targeting::Notice, Deadline, Effects, Input, Purpose, Rect};
use crate::{
    actions::Message,
    state::State,
    windows::{self, pet, CursorPoint, Point},
};
use std::{
    sync::{atomic::Ordering, Mutex},
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut};

type Job = Box<dyn FnOnce(&tauri::AppHandle) + Send>;
pub(crate) struct Runtime {
    input: Mutex<Option<Input>>,
    queue: Queue<Job>,
}
impl Default for Runtime {
    fn default() -> Self {
        Self {
            input: Mutex::new(Some(Input::default())),
            queue: Queue::default(),
        }
    }
}

/// All mutating entry points, including native callbacks, enter this queue.
/// No mutex is held while executing a job or calling the OS.
pub(crate) fn dispatch(
    app: &tauri::AppHandle,
    job: impl FnOnce(&tauri::AppHandle) + Send + 'static,
) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let runtime = handle.state::<Runtime>();
        runtime.queue.run(Box::new(job), |job| job(&handle));
    })
    .map_err(|error| error.to_string())
}

/// IPC callers await their queued result instead of blocking the main thread.
pub(crate) async fn request<T: Send + 'static>(
    app: tauri::AppHandle,
    job: impl FnOnce(&tauri::AppHandle) -> T + Send + 'static,
) -> Result<T, String> {
    let (send, mut receive) = tauri::async_runtime::channel(1);
    dispatch(&app, move |app| {
        let _ = send.try_send(job(app));
    })?;
    receive
        .recv()
        .await
        .ok_or_else(|| "Native input request ended".into())
}

struct Session<'a> {
    runtime: &'a Runtime,
    input: Option<Input>,
}
impl Drop for Session<'_> {
    fn drop(&mut self) {
        *self.runtime.input.lock().unwrap() = self.input.take();
    }
}
// Only call from a dispatched job. A session is restored even during unwinding.
fn with_input<T>(app: &tauri::AppHandle, run: impl FnOnce(&mut Input, &Desktop) -> T) -> T {
    let runtime = app.state::<Runtime>();
    let input = runtime
        .input
        .lock()
        .unwrap()
        .take()
        .expect("native input operations must be dispatched, not nested");
    let mut session = Session {
        runtime: &runtime,
        input: Some(input),
    };
    run(session.input.as_mut().unwrap(), &Desktop(app.clone()))
}

pub(crate) struct Desktop(tauri::AppHandle);
impl Effects for Desktop {
    fn now(&self) -> Instant {
        Instant::now()
    }
    fn visible(&self) -> bool {
        self.0.state::<State>().visible.load(Ordering::SeqCst)
    }
    fn settings(&self) -> (bool, u8) {
        let state = self.0.state::<State>();
        let settings = state.settings.lock().unwrap();
        (settings.paused, settings.mischief)
    }
    fn window_exists(&self) -> bool {
        pet(&self.0).is_ok()
    }
    fn geometry(&self) -> Result<((u32, u32), f64), String> {
        let window = pet(&self.0)?;
        let size = window.inner_size().map_err(|error| error.to_string())?;
        Ok((
            (size.width, size.height),
            window.scale_factor().map_err(|error| error.to_string())?,
        ))
    }
    fn pointer(&self) -> Option<CursorPoint> {
        windows::cursor_position(self.0.clone())
    }
    fn capture(&self, enabled: bool) -> Result<(), String> {
        pet(&self.0)?
            .set_ignore_cursor_events(!enabled)
            .map_err(|error| error.to_string())
    }
    fn focusable(&self, enabled: bool) -> Result<(), String> {
        pet(&self.0)?
            .set_focusable(enabled)
            .map_err(|error| error.to_string())
    }
    fn focus(&self) -> Result<(), String> {
        pet(&self.0)?.set_focus().map_err(|error| error.to_string())
    }
    fn all_workspaces(&self) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        pet(&self.0)?
            .set_visible_on_all_workspaces(true)
            .map_err(|error| error.to_string())?;
        Ok(())
    }
    fn escape(&self, only_if_missing: bool) -> Result<(), String> {
        let shortcut = Shortcut::new(None, Code::Escape);

        if only_if_missing && self.0.global_shortcut().is_registered(shortcut) {
            return Ok(());
        }

        self.0
            .global_shortcut()
            .register(shortcut)
            .map_err(|error| error.to_string())
    }
    fn release_escape(&self) {
        let _ = self
            .0
            .global_shortcut()
            .unregister(Shortcut::new(None, Code::Escape));
    }
    fn move_cursor(&self, point: Point) -> Result<(), String> {
        pet(&self.0)?
            .set_cursor_position(tauri::LogicalPosition::new(point.x, point.y))
            .map_err(|error| error.to_string())
    }
    fn visibility(&self, visible: bool) -> Result<(), String> {
        self.0
            .state::<State>()
            .visible
            .store(visible, Ordering::SeqCst);

        if !visible {
            crate::work_activity::stop(&self.0);
        }

        let window = pet(&self.0)?;

        if visible {
            window.show()
        } else {
            window.hide()
        }
        .map_err(|error| error.to_string())?;

        self.0
            .emit("gullbert-visible", visible)
            .map_err(|error| error.to_string())
    }

    fn emergency_hide(&self, error: &str) {
        eprintln!("Gullbert: unable to change input capture: {error}");

        if let Ok(window) = pet(&self.0) {
            let _ = window.hide();
        }

        self.0
            .state::<State>()
            .visible
            .store(false, Ordering::SeqCst);
        let _ = self.0.emit("gullbert-visible", false);
    }
    fn emit(
        &self,
        action: &str,
        point: Option<Point>,
        cursor_id: Option<u64>,
    ) -> Result<(), String> {
        pet(&self.0)?
            .emit(
                "gullbert-action",
                Message {
                    action: action.into(),
                    point,
                    cursor_id,
                },
            )
            .map_err(|error| error.to_string())
    }
    fn target_notice(&self, notice: Notice) -> Result<(), String> {
        pet(&self.0)?
            .emit("gullbert-target", notice)
            .map_err(|error| error.to_string())
    }
    fn schedule(&self, deadline: Deadline, delay: Duration) {
        let app = self.0.clone();
        std::thread::spawn(move || {
            std::thread::sleep(delay);
            let _ = dispatch(&app, move |app| {
                with_input(app, |input, effects| input.expired(effects, deadline))
            });
        });
    }
    fn position_for_target(&self, purpose: Purpose) -> Result<(), String> {
        windows::position_for_target(&self.0, purpose)
    }
    fn position_for_cursor(&self) -> Result<(), String> {
        windows::fit_to_cursor_monitor(&self.0).map(|_| ())
    }
}

impl Runtime {
    pub(crate) fn watch(app: tauri::AppHandle) {
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(50));
            let needs_reconciliation = app
                .state::<Runtime>()
                .input
                .lock()
                .unwrap()
                .as_ref()
                .is_some_and(|input| input.capture != Some(false));

            if !needs_reconciliation {
                continue;
            }

            // At most one outstanding watcher tick, even if the UI is stalled.
            let (done, wait) = std::sync::mpsc::channel();

            if dispatch(&app, move |app| {
                with_input(app, |input, effects| input.watch(effects));
                let _ = done.send(());
            })
            .is_err()
                || wait.recv().is_err()
            {
                break;
            }
        });
    }
}

#[tauri::command]
pub(crate) async fn sync_interaction(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    rects: Vec<Rect>,
    pickup_id: Option<u64>,
) -> Option<CursorPoint> {
    if window.label() != "pet" {
        return None;
    }

    request(app, move |app| {
        if crate::shutdown::in_progress(app) {
            return None;
        }

        with_input(app, |input, effects| {
            input.sync_interaction(effects, rects, pickup_id)
        })
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
pub(crate) async fn begin_pickup(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    rect: Rect,
) -> Option<u64> {
    if window.label() != "pet" {
        return None;
    }

    request(app, move |app| {
        if crate::shutdown::in_progress(app) {
            return None;
        }

        with_input(app, |input, effects| input.begin_pickup(effects, rect))
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
pub(crate) async fn end_pickup(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: u64,
    retaliate: bool,
    tug: bool,
) -> Option<u64> {
    if window.label() != "pet" {
        return None;
    }

    request(app, move |app| {
        let interactive = !crate::shutdown::in_progress(app);
        with_input(app, |input, effects| {
            input.end_pickup(effects, id, retaliate && interactive, tug && interactive)
        })
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
pub(crate) async fn release_cursor(app: tauri::AppHandle, id: u64) {
    let _ = request(app, move |app| {
        with_input(app, |input, effects| input.release_cursor(effects, id))
    })
    .await;
}

#[tauri::command]
pub(crate) async fn tug_cursor(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: u64,
    x: f64,
    y: f64,
) -> bool {
    if window.label() != "pet" {
        return false;
    }

    request(app, move |app| {
        if crate::shutdown::in_progress(app) {
            return false;
        }

        with_input(app, |input, effects| {
            input.tug_cursor(effects, id, Point { x, y })
        })
    })
    .await
    .unwrap_or(false)
}

#[tauri::command]
pub(crate) async fn target_picked(
    app: tauri::AppHandle,
    id: u64,
    x: f64,
    y: f64,
) -> Result<(), String> {
    request(app, move |app| {
        if crate::shutdown::in_progress(app) {
            return Err("Gullbert is preparing to quit or install an update.".into());
        }

        with_input(app, |input, effects| {
            input.target_picked(effects, id, Point { x, y })
        })
    })
    .await?
}

#[tauri::command]
pub(crate) async fn cancel_targeting(app: tauri::AppHandle, id: Option<u64>) {
    let _ = request(app, move |app| {
        with_input(app, |input, effects| {
            if id.is_some() {
                input.finish_target_id(effects, id);
            } else {
                crate::actions::report(input.escape(effects));
            }
        })
    })
    .await;
}

// Called by application routing inside a dispatched job. Lease state and the
// effect seam remain private; callers cannot reconstruct cross-lease policy.
pub(crate) fn replace_target(app: &tauri::AppHandle) {
    with_input(app, |input, effects| input.replace_target(effects));
}
pub(crate) fn set_visible(app: &tauri::AppHandle, visible: bool) -> Result<(), String> {
    with_input(app, |input, effects| input.set_visible(effects, visible))
}
pub(crate) fn interrupt(app: &tauri::AppHandle) {
    with_input(app, |input, effects| input.interrupt(effects));
}
pub(crate) fn eat_cursor(app: &tauri::AppHandle) -> Result<(), String> {
    with_input(app, |input, effects| input.eat_cursor(effects))
}
pub(crate) fn begin_target(
    app: &tauri::AppHandle,
    purpose: Purpose,
    preparation: &'static str,
) -> Result<(), String> {
    with_input(app, |input, effects| {
        input.begin_target(effects, purpose, preparation)
    })
}
pub(crate) fn escape(app: &tauri::AppHandle) -> Result<(), String> {
    with_input(app, |input, effects| input.escape(effects))
}

pub(crate) fn prepare_shutdown(app: &tauri::AppHandle) {
    with_input(app, quiesce_input);
}

pub(super) fn quiesce_input(input: &mut Input, effects: &impl Effects) {
    input.interrupt(effects);
    input.replace_target(effects);
    input.sync_interaction(effects, vec![], None);
}

pub(crate) fn ready(app: &tauri::AppHandle) -> Result<(), String> {
    with_input(app, |input, effects| input.ready(effects))
}
