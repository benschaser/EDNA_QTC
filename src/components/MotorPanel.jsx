import React from "react";

const motorRows = [
  { key: "m_fl", label: "Front left" },
  { key: "m_fr", label: "Front right" },
  { key: "m_rl", label: "Rear left" },
  { key: "m_rr", label: "Rear right" },
];

function MotorPanel({ packet }) {
  return (
    <section className="panel motor-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Mix</p>
          <h2>Motor speeds</h2>
        </div>
        <div className="readout-pill">{average(packet).toFixed(0)} &micro;s avg</div>
      </div>

      <div className="motor-list">
        {motorRows.map((motor) => {
          const value = Number(packet[motor.key]) || 0;
          const pct = Math.min(100, Math.max(0, ((value - 1000) / 1000) * 100));

          return (
            <div className="motor-row" key={motor.key}>
              <div>
                <span>{motor.label}</span>
                <strong>{value.toFixed(0)} us</strong>
              </div>
              <div className="motor-track">
                <i style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function average(packet) {
  return (packet.m_fl + packet.m_fr + packet.m_rl + packet.m_rr) / 4;
}

export default MotorPanel;
