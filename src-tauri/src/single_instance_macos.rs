// macOS single-instance transport, adapted from tauri-plugin-single-instance 2.5.4.
// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: MIT
// Kept locally until upstream supports private sockets and bounded receives.
/*
MIT License

Copyright (c) 2017 - Present The Tauri Programme in the Commons Conservancy

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    io::{Error, ErrorKind, Write},
    os::fd::AsRawFd,
    os::unix::{
        fs::{DirBuilderExt, MetadataExt},
        net::UnixStream,
    },
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{
    plugin::{self, TauriPlugin},
    AppHandle, Config, Manager, RunEvent, Runtime,
};
use tokio::{io::AsyncReadExt, sync::Semaphore, time::timeout};

const MAX_MESSAGE_BYTES: usize = 16_384;
const RECEIVE_TIMEOUT: Duration = Duration::from_secs(1);
const MAX_CONNECTIONS: usize = 8;
type SingleInstanceCallback<R> =
    dyn FnMut(&AppHandle<R>, Vec<String>, String) + Send + Sync + 'static;

struct SocketPath {
    path: PathBuf,
    _lock: std::fs::File,
}
struct Instance(Mutex<Option<SocketPath>>);

fn claim_instance(socket: &PathBuf) -> std::io::Result<Option<std::fs::File>> {
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(socket.with_extension("lock"))?;

    if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
        return Ok(Some(lock));
    }

    let error = Error::last_os_error();
    if error.kind() == ErrorKind::WouldBlock {
        return Ok(None);
    }

    Err(error)
}

pub fn init<R: Runtime, F>(callback: F) -> TauriPlugin<R>
where
    F: FnMut(&AppHandle<R>, Vec<String>, String) + Send + Sync + 'static,
{
    let callback = Box::new(callback);
    plugin::Builder::new("single-instance")
        .setup(|app, _api| {
            let socket = socket_path(app.config())?;

            let Some(lock) = claim_instance(&socket)? else {
                notify_existing_instance(&socket)?;
                std::process::exit(0);
            };

            let _ = std::fs::remove_file(&socket);
            let listener = std::os::unix::net::UnixListener::bind(&socket)?;
            listener.set_nonblocking(true)?;
            app.manage(Instance(Mutex::new(Some(SocketPath {
                path: socket,
                _lock: lock,
            }))));
            listen_for_other_instances(listener, app.clone(), callback);
            Ok(())
        })
        .on_event(|app, event| {
            if let RunEvent::Exit = event {
                destroy(app);
            }
        })
        .build()
}

pub fn destroy<R: Runtime, M: Manager<R>>(manager: &M) {
    let Some(instance) = manager.try_state::<Instance>() else {
        return;
    };
    let mut owner = instance.0.lock().unwrap();
    let Some(socket) = owner.take() else {
        return;
    };

    // Unlink before releasing ownership. Taking the state makes repeated cleanup
    // harmless, and releasing here allows Tauri to spawn an updater restart.
    let _ = std::fs::remove_file(&socket.path);
}

fn private_directory(path: &PathBuf) -> std::io::Result<()> {
    match std::fs::DirBuilder::new().mode(0o700).create(path) {
        Ok(()) => {}

        Err(error) if error.kind() == ErrorKind::AlreadyExists => {}

        Err(error) => return Err(error),
    }

    let metadata = std::fs::symlink_metadata(path)?;
    if !metadata.is_dir() || metadata.uid() != unsafe { libc::geteuid() } {
        return Err(Error::new(
            ErrorKind::PermissionDenied,
            "Untrusted IPC directory",
        ));
    }

    if metadata.mode() & 0o077 != 0 {
        return Err(Error::new(
            ErrorKind::PermissionDenied,
            "IPC directory is not private",
        ));
    }

    Ok(())
}

fn socket_path(config: &Config) -> std::io::Result<PathBuf> {
    let mut hasher = DefaultHasher::new();
    config.identifier.hash(&mut hasher);
    let uid = unsafe { libc::geteuid() };
    let directory = PathBuf::from(format!("/tmp/tauri-si-{uid}-{:x}", hasher.finish()));
    private_directory(&directory)?;
    Ok(directory.join("instance.sock"))
}

fn notify_existing_instance(socket: &PathBuf) -> std::io::Result<()> {
    // The owner may still be binding. Never unlink another live owner's socket.
    let deadline = std::time::Instant::now() + RECEIVE_TIMEOUT;
    loop {
        match notify_singleton(socket) {
            Ok(()) => return Ok(()),

            Err(error) => {
                if !matches!(
                    error.kind(),
                    ErrorKind::NotFound | ErrorKind::ConnectionRefused
                ) {
                    return Err(error);
                }

                if std::time::Instant::now() >= deadline {
                    return Err(error);
                }
            }
        }

        std::thread::sleep(Duration::from_millis(20));
    }
}

fn notify_singleton(socket: &PathBuf) -> std::io::Result<()> {
    let mut message = std::env::current_dir()?.to_string_lossy().into_owned();
    message.push_str("\0\0");
    let arguments = std::env::args_os()
        .map(|argument| argument.to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("\0");
    message.push_str(&arguments);

    if message.len() > MAX_MESSAGE_BYTES {
        return Err(Error::new(
            ErrorKind::InvalidInput,
            "Launch message is too large",
        ));
    }

    let mut stream = UnixStream::connect(socket)?;
    stream.set_write_timeout(Some(RECEIVE_TIMEOUT))?;
    stream.write_all(message.as_bytes())
}

fn listen_for_other_instances<R: Runtime>(
    listener: std::os::unix::net::UnixListener,
    app: AppHandle<R>,
    callback: Box<SingleInstanceCallback<R>>,
) {
    let callback = Arc::new(Mutex::new(callback));
    let slots = Arc::new(Semaphore::new(MAX_CONNECTIONS));
    tauri::async_runtime::spawn(async move {
        let Ok(listener) = tokio::net::UnixListener::from_std(listener) else {
            tracing::error!("Could not initialize single-instance listener");
            return;
        };

        while let Ok((stream, _)) = listener.accept().await {
            let Ok(credentials) = stream.peer_cred() else {
                continue;
            };

            if credentials.uid() != unsafe { libc::geteuid() } {
                continue;
            }

            let Ok(slot) = slots.clone().try_acquire_owned() else {
                continue;
            };
            let app = app.clone();
            let callback = callback.clone();
            tauri::async_runtime::spawn(async move {
                let _slot = slot;
                let Ok(message) = read_message(stream).await else {
                    return;
                };
                let Some((cwd, arguments)) = message.split_once("\0\0") else {
                    return;
                };

                if arguments.is_empty() {
                    return;
                }

                let arguments = arguments.split('\0').map(String::from).collect();
                if let Ok(mut callback) = callback.lock() {
                    callback(&app, arguments, cwd.to_string());
                }
            });
        }
    });
}

async fn read_message(stream: tokio::net::UnixStream) -> std::io::Result<String> {
    let mut message = String::new();
    let mut bounded = stream.take((MAX_MESSAGE_BYTES + 1) as u64);
    timeout(RECEIVE_TIMEOUT, bounded.read_to_string(&mut message))
        .await
        .map_err(|_| Error::new(ErrorKind::TimedOut, "Launch message timed out"))??;

    if message.len() > MAX_MESSAGE_BYTES {
        return Err(Error::new(
            ErrorKind::InvalidData,
            "Launch message is too large",
        ));
    }

    Ok(message)
}
