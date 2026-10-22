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

    private class FakeTokenClient : MediaTokenClient {
        override suspend fun fetch(tokenUrl: String, name: String): MediaToken =
            MediaToken(url = "ws://192.168.1.2:7880", token = "join-token")
    }

    private class FakeRoom : OperatorRoom {
        private var listener: ((MediaRoomEvent) -> Unit)? = null
        var connectedUrl: String? = null
        var connectError: Exception? = null

        override suspend fun connect(url: String, token: String) {
            connectError?.let { throw it }
            connectedUrl = url
        }

        override fun disconnect() = Unit

        override fun setEventListener(listener: (MediaRoomEvent) -> Unit) {
            this.listener = listener
        }

        fun emit(event: MediaRoomEvent) {
            listener?.invoke(event)
        }
    }
}
