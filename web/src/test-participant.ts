import {
  DirectorConnection,
  type DirectorConnectionOptions,
} from "./connection";
import { DirectorMedia, type DirectorMediaOptions } from "./media";
import { LiveKitDirectorRoom } from "./livekit-room";

export interface OperatorTestParticipantOptions {
  name: string;
  cameraNumber: number;
  connectionOptions?: Omit<DirectorConnectionOptions, "role" | "name">;
  /** Defaults to a real LiveKit room with no token fetch. */
  mediaOptions?: DirectorMediaOptions;
}

export interface BrowserTestParticipant {
  role: "operator";
  name: string;
  cameraNumber: number;
  connection: DirectorConnection;
  media: DirectorMedia;
  /** Explicit join; nothing in this factory joins or connects on page load. */
  join(roomName: string): void;
}

/**
 * The supported path for a second browser tab acting as an Operator during
 * multi-party testing (`?role=operator`). The caller decides when to connect
 * and join; PTT is wired by the UI ticket.
 */
export function createOperatorTestParticipant(
  options: OperatorTestParticipantOptions,
): BrowserTestParticipant {
  const connection = new DirectorConnection({
    ...options.connectionOptions,
    role: "operator",
    name: options.name,
  });
  const media = new DirectorMedia(
    options.mediaOptions ?? {
      createRoom: () => new LiveKitDirectorRoom(),
    },
  );

  return {
    role: "operator",
    name: options.name,
    cameraNumber: options.cameraNumber,
    connection,
    media,
    join(roomName: string): void {
      connection.joinRoom(roomName, {
        name: options.name,
        cameraNumber: options.cameraNumber,
      });
    },
  };
}
