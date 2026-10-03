//! Opt-in, macOS 2.19.1-only localization of reviewed static App controls.
//! Attaches only to the App's existing, independently verified loopback CDP.

use super::localization_macos::{self, Discovery, Installation};
use super::localization_transport::{CdpTransport, PageTarget, RuntimeAction, TransportError};
use once_cell::sync::Lazy;
use serde::Serialize;
use serde_json::Value;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Mutex,
};
use std::time::{Duration, Instant};

const DICTIONARY: &str = include_str!("../../resources/app-localization/zh-CN.json");
const MAX_ASAR_HEADER: usize = 4 * 1024 * 1024;
const MAX_PACKAGE: usize = 16 * 1024;
const SUPPORTED: &[&str] = &["2.19.1"];
static ENABLED: AtomicBool = AtomicBool::new(false);
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);
static CONTROL_LOCK: Mutex<()> = Mutex::new(());
static INTENT_LOCK: Mutex<()> = Mutex::new(());
static INTENT_GENERATION: AtomicU64 = AtomicU64::new(0);
static STARTED: AtomicBool = AtomicBool::new(false);
static SESSION: Lazy<Mutex<Option<Session>>> = Lazy::new(|| Mutex::new(None));
static SNAPSHOT: Lazy<Mutex<Option<LocalizationStatus>>> = Lazy::new(|| Mutex::new(None));
static WORKER: Lazy<Mutex<Option<std::thread::Thread>>> = Lazy::new(|| Mutex::new(None));

#[derive(Debug, Clone, Serialize)]
pub struct LocalizationStatus {
    enabled: bool,
    state: String,
    installed_version: Option<String>,
    dictionary_version: String,
    dictionary_entries: usize,
    supported_versions: Vec<String>,
    supported: bool,
    can_apply: bool,
    active: bool,
    translated: u64,
    detail: Option<String>,
    #[serde(skip)]
    observed_at: Instant,
}
struct Session {
    discovery: Discovery,
    transport: CdpTransport,
    page: PageTarget,
    version: String,
    installation: Installation,
    pending_restore: bool,
}

fn compatible(version: &str, platform: &str) -> bool {
    platform == "macos" && SUPPORTED.contains(&version)
}
fn supported_versions() -> &'static [&'static str] {
    SUPPORTED
}

fn package_version(package: &[u8]) -> Option<String> {
    let package: Value = serde_json::from_slice(package).ok()?;
    // Antigravity IDE also uses the Antigravity name. Require the standalone
    // App's package identity; never run --version or execute a selected binary.
    if package.get("name")?.as_str()? != "antigravity"
        || package.get("productName")?.as_str()? != "Antigravity"
        || package.get("description")?.as_str()? != "Antigravity - Agentic Desktop Application"
    {
        return None;
    }
    let version = package.get("version")?.as_str()?;
    if version.len() > 32
        || version.split('.').count() != 3
        || !version.split('.').all(|part| {
            !part.is_empty() && part.len() <= 8 && part.bytes().all(|b| b.is_ascii_digit())
        })
    {
        return None;
    }
    Some(version.to_string())
}

/// Read only the bounded package.json entry from an ASAR; no extraction or code
/// execution. Reject links, unpacked entries, oversized values and bad offsets.
pub(crate) fn read_asar_version(path: &Path) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let file_size = file.metadata().ok()?.len();
    let mut prefix = [0_u8; 16];
    file.read_exact(&mut prefix).ok()?;
    let number =
        |start: usize| u32::from_le_bytes(prefix[start..start + 4].try_into().unwrap()) as usize;
    let header_size = number(4);
    let json_size = number(12);
    if number(0) != 4
        || json_size == 0
        || header_size > MAX_ASAR_HEADER
        || json_size > header_size.checked_sub(8)?
        || number(8) > header_size
    {
        return None;
    }
    let mut header = vec![0; json_size];
    file.read_exact(&mut header).ok()?;
    let header: Value = serde_json::from_slice(&header).ok()?;
    let entry = header.get("files")?.get("package.json")?;
    if entry.get("link").is_some()
        || entry
            .get("unpacked")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    {
        return None;
    }
    let offset = entry.get("offset")?.as_str()?.parse::<u64>().ok()?;
    let size = entry.get("size")?.as_u64()?;
    if size == 0 || size > MAX_PACKAGE as u64 {
        return None;
    }
    let position = (8_u64)
        .checked_add(header_size as u64)?
        .checked_add(offset)?;
    if position.checked_add(size)? > file_size {
        return None;
    }
    file.seek(SeekFrom::Start(position)).ok()?;
    let mut package = vec![0; size as usize];
    file.read_exact(&mut package).ok()?;
    package_version(&package)
}

