use serde::{Deserialize, Serialize};
use std::{
    io::ErrorKind,
    net::UdpSocket,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::Duration,
};
use tauri::{Emitter, State};

const TELEMETRY_EVENT: &str = "telemetry://packet";

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

struct TelemetryRuntime {
    config: TelemetryConfig,
    socket: UdpSocket,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    last_packet: Arc<Mutex<Option<TelemetryPacket>>>,
}

#[derive(Default)]
struct TelemetryState {
    runtime: Mutex<Option<TelemetryRuntime>>,
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

    let thread = thread::spawn(move || {
        let mut buf = [0_u8; 2048];

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(TelemetryState::default())
        .invoke_handler(tauri::generate_handler![
            start_telemetry,
            stop_telemetry,
            telemetry_status,
            send_pid_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
