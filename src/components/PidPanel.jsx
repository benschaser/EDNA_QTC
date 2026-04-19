import React, { useMemo, useState } from "react";
import "./PidPanel.css";
import { Button, Colors, FormGroup, NumericInput, Popover } from "@blueprintjs/core";
import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";

const axes = ["pitch", "roll", "yaw"];
const gains = ["kp", "ki", "kd"];

const responseTargets = {
  pitch: 12,
  roll: 12,
  yaw: 28,
};

function PidPanel({ drafts, lastConfirmedDrafts, onDraftsChange, onUndoChanges, onSend, connected }) {
  const hasUnsavedChanges = !pidDraftsEqual(drafts, lastConfirmedDrafts);
  const [graphSettings, setGraphSettings] = useState({
    timespan: "2",
    samples: "100",
  });

  return (
    <section className="PidPanel panel pid-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Control loop</p>
          <h2>PID gains</h2>
        </div>
        <div className="panel-actions">
          <Button
            disabled={!connected}
            intent={connected ? "success" : undefined}
            icon={connected ? "send-message" : "issue"}
            onClick={() => onSend(drafts)}
          >
            {connected ? "Send All" : "Connect to Send"}
          </Button>{" "}
          <Button icon="reset" disabled={!hasUnsavedChanges} onClick={onUndoChanges} />
          {/* timespan and sample size settings */}
          <Popover
            placement="bottom-end"
            content={
              <div className="pid-settings-popover">
                <p className="eyebrow">Settings</p>
                <h3>PID Graphs</h3>
                <FormGroup label="Timespan (s)">
                  <NumericInput
                    min={0.1}
                    max={30}
                    stepSize={0.25}
                    minorStepSize={0.05}
                    majorStepSize={1}
                    buttonPosition="none"
                    value={graphSettings.timespan}
                    onValueChange={(_value, valueAsString) =>
                      setGraphSettings({
                        ...graphSettings,
                        timespan: valueAsString,
                      })
                    }
                  />
                </FormGroup>
                <FormGroup label="Samples">
                  <NumericInput
                    min={10}
                    max={1000}
                    stepSize={10}
                    minorStepSize={1}
                    majorStepSize={50}
                    buttonPosition="none"
                    value={graphSettings.samples}
                    onValueChange={(_value, valueAsString) =>
                      setGraphSettings({
                        ...graphSettings,
                        samples: valueAsString,
                      })
                    }
                  />
                </FormGroup>
              </div>
            }
          >
            <Button icon="cog" />
          </Popover>
          {/* {connected ? (
            <Button intent="success" icon="send-message" disabled={!connected} onClick={() => onSend(drafts)}>
              Send all
            </Button>
          ) : (
            <div className="readout-pill">Connect to Send</div>
          )} */}
        </div>
      </div>

      <div className="pid-grid">
        {axes.map((axis) => (
          <article className="pid-axis" key={axis}>
            <header>
              <strong>{axis}</strong>
            </header>
            <div className="pid-axis-body">
              <div className="gain-stack">
                {gains.map((gain) => (
                  <label className="gain-row" key={gain}>
                    <span>{gain.toUpperCase()}</span>
                    <NumericInput
                      min={0}
                      style={{ maxWidth: 64 }}
                      stepSize={gain === "ki" ? 0.001 : 0.01}
                      minorStepSize={gain === "ki" ? 0.0001 : 0.001}
                      majorStepSize={gain === "ki" ? 0.01 : 0.1}
                      buttonPosition="none"
                      value={String(drafts[axis][gain] ?? "")}
                      onValueChange={(_value, valueAsString) =>
                        onDraftsChange({
                          ...drafts,
                          [axis]: {
                            ...drafts[axis],
                            [gain]: valueAsString,
                          },
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <PidAxisChart axis={axis} gains={drafts[axis]} settings={graphSettings} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function PidAxisChart({ axis, gains, settings }) {
  const data = useMemo(() => simulatePidResponse(axis, gains, settings), [axis, gains, settings]);

  return (
    <div className="pid-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <YAxis hide domain={["auto", "auto"]} />
          <Line
            type="monotone"
            dataKey="target"
            stroke={Colors.GRAY1}
            strokeWidth={1}
            strokeDasharray="4 5"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="response"
            stroke={Colors.GREEN5}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function simulatePidResponse(axis, gainsForAxis, settings) {
  const timespan = positiveNumber(settings?.timespan, 1);
  const samples = clamp(Math.round(positiveNumber(settings?.samples, 100)), 10, 1000);
  const target = responseTargets[axis];
  const kp = parseGain(gainsForAxis?.kp);
  const ki = parseGain(gainsForAxis?.ki);
  const kd = parseGain(gainsForAxis?.kd);

  const dt = timespan / Math.max(samples - 1, 1);
  const points = [];

  let response = 0;
  let rate = 0;
  let integral = 0;
  let previousError = target;

  for (let i = 0; i < samples; i += 1) {
    const error = target - response;
    integral = clamp(integral + error * dt, -80, 80);
    const derivative = (error - previousError) / dt;
    const controller = clamp(kp * error + ki * integral + kd * derivative, -120, 120);
    const inertia = axis === "yaw" ? 1.35 : 1;
    const acceleration = (controller * 0.23 - rate * 1.25 - response * 0.08) / inertia;

    rate += acceleration * dt;
    response += rate * dt;
    previousError = error;

    points.push({
      t: i * dt,
      response,
      target,
    });
  }

  return points;
}

function parseGain(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pidDraftsEqual(left, right) {
  return axes.every((axis) => gains.every((gain) => Number(left?.[axis]?.[gain]) === Number(right?.[axis]?.[gain])));
}

export default PidPanel;
