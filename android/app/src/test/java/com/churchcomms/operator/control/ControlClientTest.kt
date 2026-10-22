package com.churchcomms.operator.control

import com.churchcomms.operator.discovery.DiscoveredServer
import com.churchcomms.operator.protocol.ClearMuteMessage
import com.churchcomms.operator.protocol.CreateRoomMessage
import com.churchcomms.operator.protocol.EndRoomMessage
import com.churchcomms.operator.protocol.HelloMessage
import com.churchcomms.operator.protocol.JoinRoomMessage
import com.churchcomms.operator.protocol.LeaveRoomMessage
import com.churchcomms.operator.protocol.Protocol
import com.churchcomms.operator.protocol.SetCameraMessage
import com.churchcomms.operator.protocol.SetMuteMessage
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.IOException
import okhttp3.Protocol as HttpProtocol

@OptIn(ExperimentalCoroutinesApi::class)
class ControlClientTest {
    private val fixturesDir = File(
        System.getProperty("protocol.fixtures.dir")
            ?: error("protocol.fixtures.dir system property is not set"),
    )

    private fun fixture(name: String): String = File(fixturesDir, name).readText()

    @Test
    fun `sends a v1 operator hello when the websocket opens`() {
        val factory = FakeWebSocketFactory()
        val client = client(factory)
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
        assertNull(hello.sessionToken)
    }

    @Test
    fun `shows server info and the live roster after the handshake`() {
        val factory = FakeWebSocketFactory()
        val client = client(factory)
        client.connect(server())
        factory.listener.onOpen(factory.socket, openResponse(factory.request))

        factory.listener.onMessage(
            factory.socket,
            """{"type":"server_info","protocol":1,"serverId":"test-server",""" +
                """"livekitUrl":"ws://192.168.137.1:7880",""" +
                """"serverTime":"2026-10-21T09:00:00.000Z"}""",
        )
        factory.listener.onMessage(factory.socket, fixture("debug_roster.json"))

        val state = client.state.value as ControlState.Connected
        assertEquals("test-server", state.serverInfo.serverId)
        assertEquals(listOf("Director", "Camera 1"), state.roster.map { it.name })
    }

    @Test
    fun `exposes every room command on the wire`() {
        val factory = FakeWebSocketFactory()
        val client = client(factory)
        client.connect(server())
        factory.listener.onOpen(factory.socket, openResponse(factory.request))
        factory.socket.sent.clear()

        client.createRoom("  MEDIA  ")
        client.joinRoom(room = "MEDIA", name = " Camera 2 ", cameraNumber = 2)
        client.setCamera(3)
        client.setMute("operator-2", muted = true)
        client.clearMute()
        client.endRoom()
        client.leaveRoom()

        val sent = factory.socket.sent
        assertEquals(
            "MEDIA",
            Protocol.json.decodeFromString(
                CreateRoomMessage.serializer(),
                sent[0],
            ).name,
        )
        val join = Protocol.json.decodeFromString(JoinRoomMessage.serializer(), sent[1])
        assertEquals("MEDIA", join.room)
        assertEquals("Camera 2", join.name)
        assertEquals(2, join.cameraNumber)
        assertEquals(
            3,
            Protocol.json.decodeFromString(SetCameraMessage.serializer(), sent[2]).cameraNumber,
        )
        val mute = Protocol.json.decodeFromString(SetMuteMessage.serializer(), sent[3])
        assertEquals("operator-2", mute.participantId)
        assertTrue(mute.muted)
        assertEquals(
            "clear_mute",
            Protocol.json.decodeFromString(ClearMuteMessage.serializer(), sent[4]).type,
        )
        assertEquals(
            "end_room",
            Protocol.json.decodeFromString(EndRoomMessage.serializer(), sent[5]).type,
        )
        assertEquals(
            "leave_room",
            Protocol.json.decodeFromString(LeaveRoomMessage.serializer(), sent[6]).type,
        )
        assertEquals(ControlState.Disconnected, client.state.value)
    }

    @Test
    fun `joined stores the session token and room snapshot`() {
        val factory = FakeWebSocketFactory()
        val tokens = InMemorySessionTokenStore()
        val client = client(factory, tokens = tokens)
        client.connect(server())
        factory.listener.onOpen(factory.socket, openResponse(factory.request))

        factory.listener.onMessage(factory.socket, fixture("joined.json"))

        val joined = client.state.value as ControlState.Joined
        assertEquals("participant-fixture-1", joined.participantId)
        assertEquals("MEDIA", joined.room.name)
        assertEquals("session-fixture-1", tokens.get())

        client.disconnect()
        assertNull(tokens.get())
    }

    @Test
    fun `mute state updates the joined participant`() {
        val factory = FakeWebSocketFactory()
        val client = client(factory)
        client.connect(server())
        factory.listener.onOpen(factory.socket, openResponse(factory.request))
        factory.listener.onMessage(factory.socket, fixture("joined.json"))

        factory.listener.onMessage(factory.socket, fixture("mute_state.json"))

        val joined = client.state.value as ControlState.Joined
        assertTrue(joined.room.operators.single().muted)
        assertEquals("director-fixture-1", joined.mutedBy)
    }

