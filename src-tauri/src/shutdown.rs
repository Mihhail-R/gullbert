//! A single shutdown request owns the frontend flush and the right to terminate.
use crate::{native_input, windows};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, Sender},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

const SAVE_TIMEOUT: Duration = Duration::from_secs(15);
// A second Quit soon after a failed save is an explicit choice to lose unsaved memories.
const FORCE_QUIT_WINDOW: Duration = Duration::from_secs(60);

#[derive(Default)]
struct Requests {
    next_id: u32,
    active: Option<u32>,
    reply: Option<Sender<Result<(), String>>>,
}

impl Requests {
    fn begin(&mut self) -> Result<(u32, Receiver<Result<(), String>>), String> {
        if self.active.is_some() {
            return Err("Gullbert is already preparing to quit or install an update.".into());
        }

        self.next_id = self
            .next_id
            .checked_add(1)
            .ok_or("Shutdown request IDs exhausted")?;
        let (send, receive) = mpsc::channel();
        self.active = Some(self.next_id);
        self.reply = Some(send);
        Ok((self.next_id, receive))
    }

    fn awaiting(&self, id: u32) -> bool {
        self.active == Some(id) && self.reply.is_some()
    }

    fn acknowledge(&mut self, id: u32, result: Result<(), String>) -> Result<(), String> {
        if self.active != Some(id) {
            return Err("This shutdown request is no longer active.".into());
        }

        self.reply
            .take()
            .ok_or("This shutdown request was already acknowledged.")?
            .send(result)
            .map_err(|_| "This shutdown request has expired.".into())
    }

    fn cancel(&mut self, id: u32) {
        if self.active == Some(id) {
            self.active = None;
            self.reply = None;
        }
    }
}

#[derive(Default)]
struct FailedQuit(Option<Instant>);

impl FailedQuit {
    fn record(&mut self, now: Instant) {
        self.0 = Some(now);
    }

    fn take_if_recent(&mut self, now: Instant) -> bool {
        self.0
            .take()
            .is_some_and(|at| now.duration_since(at) <= FORCE_QUIT_WINDOW)
    }
}

#[derive(Default)]
pub(crate) struct Runtime {
    requests: Mutex<Requests>,
    exiting: AtomicBool,
    failed_quit: Mutex<FailedQuit>,
}

/// Dropping an unsuccessful operation releases the gate and unfreezes the pet.
pub(crate) struct Prepared {
    app: tauri::AppHandle,
    id: u32,
}

impl Prepared {
    pub(crate) fn allow_exit(&self) {
        self.app
            .state::<Runtime>()
            .exiting
            .store(true, Ordering::SeqCst);
    }
}

impl Drop for Prepared {
    fn drop(&mut self) {
        let runtime = self.app.state::<Runtime>();

        if runtime.exiting.load(Ordering::SeqCst) {
            return;
        }

        runtime.requests.lock().unwrap().cancel(self.id);

        if let Ok(pet) = windows::pet(&self.app) {
            let _ = pet.emit("gullbert-shutdown-cancel", self.id);
        }
    }
}

fn wait_for_save(reply: Receiver<Result<(), String>>, timeout: Duration) -> Result<(), String> {
    reply.recv_timeout(timeout).map_err(|_| {
        "Timed out waiting for Gullbert's memories to save. Nothing was closed; try again."
            .to_string()
    })?
}

pub(crate) async fn prepare(app: &tauri::AppHandle) -> Result<Prepared, String> {
    let (id, reply) = app.state::<Runtime>().requests.lock().unwrap().begin()?;
    let prepared = Prepared {
        app: app.clone(),
        id,
    };

    // A hidden bootstrap page has no running simulation or unsaved memories.
    // Quit must still work if browser configuration fails or has not finished.
    if !crate::pet_browser::is_ready(app) {
        return Ok(prepared);
    }

    native_input::request(app.clone(), move |app| {
        // Updater and OS exits need the same input cleanup as the Quit action.
        native_input::desktop::prepare_shutdown(app);
        windows::pet(app)?
            .emit("gullbert-shutdown-prepare", id)
            .map_err(|e| e.to_string())
    })
    .await??;

    tauri::async_runtime::spawn_blocking(move || wait_for_save(reply, SAVE_TIMEOUT))
        .await
        .map_err(|e| e.to_string())??;
    Ok(prepared)
}

#[tauri::command]
pub(crate) async fn shutdown_ready(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: u32,
    error: Option<String>,
) -> Result<(), String> {
    if window.label() != "pet" {
        return Err("Only Gullbert can acknowledge saved memories.".into());
    }

    let result = match error {
        Some(error) => Err(format!("Could not save Gullbert's memories: {error}")),

        None => Ok(()),
    };
    native_input::request(app, move |app| {
        if !app.state::<Runtime>().requests.lock().unwrap().awaiting(id) {
            return Err("This shutdown request is no longer awaiting a save.".into());
        }

        // Release input acquired by an IPC call already in flight when the pet froze.
        native_input::desktop::prepare_shutdown(app);
        app.state::<Runtime>()
            .requests
            .lock()
            .unwrap()
            .acknowledge(id, result)
    })
    .await?
}

