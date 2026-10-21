package com.churchcomms.operator.control

import com.churchcomms.operator.discovery.DiscoveredServer
import com.churchcomms.operator.protocol.HelloMessage
import com.churchcomms.operator.protocol.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.junit.Assert.assertEquals
import org.junit.Test
import okhttp3.Protocol as HttpProtocol

class ControlClientTest {
    @Test
    fun `sends a v1 operator hello when the websocket opens`() {
        val factory = FakeWebSocketFactory()
        val client = ControlClient(
            appVersion = "0.1.0",
            clientName = "SM-T295",
            webSocketFactory = factory,
        )

        client.connect(server())
        factory.listener.onOpen(factory.socket, openResponse(factory.request))

        val hello = Protocol.json.decodeFromString(
            HelloMessage.serializer(),
            factory.socket.sent.single(),
        )
        assertEquals("hello", hello.type)
        assertEquals(Protocol.VERSION, hello.protocol)
        assertEquals("operator", hello.clientType)
        assertEquals("SM-T295", hello.name)
        assertEquals("0.1.0", hello.appVersion)
    }

    @Test
    fun `shows server info and the live roster after the handshake`() {
        val factory = FakeWebSocketFactory()
        val client = ControlClient(
            appVersion = "0.1.0",
            clientName = "SM-T295",
            webSocketFactory = factory,
        )
        client.connect(server())
        factory.listener.onOpen(factory.socket, openResponse(factory.request))

        factory.listener.onMessage(
            factory.socket,
            """{"type":"server_info","protocol":1,"serverId":"test-server",""" +
                """"livekitUrl":"ws://192.168.137.1:7880",""" +
                """"serverTime":"2026-10-21T09:00:00.000Z"}""",
        )
        factory.listener.onMessage(
            factory.socket,
            """{"type":"debug_roster","clients":[""" +
                """{"id":"director-1","name":"Director","clientType":"director",""" +
                """"appVersion":"0.1.0","connectedAt":"2026-10-21T09:00:00.000Z"},""" +
                """{"id":"camera-1","name":"Camera 1","clientType":"operator",""" +
                """"appVersion":"0.1.0","connectedAt":"2026-10-21T09:00:05.000Z"}]}""",
        )

        val state = client.state.value as ControlState.Connected
        assertEquals("test-server", state.serverInfo.serverId)
        assertEquals(listOf("Director", "Camera 1"), state.roster.map { it.name })
    }

    @Test
    fun `maps a protocol error to a readable failed state`() {
        val factory = FakeWebSocketFactory()
        val client = ControlClient(
            appVersion = "0.1.0",
            clientName = "SM-T295",
            webSocketFactory = factory,
        )
        client.connect(server())
        factory.listener.onOpen(factory.socket, openResponse(factory.request))

        factory.listener.onMessage(
            factory.socket,
            """{"type":"error","code":"PROTOCOL_MISMATCH",""" +
                """"message":"Protocol mismatch: this server speaks v1, the client speaks v2. """ +
                """Update the app or the server so both use v1."}""",
        )

        val state = client.state.value as ControlState.Failed
        assertEquals(
            "Protocol mismatch: this server speaks v1, the client speaks v2. " +
                "Update the app or the server so both use v1.",
            state.message,
        )
    }

    @Test
    fun `stays disconnected when the operator leaves`() {
        val factory = FakeWebSocketFactory()
        val client = ControlClient(
            appVersion = "0.1.0",
            clientName = "SM-T295",
            webSocketFactory = factory,
        )
        client.connect(server())
        factory.listener.onOpen(factory.socket, openResponse(factory.request))

        client.disconnect()
        factory.listener.onClosed(factory.socket, 1000, "leaving")

        assertEquals(ControlState.Disconnected, client.state.value)
    }

    private fun server() = DiscoveredServer(
        serviceName = "LAPTOP-MBU6BG9M._church-comms._tcp.local.",
        displayName = "Director laptop",
        host = "192.168.137.1",
        port = 8765,
        txt = mapOf("path" to "/ws", "proto" to "1"),
    )

    private fun openResponse(request: Request): Response = Response.Builder()
        .request(request)
        .protocol(HttpProtocol.HTTP_1_1)
        .code(101)
        .message("Switching Protocols")
        .build()

    private class FakeWebSocketFactory : WebSocket.Factory {
        lateinit var request: Request
        lateinit var listener: WebSocketListener
        lateinit var socket: FakeWebSocket

        override fun newWebSocket(request: Request, listener: WebSocketListener): WebSocket {
            this.request = request
            this.listener = listener
            socket = FakeWebSocket(request)
            return socket
        }
    }

    private class FakeWebSocket(private val request: Request) : WebSocket {
        val sent = mutableListOf<String>()

        override fun request(): Request = request

        override fun queueSize(): Long = 0

        override fun send(text: String): Boolean {
            sent += text
            return true
        }

        override fun send(bytes: ByteString): Boolean = false

        override fun close(code: Int, reason: String?): Boolean = true

        override fun cancel() = Unit
    }
}
