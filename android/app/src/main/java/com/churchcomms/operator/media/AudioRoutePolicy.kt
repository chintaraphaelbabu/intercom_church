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

    fun preferredDeviceClasses(): List<Class<out AudioDevice>> = listOf(
        AudioDevice.WiredHeadset::class.java,
        AudioDevice.BluetoothHeadset::class.java,
        AudioDevice.Speakerphone::class.java,
        AudioDevice.Earpiece::class.java,
    )

    fun routeLabel(selectedName: String?): String =
        selectedName?.trim()?.takeIf { it.isNotEmpty() } ?: NO_ROUTE

    fun routeLogLine(selectedName: String?): String =
        "Audio route: ${routeLabel(selectedName)}"
}