fn snapshot(
    enabled: bool,
    version: Option<String>,
    state: &str,
    detail: Option<&str>,
) -> LocalizationStatus {
    let dictionary: Value = serde_json::from_str(DICTIONARY).expect("bundled dictionary is JSON");
    let supported = version
        .as_deref()
        .is_some_and(|v| compatible(v, std::env::consts::OS));
    LocalizationStatus {
        enabled,
        state: state.to_string(),
        installed_version: version,
        dictionary_version: dictionary["version"]
            .as_str()
            .unwrap_or("unknown")
            .to_string(),
        dictionary_entries: dictionary["exact"].as_object().map_or(0, |d| d.len()),
        supported_versions: SUPPORTED.iter().map(|s| s.to_string()).collect(),
        supported,
        can_apply: supported,
        active: false,
        translated: 0,
        detail: detail.map(str::to_string),
        observed_at: Instant::now(),
    }
}
fn preflight(enabled: bool) -> (LocalizationStatus, Option<Installation>) {
    if !cfg!(target_os = "macos") {
        return (
            snapshot(enabled, None, "unsupported_platform", Some("macos_only")),
            None,
        );
    }
    let config = match super::config::load_app_config() {
        Ok(c) => c,
        Err(_) => {
            return (
                snapshot(enabled, None, "error", Some("config_unavailable")),
                None,
            )
        }
    };
    match localization_macos::installed(config.antigravity_executable.as_deref()) {
        Ok(Some(app)) if compatible(&app.version, "macos") => (
            snapshot(
                enabled,
                Some(app.version.clone()),
                if enabled { "ready" } else { "disabled" },
                None,
            ),
            Some(app),
        ),
        Ok(Some(app)) => (
            snapshot(
                enabled,
                Some(app.version),
                "unsupported_version",
                Some("version_changed"),
            ),
            None,
        ),
        Ok(None) => (
            snapshot(enabled, None, "not_installed", Some("app_required")),
            None,
        ),
        Err(code) => (snapshot(enabled, None, "error", Some(code)), None),
    }
}
fn publish(value: LocalizationStatus) -> LocalizationStatus {
    if let Ok(mut status) = SNAPSHOT.lock() {
        *status = Some(value.clone());
    }
    value
}
fn transport_code(error: TransportError) -> &'static str {
    match error {
        TransportError::WrongProcess
        | TransportError::WrongTarget
        | TransportError::InvalidEndpoint
        | TransportError::UnverifiedListener => "identity_mismatch",
        TransportError::AmbiguousTargets => "multiple_windows",
        TransportError::Timeout => "connection_timeout",
        TransportError::Closed | TransportError::ConnectFailed => "connection_lost",
        _ => "runtime_failed",
    }
}
fn dispose(session: &mut Option<Session>) -> bool {
    let Some(active) = session.as_mut() else {
        return true;
    };
    active.pending_restore = true;
    let pid = active.discovery.endpoint.browser_pid();
    match localization_macos::known_process_exited(pid) {
        Ok(true) => {
            *session = None;
            return true;
        }
        Ok(false) => {}
        Err(_) => return false,
    }
    if active.transport.page_destroyed(&active.page) == Ok(true) {
        *session = None;
        return true;
    }
    let restored = |report: &super::localization_transport::RuntimeReport| {
        report.status == "disposed" && !report.active
    };
    if active
        .transport
        .run(&active.page, &active.version, RuntimeAction::Dispose)
        .is_ok_and(|report| restored(&report))
    {
        *session = None;
        return true;
    }
    // A closed last window may also stop the App server. Endpoint-only
    // revalidation is enough to prove target destruction, but never to inject.
    if let Ok(endpoint) = localization_macos::rediscover_endpoint(&active.installation) {
        if endpoint == active.discovery.endpoint {
            if let Ok(mut connection) = CdpTransport::connect(endpoint) {
                if connection.page_destroyed(&active.page) == Ok(true) {
                    *session = None;
                    return true;
                }
            }
        }
    }
    // Reconnect only after independently re-verifying exactly the same process,
    // endpoint and App server. Never forget a possibly applied runtime on error.
    if let Ok(fresh) = localization_macos::discover(&active.installation) {
        if fresh.endpoint == active.discovery.endpoint
            && fresh.origins.contains(active.page.origin())
        {
            if let Ok(mut connection) = CdpTransport::connect(fresh.endpoint) {
                let gone = connection.page_destroyed(&active.page) == Ok(true);
                let clean = gone
                    || connection
                        .run(&active.page, &active.version, RuntimeAction::Dispose)
                        .is_ok_and(|report| restored(&report));
                if clean {
                    *session = None;
                    return true;
                }
                active.transport = connection;
            }
        }
    }
    false
}
fn stop_session(state: &mut LocalizationStatus, sessions: &mut Option<Session>) {
    if !dispose(sessions) {
        state.state = "restore_pending".into();
        state.detail = Some("restore_pending".into());
        state.can_apply = false;
    }
    state.active = false;
    state.translated = 0;
}

