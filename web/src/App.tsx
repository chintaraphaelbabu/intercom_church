import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { FormEvent, JSX } from "react";
import {
  MAX_ROOM_NAME_LENGTH,
  roomClosedMessage,
  validateRoomName,
  type RoomSnapshot,
} from "@church-comms/protocol";
import { DirectorConnection, type DirectorConnectionOptions } from "./connection";
import { fetchDirectorToken, LiveKitDirectorRoom } from "./livekit-room";
import {
  DirectorMedia,
  type DirectorMediaState,
  type DirectorMediaToken,
} from "./media";

function mediaStatusLabel(phase: DirectorMediaState["phase"]): string {
  switch (phase) {
    case "idle":
      return "mic off";
    case "connecting":
      return "connecting";
    case "ready":
      return "ready";
    case "publishing":
      return "on air";
    case "error":
      return "media failed";
  }
}

function participantCount(room: RoomSnapshot): number {
  return room.operators.length + (room.director === null ? 0 : 1);
}

export interface AppProps {
  connectionOptions?: DirectorConnectionOptions;
  media?: DirectorMediaControls;
}

export interface DirectorMediaControls {
  getState(): DirectorMediaState;
  subscribe(listener: () => void): () => void;
  setOpenMic(enabled: boolean, credentials?: DirectorMediaToken): Promise<void>;
  disconnect(): Promise<void>;
}

function createDefaultMedia(): DirectorMedia {
  return new DirectorMedia({
    createRoom: () => new LiveKitDirectorRoom(),
    fetchToken: fetchDirectorToken,
  });
}

