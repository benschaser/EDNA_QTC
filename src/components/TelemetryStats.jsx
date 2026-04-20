import React from "react";
import "./TelemetryStats.css";
import { Card } from "@blueprintjs/core";

const attitudeStats = [
  { key: "roll", label: "Roll", unit: "deg" },
  { key: "pitch", label: "Pitch", unit: "deg" },
  { key: "yaw_rate", label: "Yaw rate", unit: "deg/s" },
  { key: "throttle", label: "Throttle", unit: "us" },
];

function TelemetryStats({ packet, health }) {
  return (
    <section className="TelemetryStats">
      {/* Roll */}
      <Card compact className="tile">
        <span>Roll</span>
        <div>
          <strong>{format(packet["roll"])}</strong>
          <small>deg</small>
        </div>
      </Card>
      {/* Pitch */}
      <Card compact className="tile">
        <span>Pitch</span>
        <div>
          <strong>{format(packet["pitch"])}</strong>
          <small>deg</small>
        </div>
      </Card>
      {/* Yaw Rate */}
      <Card className="tile">
        <span>Yaw Rate</span>
        <div>
          <strong>{format(packet["yaw_rate"])}</strong>
          <small>deg/s</small>
        </div>
      </Card>
      {/* Throttle */}
      <Card className="tile">
        <span>Throttle</span>
        <div>
          <strong>{format(packet["throttle"])}</strong>
          <small>&micro;s</small>
        </div>
      </Card>
      {/* {attitudeStats.map((stat) => (
        <article className="metric-tile" key={stat.key}>
          <span>{stat.label}</span>
          <strong>{format(packet[stat.key])}</strong>
          <small>{stat.unit}</small>
        </article>
      ))} */}
      {/* <article className="metric-tile link-tile">
        <span>Link</span>
        <strong>{health.sampleCount}</strong>
        <small>{health.ageMs == null ? "awaiting packets" : `${Math.round(health.ageMs)} ms ago`}</small>
      </article> */}
    </section>
  );
}

function format(value) {
  return Number(value || 0).toFixed(Math.abs(value) >= 100 ? 0 : 1);
}

export default TelemetryStats;