fn tick(force: bool) -> LocalizationStatus {
    // Capture intent only inside the session sequence: an old background tick
    // must not wait behind a newer apply and then dispose it using stale `off`.
    let Ok(mut sessions) = SESSION.lock() else {
        return publish(snapshot(
            ENABLED.load(Ordering::SeqCst),
            None,
            "error",
            Some("worker_unavailable"),
        ));
    };
    let enabled = ENABLED.load(Ordering::SeqCst);
    let (mut status, app) = preflight(enabled);
    if sessions.as_ref().is_some_and(|s| s.pending_restore) && !dispose(&mut sessions) {
        status.state = "restore_pending".into();
        status.detail = Some("restore_pending".into());
        status.can_apply = false;
        return publish(status);
    }
    if !enabled || app.is_none() {
        stop_session(&mut status, &mut sessions);
        return publish(status);
    }
    let app = app.unwrap();
    let discovery = match localization_macos::discover(&app) {
        Ok(d) => d,
        Err(code) => {
            stop_session(&mut status, &mut sessions);
            if status.state != "restore_pending" {
                status.state = if code == "not_running" {
                    "not_running"
                } else {
                    "error"
                }
                .into();
                status.detail = Some(code.into());
            }
            return publish(status);
        }
    };
    if let Some(existing) = sessions.as_mut() {
        if existing.discovery.endpoint == discovery.endpoint
            && discovery.origins.contains(existing.page.origin())
            && existing.version == app.version
            && !force
        {
            match existing
                .transport
                .run(&existing.page, &existing.version, RuntimeAction::Renew)
            {
                Ok(report) if report.status == "applied" && report.active => {
                    status.state = applied_state(report.translated, report.awaiting_scope).into();
                    status.active = report.translated > 0;
                    status.translated = report.translated;
                    if !ENABLED.load(Ordering::SeqCst) {
                        status.enabled = false;
                        status.state = "disabled".into();
                        stop_session(&mut status, &mut sessions);
                    }
                    return publish(status);
                }
                _ => {}
            }
        }
        // A reload, changed process/origin/version, or explicit reapply must
        // release the previous owned session before attaching a new one.
        if !dispose(&mut sessions) {
            status.state = "restore_pending".into();
            status.detail = Some("restore_pending".into());
            return publish(status);
        }
    }
    if !ENABLED.load(Ordering::SeqCst) {
        status.enabled = false;
        status.state = "disabled".into();
        return publish(status);
    }
    let mut connection = match CdpTransport::connect(discovery.endpoint.clone()) {
        Ok(c) => c,
        Err(e) => {
            status.state = "error".into();
            status.detail = Some(transport_code(e).into());
            return publish(status);
        }
    };
    let pages = match connection.pages_for_origins(&discovery.origins) {
        Ok(p) => p,
        Err(e) => {
            status.state = "error".into();
            status.detail = Some(transport_code(e).into());
            return publish(status);
        }
    };
    let started = Instant::now();
    let mut supported = Vec::new();
    let mut waiting_for_controls = false;
    for page in pages {
        if !ENABLED.load(Ordering::SeqCst) {
            break;
        }
        if started.elapsed() > Duration::from_secs(8) {
            status.state = "error".into();
            status.detail = Some("connection_timeout".into());
            return publish(status);
        }
        match connection.run(&page, &app.version, RuntimeAction::Probe) {
            Ok(report) if report.status == "supported" && report.label_count > 0 => {
                supported.push(page)
            }
            Ok(report) if report.status == "supported" => waiting_for_controls = true,
            Ok(_) => {}
            Err(e) => {
                status.state = "error".into();
                status.detail = Some(transport_code(e).into());
                return publish(status);
            }
        }
    }
    if !ENABLED.load(Ordering::SeqCst) {
        status.enabled = false;
        status.state = "disabled".into();
        return publish(status);
    }
    if supported.is_empty() && waiting_for_controls {
        status.state = "waiting_ui".into();
        return publish(status);
    }
    if supported.len() != 1 {
        status.state = "unsupported_dom".into();
        status.detail = Some(
            if supported.is_empty() {
                "dom_changed"
            } else {
                "multiple_windows"
            }
            .into(),
        );
        return publish(status);
    }
    let page = supported.pop().unwrap();
    // Retain the cleanup handle before the first write: a lost response may
    // still mean the renderer applied changes successfully.
    *sessions = Some(Session {
        discovery,
        transport: connection,
        page,
        version: app.version.clone(),
        installation: app,
        pending_restore: true,
    });
    let active = sessions.as_mut().unwrap();
    match active
        .transport
        .run(&active.page, &active.version, RuntimeAction::Apply)
    {
        Ok(report) if report.status == "applied" && report.active => {
            active.pending_restore = false;
            status.state = applied_state(report.translated, report.awaiting_scope).into();
            status.active = report.translated > 0;
            status.translated = report.translated;
            if !ENABLED.load(Ordering::SeqCst) {
                status.enabled = false;
                status.state = "disabled".into();
                stop_session(&mut status, &mut sessions);
            }
        }
        Ok(_) => {
            status.state = "unsupported_dom".into();
            status.detail = Some("dom_changed".into());
            stop_session(&mut status, &mut sessions);
        }
        Err(e) => {
            status.state = "error".into();
            status.detail = Some(transport_code(e).into());
            stop_session(&mut status, &mut sessions);
        }
    }
    publish(status)
}

