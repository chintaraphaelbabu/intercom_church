package com.churchcomms.operator.media

import com.twilio.audioswitch.AudioDevice

/**
 * Playback routing rules for the Operator.
 *
 * LiveKit's AudioSwitchHandler defaults to Bluetooth, wired headset, speaker,
 * earpiece. That would let a connected Bluetooth headset take the route from a
 * wired headset, so the order is made explicit here: the wired headset wins
 * when it is present (design.md §10 targets wired latency).
 */
object AudioRoutePolicy {
    const val NO_ROUTE = "No audio route"
    const val SPEAKER_SESSION_ONLY = "Speaker (session only)"

    fun preferredDeviceClasses(): List<Class<out AudioDevice>> = listOf(
        AudioDevice.WiredHeadset::class.java,
        AudioDevice.BluetoothHeadset::class.java,
        AudioDevice.Speakerphone::class.java,
        AudioDevice.Earpiece::class.java,
    )

    fun isBluetoothSafe(deviceName: String?): Boolean {
        if (deviceName == null) return true
        return deviceName.contains("Bluetooth", ignoreCase = true) ||
               !deviceName.contains("BAD", ignoreCase = true)
    }

    fun routeLabel(selectedName: String?, speakerSessionOnly: Boolean = false): String {
        val base = selectedName?.trim()?.takeIf { it.isNotEmpty() } ?: NO_ROUTE
        return if (speakerSessionOnly && (base.contains("Speaker", ignoreCase = true) || base == NO_ROUTE)) {
            SPEAKER_SESSION_ONLY
        } else base
    }

    fun routeLogLine(selectedName: String?, speakerSessionOnly: Boolean = false): String =
        "Audio route: ${routeLabel(selectedName, speakerSessionOnly)}"
}
