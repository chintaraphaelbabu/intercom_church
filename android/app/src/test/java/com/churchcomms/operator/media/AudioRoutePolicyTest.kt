package com.churchcomms.operator.media

import com.twilio.audioswitch.AudioDevice
import org.junit.Assert.assertEquals
import org.junit.Test

class AudioRoutePolicyTest {
    @Test
    fun `wired headset is preferred over bluetooth, speaker and earpiece`() {
        assertEquals(
            listOf(
                AudioDevice.WiredHeadset::class.java,
                AudioDevice.BluetoothHeadset::class.java,
                AudioDevice.Speakerphone::class.java,
                AudioDevice.Earpiece::class.java,
            ),
            AudioRoutePolicy.preferredDeviceClasses(),
        )
    }

    @Test
    fun `the active route is named and logged`() {
        assertEquals("Wired Headset", AudioRoutePolicy.routeLabel("Wired Headset"))
        assertEquals(
            "Audio route: Wired Headset",
            AudioRoutePolicy.routeLogLine("Wired Headset"),
        )
    }

    @Test
    fun `a missing route is reported instead of crashing`() {
        assertEquals("No audio route", AudioRoutePolicy.routeLabel(null))
        assertEquals("Audio route: No audio route", AudioRoutePolicy.routeLogLine(null))
    }
}
