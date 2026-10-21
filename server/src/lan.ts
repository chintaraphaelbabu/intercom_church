import os from "node:os";

/** IPv4 addresses that another device on the church Wi-Fi can reach. */
export function lanAddresses(): string[] {
  const addresses: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }
  return addresses;
}

export function primaryLanAddress(): string | undefined {
  return lanAddresses()[0];
}
