package com.churchcomms.operator.service

import com.churchcomms.operator.control.ControlState
import com.churchcomms.operator.protocol.Protocol

/**
 * Pure rules used by [OperatorService]. Keeping these free of Android types lets
 * JVM tests assert notification wording and wake-lock behaviour.
 */
object ServicePolicy {
    const val DEFAULT_ROOM_LABEL = "Church Comms"

    fun roomLabel(roomName: String?): String =
        roomName?.trim()?.takeIf { it.isNotEmpty() } ?: DEFAULT_ROOM_LABEL

    fun notificationTitle(roomName: String?): String = "Church Comms session"

    fun notificationText(roomName: String?): String {
        val label = roomLabel(roomName)
        return if (label == DEFAULT_ROOM_LABEL) {
            "Connected to the control server"
        } else {
            "In room $label"
        }
    }

    fun leaveActionLabel(): String = "Leave"

    /** The CPU stays awake only while the room session is genuinely connected. */
    fun shouldHoldWakeLock(control: ControlState): Boolean =
        control is ControlState.Joined

    fun validateRoomName(name: String): Boolean =
        name.trim().isNotEmpty() && name.trim().length <= Protocol.MAX_ROOM_NAME_LENGTH
}
