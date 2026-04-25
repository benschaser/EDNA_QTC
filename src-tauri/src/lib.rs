use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::ErrorKind,
    net::UdpSocket,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager, State};

const TELEMETRY_EVENT: &str = "telemetry://packet";
const SETTINGS_FILE_NAME: &str = "telemetry-console-settings.json";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct TelemetryPacket {
    pitch: f32,
    roll: f32,
    #[serde(default)]
    yaw_rate: f32,
    #[serde(default)]
    pitch_sp: f32,
    #[serde(default)]
    roll_sp: f32,
    #[serde(default)]
    yaw_sp: f32,
    #[serde(default)]
    pitch_out: f32,
    #[serde(default)]
    roll_out: f32,
    #[serde(default)]
    yaw_out: f32,
    #[serde(default)]
    m_fl: u32,
    #[serde(default)]
    m_fr: u32,
    #[serde(default)]
    m_rl: u32,
    #[serde(default)]
    m_rr: u32,
    #[serde(default)]
    throttle: i32,
    #[serde(default)]
    kp_pitch: f32,
    #[serde(default)]
    ki_pitch: f32,
    #[serde(default)]
    kd_pitch: f32,
    #[serde(default)]
    kp_roll: f32,
    #[serde(default)]
    ki_roll: f32,
    #[serde(default)]
    kd_roll: f32,
    #[serde(default)]
    kp_yaw: f32,
    #[serde(default)]
    ki_yaw: f32,
    #[serde(default)]
    kd_yaw: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TelemetryConfig {
    #[serde(default = "default_host")]
    host: String,
    #[serde(default = "default_port")]
    port: u16,
    #[serde(default = "default_local_port")]
    local_port: u16,
}

#[derive(Debug, Clone, Serialize)]
struct TelemetryStatus {
    listening: bool,
    host: String,
    port: u16,
    local_port: u16,
    last_packet: Option<TelemetryPacket>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PidUpdate {
    axis: String,
    kp: f32,
    ki: f32,
    kd: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PidAxisSettings {
    kp: f32,
    ki: f32,
    kd: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PidSettings {
    pitch: PidAxisSettings,
    roll: PidAxisSettings,
    yaw: PidAxisSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppSettings {
    telemetry: TelemetryConfig,
    pid_drafts: PidSettings,
    #[serde(default)]
    packet_log_dir: String,
}

struct TelemetryRuntime {
    config: TelemetryConfig,
    socket: UdpSocket,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    last_packet: Arc<Mutex<Option<TelemetryPacket>>>,
}

struct TelemetryState {
    settings: Arc<Mutex<AppSettings>>,
    runtime: Mutex<Option<TelemetryRuntime>>,
}

struct PacketLogger {
    active_dir: Option<PathBuf>,
    file: Option<File>,
}

fn default_host() -> String {
    "192.168.4.1".to_string()
}

fn default_port() -> u16 {
    4444
}

fn default_local_port() -> u16 {
    4444
}

impl Default for PidSettings {
    fn default() -> Self {
        Self {
            pitch: PidAxisSettings {
                kp: 1.2,
                ki: 0.01,
                kd: 0.08,
            },
            roll: PidAxisSettings {
                kp: 1.2,
                ki: 0.01,
                kd: 0.08,
            },
            yaw: PidAxisSettings {
                kp: 2.0,
                ki: 0.05,
                kd: 0.0,
            },
        }
    }
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            telemetry: TelemetryConfig {
                host: default_host(),
                port: default_port(),
                local_port: default_local_port(),
            },
            pid_drafts: PidSettings::default(),
            packet_log_dir: String::new(),
        }
    }
}

impl TelemetryState {
    fn new(settings: AppSettings) -> Self {
        Self {
            settings: Arc::new(Mutex::new(settings)),
            runtime: Mutex::new(None),
        }
    }
}

impl PacketLogger {
    fn new() -> Self {
        Self {
            active_dir: None,
            file: None,
        }
    }

    fn write_packet(&mut self, log_dir: &str, packet: &TelemetryPacket) -> Result<(), String> {
        let trimmed = log_dir.trim();
        if trimmed.is_empty() {
            self.active_dir = None;
            self.file = None;
            return Ok(());
        }

        let desired_dir = PathBuf::from(trimmed);
        if self.active_dir.as_ref() != Some(&desired_dir) || self.file.is_none() {
            fs::create_dir_all(&desired_dir)
                .map_err(|err| format!("Could not create packet log directory {}: {err}", desired_dir.display()))?;

            let file_path = desired_dir.join(format!("telemetry-{}.jsonl", session_timestamp()));
            let file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&file_path)
                .map_err(|err| format!("Could not open packet log file {}: {err}", file_path.display()))?;

            self.active_dir = Some(desired_dir);
            self.file = Some(file);
        }

        if let Some(file) = self.file.as_mut() {
            serde_json::to_writer(&mut *file, packet).map_err(|err| err.to_string())?;
            use std::io::Write;
            file.write_all(b"\n").map_err(|err| err.to_string())?;
            file.flush().map_err(|err| err.to_string())?;
        }

        Ok(())
    }
}

#[tauri::command]
fn start_telemetry(
    app: tauri::AppHandle,
    state: State<'_, TelemetryState>,
    config: TelemetryConfig,
) -> Result<TelemetryStatus, String> {
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| "Telemetry state lock failed".to_string())?;

    if let Some(existing) = runtime.as_ref() {
        return Ok(status_from_runtime(existing, true));
    }

    let bind_addr = format!("0.0.0.0:{}", config.local_port);
    let socket =
        UdpSocket::bind(&bind_addr).map_err(|err| format!("Could not bind {bind_addr}: {err}"))?;
    socket
        .set_read_timeout(Some(Duration::from_millis(200)))
        .map_err(|err| format!("Could not configure UDP timeout: {err}"))?;

    let remote_addr = format!("{}:{}", config.host, config.port);
    socket
        .connect(&remote_addr)
        .map_err(|err| format!("Could not connect UDP socket to {remote_addr}: {err}"))?;
    socket
        .send(b"{\"hello\":\"telemetry-console\"}\n")
        .map_err(|err| format!("Could not send telemetry handshake: {err}"))?;

    let reader = socket
        .try_clone()
        .map_err(|err| format!("Could not clone UDP socket: {err}"))?;
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = Arc::clone(&stop);
    let last_packet = Arc::new(Mutex::new(None));
    let thread_last_packet = Arc::clone(&last_packet);
    let settings = Arc::clone(&state.settings);

    let thread = thread::spawn(move || {
        let mut buf = [0_u8; 2048];
        let mut logger = PacketLogger::new();

        while !thread_stop.load(Ordering::Relaxed) {
            match reader.recv(&mut buf) {
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]);

                    for line in text.lines().filter(|line| !line.trim().is_empty()) {
                        match serde_json::from_str::<TelemetryPacket>(line) {
                            Ok(packet) => {
                                if let Ok(mut last) = thread_last_packet.lock() {
                                    *last = Some(packet.clone());
                                }
                                let log_dir = settings
                                    .lock()
                                    .ok()
                                    .map(|current| current.packet_log_dir.clone())
                                    .unwrap_or_default();
                                if let Err(err) = logger.write_packet(&log_dir, &packet) {
                                    eprintln!("{err}");
                                }
                                let _ = app.emit(TELEMETRY_EVENT, packet);
                            }
                            Err(err) => {
                                eprintln!("Ignoring malformed telemetry packet: {err}: {line}");
                            }
                        }
                    }
                }
                Err(err)
                    if err.kind() == ErrorKind::WouldBlock || err.kind() == ErrorKind::TimedOut => {}
                Err(err) => {
                    eprintln!("Telemetry UDP receive failed: {err}");
                    thread::sleep(Duration::from_millis(250));
                }
            }
        }
    });

    let status = TelemetryStatus {
        listening: true,
        host: config.host.clone(),
        port: config.port,
        local_port: config.local_port,
        last_packet: None,
    };

    *runtime = Some(TelemetryRuntime {
        config,
        socket,
        stop,
        thread: Some(thread),
        last_packet,
    });

    Ok(status)
}

