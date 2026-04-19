import React from "react";

const motors = [
  { key: "m_fl", label: "FL", className: "front-left" },
  { key: "m_fr", label: "FR", className: "front-right" },
  { key: "m_rl", label: "RL", className: "rear-left" },
  { key: "m_rr", label: "RR", className: "rear-right" },
];

function DroneAttitude({ packet }) {
  const transform = `rotateX(${clamp(packet.pitch, -45, 45)}deg) rotateY(${clamp(
    -packet.roll,
    -45,
    45,
  )}deg) rotateZ(${clamp(packet.yaw_rate / 3, -35, 35)}deg)`;

  return (
    <div className="attitude-stage">
      <div className="horizon-grid" />
      {/* <div className="drone-model" style={{ transform }}>
        <div className="drone-arm arm-x" />
        <div className="drone-arm arm-y" />
        <div className="drone-body">
          <span>EDNA</span>
          <b />
        </div>
        {motors.map((motor) => (
          <div
            className={`motor-pod ${motor.className}`}
            key={motor.key}
            style={{ "--spin-speed": `${spinSpeed(packet[motor.key])}ms` }}
          >
            <div className="propeller" />
            <span>{motor.label}</span>
          </div>
        ))}
      </div> */}
      <div className="attitude-footer">
        <span>Roll {packet.roll.toFixed(1)} deg</span>
        <span>Pitch {packet.pitch.toFixed(1)} deg</span>
        <span>Yaw {packet.yaw_rate.toFixed(1)} deg/s</span>
      </div>
    </div>
  );
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function spinSpeed(value) {
  const normalized = clamp((Number(value) - 1000) / 1000, 0, 1);
  return Math.round(620 - normalized * 470);
}

export default DroneAttitude;
