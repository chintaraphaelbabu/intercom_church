package com.churchcomms.operator.media

import android.content.Context
import android.util.Log
import io.livekit.android.LiveKit
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.room.Room
import io.livekit.android.room.track.LocalAudioTrack
import io.livekit.android.room.track.LocalAudioTrackOptions
import io.livekit.android.room.track.Track
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

private const val TAG = "ChurchComms.Audio"

/**
 * LiveKit's Android room adapted to the narrow [OperatorRoom] seam.
 *
 * LiveKit renders subscribed audio itself through its AudioSwitchHandler. The
 * preference order is set by [AudioRoutePolicy] so a wired headset is selected
 * whenever it is present, and every active route is logged for diagnostics.
 */
class LiveKitOperatorRoom(private val context: Context) : OperatorRoom {
    private var room: Room? = null
    private var scope: CoroutineScope? = null
    private var listener: ((MediaRoomEvent) -> Unit)? = null
    private var localAudioTrack: LocalAudioTrack? = null
    private val microphoneMutex = Mutex()

    override fun setEventListener(listener: (MediaRoomEvent) -> Unit) {
        this.listener = listener
    }

    override suspend fun connect(url: String, token: String) {
        val room = LiveKit.create(context)
        this.room = room
        // docs/design.md §10: speech-tuned capture, enabled once for the room.
        room.localParticipant.audioTrackCaptureDefaults = LocalAudioTrackOptions(
            noiseSuppression = true,
            echoCancellation = true,
            autoGainControl = true,
        )
        // Wired first: LiveKit's default would prefer a Bluetooth headset.
        room.audioSwitchHandler?.preferredDeviceList =
            AudioRoutePolicy.preferredDeviceClasses()

        room.audioSwitchHandler?.registerAudioDeviceChangeListener { _, selected ->
            logRoute(selected?.name)
            listener?.invoke(MediaRoomEvent.RouteChanged(routeLabel(selected?.name)))
        }

        val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
        this.scope = scope
        scope.launch {
            room.events.collect { event ->
                when (event) {
                    is RoomEvent.Connected -> {
                        // Publish once, muted, before the UI can enable PTT, so
                        // the first press only flips the existing track.
                        runCatching {
                            microphoneMutex.withLock { publishMicrophone(room) }
                        }.onFailure { error ->
                            Log.w(TAG, "Could not pre-publish the microphone", error)
                        }
                        // Log the route the handler settled on, not only changes.
                        val route = routeLabel(room.audioSwitchHandler?.selectedAudioDevice?.name)
                        Log.i(TAG, AudioRoutePolicy.routeLogLine(route))
                        listener?.invoke(MediaRoomEvent.Connected(route))
                    }

                    is RoomEvent.TrackSubscribed -> {
                        if (event.track.kind == Track.Kind.AUDIO) {
                            val name = event.participant.name ?: "Director"
                            Log.i(TAG, "Subscribed to audio from $name")
                            listener?.invoke(
                                MediaRoomEvent.DirectorAudioSubscribed(name),
                            )
                        }
                    }

                    is RoomEvent.TrackUnsubscribed -> {
                        if (event.track.kind == Track.Kind.AUDIO) {
                            listener?.invoke(
                                MediaRoomEvent.DirectorAudioUnsubscribed(
                                    event.participant.name ?: "Director",
                                ),
                            )
                        }
                    }

                    is RoomEvent.Disconnected -> {
                        localAudioTrack?.stop()
                        localAudioTrack = null
                        listener?.invoke(
                            MediaRoomEvent.Disconnected(event.reason.name),
                        )
                    }

                    is RoomEvent.FailedToConnect -> {
                        localAudioTrack?.stop()
                        localAudioTrack = null
                        listener?.invoke(
                            MediaRoomEvent.Disconnected(
                                event.error.message ?: "LiveKit failed to connect",
                            ),
                        )
                    }

                    else -> Unit
                }
            }
        }

        Log.i(TAG, "Connecting to LiveKit at $url")
        room.connect(url, token)
        Log.i(TAG, "LiveKit connected at $url")
    }

    override fun setVolume(volume: Float) {
        Log.d(TAG, "[DEBUG-a4f3] setVolume=$volume (LiveKit SDK: apply to room tracks if available)")
        // LiveKit SDK: remote track volume could be applied here via room.remoteParticipants
        // Minimal hook for slider functionality.
    }

    override suspend fun setMicrophoneTransmitting(transmitting: Boolean) {
        microphoneMutex.withLock {
            val room = room ?: throw IllegalStateException("LiveKit is not connected.")
            if (!transmitting) {
                // Already-published track: disabling it mutes capture without a
                // renegotiation or a new publication.
                localAudioTrack?.enabled = false
                Log.i(TAG, "PTT transmit off")
                return@withLock
            }

            val track = localAudioTrack ?: publishMicrophone(room)
            track.enabled = true
            Log.i(TAG, "PTT transmit on")
        }
    }

    private suspend fun publishMicrophone(room: Room): LocalAudioTrack {
        val track = room.localParticipant.getOrCreateDefaultAudioTrack()
        // Publish muted, then unmute only for the press that asked to talk.
        track.enabled = false
        val published = try {
            room.localParticipant.publishAudioTrack(track)
        } catch (error: Exception) {
            track.enabled = false
            throw error
        }
        if (!published) {
            track.enabled = false
            throw IllegalStateException("LiveKit rejected the microphone track.")
        }
        localAudioTrack = track
        Log.i(TAG, "Published the Operator microphone")
        return track
    }

    override fun disconnect() {
        scope?.cancel()
        scope = null
        localAudioTrack?.stop()
        localAudioTrack = null
        room?.disconnect()
        room = null
        Log.i(TAG, "LiveKit disconnected")
    }

    private fun logRoute(selectedName: String?) {
        Log.i(TAG, AudioRoutePolicy.routeLogLine(selectedName))
    }

    private fun routeLabel(selectedName: String?): String =
        AudioRoutePolicy.routeLabel(selectedName)
}
