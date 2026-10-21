import type { Service } from "bonjour-service";
import { Bonjour } from "bonjour-service";
import { MDNS_SERVICE_TYPE } from "./config.js";
import type { Logger } from "./logger.js";

export interface MdnsOptions {
  serviceName: string;
  port: number;
  livekitUrl: string;
  roomCount: number;
  logger: Logger;
}

export interface MdnsAdvertisement {
  stop(): Promise<void>;
}

/**
 * Advertise the control server as `_church-comms._tcp.local`.
 *
 * TXT records are the contract from docs/design.md §12; the Android client reads
 * `proto`, `path`, and `livekit` to join without typing an address.
 */
export async function advertise(options: MdnsOptions): Promise<MdnsAdvertisement> {
  const bonjour = new Bonjour();
  let service: Service | undefined;

  try {
    service = bonjour.publish({
      name: options.serviceName,
      type: MDNS_SERVICE_TYPE,
      port: options.port,
      txt: {
        proto: "1",
        path: "/ws",
        livekit: options.livekitUrl,
        roomcount: String(options.roomCount),
        name: options.serviceName,
      },
    });
    options.logger.info(
      `mDNS: advertising _${MDNS_SERVICE_TYPE}._tcp.local as "${options.serviceName}" on port ${options.port}`,
    );
  } catch (error) {
    bonjour.destroy();
    throw error;
  }

  return {
    async stop(): Promise<void> {
      await new Promise<void>((resolve) => {
        try {
          service?.stop(() => resolve());
        } catch {
          resolve();
        }
      });
      bonjour.destroy();
    },
  };
}
