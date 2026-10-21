package com.churchcomms.operator.protocol

import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Control protocol v1, mirroring `protocol/src/index.ts`.
 *
 * The server owns media transport through LiveKit, so this package carries only
 * the versioned JSON control messages the M0 walking skeleton needs.
 */
object Protocol {
    const val VERSION = 1
    const val CONTROL_PATH = "/ws"

    val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = false
    }

    fun hello(
        name: String,
        appVersion: String,
        sessionToken: String? = null,
    ): String = json.encodeToString(
        HelloMessage.serializer(),
        HelloMessage(
            appVersion = appVersion,
            name = name,
            sessionToken = sessionToken,
        ),
    )

    /**
     * Decode one server message. Unknown types return null so a newer server can
     * add messages without crashing this client.
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

@Serializable
data class HelloMessage(
    val type: String = "hello",
    val protocol: Int = Protocol.VERSION,
    val clientType: String = "operator",
    val appVersion: String,
    val name: String,
    val sessionToken: String? = null,
)

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
data class ErrorMessage(
    override val type: String = "error",
    val code: String,
    val message: String,
) : ServerMessage

@Serializable
data class PongMessage(
    override val type: String = "pong",
) : ServerMessage
