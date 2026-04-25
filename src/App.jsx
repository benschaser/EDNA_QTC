import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FocusStyleManager, OverlayToaster, Position } from "@blueprintjs/core";
import { invoke } from "@tauri-apps/api/core";

import "./App.css";
import DroneAttitude from "./components/DroneAttitude";
import MotorStats from "./components/MotorStats";
import PidPanel from "./components/PidPanel";
import OrientationPanel from "./components/OrientationPanel";
import TelemetryStats from "./components/TelemetryStats";
import TopBar from "./components/TopBar";
import { defaultPid, emptyTelemetryPacket, useTelemetry } from "./telemetryClient";

FocusStyleManager.onlyShowFocusOnTabs();

const appToaster = OverlayToaster.create({
  maxToasts: 4,
  position: Position.TOP_RIGHT,
});

const pidAxes = ["pitch", "roll", "yaw"];
const pidGains = ["kp", "ki", "kd"];
const PID_CONFIRM_TIMEOUT_MS = 2000;
const PID_CONFIRM_TOLERANCE = 0.0001;

function App() {
  const telemetry = useTelemetry();
  const lastToastedError = useRef("");
  const pidConfirmationTimeout = useRef(null);
  const [pidDrafts, setPidDrafts] = useState(defaultPid);
  const [lastConfirmedPid, setLastConfirmedPid] = useState(defaultPid);
  const [pidDraftsInitialized, setPidDraftsInitialized] = useState(false);
  const [pendingPidConfirmation, setPendingPidConfirmation] = useState(null);
  const [packetLogDir, setPacketLogDir] = useState("");
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    invoke("load_app_settings")
      .then((settings) => {
        if (cancelled || !settings) return;

        const savedTarget = hydrateTargetSettings(settings.telemetry);
        const savedPid = normalizePidDrafts(settings.pid_drafts);
        telemetry.setTarget(savedTarget);
        setPidDrafts(savedPid);
        setLastConfirmedPid(savedPid);
        setPidDraftsInitialized(true);
        setPacketLogDir(String(settings.packet_log_dir ?? ""));
      })
      .catch((err) => {
        if (cancelled) return;
        appToaster.then((toaster) => {
          toaster.show({
            icon: "warning-sign",
            intent: "warning",
            message: `Could not load saved settings: ${String(err)}`,
            timeout: 5000,
          });
        });
      })
      .finally(() => {
        if (!cancelled) {
          setSettingsLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [telemetry.setTarget]);

  useEffect(() => {
    if (!telemetry.latest || pidDraftsInitialized) return;

    const incomingPid = pidDraftsFromPacket(telemetry.latest);
    setPidDrafts(incomingPid);
    setLastConfirmedPid(incomingPid);
    setPidDraftsInitialized(true);
  }, [pidDraftsInitialized, telemetry.latest]);

  useEffect(() => {
    if (!telemetry.error || telemetry.error === lastToastedError.current) return;

    lastToastedError.current = telemetry.error;
    appToaster.then((toaster) => {
      toaster.show(
        {
          icon: "error",
          intent: "danger",
          message: telemetry.error,
          timeout: 6500,
        },
        "telemetry-error",
      );
    });
  }, [telemetry.error]);

  useEffect(() => {
    return () => {
      if (pidConfirmationTimeout.current) {
        clearTimeout(pidConfirmationTimeout.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;

    invoke("save_app_settings", {
      settings: {
        telemetry: normalizeTargetSettings(telemetry.target),
        pid_drafts: normalizePidDrafts(pidDrafts),
        packet_log_dir: packetLogDir.trim(),
      },
    }).catch((err) => {
      const message = `Could not save settings: ${String(err)}`;
      if (lastToastedError.current === message) return;
      lastToastedError.current = message;
      appToaster.then((toaster) => {
        toaster.show({
          icon: "floppy-disk",
          intent: "warning",
          message,
          timeout: 5000,
        });
      });
    });
  }, [settingsLoaded, telemetry.target, pidDrafts, packetLogDir]);

  useEffect(() => {
    if (!pendingPidConfirmation || !telemetry.latest) return;

    const incomingPid = pidDraftsFromPacket(telemetry.latest);
    if (!pidDraftsMatch(incomingPid, pendingPidConfirmation)) return;

    if (pidConfirmationTimeout.current) {
      clearTimeout(pidConfirmationTimeout.current);
      pidConfirmationTimeout.current = null;
    }

    setLastConfirmedPid(pendingPidConfirmation);
    setPendingPidConfirmation(null);
    appToaster.then((toaster) => {
      toaster.show(
        {
          icon: "tick-circle",
          intent: "success",
          message: "PID gains confirmed by drone",
          timeout: 3500,
        },
        "pid-confirmed",
      );
    });
  }, [pendingPidConfirmation, telemetry.latest]);

  const handleSendPid = useCallback(
    async (drafts) => {
      const sentPid = normalizePidDrafts(drafts);
      const sent = await telemetry.sendPid(sentPid);
      if (!sent) return;

      if (pidConfirmationTimeout.current) {
        clearTimeout(pidConfirmationTimeout.current);
      }

      setPendingPidConfirmation(sentPid);
      appToaster.then((toaster) => {
        toaster.show(
          {
            icon: "send-message",
            intent: "primary",
            message: "PID gains sent. Waiting for drone confirmation.",
            timeout: 2200,
          },
          "pid-sent",
        );
      });

      pidConfirmationTimeout.current = setTimeout(() => {
        setPendingPidConfirmation(null);
        pidConfirmationTimeout.current = null;
        appToaster.then((toaster) => {
          toaster.show(
            {
              icon: "warning-sign",
              intent: "warning",
              message: "PID gains not confirmed. Drone is still reporting different values.",
              timeout: 6500,
            },
            "pid-not-confirmed",
          );
        });
      }, PID_CONFIRM_TIMEOUT_MS);
    },
    [telemetry],
  );

  const packet = telemetry.latest ?? emptyTelemetryPacket;
  const connectionLabel = telemetry.connected ? "Live UDP" : telemetry.error ? "Link fault" : "Awaiting data";

  const health = useMemo(
    () => ({
      connectionLabel,
      sampleCount: telemetry.history.length,
      ageMs: telemetry.lastSeenAt ? Date.now() - telemetry.lastSeenAt : null,
    }),
    [connectionLabel, telemetry.history.length, telemetry.lastSeenAt],
  );

  return (
    <main className="bp6-dark app-shell">
      <TopBar telemetry={telemetry} health={health} packetLogDir={packetLogDir} onPacketLogDirChange={setPacketLogDir} />

      <section className="dashboard-grid">
        <MotorStats packet={packet} />
        <OrientationPanel data={telemetry.history.length ? telemetry.history : [packet]} />

        <TelemetryStats packet={packet} health={health} />

        {/* <section className="panel attitude-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Airframe</p>
              <h2>Attitude</h2>
            </div>
            <div className="readout-pill">{Math.round(packet.throttle)} us</div>
          </div>
          <DroneAttitude packet={packet} />
        </section> */}

        {/* <section className="panel chart-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Orientation</p>
              <h2>Roll, pitch, yaw rate</h2>
            </div>
            <div className="legend-row">
              <span className="legend-dot roll" /> Roll
              <span className="legend-dot pitch" /> Pitch
              <span className="legend-dot yaw" /> Yaw rate
            </div>
          </div>
          <RealtimeRotationChart data={telemetry.history.length ? telemetry.history : [packet]} />
        </section> */}

        {/* <MotorPanel packet={packet} /> */}

        <PidPanel
          drafts={pidDrafts}
          lastConfirmedDrafts={lastConfirmedPid}
          onDraftsChange={setPidDrafts}
          onUndoChanges={() => setPidDrafts(lastConfirmedPid)}
          onSend={handleSendPid}
          connected={telemetry.connected}
        />
      </section>
    </main>
  );
}

function normalizePidDrafts(drafts) {
  return pidAxes.reduce((normalized, axis) => {
    normalized[axis] = pidGains.reduce((axisGains, gain) => {
      const value = Number(drafts?.[axis]?.[gain]);
      axisGains[gain] = Number.isFinite(value) ? value : 0;
      return axisGains;
    }, {});
    return normalized;
  }, {});
}

function normalizeTargetSettings(target) {
  return {
    host: String(target?.host ?? "192.168.4.1"),
    port: Number(target?.port) || 4444,
    local_port: Number(target?.localPort ?? target?.local_port) || 4444,
  };
}

function hydrateTargetSettings(target) {
  return {
    host: String(target?.host ?? "192.168.4.1"),
    port: Number(target?.port) || 4444,
    localPort: Number(target?.local_port ?? target?.localPort) || 4444,
  };
}

function pidDraftsMatch(left, right) {
  return pidAxes.every((axis) =>
    pidGains.every((gain) => {
      const actual = Number(left?.[axis]?.[gain]);
      const expected = Number(right?.[axis]?.[gain]);
      return Number.isFinite(actual) && Number.isFinite(expected)
        ? Math.abs(actual - expected) <= PID_CONFIRM_TOLERANCE
        : actual === expected;
    }),
  );
}

function pidDraftsFromPacket(packet) {
  return {
    pitch: {
      kp: packet.kp_pitch,
      ki: packet.ki_pitch,
      kd: packet.kd_pitch,
    },
    roll: {
      kp: packet.kp_roll,
      ki: packet.ki_roll,
      kd: packet.kd_roll,
    },
    yaw: {
      kp: packet.kp_yaw,
      ki: packet.ki_yaw,
      kd: packet.kd_yaw,
    },
  };
}

export default App;
