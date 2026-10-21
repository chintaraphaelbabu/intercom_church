package com.churchcomms.operator.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ProtocolTest {
    private val fixturesDir = File(
        System.getProperty("protocol.fixtures.dir")
            ?: error("protocol.fixtures.dir system property is not set"),
    )

    private fun fixture(name: String): String {
        val file = File(fixturesDir, name)
        check(file.isFile) { "Missing shared protocol fixture: ${file.absolutePath}" }
        return file.readText()
    }

    @Test
    fun `shared hello fixture decodes with v1 and operator type`() {
        val hello = Protocol.json.decodeFromString(
            HelloMessage.serializer(),
            fixture("hello.json"),
        )

        assertEquals("hello", hello.type)
        assertEquals(Protocol.VERSION, hello.protocol)
        assertEquals("operator", hello.clientType)
        assertEquals("Camera 1", hello.name)
        assertEquals("0.1.0", hello.appVersion)
    }

    @Test
    fun `encoded hello carries the version and client type`() {
        val encoded = Protocol.hello(name = "SM-T295", appVersion = "0.1.0")

        assertTrue(encoded.contains("\"type\":\"hello\""))
        assertTrue(encoded.contains("\"protocol\":1"))
        assertTrue(encoded.contains("\"clientType\":\"operator\""))
        assertTrue(encoded.contains("\"name\":\"SM-T295\""))
    }

    @Test
    fun `shared server_info fixture decodes`() {
        val message = Protocol.parseServerMessage(fixture("server_info.json"))

        assertTrue(message is ServerInfoMessage)
        message as ServerInfoMessage
        assertEquals(Protocol.VERSION, message.protocol)
        assertEquals("fixture-server-id", message.serverId)
        assertEquals("ws://192.168.1.20:7880", message.livekitUrl)
    }

    @Test
    fun `shared debug_roster fixture decodes every client`() {
        val message = Protocol.parseServerMessage(fixture("debug_roster.json"))

        assertTrue(message is DebugRosterMessage)
        message as DebugRosterMessage
        assertEquals(2, message.clients.size)
        assertEquals("Director", message.clients[0].name)
        assertEquals("director", message.clients[0].clientType)
        assertEquals("Camera 1", message.clients[1].name)
        assertEquals("operator", message.clients[1].clientType)
    }

    @Test
    fun `shared protocol mismatch fixture is readable`() {
        val message = Protocol.parseServerMessage(fixture("error_protocol_mismatch.json"))

        assertTrue(message is ErrorMessage)
        message as ErrorMessage
        assertEquals("PROTOCOL_MISMATCH", message.code)
        assertTrue(message.message.contains("v1"))
        assertTrue(message.message.contains("v2"))
    }

    @Test
    fun `shared ping and pong fixtures are compatible`() {
        val pong = Protocol.parseServerMessage(fixture("pong.json"))

        assertTrue(pong is PongMessage)
        assertTrue(Protocol.hello(name = "x", appVersion = "1").contains("\"type\":\"hello\""))
    }

    @Test
    fun `unknown server messages are ignored instead of crashing`() {
        assertNull(Protocol.parseServerMessage("""{"type":"webrtc_offer","sdp":"stale"}"""))
        assertNull(Protocol.parseServerMessage("not json"))
    }
}
