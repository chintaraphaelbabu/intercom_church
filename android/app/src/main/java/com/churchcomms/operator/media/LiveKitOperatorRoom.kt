package com.churchcomms.operator.media

import android.content.Context
import android.util.Log
import io.livekit.android.LiveKit
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.room.Room
import io.livekit.android.room.track.Track
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

private const val TAG = "ChurchComms.Audio"

/**
 * LiveKit's Android room adapted to the narrow [OperatorRoom] seam.
 *
 * LiveKit renders subscribed audio itself through its AudioSwitchHandler, whose
 * default preference order is Bluetooth, wired headset, speakerphone, earpiece.
 * We only report which route it selected and which remote tracks arrived.
 */
class LiveKitOperatorRoom(private val context: Context) : OperatorRoom {
    private var room: Room? = null
    private var scope: CoroutineScope? = null
    private var listener: ((MediaRoomEvent) -> Unit)? = null

    override fun setEventListener(listener: (MediaRoomEvent) -> Unit) {
        this.listener = listener
    }

    override suspend fun connect(url: String, token: String) {
        val room = LiveKit.create(context)
        this.room = room

        room.audioSwitchHandler?.registerAudioDeviceChangeListener { _, selected ->
            val route = selected?.name ?: "No audio route"
            Log.i(TAG, "Audio route: $route")
            listener?.invoke(MediaRoomEvent.RouteChanged(route))
        }

        val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
        this.scope = scope
        scope.launch {
            room.events.collect { event ->
                when (event) {
                    is RoomEvent.Connected -> {
                        listener?.invoke(
                            MediaRoomEvent.Connected(routeName(room)),
                        )
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
                        listener?.invoke(
                            MediaRoomEvent.Disconnected(event.reason.name),
                        )
                    }

                    is RoomEvent.FailedToConnect -> {
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

    override fun disconnect() {
        scope?.cancel()
        scope = null
        room?.disconnect()
        room = null
        Log.i(TAG, "LiveKit disconnected")
    }

    private fun routeName(room: Room): String =
        room.audioSwitchHandler?.selectedAudioDevice?.name ?: "No audio route"
}
