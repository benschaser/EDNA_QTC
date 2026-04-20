import React from "react";
import "./MotorStats.css";
import { Card } from "@blueprintjs/core";

const motorRows = [
  { key: "m_fl", label: "Front Left" },
  { key: "m_fr", label: "Front Right" },
  { key: "m_rl", label: "Rear Left" },
  { key: "m_rr", label: "Rear Right" },
];

function MotorPanel({ packet }) {
  return (
    <section className="MotorStats">
      {/* <div className="panel-header">
        <div>
          <p className="eyebrow">Motor</p>
          <h2></h2>
        </div>
        <div className="readout-pill">{average(packet).toFixed(0)} &micro;s avg</div>
      </div> */}
      <Card compact className="model">
        /model/
      </Card>
      <Card compact className="motor-list">
        {motorRows.map((motor) => {
          const value = Number(packet[motor.key]) || 0;
          const pct = Math.min(100, Math.max(0, ((value - 1000) / 1000) * 100));

          return (
            <div className="motor-row" key={motor.key}>
              <div>
                <span>{motor.label}</span>
                <strong>{value.toFixed(0)} &micro;s</strong>
              </div>
              <div className="motor-track">
                <i style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </Card>
    </section>
  );
}

function average(packet) {
  return (packet.m_fl + packet.m_fr + packet.m_rl + packet.m_rr) / 4;
}

export default MotorPanel;