pub(crate) fn in_progress(app: &tauri::AppHandle) -> bool {
    app.state::<Runtime>()
        .requests
        .lock()
        .unwrap()
        .active
        .is_some()
}

pub(crate) fn request_quit(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let runtime = app.state::<Runtime>();

        // Never cut short a save or update installation that is still running.
        if !in_progress(&app)
            && runtime
                .failed_quit
                .lock()
                .unwrap()
                .take_if_recent(Instant::now())
        {
            force_quit(&app).await;
            return;
        }

        match prepare(&app).await {
            Ok(prepared) => {
                prepared.allow_exit();
                app.exit(0);
            }

            Err(error) => {
                runtime.failed_quit.lock().unwrap().record(Instant::now());
                show_quit_error(&app, &error);
            }
        }
    });
}

async fn force_quit(app: &tauri::AppHandle) {
    // Best effort: never let input cleanup keep a stuck app from closing.
    let _ = native_input::request(app.clone(), |app| {
        native_input::desktop::prepare_shutdown(app);
    })
    .await;
    app.state::<Runtime>().exiting.store(true, Ordering::SeqCst);
    app.exit(0);
}

pub(crate) fn on_exit(app: &tauri::AppHandle, event: &tauri::RunEvent) {
    if let tauri::RunEvent::ExitRequested { api, .. } = event {
        if !app.state::<Runtime>().exiting.load(Ordering::SeqCst) {
            api.prevent_exit();
            request_quit(app);
        }
    }
}

pub(crate) fn show_error(app: &tauri::AppHandle, error: &str) {
    windows::controls(app);
    let message =
        format!("{error} Gullbert is still running. Retry Quit or Install after saving works.");
    let _ = app.emit("gullbert-shutdown-error", &message);
    eprintln!("{message}");
}

fn show_quit_error(app: &tauri::AppHandle, error: &str) {
    windows::controls(app);
    let message = format!(
        "{error} Gullbert is still running. Choose Quit again within a minute to quit \
        without saving his latest memories."
    );
    let _ = app.emit("gullbert-shutdown-error", &message);
    eprintln!("{message}");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_save_cannot_authorize_exit_and_duplicates_do_not_replace_it() {
        let mut requests = Requests::default();
        let (id, reply) = requests.begin().unwrap();
        assert!(requests.begin().is_err());
        assert!(reply.try_recv().is_err());
        requests.acknowledge(id, Ok(())).unwrap();
        assert_eq!(wait_for_save(reply, Duration::ZERO), Ok(()));
        assert!(requests.acknowledge(id, Ok(())).is_err());
        assert!(requests.begin().is_err());
    }

    #[test]
    fn failed_commit_aborts_installation_and_allows_a_new_attempt() {
        let mut requests = Requests::default();
        let (id, reply) = requests.begin().unwrap();
        requests.acknowledge(id, Err("disk full".into())).unwrap();
        assert_eq!(
            wait_for_save(reply, Duration::ZERO),
            Err("disk full".into())
        );
        requests.cancel(id);
        assert!(requests.begin().is_ok());
    }

    #[test]
    fn timeout_and_stale_acknowledgments_cannot_authorize_a_later_exit() {
        let mut requests = Requests::default();
        let (old_id, old_reply) = requests.begin().unwrap();
        assert!(wait_for_save(old_reply, Duration::ZERO).is_err());
        requests.cancel(old_id);
        let (id, reply) = requests.begin().unwrap();
        assert_ne!(old_id, id);
        assert!(requests.acknowledge(old_id, Ok(())).is_err());
        requests.cancel(old_id);
        assert!(reply.try_recv().is_err());
        requests.acknowledge(id, Ok(())).unwrap();
        assert_eq!(wait_for_save(reply, Duration::ZERO), Ok(()));
    }

    #[test]
    fn only_a_quit_soon_after_a_failed_save_skips_saving_and_only_once() {
        let start = Instant::now();
        let mut failed = FailedQuit::default();
        assert!(!failed.take_if_recent(start));

        failed.record(start);
        assert!(failed.take_if_recent(start + FORCE_QUIT_WINDOW));
        assert!(!failed.take_if_recent(start + FORCE_QUIT_WINDOW));

        failed.record(start);
        assert!(!failed.take_if_recent(start + FORCE_QUIT_WINDOW + Duration::from_secs(1)));
    }
}
