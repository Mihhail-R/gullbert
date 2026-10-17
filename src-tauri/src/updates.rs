//! User-initiated updates. GitHub discovers releases; Tauri verifies and installs bytes.
use semver::Version;
use serde::{Deserialize, Serialize};
use std::{
    future::Future,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::Emitter;
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub(crate) struct Runtime {
    busy: AtomicBool,
    pending: Mutex<Option<Update>>,
}
struct Operation<'a>(&'a AtomicBool);
impl Drop for Operation<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
impl Runtime {
    fn begin(&self) -> Result<Operation<'_>, String> {
        self.busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "An update operation is already running.".to_string())?;
        Ok(Operation(&self.busy))
    }
}
#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    body: Option<String>,
    assets: Vec<Asset>,
}
#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
}
#[derive(Serialize)]
pub(crate) struct Available {
    version: String,
    notes: String,
}
#[derive(Clone, Serialize)]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
    installing: bool,
}

fn controls(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "controls" {
        return Err("Updates are available in the control room.".into());
    }
    Ok(())
}
#[tauri::command]
pub(crate) fn app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}
fn newest<'a>(
    releases: &'a [Release],
    current: &Version,
    beta: bool,
) -> Option<(&'a Release, Version)> {
    releases
        .iter()
        .filter_map(|release| {
            let version = Version::parse(release.tag_name.strip_prefix('v')?).ok()?;
            if release.draft {
                return None;
            }
            if !beta && (release.prerelease || !version.pre.is_empty()) {
                return None;
            }
            if version <= *current {
                return None;
            }
            Some((release, version))
        })
        .max_by(|a, b| a.1.cmp(&b.1))
}
fn github_client() -> Result<reqwest::Client, String> {
    // Release discovery runs before Tauri's updater initializes its TLS provider.
    // Reuse its ring provider, leaving an existing process-wide choice intact.
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent(concat!("Gullbert/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub(crate) async fn check_update(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    beta: bool,
    runtime: tauri::State<'_, Runtime>,
) -> Result<Option<Available>, String> {
    controls(&window)?;
    let _operation = runtime.begin()?;
    *runtime.pending.lock().unwrap() = None;
    let client = github_client()?;
    let releases: Vec<Release> = client
        .get("https://api.github.com/repos/Mihhail-R/gullbert/releases?per_page=100")
        .send()
        .await
        .map_err(|e| format!("Could not reach GitHub: {e}"))?
        .error_for_status()
        .map_err(|e| format!("GitHub could not check releases (try again later): {e}"))?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let Some((release, version)) = newest(&releases, &app.package_info().version, beta) else {
        return Ok(None);
    };
    let asset = release.assets.iter().find(|asset| asset.name == "latest.json")
        .ok_or("This release has no updater package. Download it from the Gullbert GitHub releases page.")?;
    let expected = format!(
        "https://github.com/Mihhail-R/gullbert/releases/download/{}/latest.json",
        release.tag_name
    );
    if asset.browser_download_url != expected {
        return Err("Unexpected update manifest address.".into());
    }
    let update = app
        .updater_builder()
        .endpoints(vec![expected
            .parse()
            .map_err(|_| "Invalid update address")?])
        .map_err(|e| e.to_string())?
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| format!("Could not check update package: {e}"))?
        .ok_or("The release metadata does not contain a newer update.")?;
    if update.version != version.to_string() {
        return Err("Release and update versions do not match.".into());
    }
    let available = Available {
        version: update.version.clone(),
        notes: release.body.clone().unwrap_or_default(),
    };
    *runtime.pending.lock().unwrap() = Some(update);
    Ok(Some(available))
}
#[tauri::command]
pub(crate) async fn install_update(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    runtime: tauri::State<'_, Runtime>,
) -> Result<(), String> {
    controls(&window)?;
    let _operation = runtime.begin()?;

    #[cfg(target_os = "macos")]
    {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let path = exe.to_string_lossy();

        if path.contains("/AppTranslocation/") || path.starts_with("/Volumes/") {
            return Err(concat!(
                "Move Gullbert to Applications, quit this copy, and open it from ",
                "Applications before updating."
            )
            .into());
        }
    }

    let update = runtime
        .pending
        .lock()
        .unwrap()
        .take()
        .ok_or("Check for updates before installing.")?;

    let mut downloaded = 0;
    let bytes = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                let _ = window.emit(
                    "gullbert-update-progress",
                    Progress {
                        downloaded,
                        total,
                        installing: false,
                    },
                );
            },
            || {},
        )
        .await
        .map_err(|e| format!("Update failed; check again to retry. {e}"))?;

    // Windows install launches the installer and exits the process itself. Flush
    // before calling it, and keep the pet frozen until the restart is authorized.
    let prepared = install_when_saved(crate::shutdown::prepare(&app), || {
        let _ = window.emit(
            "gullbert-update-progress",
            Progress {
                downloaded: 0,
                total: None,
                installing: true,
            },
        );
        update
            .install(bytes)
            .map_err(|e| format!("Update failed; check again to retry. {e}"))
    })
    .await
    .map_err(|error| {
        crate::shutdown::show_error(&app, &error);
        error
    })?;
    prepared.allow_exit();
    app.restart();
}

