package com.churchcomms.operator.media

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** The Operator's media state, distinct from the control connection. */
sealed interface MediaState {
    data object Idle : MediaState
    data object WebRtcConnecting : MediaState
    data class Ready(
        val outputRoute: String,
        val directorAudio: Boolean,
        /** True only while the published microphone track is actually unmuted. */
        val transmitting: Boolean = false,
    ) : MediaState

    data class Failed(val message: String) : MediaState
}

sealed interface MediaRoomEvent {
    data class Connected(val outputRoute: String) : MediaRoomEvent
    data class RouteChanged(val outputRoute: String) : MediaRoomEvent
    data class DirectorAudioSubscribed(val participantName: String) : MediaRoomEvent
    data class DirectorAudioUnsubscribed(val participantName: String) : MediaRoomEvent
    data class Disconnected(val reason: String) : MediaRoomEvent
}

data class MediaToken(
    val url: String,
    val token: String,
)

interface MediaTokenClient {
    suspend fun fetch(tokenUrl: String, name: String): MediaToken
}

/** The LiveKit room narrowed to what OperatorMedia needs. */
interface OperatorRoom {
    suspend fun connect(url: String, token: String)
    fun disconnect()
    fun setEventListener(listener: (MediaRoomEvent) -> Unit)

    /**
     * Publish the microphone once, then mute or unmute that same track.
     * Implementations must not renegotiate or republish on later calls.
     */
    suspend fun setMicrophoneTransmitting(transmitting: Boolean)
    fun setVolume(volume: Float) // [DEBUG-a4f3]
}

interface MediaController {
    val state: StateFlow<MediaState>

    suspend fun connect(
        tokenUrl: String,
        preferredLivekitUrl: String?,
        name: String,
    )

    /** Join with LiveKit credentials already issued by `joined`. */
    suspend fun connectDirect(url: String, token: String)

    fun disconnect()

    /**
     * Toggle transmission on the already-published microphone track. Throws
     * when media is not ready or the track cannot change state, after moving
     * the state to MEDIA_FAILED.
     */
    suspend fun setMicrophoneTransmitting(transmitting: Boolean)
    fun setVolume(volume: Float) // [DEBUG-a4f3]
}

/**
 * Owns the Operator's LiveKit connection and publishes the state the UI shows:
 * WEBRTC_CONNECTING, READY, or MEDIA_FAILED. The control connection is owned by
 * ControlClient and is intentionally separate.
 */
class OperatorMedia(
    private val tokenClient: MediaTokenClient,
    private val createRoom: () -> OperatorRoom,
) : MediaController {
    private val _state = MutableStateFlow<MediaState>(MediaState.Idle)
    override val state: StateFlow<MediaState>
        get() = _state.asStateFlow()

    private var room: OperatorRoom? = null
    private var directorAudioSubscribed = false
    private var connectionGeneration = 0

    override suspend fun connect(
        tokenUrl: String,
        preferredLivekitUrl: String?,
        name: String,
    ) {
        disconnect()
        val generation = connectionGeneration
        _state.value = MediaState.WebRtcConnecting

        val token = try {
            tokenClient.fetch(tokenUrl = tokenUrl, name = name)
        } catch (error: Exception) {
            if (generation == connectionGeneration) {
                _state.value = MediaState.Failed(
                    "Could not get a media token: ${error.readableMessage()}",
                )
            }
            return
        }
        if (generation != connectionGeneration) {
            return
        }

        attach(
            generation = generation,
            url = preferredLivekitUrl?.takeIf { it.isNotBlank() } ?: token.url,
            token = token.token,
        )
    }

    override suspend fun connectDirect(url: String, token: String) {
        disconnect()
        val generation = connectionGeneration
        _state.value = MediaState.WebRtcConnecting
        attach(generation = generation, url = url, token = token)
    }

    private suspend fun attach(generation: Int, url: String, token: String) {
        val mediaRoom = createRoom()
        room = mediaRoom
        mediaRoom.setEventListener { event -> handle(generation, event) }

        try {
            mediaRoom.connect(url = url, token = token)
            if (generation != connectionGeneration) {
                if (room === mediaRoom) {
                    room = null
                }
                mediaRoom.disconnect()
            }
        } catch (error: Exception) {
            if (room === mediaRoom) {
                room = null
            }
            mediaRoom.disconnect()
            if (generation == connectionGeneration) {
                _state.value = MediaState.Failed(
                    "LiveKit connection failed: ${error.readableMessage()}",
                )
            }
        }
    }

    override fun disconnect() {
        connectionGeneration += 1
        room?.disconnect()
        room = null
        directorAudioSubscribed = false
        _state.value = MediaState.Idle
    }

    override fun setVolume(volume: Float) {
        // [DEBUG-a4f3] Minimal hook: passes to underlying room if connected
        (room as? LiveKitOperatorRoom)?.setVolume(volume)
    }

    override suspend fun setMicrophoneTransmitting(transmitting: Boolean) {
        if (_state.value !is MediaState.Ready) {
            throw IllegalStateException("LiveKit media is not ready.")
        }
        val mediaRoom = room ?: throw IllegalStateException("LiveKit is not connected.")
        val generation = connectionGeneration
        try {
            mediaRoom.setMicrophoneTransmitting(transmitting)
        } catch (error: Exception) {
            if (generation == connectionGeneration && room === mediaRoom) {
                _state.value = MediaState.Failed(
                    "Microphone unavailable: ${error.readableMessage()}",
                )
            }
            throw error
        }
        if (generation != connectionGeneration || room !== mediaRoom) {
            return
        }
        val current = _state.value
        if (current is MediaState.Ready) {
            _state.value = current.copy(transmitting = transmitting)
        }
    }

    private fun handle(generation: Int, event: MediaRoomEvent) {
        if (generation != connectionGeneration) {
            return
        }
        when (event) {
            is MediaRoomEvent.Connected -> {
                _state.value = MediaState.Ready(
                    outputRoute = event.outputRoute,
                    directorAudio = directorAudioSubscribed,
                )
            }

            is MediaRoomEvent.RouteChanged -> {
                val current = _state.value
                if (current is MediaState.Ready) {
                    _state.value = current.copy(outputRoute = event.outputRoute)
                }
            }

            is MediaRoomEvent.DirectorAudioSubscribed -> {
                directorAudioSubscribed = true
                val current = _state.value
                if (current is MediaState.Ready) {
                    _state.value = current.copy(directorAudio = true)
                }
            }

            is MediaRoomEvent.DirectorAudioUnsubscribed -> {
                directorAudioSubscribed = false
                val current = _state.value
                if (current is MediaState.Ready) {
                    _state.value = current.copy(directorAudio = false)
                }
            }

            is MediaRoomEvent.Disconnected -> {
                room = null
                directorAudioSubscribed = false
                _state.value = MediaState.Failed(
                    "Media connection closed: ${event.reason}",
                )
            }
        }
    }
}

private fun Exception.readableMessage(): String = message?.takeIf { it.isNotBlank() }
    ?: this::class.java.simpleName
