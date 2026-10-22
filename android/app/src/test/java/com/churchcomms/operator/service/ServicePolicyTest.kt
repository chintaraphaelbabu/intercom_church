package com.churchcomms.operator.service

import com.churchcomms.operator.control.ControlState
import com.churchcomms.operator.protocol.LiveKitCredentials
import com.churchcomms.operator.protocol.RoomSnapshot
import com.churchcomms.operator.protocol.ServerInfoMessage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ServicePolicyTest {
    @Test
    fun `notification names the room and offers leave`() {
        assertEquals("In room MEDIA", ServicePolicy.notificationText("  MEDIA  "))
        assertEquals("Church Comms session", ServicePolicy.notificationTitle("MEDIA"))
        assertEquals("Leave", ServicePolicy.leaveActionLabel())
    }

    @Test
    fun `notification falls back safely when the room is unknown`() {
        assertEquals("Church Comms", ServicePolicy.roomLabel(null))
        assertEquals("Church Comms", ServicePolicy.roomLabel("   "))
        assertEquals(
            "Connected to the control server",
            ServicePolicy.notificationText(null),
        )
    }

    @Test
    fun `wake lock is held only while joined`() {
        assertTrue(ServicePolicy.shouldHoldWakeLock(joined()))
        assertFalse(
            ServicePolicy.shouldHoldWakeLock(ControlState.Reconnecting(1, 5)),
        )
        assertFalse(ServicePolicy.shouldHoldWakeLock(ControlState.Connecting))
        assertFalse(ServicePolicy.shouldHoldWakeLock(ControlState.Disconnected))
        assertFalse(
            ServicePolicy.shouldHoldWakeLock(
                ControlState.Connected(
                    ServerInfoMessage(
                        protocol = 1,
                        serverId = "server-1",
                        livekitUrl = "ws://192.168.1.20:7880",
                        serverTime = "2026-10-22T09:00:00.000Z",
                    ),
                ),
            ),
        )
    }

    @Test
    fun `room names follow the protocol limits`() {
        assertTrue(ServicePolicy.validateRoomName("MEDIA"))
        assertTrue(ServicePolicy.validateRoomName("  MEDIA  "))
        assertFalse(ServicePolicy.validateRoomName(""))
        assertFalse(ServicePolicy.validateRoomName("   "))
        assertFalse(ServicePolicy.validateRoomName("x".repeat(25)))
    }

    private fun joined() = ControlState.Joined(
        participantId = "participant-1",
        sessionToken = "session-1",
        room = RoomSnapshot(name = "MEDIA", status = "open"),
        livekit = LiveKitCredentials(
            url = "ws://192.168.1.20:7880",
            room = "MEDIA",
            token = "token",
            expiresAt = "2026-10-22T11:56:00.000Z",
        ),
    )
}