// Hold the successful save permit throughout installation; dropping it on any
// failure resumes the pet, while Windows may terminate inside the installer.
async fn install_when_saved<Permit>(
    save: impl Future<Output = Result<Permit, String>>,
    install: impl FnOnce() -> Result<(), String>,
) -> Result<Permit, String> {
    let permit = save.await?;
    install()?;
    Ok(permit)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn installation_waits_for_committed_memories() {
        tauri::async_runtime::block_on(async {
            let (send, mut receive) = tauri::async_runtime::channel(1);
            let installed = AtomicBool::new(false);
            let mut installation = std::pin::pin!(install_when_saved(
                async { receive.recv().await.unwrap() },
                || {
                    installed.store(true, Ordering::SeqCst);
                    Ok(())
                },
            ));
            let mut context = std::task::Context::from_waker(std::task::Waker::noop());
            assert!(installation.as_mut().poll(&mut context).is_pending());
            assert!(!installed.load(Ordering::SeqCst));

            send.try_send(Ok(())).unwrap();
            installation.await.unwrap();
            assert!(installed.load(Ordering::SeqCst));
        });
    }

    #[test]
    fn failed_save_never_starts_the_installer() {
        tauri::async_runtime::block_on(async {
            let result = install_when_saved(async { Err::<(), _>("disk full".into()) }, || {
                panic!("installer must not run before a successful save")
            })
            .await;
            assert_eq!(result, Err("disk full".into()));
        });
    }

    #[test]
    fn github_client_initializes_before_any_updater_check() {
        assert!(github_client().is_ok());
    }
    fn release(tag: &str, prerelease: bool, draft: bool) -> Release {
        Release {
            tag_name: tag.into(),
            prerelease,
            draft,
            body: None,
            assets: vec![],
        }
    }
    #[test]
    fn selects_highest_version_not_publish_order_and_obeys_channel() {
        let releases = vec![
            release("v0.3.1", false, false),
            release("v0.4.0-beta.1", true, false),
            release("v0.3.2", false, false),
            release("v9.0.0", false, true),
        ];
        let current = Version::parse("0.3.0-beta.1").unwrap();
        assert_eq!(
            newest(&releases, &current, false).unwrap().1.to_string(),
            "0.3.2"
        );
        assert_eq!(
            newest(&releases, &current, true).unwrap().1.to_string(),
            "0.4.0-beta.1"
        );
    }
    #[test]
    fn never_downgrades_or_treats_unflagged_beta_as_stable() {
        let releases = vec![
            release("v0.3.0-beta.2", false, false),
            release("v0.2.0", false, false),
            release("updates", false, false),
        ];
        let current = Version::parse("0.3.0-beta.1").unwrap();
        assert!(newest(&releases, &current, false).is_none());
        assert!(newest(&releases, &Version::parse("0.3.0-beta.2").unwrap(), true).is_none());
    }
    #[test]
    fn operations_release_busy_state_on_failure() {
        let runtime = Runtime::default();
        let first = runtime.begin().unwrap();
        assert!(runtime.begin().is_err());
        drop(first);
        assert!(runtime.begin().is_ok());
    }
}
