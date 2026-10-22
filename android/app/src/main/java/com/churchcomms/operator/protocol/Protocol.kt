package com.churchcomms.operator.protocol

import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Control protocol v1, mirroring `protocol/src/index.ts` and the shared fixtures
 * under `protocol/fixtures/`.
 *
 * The server owns media transport through LiveKit, so this package carries only
 * the versioned JSON control messages. Unknown server message types decode to
 * null and are ignored, which lets a newer server add messages safely.
 */
object Protocol {
    const val VERSION = 1
    const val CONTROL_PATH = "/ws"

    const val ROOM_CAPACITY = 11
    const val MAX_OPERATORS = 10
    const val MIN_CAMERA_NUMBER = 1
    const val MAX_CAMERA_NUMBER = 10
    const val MAX_ROOM_NAME_LENGTH = 24
    const val MAX_DISPLAY_NAME_LENGTH = 32
    const val GRACE_PERIOD_MS = 5 * 60 * 1000L

    val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = false
    }

    // ---------------------------------------------------------------- encoding

    fun hello(
        name: String,
        appVersion: String,
        sessionToken: String? = null,
        clientType: String = "operator",
    ): String = encodeClientMessage(
        HelloMessage(
            clientType = clientType,
            appVersion = appVersion,
            name = name,
            sessionToken = sessionToken,
        ),
    )

    fun createRoom(name: String): String =
        encodeClientMessage(CreateRoomMessage(name = name.trim()))

    fun endRoom(): String = encodeClientMessage(EndRoomMessage())

    fun joinRoom(
        room: String,
        name: String,
        cameraNumber: Int,
        sessionToken: String? = null,
    ): String = encodeClientMessage(
        JoinRoomMessage(
            room = room.trim(),
            name = name.trim(),
            cameraNumber = cameraNumber,
            sessionToken = sessionToken,
        ),
    )

    fun leaveRoom(): String = encodeClientMessage(LeaveRoomMessage())

    fun setCamera(cameraNumber: Int): String =
        encodeClientMessage(SetCameraMessage(cameraNumber = cameraNumber))

    fun setMute(participantId: String, muted: Boolean): String =
        encodeClientMessage(SetMuteMessage(participantId = participantId, muted = muted))

    fun clearMute(): String = encodeClientMessage(ClearMuteMessage())

    fun ping(): String = encodeClientMessage(PingMessage())

    fun encodeClientMessage(message: ClientMessage): String = when (message) {
        is HelloMessage -> json.encodeToString(HelloMessage.serializer(), message)
        is CreateRoomMessage -> json.encodeToString(CreateRoomMessage.serializer(), message)
        is EndRoomMessage -> json.encodeToString(EndRoomMessage.serializer(), message)
        is JoinRoomMessage -> json.encodeToString(JoinRoomMessage.serializer(), message)
        is LeaveRoomMessage -> json.encodeToString(LeaveRoomMessage.serializer(), message)
        is SetCameraMessage -> json.encodeToString(SetCameraMessage.serializer(), message)
        is SetMuteMessage -> json.encodeToString(SetMuteMessage.serializer(), message)
        is ClearMuteMessage -> json.encodeToString(ClearMuteMessage.serializer(), message)
        is PingMessage -> json.encodeToString(PingMessage.serializer(), message)
    }

    /**
     * Decode one server message. Unknown or malformed messages return null so a
     * newer server can add messages without crashing this client.
     */
    fun parseServerMessage(raw: String): ServerMessage? {
        val objectValue = try {
            json.parseToJsonElement(raw) as? JsonObject
        } catch (_: SerializationException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        } ?: return null

        return try {
            when ((objectValue["type"] as? JsonPrimitive)?.content) {
                "server_info" -> json.decodeFromJsonElement(
                    ServerInfoMessage.serializer(),
                    objectValue,
                )

                "debug_roster" -> json.decodeFromJsonElement(
                    DebugRosterMessage.serializer(),
                    objectValue,
                )

                "room_list" -> json.decodeFromJsonElement(
                    RoomListMessage.serializer(),
                    objectValue,
                )

                "joined" -> json.decodeFromJsonElement(
                    JoinedMessage.serializer(),
                    objectValue,
                )

                "participant_joined" -> json.decodeFromJsonElement(
                    ParticipantJoinedMessage.serializer(),
                    objectValue,
                )

                "participant_left" -> json.decodeFromJsonElement(
                    ParticipantLeftMessage.serializer(),
                    objectValue,
                )

                "participant_updated" -> json.decodeFromJsonElement(
                    ParticipantUpdatedMessage.serializer(),
                    objectValue,
                )

                "director_state" -> json.decodeFromJsonElement(
                    DirectorStateMessage.serializer(),
                    objectValue,
                )

                "mute_state" -> json.decodeFromJsonElement(
                    MuteStateMessage.serializer(),
                    objectValue,
                )

                "room_closed" -> json.decodeFromJsonElement(
                    RoomClosedMessage.serializer(),
                    objectValue,
                )

                "server_health" -> json.decodeFromJsonElement(
                    ServerHealthMessage.serializer(),
                    objectValue,
                )

                "error" -> json.decodeFromJsonElement(
                    ErrorMessage.serializer(),
                    objectValue,
                )

                "pong" -> json.decodeFromJsonElement(
                    PongMessage.serializer(),
                    objectValue,
                )

                else -> null
            }
        } catch (_: SerializationException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
    }

}

// --------------------------------------------------------------- client messages

sealed interface ClientMessage {
    val type: String
}

@Serializable
data class HelloMessage(
    override val type: String = "hello",
    val protocol: Int = Protocol.VERSION,
    val clientType: String = "operator",
    val appVersion: String,
    val name: String,
    val sessionToken: String? = null,
) : ClientMessage