fn applied_state(translated: u64, awaiting_scope: bool) -> &'static str {
    if translated == 0 || awaiting_scope {
        "waiting_ui"
    } else {
        "applied"
    }
}

fn ensure_current(generation: u64) -> Result<(), String> {
    if SHUTTING_DOWN.load(Ordering::SeqCst) {
        return Err("feature_disabled".into());
    }
    if INTENT_GENERATION.load(Ordering::SeqCst) != generation {
        return Err("operation_superseded".into());
    }
    Ok(())
}

// Allocate the intent in the IPC entry point, before spawn_blocking can reorder
// execution. The short lock also makes a later disable atomic with any older
// enable's runtime commit; a generation check followed by a bare store is racy.
fn new_intent(enabled: bool) -> Result<u64, String> {
    let _guard = INTENT_LOCK
        .lock()
        .map_err(|_| "worker_unavailable".to_string())?;
    if SHUTTING_DOWN.load(Ordering::SeqCst) {
        return Err("feature_disabled".into());
    }
    let generation = INTENT_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    if !enabled {
        ENABLED.store(false, Ordering::SeqCst);
    }
    Ok(generation)
}

fn commit_enabled(generation: u64) -> Result<(), String> {
    let _guard = INTENT_LOCK
        .lock()
        .map_err(|_| "worker_unavailable".to_string())?;
    ensure_current(generation)?;
    ENABLED.store(true, Ordering::SeqCst);
    Ok(())
}

