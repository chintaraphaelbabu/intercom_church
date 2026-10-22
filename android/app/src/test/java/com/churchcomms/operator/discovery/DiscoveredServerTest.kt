package com.churchcomms.operator.discovery

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DiscoveredServerTest {
    private fun server(
        host: String = "192.168.1.20",
        txt: Map<String, String> = mapOf("path" to "/ws", "proto" to "1"),
    ) = DiscoveredServer(
        serviceName = "LAPTOP._church-comms._tcp.local.",
        displayName = "Director laptop",
        host = host,
        port = 8765,
        txt = txt,
    )

    @Test
    fun `control url uses the advertised path and port`() {
        assertEquals("ws://192.168.1.20:8765/ws", server().controlUrl)
    }

    @Test
    fun `ipv6 hosts are bracketed in urls`() {
        assertEquals("ws://[fe80::1]:8765/ws", server(host = "fe80::1").controlUrl)
    }

    @Test
    fun `missing path falls back to the v1 control path`() {
        assertEquals(
            "ws://192.168.1.20:8765/ws",
            server(txt = emptyMap()).controlUrl,
        )
    }

    @Test
    fun `protocol version and livekit url come from txt records`() {
        val withLivekit = server(
            txt = mapOf(
                "path" to "/ws",
                "proto" to "1",
                "livekit" to "ws://192.168.1.20:7880",
            ),
        )

        assertEquals(1, withLivekit.protocolVersion)
        assertEquals("ws://192.168.1.20:7880", withLivekit.livekitUrl)
        assertNull(server(txt = emptyMap()).protocolVersion)
    }

    @Test
    fun `livekit url uses the same interface as the control connection`() {
        val withLivekit = server(
            host = "192.168.137.1",
            txt = mapOf(
                "livekit" to "ws://192.168.1.20:7880",
            ),
        )

        assertEquals("ws://192.168.137.1:7880", withLivekit.livekitUrl)
    }

    @Test
    fun `token url uses http on the control port`() {
        assertEquals(
            "http://192.168.1.20:8765/api/livekit-token",
            server().tokenUrl,
        )
    }
}
