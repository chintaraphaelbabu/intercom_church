package com.churchcomms.operator.media

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class OperatorMediaTest {
    @Test
    fun `moves from connecting to ready when the media room connects`() = runTest {
        val room = FakeRoom()
        val media = OperatorMedia(
            tokenClient = FakeTokenClient(),
            createRoom = { room },
        )

        media.connect(
            tokenUrl = "http://192.168.137.1:8765/api/livekit-token",
            preferredLivekitUrl = "ws://192.168.137.1:7880",
            name = "SM-T295",
        )

        assertEquals(MediaState.WebRtcConnecting, media.state.value)

        room.emit(MediaRoomEvent.Connected("Wired Headset"))

        assertEquals(
            MediaState.Ready(outputRoute = "Wired Headset", directorAudio = false),
            media.state.value,
        )
    }

    @Test
    fun `leaving audio while the token request is pending cancels the join`() = runTest {
        val pendingToken = CompletableDeferred<MediaToken>()
        val room = FakeRoom()
        val media = OperatorMedia(
            tokenClient = object : MediaTokenClient {
                override suspend fun fetch(tokenUrl: String, name: String): MediaToken =
                    pendingToken.await()
            },
            createRoom = { room },
        )

        val joining = launch {
            media.connect(
                tokenUrl = "http://192.168.137.1:8765/api/livekit-token",
                preferredLivekitUrl = "ws://192.168.137.1:7880",
                name = "SM-T295",
            )
        }
        runCurrent()
        assertEquals(MediaState.WebRtcConnecting, media.state.value)

        media.disconnect()
        pendingToken.complete(
            MediaToken(url = "ws://192.168.1.2:7880", token = "join-token"),
        )
        joining.join()

        assertEquals(MediaState.Idle, media.state.value)
        assertNull(room.connectedUrl)
    }

    @Test
    fun `uses the discovered LiveKit URL instead of the unreachable advertised host`() = runTest {
        val room = FakeRoom()
        val media = OperatorMedia(
            tokenClient = FakeTokenClient(),
            createRoom = { room },
        )

        media.connect(
            tokenUrl = "http://192.168.137.1:8765/api/livekit-token",
            preferredLivekitUrl = "ws://192.168.137.1:7880",
            name = "SM-T295",
        )

        assertEquals("ws://192.168.137.1:7880", room.connectedUrl)
    }

    @Test
    fun `reports MEDIA_FAILED when the token request fails`() = runTest {
        val room = FakeRoom()
        val media = OperatorMedia(
            tokenClient = object : MediaTokenClient {
                override suspend fun fetch(tokenUrl: String, name: String): MediaToken =
                    throw IllegalStateException("token service down")
            },
            createRoom = { room },
        )

        media.connect(
            tokenUrl = "http://192.168.137.1:8765/api/livekit-token",
            preferredLivekitUrl = "ws://192.168.137.1:7880",
            name = "SM-T295",
        )

        val state = media.state.value as MediaState.Failed
        assertEquals("Could not get a media token: token service down", state.message)
        assertNull(room.connectedUrl)
    }

    @Test
    fun `reports MEDIA_FAILED when LiveKit cannot connect`() = runTest {
        val room = FakeRoom().apply {
            connectError = IllegalStateException("no route to host")
        }
        val media = OperatorMedia(
            tokenClient = FakeTokenClient(),
            createRoom = { room },
        )

        media.connect(
            tokenUrl = "http://192.168.137.1:8765/api/livekit-token",
            preferredLivekitUrl = "ws://192.168.137.1:7880",
            name = "SM-T295",
        )

        val state = media.state.value as MediaState.Failed
        assertEquals("LiveKit connection failed: no route to host", state.message)
    }

    @Test
    fun `marks Director audio live when the audio track arrives`() = runTest {
        val room = FakeRoom()
        val media = OperatorMedia(
            tokenClient = FakeTokenClient(),
            createRoom = { room },
        )
        media.connect(
            tokenUrl = "http://192.168.137.1:8765/api/livekit-token",
            preferredLivekitUrl = "ws://192.168.137.1:7880",
            name = "SM-T295",
        )
        room.emit(MediaRoomEvent.Connected("Wired Headset"))

        room.emit(MediaRoomEvent.DirectorAudioSubscribed("Director"))

        assertEquals(
            MediaState.Ready(outputRoute = "Wired Headset", directorAudio = true),
            media.state.value,
        )
    }

    @Test
    fun `keeps Director audio live when subscription arrives before connected`() = runTest {
        val room = FakeRoom()
        val media = OperatorMedia(
            tokenClient = FakeTokenClient(),
            createRoom = { room },
        )
        media.connect(
            tokenUrl = "http://192.168.137.1:8765/api/livekit-token",
            preferredLivekitUrl = "ws://192.168.137.1:7880",
            name = "SM-T295",
        )

        room.emit(MediaRoomEvent.DirectorAudioSubscribed("Director"))
        room.emit(MediaRoomEvent.Connected("Wired Headset"))

        assertEquals(
            MediaState.Ready(outputRoute = "Wired Headset", directorAudio = true),
            media.state.value,
        )
    }

    @Test
    fun `joins directly with credentials issued by the control protocol`() = runTest {
        val room = FakeRoom()
        val media = OperatorMedia(
            tokenClient = object : MediaTokenClient {
                override suspend fun fetch(tokenUrl: String, name: String): MediaToken =
                    error("Direct credentials must not fetch another token")
            },
            createRoom = { room },
        )

        media.connectDirect(
            url = "ws://192.168.137.1:7880",
            token = "joined-livekit-token",
        )

        assertEquals("ws://192.168.137.1:7880", room.connectedUrl)
        assertEquals("joined-livekit-token", room.connectedToken)
        assertEquals(MediaState.WebRtcConnecting, media.state.value)
    }

    @Test
    fun `publishes the microphone once and reports real transmitting state`() = runTest {
        val room = FakeRoom()
        val media = OperatorMedia(
            tokenClient = FakeTokenClient(),
            createRoom = { room },
        )
        media.connectDirect(url = "ws://192.168.137.1:7880", token = "join-token")
        room.emit(MediaRoomEvent.Connected("Wired Headset"))
        room.emit(MediaRoomEvent.DirectorAudioSubscribed("Director"))

        media.setMicrophoneTransmitting(true)
        assertEquals(
            MediaState.Ready(
                outputRoute = "Wired Headset",
                directorAudio = true,
                transmitting = true,
            ),
            media.state.value,
        )

        media.setMicrophoneTransmitting(false)
        assertEquals(false, (media.state.value as MediaState.Ready).transmitting)
        assertEquals(1, room.publishCalls)
        assertEquals(listOf(true, false), room.trackStates)
    }

    @Test
    fun `a microphone publish failure surfaces MEDIA_FAILED and stops transmitting`() = runTest {
        val room = FakeRoom().apply {
            transmitError = IllegalStateException("microphone permission denied")
        }
        val media = OperatorMedia(
            tokenClient = FakeTokenClient(),
            createRoom = { room },
        )
        media.connectDirect(url = "ws://192.168.137.1:7880", token = "join-token")
        room.emit(MediaRoomEvent.Connected("Wired Headset"))

        val failure = runCatching { media.setMicrophoneTransmitting(true) }.exceptionOrNull()

        assertEquals("microphone permission denied", failure?.message)
        val state = media.state.value as MediaState.Failed
        assertEquals("Microphone unavailable: microphone permission denied", state.message)
    }

    private class FakeTokenClient : MediaTokenClient {
        override suspend fun fetch(tokenUrl: String, name: String): MediaToken =
            MediaToken(url = "ws://192.168.1.2:7880", token = "join-token")
    }

    private class FakeRoom : OperatorRoom {
        private var listener: ((MediaRoomEvent) -> Unit)? = null
        var connectedUrl: String? = null
        var connectedToken: String? = null
        var connectError: Exception? = null
        var transmitError: Exception? = null
        var publishCalls = 0
        val trackStates = mutableListOf<Boolean>()
        private var published = false

        override suspend fun connect(url: String, token: String) {
            connectError?.let { throw it }
            connectedUrl = url
            connectedToken = token
            // The real room publishes the microphone muted on connect.
            published = true
            publishCalls += 1
        }

        override fun disconnect() = Unit

        override fun setEventListener(listener: (MediaRoomEvent) -> Unit) {
            this.listener = listener
        }

        override suspend fun setMicrophoneTransmitting(transmitting: Boolean) {
            transmitError?.let { throw it }
            if (transmitting && !published) {
                published = true
                publishCalls += 1
            }
            trackStates += transmitting
        }

        fun emit(event: MediaRoomEvent) {
            listener?.invoke(event)
        }
    }
}