fn coordinated<T>(
    generation: u64,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let _guard = CONTROL_LOCK
        .lock()
        .map_err(|_| "worker_unavailable".to_string())?;
    ensure_current(generation)?;
    let result = operation();
    ensure_current(generation)?;
    result
}

/// Runs only inside Tools; no launchd/login item/service is installed.
pub(crate) fn initialize() {
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let saved_enabled = super::config::load_app_config()
        .map(|c| c.app_localization.enabled)
        .unwrap_or(false);
    if let Ok(_intent) = INTENT_LOCK.lock() {
        if INTENT_GENERATION.load(Ordering::SeqCst) == 0 && !SHUTTING_DOWN.load(Ordering::SeqCst) {
            ENABLED.store(saved_enabled, Ordering::SeqCst);
        }
    }
    if !cfg!(target_os = "macos") {
        return;
    }
    let worker = std::thread::Builder::new()
        .name("app-localization".into())
        .spawn(|| loop {
            if SHUTTING_DOWN.load(Ordering::SeqCst) {
                break;
            }
            if ENABLED.load(Ordering::SeqCst)
                || SESSION.lock().map(|s| s.is_some()).unwrap_or(false)
            {
                let _ = tick(false);
            }
            std::thread::park_timeout(Duration::from_secs(3));
        });
    match worker {
        Ok(worker) => {
            if let Ok(mut handle) = WORKER.lock() {
                *handle = Some(worker.thread().clone());
            }
        }
        Err(_) => {
            ENABLED.store(false, Ordering::SeqCst);
            STARTED.store(false, Ordering::SeqCst);
            publish(snapshot(false, None, "error", Some("worker_unavailable")));
        }
    }
}
fn wake() {
    if let Ok(handle) = WORKER.lock() {
        if let Some(handle) = handle.as_ref() {
            handle.unpark();
        }
    }
}

/// Best-effort cleanup before the host exits; runtime's lease is the fallback.
pub(crate) fn shutdown() {
    {
        let _intent = INTENT_LOCK.lock();
        SHUTTING_DOWN.store(true, Ordering::SeqCst);
        INTENT_GENERATION.fetch_add(1, Ordering::SeqCst);
        ENABLED.store(false, Ordering::SeqCst);
    }
    wake();
    // Wait for an earlier IPC transaction before the final stop, and reject
    // queued/new commands. Otherwise an older enable could restart the lease.
    let _control = CONTROL_LOCK.lock();
    ENABLED.store(false, Ordering::SeqCst);
    if let Ok(mut sessions) = SESSION.lock() {
        let _ = dispose(&mut sessions);
    }
}

