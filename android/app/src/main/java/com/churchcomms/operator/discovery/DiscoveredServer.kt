package com.churchcomms.operator.discovery

/**
 * One `_church-comms._tcp.local` advertisement after mDNS resolution.
 *
 * TXT records follow docs/design.md §12: `proto`, `path`, `livekit`, `roomcount`,
 * and `name`. The control URL is derived rather than stored so a missing `path`
 * still falls back to the v1 default.
 */
data class DiscoveredServer(
    val serviceName: String,
    val displayName: String,
    val host: String,
    val port: Int,
    val txt: Map<String, String>,
) {
    val controlUrl: String
        get() {
            val formattedHost = when {
                host.startsWith("[") -> host
                host.contains(':') -> "[$host]"
                else -> host
            }
            val path = txt["path"]
                ?.takeIf { it.startsWith("/") }
                ?: "/ws"
            return "ws://$formattedHost:$port$path"
        }

    val protocolVersion: Int?
        get() = txt["proto"]?.toIntOrNull()

    val livekitUrl: String?
        get() = txt["livekit"]?.takeIf { it.isNotBlank() }
}
