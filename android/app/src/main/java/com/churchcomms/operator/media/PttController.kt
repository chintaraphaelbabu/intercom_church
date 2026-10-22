package com.churchcomms.operator.media

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Owns push-to-talk intent and serializes it onto the media seam.
 *
 * Presses and releases only toggle the already-published microphone track
 * through [MediaController]. Work is coalesced so a release always wins over
 * an in-flight press, and duplicate releases are safe. [transmitting] is set
 * only after the media layer confirms the track changed state.
 */
class PttController(
    private val media: MediaController,
    private val scope: CoroutineScope,
    private val onClearMute: () -> Unit,
) {
    private val _transmitting = MutableStateFlow(false)
    val transmitting: StateFlow<Boolean> = _transmitting.asStateFlow()

    private val mutex = Mutex()

    @Volatile
    private var desired = false

    @Volatile
    private var applied = false

    @Volatile
    private var generation = 0

    init {
        scope.launch {
            media.state.collect { state ->
                if (state !is MediaState.Ready) {
                    reset()
                }
            }
        }
    }

    /** Called on pointer-down. Only available once the media room is ready. */
    fun press(forceMuted: Boolean) {
        if (media.state.value !is MediaState.Ready) {
            return
        }
        if (forceMuted) {
            onClearMute()
        }
        desired = true
        applyDesired()
    }

    /** Called on pointer-up, cancel, drag-out, leave, or backgrounding. */
    fun release() {
        desired = false
        applyDesired()
    }

    /**
     * Drop PTT state without touching the media room. Used when the session or
     * the media connection is being torn down; disconnecting the room stops
     * capture and transmission.
     */
    fun reset() {
        generation += 1
        desired = false
        applied = false
        _transmitting.value = false
    }

    private fun applyDesired() {
        val expectedGeneration = generation
        scope.launch {
            mutex.withLock {
                while (applied != desired) {
                    if (expectedGeneration != generation) {
                        return@withLock
                    }
                    val target = desired
                    if (media.state.value !is MediaState.Ready) {
                        reset()
                        return@withLock
                    }
                    try {
                        media.setMicrophoneTransmitting(target)
                    } catch (_: Exception) {
                        reset()
                        return@withLock
                    }
                    if (expectedGeneration != generation) {
                        return@withLock
                    }
                    applied = target
                    _transmitting.value = target
                }
            }
        }
    }
}
