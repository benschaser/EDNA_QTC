import React from "react";
import "./OrientationPanel.css";
import { Colors } from "@blueprintjs/core";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

function OrientationPanel({ data }) {
  return (
    <section className="OrientationPanel panel metric-tile">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Orientation</p>
          <h2>Roll, Pitch, Yaw Rate</h2>
        </div>
        <div className="legend-row">
          <span className="legend-dot roll" style={{ backgroundColor: Colors.GREEN5 }} /> Roll
          <span className="legend-dot pitch" style={{ backgroundColor: Colors.ORANGE5 }} /> Pitch
          <span className="legend-dot yaw" style={{ backgroundColor: Colors.RED5 }} /> Yaw rate
        </div>
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 40, left: 0 }}>
          <CartesianGrid stroke="#2b3030" strokeDasharray="3 5" />
          <XAxis
            dataKey="t"
            tick={{ fill: "#9aa3a0", fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: "#38403e" }}
            minTickGap={28}
            tickFormatter={(t) =>
              new Date(t).toLocaleTimeString([], {
                minute: "2-digit",
                second: "2-digit",
              })
            }
          />
          <YAxis
            domain={[-80, 80]}
            tick={{ fill: "#9aa3a0", fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: "#38403e" }}
            unit="deg"
          />
          <Tooltip
            contentStyle={{
              background: "#151918",
              border: "1px solid #35403c",
              borderRadius: 8,
              color: "#f1f5f3",
            }}
            labelFormatter={(t) => new Date(Number(t)).toLocaleTimeString()}
            formatter={(value, name) => [Number(value).toFixed(2), labelFor(name)]}
          />
          <Line
            type="monotone"
            dataKey="roll"
            stroke={Colors.GREEN5}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="pitch"
            stroke={Colors.ORANGE5}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="yaw_rate"
            stroke="#ff6b7a"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
}

function labelFor(name) {
  if (name === "yaw_rate") return "Yaw rate";
  return name[0].toUpperCase() + name.slice(1);
}

export default OrientationPanel;
