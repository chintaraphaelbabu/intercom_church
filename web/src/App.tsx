import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { JSX } from "react";
import { DirectorConnection, type DirectorConnectionOptions } from "./connection";

const CLIENT_TYPE_LABELS: Record<string, string> = {
  director: "Director",
  operator: "Operator",
  debug: "Debug",
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString();
}

export interface AppProps {
  connectionOptions?: DirectorConnectionOptions;
}

export function App({ connectionOptions }: AppProps = {}): JSX.Element {
  const connection = useMemo(
    () => new DirectorConnection(connectionOptions),
    // A new URL or socket factory means a new connection; other fields do not.
    [connectionOptions?.url, connectionOptions?.socketFactory],
  );
  const state = useSyncExternalStore(connection.subscribe, connection.getSnapshot);

  useEffect(() => {
    connection.connect();
    return () => connection.disconnect();
  }, [connection]);

  const { phase, serverInfo, roster, error } = state;

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

      {error !== undefined && (
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

      <section className="card" aria-labelledby="server-heading">
        <h2 id="server-heading">Server</h2>
        {serverInfo === undefined ? (
          <p className="muted">Waiting for the control server…</p>
        ) : (
          <dl className="facts">
            <div>
              <dt>Protocol</dt>
              <dd data-testid="protocol-version">v{serverInfo.protocol}</dd>
            </div>
            <div>
              <dt>Server ID</dt>
              <dd className="mono">{serverInfo.serverId}</dd>
            </div>
            <div>
              <dt>LiveKit</dt>
              <dd className="mono">{serverInfo.livekitUrl}</dd>
            </div>
            <div>
              <dt>Server time</dt>
              <dd>{formatTime(serverInfo.serverTime)}</dd>
            </div>
          </dl>
        )}
      </section>

      <section className="card" aria-labelledby="roster-heading">
        <div className="card__title">
          <h2 id="roster-heading">Debug roster</h2>
          <span className="count">{roster.length}</span>
        </div>
        {roster.length === 0 ? (
          <p className="muted">No clients connected yet.</p>
        ) : (
          <ul className="roster" aria-label="Connected clients">
            {roster.map((client) => (
              <li key={client.id} className="roster__row">
                <div>
                  <span className="roster__name">{client.name}</span>
                  <span className="roster__meta">
                    app {client.appVersion} · joined {formatTime(client.connectedAt)}
                  </span>
                </div>
                <span className={`chip chip--${client.clientType}`}>
                  {CLIENT_TYPE_LABELS[client.clientType] ?? client.clientType}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="director__footer">
        Discovery: <span className="mono">_church-comms._tcp.local</span> · Control:{" "}
        <span className="mono">/ws</span>
      </footer>
    </main>
  );
}