    @Test
    fun `reconnects five times with bounded backoff then offers retry`() = runTest {
        val factory = FakeWebSocketFactory()
        val delays = mutableListOf<Long>()
        val client = client(
            factory = factory,
            tokens = InMemorySessionTokenStore("session-fixture-1"),
            scope = this,
            delays = delays,
        )
        client.connect(server())
        factory.listener.onOpen(factory.socket, openResponse(factory.request))
        factory.listener.onMessage(factory.socket, fixture("joined.json"))

        repeat(5) { failureIndex ->
            factory.listener.onFailure(factory.socket, IOException("Wi-Fi lost"), null)
            runCurrent()
            val reconnecting = client.state.value as ControlState.Reconnecting
            assertEquals(failureIndex + 1, reconnecting.attempt)
            assertEquals(5, reconnecting.maxAttempts)
        }
        assertEquals(listOf(500L, 1_000L, 2_000L, 4_000L, 8_000L), delays)

        // Attempt 5 also failed: no more automatic attempts.
        factory.listener.onFailure(factory.socket, IOException("Wi-Fi still lost"), null)
        runCurrent()

        val failed = client.state.value as ControlState.Failed
        assertTrue(failed.canRetry)
        assertTrue(failed.message.contains("5 attempts"))
        assertEquals(listOf(500L, 1_000L, 2_000L, 4_000L, 8_000L), delays)

        client.retry()
        runCurrent()
        assertEquals(ControlState.Connecting, client.state.value)
        assertEquals(7, factory.sockets.size)
    }

    @Test
    fun `successful reconnect resumes with the stored token`() = runTest {
        val factory = FakeWebSocketFactory()
        val client = client(
            factory = factory,
            tokens = InMemorySessionTokenStore("session-fixture-1"),
            scope = this,
        )
        client.connect(server())
        factory.listener.onOpen(factory.socket, openResponse(factory.request))
        factory.listener.onMessage(factory.socket, joinedJson(muted = true))

        factory.listener.onFailure(factory.socket, IOException("Wi-Fi lost"), null)
        runCurrent()
        assertEquals(1, (client.state.value as ControlState.Reconnecting).attempt)

        factory.listener.onOpen(factory.socket, openResponse(factory.request))
        val hello = Protocol.json.decodeFromString(
            HelloMessage.serializer(),
            factory.socket.sent.single(),
        )
        assertEquals("session-fixture-1", hello.sessionToken)

        factory.listener.onMessage(factory.socket, joinedJson(muted = true))
        val joined = client.state.value as ControlState.Joined
        assertEquals("session-fixture-1", joined.sessionToken)
        assertFalse(joined.room.operators.single().muted)
    }

    @Test
    fun `maps a protocol error to a readable failed state`() {
        val factory = FakeWebSocketFactory()
        val client = client(factory)
        client.connect(server())
        factory.listener.onOpen(factory.socket, openResponse(factory.request))

        factory.listener.onMessage(factory.socket, fixture("error_protocol_mismatch.json"))

        val state = client.state.value as ControlState.Failed
        assertEquals(
            "Protocol mismatch: this server speaks v1, the client speaks v2. " +
                "Update the app or the server so both use v1.",
            state.message,
        )
        assertFalse(state.canRetry)
    }

    @Test
    fun `session expired clears the token and offers a fresh join`() {
        val factory = FakeWebSocketFactory()
        val tokens = InMemorySessionTokenStore("expired-token")
        val client = client(factory, tokens = tokens)
        client.connect(server())
        factory.listener.onOpen(factory.socket, openResponse(factory.request))

        factory.listener.onMessage(
            factory.socket,
            """{"type":"error","code":"SESSION_EXPIRED","message":"Session expired."}""",
        )

        val state = client.state.value as ControlState.Failed
        assertTrue(state.canRetry)
        assertNull(tokens.get())
    }

    @Test
    fun `stays disconnected when the operator leaves`() {
        val factory = FakeWebSocketFactory()
        val client = client(factory)
        client.connect(server())
        factory.listener.onOpen(factory.socket, openResponse(factory.request))

        client.disconnect()
        factory.listener.onClosed(factory.socket, 1000, "leaving")

        assertEquals(ControlState.Disconnected, client.state.value)
    }

    private fun client(
        factory: FakeWebSocketFactory,
        tokens: SessionTokenStore = InMemorySessionTokenStore(),
        scope: TestScope? = null,
        delays: MutableList<Long>? = null,
    ): ControlClient {
        val reconnectScope = scope ?: TestScope()
        return ControlClient(
            appVersion = "0.1.0",
            clientName = "SM-T295",
            webSocketFactory = factory,
            tokenStore = tokens,
            reconnectScope = reconnectScope,
            delayForTest = { millis ->
                delays?.add(millis)
            },
        )
    }

    private fun joinedJson(muted: Boolean): String =
        """{"type":"joined","participantId":"participant-fixture-1",""" +
            """"sessionToken":"session-fixture-1","room":{"name":"MEDIA",""" +
            """"status":"open","capacity":11,"director":null,"operators":[""" +
            """{"id":"participant-fixture-1","name":"Camera 1","role":"operator",""" +
            """"cameraNumber":1,"connectionState":"connected","muted":$muted,""" +
            """"joinedAt":"2026-10-22T09:56:00.000Z"}]},"livekit":{"url":""" +
            """"ws://192.168.1.20:7880","room":"MEDIA","token":"fixture-livekit-token",""" +
            """"expiresAt":"2026-10-22T11:56:00.000Z"}}"""

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
        val requests = mutableListOf<Request>()
        val listeners = mutableListOf<WebSocketListener>()
        val sockets = mutableListOf<FakeWebSocket>()

        val request: Request get() = requests.last()
        val listener: WebSocketListener get() = listeners.last()
        val socket: FakeWebSocket get() = sockets.last()

        override fun newWebSocket(request: Request, listener: WebSocketListener): WebSocket {
            requests += request
            listeners += listener
            val socket = FakeWebSocket(request)
            sockets += socket
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
