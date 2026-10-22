package com.churchcomms.operator.media

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PttControllerTest {
    @Test
    fun `press transmits and release stops`() = runTest {
        val media = FakeMedia()
        val ptt = ptt(media, this)

        ptt.press(forceMuted = false)
        advanceUntilIdle()

        assertEquals(listOf(true), media.transmissions)
        assertTrue(ptt.transmitting.value)

        ptt.release()
        advanceUntilIdle()

        assertEquals(listOf(true, false), media.transmissions)
        assertFalse(ptt.transmitting.value)
    }

    @Test
    fun `release is idempotent`() = runTest {
        val media = FakeMedia()
        val ptt = ptt(media, this)

        ptt.press(forceMuted = false)
        advanceUntilIdle()
        ptt.release()
        ptt.release()
        ptt.release()
        advanceUntilIdle()

        assertEquals(listOf(true, false), media.transmissions)
        assertFalse(ptt.transmitting.value)
    }

    @Test
    fun `a fresh press clears a force-mute before transmitting`() = runTest {
        val events = mutableListOf<String>()
        val media = FakeMedia().apply {
            onTransmit = { events += "transmit:$it" }
        }
        val ptt = ptt(media, this, onClearMute = { events += "clear-mute" })

        ptt.press(forceMuted = true)
        advanceUntilIdle()

        assertEquals(listOf("clear-mute", "transmit:true"), events)
        assertTrue(ptt.transmitting.value)
    }

    @Test
    fun `does not transmit until media is ready`() = runTest {
        val media = FakeMedia(initialState = MediaState.WebRtcConnecting)
        val ptt = ptt(media, this)

        ptt.press(forceMuted = false)
        advanceUntilIdle()

        assertTrue(media.transmissions.isEmpty())
        assertFalse(ptt.transmitting.value)
    }

    @Test
    fun `a release during a slow publish still stops transmission`() = runTest {
        val media = FakeMedia()
        val gate = CompletableDeferred<Unit>()
        media.gate = gate
        val ptt = ptt(media, this)

        ptt.press(forceMuted = false)
        runCurrent()
        ptt.release()
        gate.complete(Unit)
        advanceUntilIdle()

        assertEquals(listOf(true, false), media.transmissions)
        assertFalse(ptt.transmitting.value)
    }

    @Test
    fun `media failure clears the transmitting state`() = runTest {
        val media = FakeMedia()
        val ptt = ptt(media, this)

        ptt.press(forceMuted = false)
        advanceUntilIdle()
        media.state.value = MediaState.Failed("LiveKit connection closed")

        advanceUntilIdle()

        assertFalse(ptt.transmitting.value)
        assertEquals(listOf(true), media.transmissions)
    }

    @Test
    fun `twenty press release cycles reuse one connection and one published track`() =
        runTest {
            val room = RecordingRoom()
            val media = OperatorMedia(
                tokenClient = object : MediaTokenClient {
                    override suspend fun fetch(tokenUrl: String, name: String): MediaToken =
                        error("direct credentials must not fetch another token")
                },
                createRoom = { room },
            )
            media.connectDirect(url = "ws://192.168.137.1:7880", token = "join-token")
            room.emit(MediaRoomEvent.Connected("Wired Headset"))
            val ptt = ptt(media, this)

            repeat(20) {
                ptt.press(forceMuted = false)
                runCurrent()
                ptt.release()
                runCurrent()
            }
            advanceUntilIdle()

            assertEquals(1, room.connectCalls)
            assertEquals(1, room.publishCalls)
            assertEquals(40, room.trackStates.size)
            assertEquals(0, room.disconnectCalls)
            assertEquals(false, (media.state.value as MediaState.Ready).transmitting)
            assertFalse(ptt.transmitting.value)
        }

    private fun ptt(
        media: MediaController,
        scope: TestScope,
        onClearMute: () -> Unit = {},
    ): PttController = PttController(
        media = media,
        scope = CoroutineScope(
            scope.backgroundScope.coroutineContext +
                UnconfinedTestDispatcher(scope.testScheduler),
        ),
        onClearMute = onClearMute,
    )

    private class FakeMedia(
        initialState: MediaState = MediaState.Ready(
            outputRoute = "Wired Headset",
            directorAudio = true,
        ),
    ) : MediaController {
        override val state = MutableStateFlow(initialState)
        val transmissions = mutableListOf<Boolean>()
        var gate: CompletableDeferred<Unit>? = null
        var onTransmit: ((Boolean) -> Unit)? = null
        var disconnectCalls = 0

        override suspend fun connect(
            tokenUrl: String,
            preferredLivekitUrl: String?,
            name: String,
        ) = Unit

        override suspend fun connectDirect(url: String, token: String) = Unit

        override fun disconnect() {
            disconnectCalls += 1
            state.value = MediaState.Idle
        }

        override suspend fun setMicrophoneTransmitting(transmitting: Boolean) {
            gate?.await()
            transmissions += transmitting
            onTransmit?.invoke(transmitting)
            val current = state.value
            if (current is MediaState.Ready) {
                state.value = current.copy(transmitting = transmitting)
            }
        }
    }

    private class RecordingRoom : OperatorRoom {
        private var listener: ((MediaRoomEvent) -> Unit)? = null
        var connectCalls = 0
        var disconnectCalls = 0
        var publishCalls = 0
        val trackStates = mutableListOf<Boolean>()
        private var published = false

        override suspend fun connect(url: String, token: String) {
            connectCalls += 1
            // The real room publishes the microphone muted on connect.
            published = true
            publishCalls += 1
        }

        override fun disconnect() {
            disconnectCalls += 1
        }

        override fun setEventListener(listener: (MediaRoomEvent) -> Unit) {
            this.listener = listener
        }

        override suspend fun setMicrophoneTransmitting(transmitting: Boolean) {
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