#[tauri::command]
pub async fn get_app_localization_status() -> Result<LocalizationStatus, String> {
    initialize();
    tokio::task::spawn_blocking(|| {
        if let Ok(s) = SNAPSHOT.lock() {
            if let Some(s) = s.as_ref() {
                if ENABLED.load(Ordering::SeqCst) || s.state == "restore_pending" {
                    let mut view = s.clone();
                    if view.active && view.observed_at.elapsed() > Duration::from_secs(12) {
                        view.active = false;
                        view.translated = 0;
                        view.state = "error".into();
                        view.detail = Some("connection_timeout".into());
                    }
                    return view;
                }
            }
        }
        preflight(ENABLED.load(Ordering::SeqCst)).0
    })
    .await
    .map_err(|_| "worker_unavailable".into())
}

#[tauri::command]
pub async fn set_app_localization_enabled(enabled: bool) -> Result<LocalizationStatus, String> {
    initialize();
    let generation = new_intent(enabled)?;
    if !enabled {
        wake();
    }
    tokio::task::spawn_blocking(move || {
        coordinated(generation, || {
            if enabled && !WORKER.lock().map(|w| w.is_some()).unwrap_or(false) {
                return Err("worker_unavailable".to_string());
            }
            if enabled && !preflight(false).0.supported {
                return Err("unsupported_version_or_platform".to_string());
            }
            // Stopping must work even when the preference file is unwritable.
            // Report that persistence failed only after cancelling and cleaning up.
            if !enabled {
                ENABLED.store(false, Ordering::SeqCst);
            }
            ensure_current(generation)?;
            let saved = super::config::set_app_localization_enabled(enabled);
            if enabled {
                saved.map_err(|_| "config_unavailable".to_string())?;
                commit_enabled(generation)?;
                let result = tick(true);
                wake();
                Ok(result)
            } else {
                let result = tick(false);
                wake();
                saved.map_err(|_| "disable_not_saved".to_string())?;
                Ok(result)
            }
        })
    })
    .await
    .map_err(|_| "worker_unavailable".to_string())?
}