export function App({ connectionOptions, media: mediaOverride }: AppProps = {}): JSX.Element {
  const connection = useMemo(
    () => new DirectorConnection(connectionOptions),
    // A new URL or socket factory means a new connection; other fields do not.
    [connectionOptions?.url, connectionOptions?.socketFactory],
  );
  const media = useMemo(
    () => mediaOverride ?? createDefaultMedia(),
    [mediaOverride],
  );
  const state = useSyncExternalStore(connection.subscribe, connection.getSnapshot);
  const mediaState = useSyncExternalStore(media.subscribe, media.getState);
  const [roomName, setRoomName] = useState("MEDIA");
  const [formError, setFormError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<"setup" | "live" | "diagnostics">("setup");

  useEffect(() => {
    connection.connect();
    return () => connection.disconnect();
  }, [connection]);

  useEffect(() => {
    return () => {
      void media.disconnect();
    };
  }, [media]);

  useEffect(() => {
    if (state.joinedRoom !== undefined || state.error !== undefined) {
      setCreating(false);
    }
  }, [state.joinedRoom, state.error]);

  const { phase, serverInfo, joinedRoom, error, errorCode } = state;
  const showConnectionAlert =
    error !== undefined &&
    (joinedRoom !== undefined ||
      errorCode === "PROTOCOL_MISMATCH" ||
      phase === "error" ||
      phase === "reconnecting" ||
      phase === "disconnected");

  function createRoom(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const name = roomName.trim();
    if (!validateRoomName(name)) {
      setFormError(`Enter a room name of 1-${MAX_ROOM_NAME_LENGTH} characters.`);
      return;
    }
    setFormError(undefined);
    setCreating(true);
    connection.createRoom(name);
  }

  return (
    <main className="director">
      <header className="director__header">
        <div>
          <p className="eyebrow">Church Production Comms</p>
          <h1>Director</h1>
        </div>
        <span className={`status status--${phase}`} data-testid="connection-status">
          {phase}
        </span>
        <nav className="view-nav" aria-label="Views" style={{ display: "flex", gap: 8, marginLeft: 12 }}>
          <button type="button" aria-pressed={view === "setup"} onClick={() => setView("setup")}>Setup</button>
          <button type="button" aria-pressed={view === "live"} onClick={() => setView("live")}>Live</button>
          <button type="button" aria-pressed={view === "diagnostics"} onClick={() => setView("diagnostics")}>Diagnostics</button>
        </nav>
      </header>

      {showConnectionAlert && (
        <div className="alert" role="alert">
          <strong>Control connection problem</strong>
          <p>{error}</p>
          {phase === "disconnected" && (
            <button type="button" onClick={() => connection.connect()}>
              Retry
            </button>
          )}
        </div>
      )}

      {joinedRoom === undefined ? (
        <>
          <section className="card" aria-labelledby="create-heading">
            <h2 id="create-heading">Setup — Create a room</h2>
            <p className="muted">
              Name the room the camera Operators will join. The room exists until you
              end it or the control server stops.
            </p>

            {state.roomClosedReason !== undefined && (
              <p className="notice" role="status">
                {roomClosedMessage(state.roomClosedReason)}
              </p>
            )}

            {error !== undefined && !showConnectionAlert && !creating && (
              <div className="alert" role="alert">
                <strong>
                  {errorCode === "SESSION_EXPIRED" ? "Session expired" : "Could not create the room"}
                </strong>
                <p>{error}</p>
              </div>
            )}

            {formError !== undefined && (
              <div className="alert" role="alert">
                <strong>Check the room name</strong>
                <p>{formError}</p>
              </div>
            )}

            <form className="create-room" onSubmit={createRoom}>
              <label className="field" htmlFor="room-name">
                <span>Room name</span>
                <input
                  id="room-name"
                  name="room-name"
                  value={roomName}
                  maxLength={MAX_ROOM_NAME_LENGTH}
                  onChange={(event) => setRoomName(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <button type="submit" disabled={phase !== "connected"}>
                Create room
              </button>
            </form>

            {creating && error === undefined && (
              <p className="muted" role="status">
                Creating room…
              </p>
            )}

            {phase !== "connected" && (
              <p className="muted">
                Waiting for the control server before a room can be created.
              </p>
            )}
          </section>

          <section className="card" aria-labelledby="endpoint-heading">
            <h2 id="endpoint-heading">Control endpoint</h2>
            {serverInfo === undefined ? (
              <p className="muted">Waiting for the control server…</p>
            ) : (
              <dl className="facts">
                <div>
                  <dt>Protocol</dt>
                  <dd data-testid="protocol-version">v{serverInfo.protocol}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd data-testid="endpoint-status">{phase}</dd>
                </div>
                <div>
                  <dt>LiveKit</dt>
                  <dd className="mono">{serverInfo.livekitUrl}</dd>
                </div>
              </dl>
            )}
          </section>
        </>
      ) : view === "setup" ? (
        <section className="card room" aria-labelledby="room-heading">
          <div className="card__title">
            <h2 id="room-heading">Setup / Mixer — {joinedRoom.name}</h2>
            <span className="status status--connected">{joinedRoom.status}</span>
          </div>
          <dl className="facts">
            <div><dt>Control endpoint</dt><dd data-testid="endpoint-status">{phase}</dd></div>
            <div><dt>Participants</dt><dd>{participantCount(joinedRoom)} of {joinedRoom.capacity}</dd></div>
            <div><dt>LiveKit room</dt><dd className="mono">{state.livekit?.room ?? joinedRoom.name}</dd></div>
            {state.health !== undefined && (
              <div><dt>Server health</dt><dd>{state.health.status}</dd></div>
            )}
          </dl>

          <h3>Roster</h3>
          <ul style={{ paddingLeft: 0, listStyle: "none" }}>
            {joinedRoom.operators.map((op) => (
              <li key={op.id} style={{ marginBottom: 8, borderBottom: "1px solid #ddd", paddingBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
                  <span><strong>Cam {op.camera}</strong> — {op.name}</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" onClick={() => connection.setMute(op.id, true)} aria-label={`Mute ${op.name}`}>Mute</button>
                    <button type="button" onClick={() => connection.setMute(op.id, false)} aria-label={`Unmute ${op.name}`}>Unmute</button>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <label htmlFor={`volume-${op.id}`} style={{ fontSize: 12 }}>Volume</label>
                  <input
                    id={`volume-${op.id}`}
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={mediaState.participants.find(p => p.identity === op.id)?.volume ?? 100}
                    onChange={(e) => media.setParticipantVolume(op.id, Number(e.target.value))}
                    style={{ flex: "1 1 120px" }}
                  />
                  <span style={{ fontSize: 11, minWidth: 36 }}>
                    {mediaState.participants.find(p => p.identity === op.id)?.volume ?? 100}%
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12 }}>Level:</span>
                  <div style={{ width: 60, height: 12, background: "#e0e0e0", border: "1px solid #ccc", borderRadius: 2, overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${Math.round((mediaState.participants.find(p => p.identity === op.id)?.level ?? 0) * 100)}%`,
                        height: "100%",
                        background: "#2a7",
                      }}
                    />
                  </div>
                </div>
                {op.muted && <span style={{ color: "#c00" }}>Muted by director</span>}
              </li>
            ))}
          </ul>

          <h3>Master volume</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <label htmlFor="master-volume" style={{ fontSize: 12 }}>Master</label>
            <input
              id="master-volume"
              type="range"
              min={0}
              max={100}
              step={1}
              value={mediaState.masterVolume}
              onChange={(e) => media.setMasterVolume(Number(e.target.value))}
              style={{ flex: "1 1 120px" }}
            />
            <span style={{ fontSize: 11, minWidth: 36 }}>{mediaState.masterVolume}%</span>
          </div>

          <h3>Headset check</h3>
          <div className="card">
            <p>Input: <span className="mono">{mediaState.inputRoute}</span> · Output: <span className="mono">{mediaState.outputRoute}</span></p>
            <button type="button" onClick={async () => { try { const devices = await navigator.mediaDevices.enumerateDevices(); alert("Devices: " + devices.length); } catch { alert("Cannot enumerate devices"); } }}>Check headset devices</button>
          </div>
        </section>
      ) : view === "live" ? (
        <section className="card room" aria-labelledby="room-heading">
          <div className="card__title">
            <h2 id="room-heading">Live — {joinedRoom.name}</h2>
            <span className="status status--connected">{joinedRoom.status}</span>
          </div>
          <dl className="facts">
            <div><dt>Control endpoint</dt><dd data-testid="endpoint-status">{phase}</dd></div>
            <div><dt>Participants</dt><dd>{participantCount(joinedRoom)} of {joinedRoom.capacity}</dd></div>
            <div><dt>LiveKit room</dt><dd className="mono">{state.livekit?.room ?? joinedRoom.name}</dd></div>
            {state.health !== undefined && (
              <div><dt>Server health</dt><dd>{state.health.status}{state.health.rooms !== undefined ? ` (${state.health.rooms} room${state.health.rooms === 1 ? "" : "s"}, ${state.health.operators} op)` : ""}</dd></div>
            )}
          </dl>

          <h3>Operator mute buttons</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {joinedRoom.operators.map((op) => (
              <button key={op.id} type="button" onClick={() => connection.setMute(op.id, true)} aria-pressed={op.muted}>
                {op.name} {op.muted ? "(muted)" : ""}
              </button>
            ))}
          </div>

          <p className="muted">Ending the room disconnects every Operator immediately.</p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <label htmlFor="master-volume-live" style={{ fontSize: 12 }}>Master volume</label>
            <input
              id="master-volume-live"
              type="range"
              min={0}
              max={100}
              step={1}
              value={mediaState.masterVolume}
              onChange={(e) => media.setMasterVolume(Number(e.target.value))}
              style={{ flex: "1 1 120px" }}
            />
            <span style={{ fontSize: 11, minWidth: 36 }}>{mediaState.masterVolume}%</span>
          </div>
          <button type="button" className="button--danger" onClick={() => connection.endRoom()}>End room</button>
        </section>
      ) : (
        <section className="card" aria-labelledby="diagnostics-heading">
          <h2 id="diagnostics-heading">Diagnostics</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
            <div className="card"><h3>Wi-Fi / Network</h3><p>Online: {navigator.onLine ? "Yes" : "No"}</p><p>Connection type: {(navigator as any).connection?.effectiveType ?? "unknown"}</p></div>
            <div className="card"><h3>IP / Discovery</h3><p>Discovery: _church-comms._tcp.local</p><p>Control: /ws</p></div>
            <div className="card"><h3>Control connection</h3><p>Phase: {phase}</p><p>Error: {error ?? "none"}</p></div>
            <div className="card"><h3>LiveKit state</h3><p>Room: {state.livekit?.room ?? "—"}</p><p>Connection: {mediaState.connectionState}</p></div>
            <div className="card"><h3>Latency / Jitter / Loss</h3><p>Connection: {mediaState.connectionState}</p><p>Latency: — ms (unmeasured)</p><p>Jitter: — ms (unmeasured)</p><p>Packet loss: —% (unmeasured)</p></div>
            <div className="card"><h3>Audio routes</h3><p>Input: {mediaState.inputRoute}</p><p>Output: {mediaState.outputRoute}</p></div>
            <div className="card"><h3>Server health</h3><p>Status: {state.health?.status ?? "unknown"}</p><p>Rooms: {state.health?.rooms ?? "—"}</p><p>Operators: {state.health?.operators ?? "—"}</p></div>
          </div>
        </section>
      )}

      <section className="card" aria-labelledby="audio-heading">
        <div className="card__title">
          <h2 id="audio-heading">Director audio</h2>
          <span className={`status status--${mediaState.phase}`} data-testid="media-status">
            {mediaStatusLabel(mediaState.phase)}
          </span>
        </div>
        <p className="muted">
          Open mic publishes continuously to the room. The Operators hear you through
          their headsets.
        </p>
        {mediaState.error !== undefined && (
          <div className="alert" role="alert">
            <strong>Media problem</strong>
            <p>{mediaState.error}</p>
          </div>
        )}
        <button
          type="button"
          onClick={() =>
            void media.setOpenMic(!mediaState.micEnabled, state.livekit)
          }
          disabled={mediaState.phase === "connecting"}
        >
          {mediaState.micEnabled ? "Turn open mic off" : "Turn open mic on"}
        </button>
      </section>

      <footer className="director__footer">
        Discovery: <span className="mono">_church-comms._tcp.local</span> · Control:{" "}
        <span className="mono">/ws</span>
      </footer>
    </main>
  );
}
