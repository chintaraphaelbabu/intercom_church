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
            <h2 id="create-heading">Create a room</h2>
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
      ) : (
        <section className="card room" aria-labelledby="room-heading">
          <div className="card__title">
            <h2 id="room-heading">{joinedRoom.name}</h2>
            <span className="status status--connected">{joinedRoom.status}</span>
          </div>
          <dl className="facts">
            <div>
              <dt>Control endpoint</dt>
              <dd data-testid="endpoint-status">{phase}</dd>
            </div>
            <div>
              <dt>Participants</dt>
              <dd>
                {participantCount(joinedRoom)} of {joinedRoom.capacity}
              </dd>
            </div>
            <div>
              <dt>LiveKit room</dt>
              <dd className="mono">{state.livekit?.room ?? joinedRoom.name}</dd>
            </div>
            {state.health !== undefined && (
              <div>
                <dt>Server health</dt>
                <dd>{state.health.status}</dd>
              </div>
            )}
          </dl>
          <p className="muted">
            Ending the room disconnects every Operator immediately. They return to the
            join screen.
          </p>
          <button
            type="button"
            className="button--danger"
            onClick={() => connection.endRoom()}
          >
            End room
          </button>
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
