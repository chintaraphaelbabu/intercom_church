package com.churchcomms.operator.discovery

import java.net.Inet4Address
import java.net.InetAddress

/**
 * The subset of a resolved JmDNS `ServiceInfo` that discovery needs.
 *
 * Keeping this separate from JmDNS lets the host-selection rule be tested without
 * multicast or Android framework classes.
 */
internal data class ResolvedMdnsService(
    val serviceName: String,
    val addresses: List<InetAddress>,
    val port: Int,
    val txt: Map<String, String>,
)

/** The client's active network link, used to pick a reachable advertised address. */
internal data class LocalLink(
    val address: InetAddress,
    val prefixLength: Int,
)

/**
 * Turn one resolved advertisement into the Operator's discovery model.
 *
 * When the client has an IPv4 link, prefer the advertised address on that subnet.
 * If the client has no link, fall back to the first advertised address. A link
 * with only IPv6 uses the first advertised IPv4 address, matching the previous
 * behavior.
 */
internal fun ResolvedMdnsService.toDiscoveredServer(local: LocalLink?): DiscoveredServer? {
    val fallbackHost = if (local == null) addresses.firstOrNull()?.hostAddress else null
    val host = selectReachableHost(addresses.filterIsInstance<Inet4Address>(), local)
        ?.hostAddress
        ?: fallbackHost
        ?: return null

    val displayName = txt["name"]
        ?.takeIf { it.isNotBlank() }
        ?: serviceName.substringBefore("._").ifBlank { serviceName }

    return DiscoveredServer(
        serviceName = serviceName,
        displayName = displayName,
        host = host,
        port = port,
        txt = txt,
    )
}

private fun selectReachableHost(
    candidates: List<Inet4Address>,
    local: LocalLink?,
): Inet4Address? {
    if (candidates.isEmpty()) {
        return null
    }
    val localAddress = local?.address as? Inet4Address ?: return candidates.first()
    val prefix = local.prefixLength
    if (prefix !in 0..32) {
        return candidates.first()
    }
    val mask = if (prefix == 0) 0 else -1 shl (32 - prefix)
    val localBits = ipv4ToInt(localAddress)
    return candidates.firstOrNull { candidate ->
        (ipv4ToInt(candidate) and mask) == (localBits and mask)
    }
}

private fun ipv4ToInt(address: Inet4Address): Int {
    val bytes = address.address
    return ((bytes[0].toInt() and 0xff) shl 24) or
        ((bytes[1].toInt() and 0xff) shl 16) or
        ((bytes[2].toInt() and 0xff) shl 8) or
        (bytes[3].toInt() and 0xff)
}