@Serializable
data class CreateRoomMessage(
    override val type: String = "create_room",
    val name: String,
) : ClientMessage

@Serializable
data class EndRoomMessage(
    override val type: String = "end_room",
) : ClientMessage

@Serializable
data class JoinRoomMessage(
    override val type: String = "join_room",
    val room: String,
    val name: String,
    val cameraNumber: Int,
    val sessionToken: String? = null,
) : ClientMessage

@Serializable
data class LeaveRoomMessage(
    override val type: String = "leave_room",
) : ClientMessage

@Serializable
data class SetCameraMessage(
    override val type: String = "set_camera",
    val cameraNumber: Int,
) : ClientMessage

@Serializable
data class SetMuteMessage(
    override val type: String = "set_mute",
    val participantId: String,
    val muted: Boolean,
) : ClientMessage

@Serializable
data class ClearMuteMessage(
    override val type: String = "clear_mute",
) : ClientMessage

@Serializable
data class PingMessage(
    override val type: String = "ping",
) : ClientMessage

// --------------------------------------------------------------- server messages

sealed interface ServerMessage {
    val type: String
}

@Serializable
data class ServerInfoMessage(
    override val type: String = "server_info",
    val protocol: Int,
    val serverId: String,
    val livekitUrl: String,
    val serverTime: String,
) : ServerMessage

@Serializable
data class RosterClient(
    val id: String,
    val name: String,
    val clientType: String,
    val appVersion: String,
    val connectedAt: String,
)

@Serializable
data class DebugRosterMessage(
    override val type: String = "debug_roster",
    val clients: List<RosterClient>,
) : ServerMessage

@Serializable
data class RoomListMessage(
    override val type: String = "room_list",
    val rooms: List<RoomSummary>,
) : ServerMessage

@Serializable
data class JoinedMessage(
    override val type: String = "joined",
    val participantId: String,
    val sessionToken: String,
    val room: RoomSnapshot,
    val livekit: LiveKitCredentials,
) : ServerMessage

@Serializable
data class ParticipantJoinedMessage(
    override val type: String = "participant_joined",
    val participant: Participant,
    val room: RoomSnapshot,
) : ServerMessage

@Serializable
data class ParticipantLeftMessage(
    override val type: String = "participant_left",
    val participantId: String,
    val room: RoomSnapshot,
) : ServerMessage

@Serializable
data class ParticipantUpdatedMessage(
    override val type: String = "participant_updated",
    val participant: Participant,
    val room: RoomSnapshot,
) : ServerMessage

@Serializable
data class DirectorStateMessage(
    override val type: String = "director_state",
    val room: RoomSnapshot,
    val present: Boolean,
    val graceDeadline: String? = null,
) : ServerMessage

@Serializable
data class MuteStateMessage(
    override val type: String = "mute_state",
    val room: String,
    val participantId: String,
    val muted: Boolean,
    val by: String? = null,
) : ServerMessage

@Serializable
data class RoomClosedMessage(
    override val type: String = "room_closed",
    val room: String,
    val reason: String,
) : ServerMessage

@Serializable
data class ServerHealthMessage(
    override val type: String = "server_health",
    val status: String,
    val rooms: Int,
    val operators: Int,
    val clients: Int,
    val uptimeSeconds: Long,
    val livekitUrl: String,
) : ServerMessage

@Serializable
data class ErrorMessage(
    override val type: String = "error",
    val code: String,
    val message: String,
) : ServerMessage

@Serializable
data class PongMessage(
    override val type: String = "pong",
) : ServerMessage

// ------------------------------------------------------------------ room types

@Serializable
data class Participant(
    val id: String,
    val name: String,
    val role: String,
    val cameraNumber: Int? = null,
    val connectionState: String,
    val muted: Boolean,
    val joinedAt: String,
)

@Serializable
data class RoomSummary(
    val name: String,
    val status: String,
    val directorPresent: Boolean,
    val operatorCount: Int,
    val capacity: Int,
    val graceDeadline: String? = null,
)

@Serializable
data class RoomSnapshot(
    val name: String,
    val status: String,
    val director: Participant? = null,
    val operators: List<Participant> = emptyList(),
    val capacity: Int = Protocol.ROOM_CAPACITY,
    val graceDeadline: String? = null,
)

@Serializable
data class LiveKitCredentials(
    val url: String,
    val room: String,
    val token: String,
    val expiresAt: String,
)

object ErrorCodes {
    const val PROTOCOL_MISMATCH = "PROTOCOL_MISMATCH"
    const val INVALID_MESSAGE = "INVALID_MESSAGE"
    const val ALREADY_GREETED = "ALREADY_GREETED"
    const val DIRECTOR_REQUIRED = "DIRECTOR_REQUIRED"
    const val ROOM_EXISTS = "ROOM_EXISTS"
    const val ROOM_NOT_FOUND = "ROOM_NOT_FOUND"
    const val ROOM_CLOSED = "ROOM_CLOSED"
    const val ROOM_FULL = "ROOM_FULL"
    const val INVALID_ROOM_NAME = "INVALID_ROOM_NAME"
    const val INVALID_CAMERA = "INVALID_CAMERA"
    const val CAMERA_TAKEN = "CAMERA_TAKEN"
    const val NOT_IN_ROOM = "NOT_IN_ROOM"
    const val NOT_OPERATOR = "NOT_OPERATOR"
    const val SESSION_EXPIRED = "SESSION_EXPIRED"
}

fun roomClosedMessage(reason: String): String = when (reason) {
    "ended_by_director" -> "Room closed by director"
    "director_timeout" -> "Room closed because the director did not return"
    "server_shutdown" -> "Server stopped"
    else -> "Room closed"
}