#[tauri::command]
pub async fn apply_app_localization(launch: bool) -> Result<LocalizationStatus, String> {
    initialize();
    // Never launch an App or add debugging flags. Kept for old UI compatibility.
    if launch {
        return Err("open_app_manually".to_string());
    }
    let generation = INTENT_GENERATION.load(Ordering::SeqCst);
    tokio::task::spawn_blocking(move || {
        coordinated(generation, || {
            if !ENABLED.load(Ordering::SeqCst) {
                return Err("feature_disabled".to_string());
            }
            Ok(tick(true))
        })
    })
    .await
    .map_err(|_| "worker_unavailable".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn official_package(version: &str) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "name":"antigravity", "productName":"Antigravity",
            "description":"Antigravity - Agentic Desktop Application", "version":version
        }))
        .unwrap()
    }

    static INTENT_TEST_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn delayed_old_enable_cannot_run_after_new_disable_completed() {
        let _test = INTENT_TEST_LOCK.lock().unwrap();
        let old = new_intent(true).unwrap();
        let latest = new_intent(false).unwrap();
        coordinated(latest, || Ok(())).unwrap();
        let mut ran = false;
        assert_eq!(
            coordinated(old, || {
                ran = true;
                commit_enabled(old)
            }),
            Err("operation_superseded".into())
        );
        assert!(!ran);
        assert!(!ENABLED.load(Ordering::SeqCst));
    }

    #[test]
    fn disable_arriving_during_old_enable_write_prevents_runtime_revival() {
        use std::sync::{mpsc, Arc};
        let _test = INTENT_TEST_LOCK.lock().unwrap();
        let persisted = Arc::new(AtomicBool::new(false));
        let (written_tx, written_rx) = mpsc::channel();
        let (resume_tx, resume_rx) = mpsc::channel();
        let old = new_intent(true).unwrap();
        std::thread::scope(|scope| {
            let disk = persisted.clone();
            let enable = scope.spawn(move || {
                coordinated(old, || {
                    disk.store(true, Ordering::SeqCst);
                    written_tx.send(()).unwrap();
                    resume_rx.recv().unwrap();
                    commit_enabled(old)
                })
            });
            written_rx.recv().unwrap();
            assert!(CONTROL_LOCK.try_lock().is_err());
            let latest = new_intent(false).unwrap();
            let disk = persisted.clone();
            let disable = scope.spawn(move || {
                coordinated(latest, || {
                    disk.store(false, Ordering::SeqCst);
                    Ok(())
                })
            });
            resume_tx.send(()).unwrap();
            assert_eq!(enable.join().unwrap(), Err("operation_superseded".into()));
            disable.join().unwrap().unwrap();
        });
        assert!(!persisted.load(Ordering::SeqCst));
        assert!(!ENABLED.load(Ordering::SeqCst));
    }

    #[test]
    fn absent_scopes_never_claim_visible_translation() {
        assert_eq!(applied_state(0, false), "waiting_ui");
        assert_eq!(applied_state(0, true), "waiting_ui");
        assert_eq!(applied_state(1, true), "waiting_ui");
        assert_eq!(applied_state(1, false), "applied");
    }

    #[test]
    fn reads_only_standalone_app_identity() {
        assert_eq!(
            package_version(&official_package("2.19.1")),
            Some("2.19.1".into())
        );
        for version in ["", "2.19", "2.19.1-extra", "2.19.1.1", "a.b.c"] {
            assert_eq!(package_version(&official_package(version)), None);
        }
        assert_eq!(
            package_version(br#"{"name":"antigravity","version":"2.19.1"}"#),
            None
        );
        assert_eq!(package_version(b"not JSON"), None);
    }

    #[test]
    fn version_and_platform_gates_are_exact() {
        assert_eq!(supported_versions(), &["2.19.1"]);
        assert!(compatible("2.19.1", "macos"));
        for (version, platform) in [
            ("2.19.2", "macos"),
            ("2.19.1-beta", "macos"),
            ("2.19.1", "linux"),
            ("2.19.1", "windows"),
        ] {
            assert!(!compatible(version, platform));
        }
        let state = snapshot(
            true,
            Some("999.0.0".into()),
            "unsupported_version",
            Some("version_changed"),
        );
        assert!(!state.supported);
        assert!(!state.can_apply);
        assert!(!state.active);
    }

    #[test]
    fn dictionary_is_only_reviewed_exact_plain_text() {
        let d: Value = serde_json::from_str(DICTIONARY).unwrap();
        let map = d["exact"].as_object().unwrap();
        assert_eq!(d.as_object().unwrap().len(), 2);
        for (key, value) in map {
            assert!(!key.is_empty() && key.len() < 300);
            let value = value.as_str().unwrap();
            assert!(!value.is_empty() && value.len() < 300);
            assert!(!value.contains('<') && !value.contains('>'));
            assert!(!value.contains("http") && !value.contains('\n'));
        }
    }

    #[test]
    fn malformed_asar_is_rejected_without_executing_anything() {
        let root = std::env::temp_dir().join(format!("atl-asar-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("app.asar");
        for bytes in [vec![], vec![0; 16], vec![255; 16]] {
            std::fs::write(&path, bytes).unwrap();
            assert_eq!(read_asar_version(&path), None);
        }
        let package = official_package("2.19.1");
        let header = serde_json::to_vec(&serde_json::json!({"files":{"package.json":{
            "size":package.len(), "offset":"0"
        }}}))
        .unwrap();
        let mut bytes = Vec::new();
        for n in [
            4,
            header.len() as u32 + 8,
            header.len() as u32 + 4,
            header.len() as u32,
        ] {
            bytes.extend_from_slice(&n.to_le_bytes());
        }
        bytes.extend_from_slice(&header);
        bytes.extend_from_slice(&package);
        std::fs::write(&path, &bytes).unwrap();
        assert_eq!(read_asar_version(&path), Some("2.19.1".to_string()));
        bytes.truncate(bytes.len() - 1);
        std::fs::write(&path, bytes).unwrap();
        assert_eq!(read_asar_version(&path), None);
        std::fs::remove_dir_all(root).unwrap();
    }
}
