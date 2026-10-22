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
        val service = FakeService()
        val controller = controller(FakeDiscovery(), control, FakeMedia(), service, this)
        control.state.value = joined()
        advanceUntilIdle()

        assertEquals("MEDIA", service.roomName)
        assertTrue(service.running)
        assertEquals("MEDIA", controller.state.value.activeRoomName)

        control.state.value = ControlState.Reconnecting(2, 5)
        advanceUntilIdle()
        assertTrue(service.running)

        control.state.value = ControlState.Failed("No Wi-Fi", canRetry = true)
        advanceUntilIdle()
        assertFalse(service.running)
    }

    @Test
    fun `leave sends leave-room, stops audio and service, and restarts discovery`() = runTest {
        val discovery = FakeDiscovery()
        val control = FakeControl()
        val media = FakeMedia()
        val service = FakeService()
        val controller = controller(discovery, control, media, service, this)
        controller.start()

        control.state.value = joined()
        advanceUntilIdle()
        controller.joinRoom(roomName = "MEDIA", displayName = "Camera 1", cameraNumber = 1)
        controller.leave()
        advanceUntilIdle()

        assertEquals(1, control.leaveCalls)
        assertEquals(1, media.disconnectCalls)
        assertFalse(service.running)
        assertEquals(ControlState.Disconnected, controller.state.value.control)
        assertEquals("", controller.state.value.roomName)
        assertEquals(2, discovery.startCalls)
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
    fun `debug connection does not start the room service`() = runTest {
        val service = FakeService()
        val control = FakeControl()
        val controller = controller(FakeDiscovery(), control, FakeMedia(), service, this)

        control.state.value = ControlState.Connected(
            serverInfo = ServerInfoMessage(
                protocol = 1,
                serverId = "server-1",
                livekitUrl = "ws://192.168.1.20:7880",
                serverTime = "2026-10-22T09:00:00.000Z",
            ),
        )
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

    private fun joined(): ControlState.Joined = ControlState.Joined(
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
                    muted = false,
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
        var retryCalls = 0

        override fun connect(server: DiscoveredServer) {
            connectedTo = server
            state.value = ControlState.Connecting
        }

        override fun retry() {
            retryCalls += 1
            state.value = ControlState.Connecting
        }

        override fun disconnect() {
            state.value = ControlState.Disconnected
        }

        override fun createRoom(name: String) = Unit

        override fun joinRoom(room: String, name: String, cameraNumber: Int) = Unit

        override fun leaveRoom() {
            leaveCalls += 1
            state.value = ControlState.Disconnected
        }

        override fun endRoom() = Unit

        override fun setCamera(cameraNumber: Int) = Unit

        override fun setMute(participantId: String, muted: Boolean) = Unit

        override fun clearMute() = Unit
    }

    private class FakeMedia : MediaController {
        override val state = MutableStateFlow<MediaState>(MediaState.Idle)
        val directConnects = mutableListOf<Pair<String, String>>()
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
