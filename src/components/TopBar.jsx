import React from "react";
import { Button, FormGroup, InputGroup, Popover, Tag } from "@blueprintjs/core";
import "./TopBar.css";

function TopBar({ telemetry, health }) {
  const { target, setTarget, connected, connecting, connect, disconnect, error } = telemetry;

  return (
    <header className="top-bar">
      <div className="brand-block">
        <p className="eyebrow">EDNA 2.0</p>
        <h1>Telemetry Console</h1>
      </div>

      <div className="connect-action">
        <Tag intent={connected ? "success" : error ? "danger" : "warning"} minimal>
          {health.connectionLabel}
        </Tag>

        <Button
          intent={connected ? "danger" : "primary"}
          icon={connected ? "unlink" : "link"}
          loading={connecting}
          onClick={() => (connected ? disconnect() : connect())}
        >
          {connected ? "Disconnect" : "Connect"}
        </Button>
        <Popover
          placement="bottom-end"
          content={
            <div className="network-popover">
              <p className="eyebrow">Network</p>
              <h3>UDP settings</h3>
              <FormGroup label="Host">
                <InputGroup
                  value={target.host}
                  onChange={(event) => setTarget({ ...target, host: event.target.value })}
                  placeholder="192.168.4.1"
                />
              </FormGroup>
              <FormGroup label="Port">
                <InputGroup
                  value={target.port}
                  onChange={(event) => setTarget({ ...target, port: event.target.value })}
                  placeholder="4444"
                />
              </FormGroup>
            </div>
          }
        >
          <Button icon="cog" />
        </Popover>
      </div>
    </header>
  );
}

export default TopBar;
