package com.churchcomms.operator.session

import com.churchcomms.operator.control.ControlChannel
import com.churchcomms.operator.control.ControlState
import com.churchcomms.operator.discovery.DiscoveredServer
import com.churchcomms.operator.discovery.DiscoverySource
import com.churchcomms.operator.discovery.DiscoveryState
import com.churchcomms.operator.media.MediaController
import com.churchcomms.operator.media.MediaState
import com.churchcomms.operator.protocol.LiveKitCredentials
import com.churchcomms.operator.protocol.Participant
import com.churchcomms.operator.protocol.RoomSnapshot
import com.churchcomms.operator.protocol.RoomSummary
import com.churchcomms.operator.protocol.ServerInfoMessage
import com.churchcomms.operator.service.SessionServiceGateway
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SessionControllerTest {
    @Test
    fun `starts discovery once and stops it while connected`() = runTest {
        val discovery = FakeDiscovery()
        val control = FakeControl()
        val controller = controller(discovery, control, FakeMedia(), FakeService(), this)

        controller.start()
        controller.start()
        assertEquals(1, discovery.startCalls)

        controller.connect(server())
        assertEquals(1, discovery.stopCalls)
        assertEquals(server(), control.connectedTo)
        assertEquals(server(), controller.state.value.selectedServer)
    }

    @Test
    fun `starts the foreground service on joined and stops it after failure`() = runTest {
        val control = FakeControl()
        val media = FakeMedia()
        val service = FakeService()
        val controller = controller(FakeDiscovery(), control, media, service, this)
        control.state.value = joined()
        advanceUntilIdle()

        assertEquals("MEDIA", service.roomName)
        assertTrue(service.running)
        assertEquals("MEDIA", controller.state.value.activeRoomName)
        assertTrue(controller.state.value.isSessionActive)

        control.state.value = ControlState.Reconnecting(2, 5)
        advanceUntilIdle()
        assertTrue(service.running)

        // A resume briefly passes through Connected after the new hello.
        control.state.value = connected()
        advanceUntilIdle()
        assertTrue(service.running)
        assertEquals(0, media.disconnectCalls)
        assertTrue(controller.state.value.isSessionActive)

        control.state.value = ControlState.Failed("No Wi-Fi", canRetry = true)
        advanceUntilIdle()
        assertFalse(service.running)
        assertFalse(controller.state.value.isSessionActive)
    }

    @Test
    fun `a connected lobby exposes rooms without starting a session`() = runTest {
        val control = FakeControl()
        val service = FakeService()
        val controller = controller(FakeDiscovery(), control, FakeMedia(), service, this)

        control.state.value = connected(
            rooms = listOf(
                RoomSummary(
                    name = "MEDIA",
                    status = "open",
                    directorPresent = true,
                    operatorCount = 2,
                    capacity = 11,
                ),
            ),
        )
        advanceUntilIdle()

        val state = controller.state.value
        assertFalse(state.isSessionActive)
        assertEquals(listOf("MEDIA"), state.lobbyRooms.map { it.name })
        assertEquals(3, state.lobbyRooms.single().participantCount())
        assertFalse(service.running)
    }

    @Test
    fun `join uses the selected display name and the default camera number`() = runTest {
        val control = FakeControl()
        val controller = controller(FakeDiscovery(), control, FakeMedia(), FakeService(), this)
        control.state.value = connected()
        controller.setDisplayName("Camera 3")

        controller.joinRoom("MEDIA")

        assertEquals(JoinCall("MEDIA", "Camera 3", 1), control.joins.single())
    }

    @Test
    fun `room closed returns to the join list and shows the readable reason`() = runTest {
        val control = FakeControl()
        val media = FakeMedia()
        val service = FakeService()
        val controller = controller(FakeDiscovery(), control, media, service, this)
        control.state.value = joined()
        advanceUntilIdle()
        assertTrue(service.running)

        control.state.value = connected(
            rooms = emptyList(),
            notice = "Room closed by director",
        )
        advanceUntilIdle()

        val state = controller.state.value
        assertFalse(state.isSessionActive)
        assertEquals("Room closed by director", state.notice)
        assertEquals(emptyList<RoomSummary>(), state.lobbyRooms)
        assertEquals("", state.roomName)
        assertFalse(service.running)
        assertEquals(1, media.disconnectCalls)
    }

    @Test
    fun `leaving a room returns to the lobby without restarting discovery`() = runTest {
        val discovery = FakeDiscovery()
        val control = FakeControl()
        val media = FakeMedia()
        val service = FakeService()
        val controller = controller(discovery, control, media, service, this)
        controller.start()

        control.state.value = joined()
        advanceUntilIdle()
        controller.leave()
        advanceUntilIdle()

        assertEquals(1, control.leaveCalls)
        assertEquals(0, control.disconnectCalls)
        assertEquals(1, media.disconnectCalls)
        assertFalse(service.running)
        assertTrue(controller.state.value.control is ControlState.Connected)
        assertFalse(controller.state.value.isSessionActive)
        assertEquals("", controller.state.value.roomName)
        assertEquals(1, discovery.startCalls)
    }

    @Test
    fun `leaving the lobby disconnects and restarts discovery`() = runTest {
        val discovery = FakeDiscovery()
        val control = FakeControl()
        val controller = controller(discovery, control, FakeMedia(), FakeService(), this)
        controller.start()
        control.state.value = connected()
        advanceUntilIdle()

        controller.leave()
        advanceUntilIdle()

        assertEquals(1, control.disconnectCalls)
        assertEquals(2, discovery.startCalls)
        assertEquals(ControlState.Disconnected, controller.state.value.control)
    }

    @Test
    fun `publishes selected name, camera and headset route in one state`() = runTest {
        val media = FakeMedia()
        val controller = controller(
            FakeDiscovery(),
            FakeControl(),
            media,
            FakeService(),
            this,
        )
        controller.setDisplayName("Camera 2")
        controller.setCameraNumber(4)
        media.state.value = MediaState.Ready(
            outputRoute = "Wired Headset",
            directorAudio = true,
        )
        advanceUntilIdle()

        val state = controller.state.value
        assertEquals("Camera 2", state.displayName)
        assertEquals(4, state.cameraNumber)
        assertEquals("Wired Headset", state.outputRoute)
        assertTrue(state.media is MediaState.Ready)
    }

    @Test
    fun `joined credentials connect media without a second token request`() = runTest {
        val media = FakeMedia()
        val control = FakeControl()
        val controller = controller(
            FakeDiscovery(),
            control,
            media,
            FakeService(),
            this,
        )

        control.state.value = joined()
        advanceUntilIdle()

        assertEquals(1, media.directConnects.size)
        assertEquals("ws://192.168.1.20:7880", media.directConnects.single().first)
        assertEquals("fixture-livekit-token", media.directConnects.single().second)
    }

    @Test
    fun `press transmits through ready media and release stops it`() = runTest {
        val media = FakeMedia()
        val control = FakeControl()
        val controller = controller(FakeDiscovery(), control, media, FakeService(), this)
        control.state.value = joined()
        media.state.value = ready()
        advanceUntilIdle()

        controller.pressPtt()
        advanceUntilIdle()
        assertEquals(listOf(true), media.transmissions)
        assertTrue(controller.state.value.transmitting)

        controller.releasePtt()
        advanceUntilIdle()
        assertEquals(listOf(true, false), media.transmissions)
        assertFalse(controller.state.value.transmitting)
    }

    @Test
    fun `a fresh press while force-muted clears mute then transmits`() = runTest {
        val media = FakeMedia()
        val control = FakeControl()
        val controller = controller(FakeDiscovery(), control, media, FakeService(), this)
        control.state.value = joined(muted = true)
        media.state.value = ready()
        advanceUntilIdle()

        controller.pressPtt()
        advanceUntilIdle()

        assertEquals(1, control.clearMuteCalls)
        assertEquals(listOf(true), media.transmissions)
        assertTrue(controller.state.value.transmitting)
    }

    @Test
    fun `press does not transmit while media is still connecting`() = runTest {
        val media = FakeMedia()
        val control = FakeControl()
        val controller = controller(FakeDiscovery(), control, media, FakeService(), this)
        control.state.value = joined()
        media.state.value = MediaState.WebRtcConnecting
        advanceUntilIdle()

        controller.pressPtt()
        advanceUntilIdle()

        assertTrue(media.transmissions.isEmpty())
        assertFalse(controller.state.value.transmitting)
    }

    @Test
    fun `leaving stops transmission`() = runTest {
        val media = FakeMedia()
        val control = FakeControl()
        val controller = controller(FakeDiscovery(), control, media, FakeService(), this)
        control.state.value = joined()
        media.state.value = ready()
        advanceUntilIdle()
        controller.pressPtt()
        advanceUntilIdle()

        controller.leave()
        advanceUntilIdle()

        assertFalse(controller.state.value.transmitting)
        assertEquals(1, media.disconnectCalls)
    }

    @Test
    fun `media failure stops transmission`() = runTest {
        val media = FakeMedia()
        val control = FakeControl()
        val controller = controller(FakeDiscovery(), control, media, FakeService(), this)
        control.state.value = joined()
        media.state.value = ready()
        advanceUntilIdle()
        controller.pressPtt()
        advanceUntilIdle()
        assertTrue(controller.state.value.transmitting)

        media.state.value = MediaState.Failed("LiveKit connection closed")
        advanceUntilIdle()

        assertFalse(controller.state.value.transmitting)
    }

    @Test
    fun `debug connection does not start the room service`() = runTest {
        val service = FakeService()
        val control = FakeControl()
        val controller = controller(FakeDiscovery(), control, FakeMedia(), service, this)

        control.state.value = connected()
        advanceUntilIdle()

        assertFalse(service.running)
    }

    private fun controller(
        discovery: DiscoverySource,
        control: ControlChannel,
        media: MediaController,
        service: SessionServiceGateway,
        scope: TestScope,
    ) = SessionController(
        discovery = discovery,
        control = control,
        media = media,
        service = service,
        defaultDisplayName = "Operator",
        scope = CoroutineScope(
            scope.backgroundScope.coroutineContext + UnconfinedTestDispatcher(scope.testScheduler),
        ),
    )

    private fun server() = DiscoveredServer(
        serviceName = "laptop._church-comms._tcp.local.",
        displayName = "Director laptop",
        host = "192.168.137.1",
        port = 8765,
        txt = mapOf("path" to "/ws", "proto" to "1"),
    )

    private fun serverInfo() = ServerInfoMessage(
        protocol = 1,
        serverId = "server-1",
        livekitUrl = "ws://192.168.1.20:7880",
        serverTime = "2026-10-22T09:00:00.000Z",
    )

    private fun connected(
        rooms: List<RoomSummary> = emptyList(),
        notice: String? = null,
    ) = ControlState.Connected(
        serverInfo = serverInfo(),
        rooms = rooms,
        notice = notice,
    )

    private fun ready() = MediaState.Ready(
        outputRoute = "Wired Headset",
        directorAudio = true,
    )

    private fun joined(muted: Boolean = false): ControlState.Joined = ControlState.Joined(
        participantId = "participant-1",
        sessionToken = "session-1",
        room = RoomSnapshot(
            name = "MEDIA",
            status = "open",
            capacity = 11,
            director = Participant(
                id = "director-1",
                name = "Director",
                role = "director",
                cameraNumber = null,
                connectionState = "connected",
                muted = false,
                joinedAt = "2026-10-22T09:55:00.000Z",
            ),
            operators = listOf(
                Participant(
                    id = "participant-1",
                    name = "Camera 1",
                    role = "operator",
                    cameraNumber = 1,
                    connectionState = "connected",
                    muted = muted,
                    joinedAt = "2026-10-22T09:56:00.000Z",
                ),
            ),
        ),
        livekit = LiveKitCredentials(
            url = "ws://192.168.1.20:7880",
            room = "MEDIA",
            token = "fixture-livekit-token",
            expiresAt = "2026-10-22T11:56:00.000Z",
        ),
    )

    private data class JoinCall(
        val room: String,
        val name: String,
        val cameraNumber: Int,
    )

    private class FakeDiscovery : DiscoverySource {
        override val state = MutableStateFlow<DiscoveryState>(DiscoveryState.Idle)
        var startCalls = 0
        var stopCalls = 0
        var retryCalls = 0

        override fun start() {
            startCalls += 1
            state.value = DiscoveryState.Discovering
        }

        override fun stop() {
            stopCalls += 1
            state.value = DiscoveryState.Idle
        }

        override fun retry() {
            retryCalls += 1
            state.value = DiscoveryState.Discovering
        }
    }

    private class FakeControl : ControlChannel {
        override val state = MutableStateFlow<ControlState>(ControlState.Disconnected)
        var connectedTo: DiscoveredServer? = null
        var leaveCalls = 0
        var disconnectCalls = 0
        var retryCalls = 0
        val joins = mutableListOf<JoinCall>()
        var clearMuteCalls = 0

        override fun connect(server: DiscoveredServer) {
            connectedTo = server
            state.value = ControlState.Connecting
        }

        override fun retry() {
            retryCalls += 1
            state.value = ControlState.Connecting
        }

        override fun disconnect() {
            disconnectCalls += 1
            state.value = ControlState.Disconnected
        }

        override fun createRoom(name: String) = Unit

        override fun joinRoom(room: String, name: String, cameraNumber: Int) {
            joins += JoinCall(room, name, cameraNumber)
        }

        override fun leaveRoom() {
            leaveCalls += 1
            val current = state.value
            val serverInfo = (current as? ControlState.Joined)?.serverInfo
                ?: (current as? ControlState.Connected)?.serverInfo
                ?: ServerInfoMessage(
                    protocol = 1,
                    serverId = "server-1",
                    livekitUrl = "ws://192.168.1.20:7880",
                    serverTime = "2026-10-22T09:00:00.000Z",
                )
            state.value = ControlState.Connected(serverInfo = serverInfo)
        }

        override fun endRoom() = Unit

        override fun setCamera(cameraNumber: Int) = Unit

        override fun setMute(participantId: String, muted: Boolean) = Unit

        override fun clearMute() {
            clearMuteCalls += 1
        }
    }

    private class FakeMedia : MediaController {
        override val state = MutableStateFlow<MediaState>(MediaState.Idle)
        val directConnects = mutableListOf<Pair<String, String>>()
        val transmissions = mutableListOf<Boolean>()
        var disconnectCalls = 0

        override suspend fun connect(
            tokenUrl: String,
            preferredLivekitUrl: String?,
            name: String,
        ) = Unit

        override suspend fun connectDirect(url: String, token: String) {
            directConnects += url to token
        }

        override fun disconnect() {
            disconnectCalls += 1
            state.value = MediaState.Idle
        }

        override suspend fun setMicrophoneTransmitting(transmitting: Boolean) {
            transmissions += transmitting
            val current = state.value
            if (current is MediaState.Ready) {
                state.value = current.copy(transmitting = transmitting)
            }
        }
    }

    private class FakeService : SessionServiceGateway {
        var roomName: String? = null
        var running = false

        override fun start(roomName: String) {
            this.roomName = roomName
            running = true
        }

        override fun stop() {
            running = false
        }
    }
}
