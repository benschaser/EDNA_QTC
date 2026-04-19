import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const MAX_HISTORY = 180;

export const defaultPid = {
  pitch: { kp: 1.2, ki: 0.01, kd: 0.08 },
  roll: { kp: 1.2, ki: 0.01, kd: 0.08 },
  yaw: { kp: 2.0, ki: 0.05, kd: 0.0 },
};

const baseTelemetry = {
  pitch: 0,
  roll: 0,
  yaw_rate: 0,
  pitch_sp: 0,
  roll_sp: 0,
  yaw_sp: 0,
  pitch_out: 0,
  roll_out: 0,
  yaw_out: 0,
  m_fl: 1000,
  m_fr: 1000,
  m_rl: 1000,
  m_rr: 1000,
  throttle: 1000,
  kp_pitch: defaultPid.pitch.kp,
  ki_pitch: defaultPid.pitch.ki,
  kd_pitch: defaultPid.pitch.kd,
  kp_roll: defaultPid.roll.kp,
  ki_roll: defaultPid.roll.ki,
  kd_roll: defaultPid.roll.kd,
  kp_yaw: defaultPid.yaw.kp,
  ki_yaw: defaultPid.yaw.ki,
  kd_yaw: defaultPid.yaw.kd,
};

export const emptyTelemetryPacket = normalizePacket({
  ...baseTelemetry,
  t: Date.now(),
});

export function createMockPacket(seconds) {
  const wobble = Math.sin(seconds * 1.7);
  const drift = Math.cos(seconds * 0.42);
  const throttle = 1190 + Math.sin(seconds * 0.7) * 90;

  return normalizePacket({
    ...baseTelemetry,
    t: Date.now(),
    roll: wobble * 14,
    pitch: Math.sin(seconds * 1.2 + 0.9) * 9,
    yaw_rate: drift * 22,
    pitch_sp: Math.sin(seconds * 0.5) * 3,
    roll_sp: Math.cos(seconds * 0.54) * 3,
    yaw_sp: Math.sin(seconds * 0.36) * 10,
    pitch_out: Math.sin(seconds * 2.0) * 18,
    roll_out: Math.cos(seconds * 1.8) * 18,
    yaw_out: Math.sin(seconds * 1.1) * 12,
    throttle,
    m_fl: throttle + wobble * 80 - drift * 25,
    m_fr: throttle - wobble * 70 + drift * 20,
    m_rl: throttle + wobble * 45 + drift * 65,
    m_rr: throttle - wobble * 50 - drift * 55,
  });
}

export function normalizePacket(packet) {
  const merged = { ...baseTelemetry, ...packet };
  const timestamp = Number(packet?.t ?? Date.now());

  return {
    ...merged,
    t: timestamp,
    roll: Number(merged.roll) || 0,
    pitch: Number(merged.pitch) || 0,
    yaw_rate: Number(merged.yaw_rate) || 0,
    throttle: Number(merged.throttle) || 0,
    m_fl: Number(merged.m_fl) || 0,
    m_fr: Number(merged.m_fr) || 0,
    m_rl: Number(merged.m_rl) || 0,
    m_rr: Number(merged.m_rr) || 0,
  };
}

export function useTelemetry() {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState([]);
  const [lastSeenAt, setLastSeenAt] = useState(null);
  const [target, setTarget] = useState({
    host: "192.168.4.1",
    port: 4444,
    localPort: 4444,
  });

  useEffect(() => {
    let unlisten = () => {};

    listen("telemetry://packet", (event) => {
      const packet = normalizePacket(event.payload);
      setLatest(packet);
      setLastSeenAt(Date.now());
      setConnected(true);
      setHistory((items) => [...items.slice(-(MAX_HISTORY - 1)), packet]);
    })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch((err) => {
        setError(`Telemetry event listener failed: ${err}`);
      });

    return () => unlisten();
  }, []);

  const connect = useCallback(
    async (nextTarget = target) => {
      setConnecting(true);
      setError("");

      try {
        const status = await invoke("start_telemetry", {
          config: {
            host: nextTarget.host,
            port: Number(nextTarget.port),
            local_port: Number(nextTarget.localPort),
          },
        });
        setConnected(Boolean(status.listening));
        setTarget(nextTarget);
      } catch (err) {
        setConnected(false);
        setError(String(err));
      } finally {
        setConnecting(false);
      }
    },
    [target],
  );

  const disconnect = useCallback(async () => {
    setError("");

    try {
      await invoke("stop_telemetry");
      setConnected(false);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const sendPid = useCallback(async (drafts) => {
    setError("");

    try {
      await Promise.all(
        ["pitch", "roll", "yaw"].map((axis) =>
          invoke("send_pid_update", {
            update: {
              axis,
              kp: Number(drafts[axis].kp),
              ki: Number(drafts[axis].ki),
              kd: Number(drafts[axis].kd),
            },
          }),
        ),
      );
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  }, []);

  return useMemo(
    () => ({
      connected,
      connecting,
      error,
      latest,
      history,
      lastSeenAt,
      target,
      setTarget,
      connect,
      disconnect,
      sendPid,
    }),
    [connected, connecting, error, latest, history, lastSeenAt, target, connect, disconnect, sendPid],
  );
}
