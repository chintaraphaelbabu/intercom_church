import crypto from "node:crypto";
import type { ClientType, RosterClient } from "@church-comms/protocol";

export interface RosterEntry extends RosterClient {
  clientType: ClientType;
}

/** In-memory list of connected control clients. M0 debug roster only. */
export class ClientRegistry {
  private readonly clients = new Map<string, RosterEntry>();

  add(input: {
    name: string;
    clientType: ClientType;
    appVersion: string;
    now?: Date;
  }): RosterEntry {
    const entry: RosterEntry = {
      id: crypto.randomUUID(),
      name: input.name,
      clientType: input.clientType,
      appVersion: input.appVersion,
      connectedAt: (input.now ?? new Date()).toISOString(),
    };
    this.clients.set(entry.id, entry);
    return entry;
  }

  remove(id: string): boolean {
    return this.clients.delete(id);
  }

  list(): RosterEntry[] {
    return [...this.clients.values()].sort((a, b) =>
      a.connectedAt.localeCompare(b.connectedAt),
    );
  }

  get size(): number {
    return this.clients.size;
  }
}
