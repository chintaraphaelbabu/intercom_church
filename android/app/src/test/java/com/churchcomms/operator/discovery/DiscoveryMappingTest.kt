package com.churchcomms.operator.discovery

import org.junit.Assert.assertEquals
import org.junit.Test
import java.net.Inet4Address
import java.net.InetAddress

class DiscoveryMappingTest {
    @Test
    fun `chooses the advertised address on the client subnet`() {
        val service = resolved(
            addresses = listOf("192.168.1.2", "192.168.137.1", "192.168.56.1"),
        )

        val server = service.toDiscoveredServer(localLink("192.168.137.112", 24))

        assertEquals("192.168.137.1", server?.host)
        assertEquals("LAPTOP-MBU6BG9M", server?.displayName)
        assertEquals("ws://192.168.137.1:8765/ws", server?.controlUrl)
    }

    private fun resolved(addresses: List<String>) = ResolvedMdnsService(
        serviceName = "LAPTOP-MBU6BG9M._church-comms._tcp.local.",
        addresses = addresses.map { InetAddress.getByName(it) },
        port = 8765,
        txt = mapOf("path" to "/ws", "proto" to "1"),
    )

    private fun localLink(address: String, prefixLength: Int) = LocalLink(
        address = InetAddress.getByName(address) as Inet4Address,
        prefixLength = prefixLength,
    )
}