#[tauri::command]
fn stop_telemetry(state: State<'_, TelemetryState>) -> Result<(), String> {
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| "Telemetry state lock failed".to_string())?;

    if let Some(mut current) = runtime.take() {
        current.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = current.thread.take() {
            thread
                .join()
                .map_err(|_| "Telemetry receive thread panicked".to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
fn telemetry_status(state: State<'_, TelemetryState>) -> Result<TelemetryStatus, String> {
    let runtime = state
        .runtime
        .lock()
        .map_err(|_| "Telemetry state lock failed".to_string())?;

    Ok(runtime
        .as_ref()
        .map(|current| status_from_runtime(current, true))
        .unwrap_or_else(|| TelemetryStatus {
            listening: false,
            host: default_host(),
            port: default_port(),
            local_port: default_local_port(),
            last_packet: None,
        }))
}

#[tauri::command]
fn load_app_settings(state: State<'_, TelemetryState>) -> Result<AppSettings, String> {
    state
        .settings
        .lock()
        .map(|settings| settings.clone())
        .map_err(|_| "Telemetry settings lock failed".to_string())
}

#[tauri::command]
fn save_app_settings(
    app: tauri::AppHandle,
    state: State<'_, TelemetryState>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    {
        let mut current = state
            .settings
            .lock()
            .map_err(|_| "Telemetry settings lock failed".to_string())?;
        *current = settings.clone();
    }

    let settings_path = settings_path(&app)?;
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Could not create settings directory {}: {err}", parent.display()))?;
    }

    let payload = serde_json::to_vec_pretty(&settings).map_err(|err| err.to_string())?;
    fs::write(&settings_path, payload)
        .map_err(|err| format!("Could not save settings file {}: {err}", settings_path.display()))?;

    Ok(settings)
}

#[tauri::command]
fn send_pid_update(state: State<'_, TelemetryState>, update: PidUpdate) -> Result<(), String> {
    if !matches!(update.axis.as_str(), "pitch" | "roll" | "yaw") {
        return Err("Axis must be pitch, roll, or yaw".to_string());
    }
    if update.kp < 0.0 || update.ki < 0.0 || update.kd < 0.0 {
        return Err("PID gains must be zero or greater".to_string());
    }

    let runtime = state
        .runtime
        .lock()
        .map_err(|_| "Telemetry state lock failed".to_string())?;
    let current = runtime
        .as_ref()
        .ok_or_else(|| "Telemetry is not connected".to_string())?;
    let payload = serde_json::to_vec(&update).map_err(|err| err.to_string())?;

    current
        .socket
        .send(&payload)
        .map(|_| ())
        .map_err(|err| format!("Could not send PID update: {err}"))
}

fn status_from_runtime(runtime: &TelemetryRuntime, listening: bool) -> TelemetryStatus {
    let last_packet = runtime
        .last_packet
        .lock()
        .ok()
        .and_then(|last| (*last).clone());

    TelemetryStatus {
        listening,
        host: runtime.config.host.clone(),
        port: runtime.config.port,
        local_port: runtime.config.local_port,
        last_packet,
    }
}

fn load_settings_from_disk(app: &tauri::AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let contents =
        fs::read_to_string(&path).map_err(|err| format!("Could not read settings file {}: {err}", path.display()))?;
    serde_json::from_str(&contents)
        .map_err(|err| format!("Could not parse settings file {}: {err}", path.display()))
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("Could not resolve app config directory: {err}"))?;
    Ok(Path::new(&config_dir).join(SETTINGS_FILE_NAME))
}

fn session_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let settings = load_settings_from_disk(&app.handle()).unwrap_or_else(|err| {
                eprintln!("{err}");
                AppSettings::default()
            });
            app.manage(TelemetryState::new(settings));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_telemetry,
            stop_telemetry,
            telemetry_status,
            load_app_settings,
            save_app_settings,
            send_pid_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
