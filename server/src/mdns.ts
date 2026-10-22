import type { Service } from "bonjour-service";
import { Bonjour } from "bonjour-service";
import { MDNS_SERVICE_TYPE } from "./config.js";
import { lanAddresses } from "./lan.js";
import type { Logger } from "./logger.js";

export interface MdnsOptions {
  serviceName: string;
  port: number;
  livekitUrl: string;
  roomCount: number;
  logger: Logger;
  /** Override the interfaces to advertise on. Tests pass an explicit list. */
  addresses?: string[];
}

export interface MdnsAdvertisement {
  stop(): Promise<void>;
}

interface PublishedAdvertisement {
  bonjour: Bonjour;
  service: Service;
}

/**
 * The laptop may have more than one useful IPv4 link: the church Wi-Fi, an
 * Ethernet cable, or a Windows mobile hotspot. Each interface needs its own
 * mDNS socket so responses leave from the address the phone queried, and each
 * TXT record must point LiveKit at that same reachable address.
 */
export function mdnsAddresses(addresses: string[] = lanAddresses()): string[] {
  return [...new Set(addresses)].filter((address) => {
    if (address.startsWith("169.254.") || address === "127.0.0.1") {
      return false;
    }
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(address);
  });
}

export function livekitUrlForAddress(livekitUrl: string, address: string): string {
  try {
    const url = new URL(livekitUrl);
    url.hostname = address;
    return url.toString().replace(/\/$/, "");
  } catch {
    return livekitUrl;
  }
}

/**
 * Advertise the control server as `_church-comms._tcp.local`.
 *
 * TXT records are the contract from docs/design.md §12; the Android client reads
 * `proto`, `path`, and `livekit` to join without typing an address.
 */
export async function advertise(options: MdnsOptions): Promise<MdnsAdvertisement> {
  const addresses = mdnsAddresses(options.addresses);
  if (addresses.length === 0) {
    throw new Error("No usable IPv4 LAN address to advertise over mDNS.");
  }

  const published: PublishedAdvertisement[] = [];

  try {
    for (const address of addresses) {
      // bonjour-service forwards its options to multicast-dns, but the bundled
      // type only describes ServiceConfig and omits multicast-dns's interface.
      const bonjour = new Bonjour({ interface: address } as never);
      try {
        const service = bonjour.publish({
          name: options.serviceName,
          type: MDNS_SERVICE_TYPE,
          port: options.port,
          txt: {
            proto: "1",
            path: "/ws",
            livekit: livekitUrlForAddress(options.livekitUrl, address),
            roomcount: String(options.roomCount),
            name: options.serviceName,
          },
        });
        published.push({ bonjour, service });
        options.logger.info(
          `mDNS: advertising _${MDNS_SERVICE_TYPE}._tcp.local as "${options.serviceName}" ` +
            `on port ${options.port} via ${address}`,
        );
      } catch (error) {
        bonjour.destroy();
        options.logger.warn(`mDNS: could not advertise on ${address}`, error);
      }
    }
  } catch (error) {
    for (const entry of published) {
      entry.bonjour.destroy();
    }
    throw error;
  }

  if (published.length === 0) {
    throw new Error("mDNS advertisement failed on every LAN address.");
  }

  return {
    async stop(): Promise<void> {
      await Promise.all(
        published.map(
          (entry) =>
            new Promise<void>((resolve) => {
              try {
                entry.service.stop(() => resolve());
              } catch {
                resolve();
              }
            }),
        ),
      );
      for (const entry of published) {
        entry.bonjour.destroy();
      }
    },
  };
}
