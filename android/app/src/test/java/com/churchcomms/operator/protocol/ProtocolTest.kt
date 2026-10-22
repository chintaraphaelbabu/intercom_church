package com.churchcomms.operator.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ProtocolTest {
    private val fixturesDir = File(
        System.getProperty("protocol.fixtures.dir")
            ?: error("protocol.fixtures.dir system property is not set"),
    )

    private fun fixture(name: String): String {
        val file = File(fixturesDir, name)
        check(file.isFile) { "Missing shared protocol fixture: ${file.absolutePath}" }
        return file.readText()
    }

    @Test
    fun `shared hello fixture decodes with v1 and operator type`() {
        val hello = Protocol.json.decodeFromString(
            HelloMessage.serializer(),
            fixture("hello.json"),
        )

        assertEquals("hello", hello.type)
        assertEquals(Protocol.VERSION, hello.protocol)
        assertEquals("operator", hello.clientType)
        assertEquals("Camera 1", hello.name)
        assertEquals("0.1.0", hello.appVersion)
    }

    @Test
    fun `encoded hello carries the version and client type`() {
        val encoded = Protocol.hello(name = "SM-T295", appVersion = "0.1.0")

        assertTrue(encoded.contains("\"type\":\"hello\""))
        assertTrue(encoded.contains("\"protocol\":1"))
        assertTrue(encoded.contains("\"clientType\":\"operator\""))
        assertTrue(encoded.contains("\"name\":\"SM-T295\""))
    }

    @Test
    fun `shared server_info fixture decodes`() {
        val message = Protocol.parseServerMessage(fixture("server_info.json"))

        assertTrue(message is ServerInfoMessage)
        message as ServerInfoMessage
        assertEquals(Protocol.VERSION, message.protocol)
        assertEquals("fixture-server-id", message.serverId)
        assertEquals("ws://192.168.1.20:7880", message.livekitUrl)
    }

    @Test
    fun `shared debug_roster fixture decodes every client`() {
        val message = Protocol.parseServerMessage(fixture("debug_roster.json"))

        assertTrue(message is DebugRosterMessage)
        message as DebugRosterMessage
        assertEquals(2, message.clients.size)
        assertEquals("Director", message.clients[0].name)
        assertEquals("director", message.clients[0].clientType)
        assertEquals("Camera 1", message.clients[1].name)
        assertEquals("operator", message.clients[1].clientType)
    }

    @Test
    fun `shared protocol mismatch fixture is readable`() {
        val message = Protocol.parseServerMessage(fixture("error_protocol_mismatch.json"))

        assertTrue(message is ErrorMessage)
        message as ErrorMessage
        assertEquals("PROTOCOL_MISMATCH", message.code)
        assertTrue(message.message.contains("v1"))
        assertTrue(message.message.contains("v2"))
    }

    @Test
    fun `shared ping and pong fixtures are compatible`() {
        val pong = Protocol.parseServerMessage(fixture("pong.json"))

        assertTrue(pong is PongMessage)
        assertTrue(Protocol.hello(name = "x", appVersion = "1").contains("\"type\":\"hello\""))
    }

    @Test
    fun `shared joined fixture decodes the session, room and LiveKit credentials`() {
        val message = Protocol.parseServerMessage(fixture("joined.json"))

        assertTrue(message is JoinedMessage)
        message as JoinedMessage
        assertEquals("participant-fixture-1", message.participantId)
        assertEquals("session-fixture-1", message.sessionToken)
        assertEquals("MEDIA", message.room.name)
        assertEquals("open", message.room.status)
        assertEquals("Director", message.room.director?.name)
        assertEquals(null, message.room.director?.cameraNumber)
        assertEquals(listOf(1), message.room.operators.map { it.cameraNumber })
        assertEquals("ws://192.168.1.20:7880", message.livekit.url)
        assertEquals("fixture-livekit-token", message.livekit.token)
    }

    @Test
    fun `shared room list fixture decodes live and grace rooms`() {
        val message = Protocol.parseServerMessage(fixture("room_list.json"))

        assertTrue(message is RoomListMessage)
        message as RoomListMessage
        assertEquals(listOf("MEDIA", "SECURITY"), message.rooms.map { it.name })
        assertEquals("open", message.rooms[0].status)
        assertEquals("grace", message.rooms[1].status)
        assertEquals(false, message.rooms[1].directorPresent)
        assertEquals("2026-10-22T10:05:00.000Z", message.rooms[1].graceDeadline)
    }

    @Test
    fun `shared director state fixture decodes grace presence`() {
        val message = Protocol.parseServerMessage(fixture("director_state.json"))

        assertTrue(message is DirectorStateMessage)
        message as DirectorStateMessage
        assertEquals(false, message.present)
        assertEquals("grace", message.room.status)
        assertEquals("2026-10-22T10:05:00.000Z", message.graceDeadline)
        assertEquals(1, message.room.operators.size)
    }

    @Test
    fun `shared mute state fixture decodes who muted the operator`() {
        val message = Protocol.parseServerMessage(fixture("mute_state.json"))

        assertTrue(message is MuteStateMessage)
        message as MuteStateMessage
        assertEquals("MEDIA", message.room)
        assertEquals("participant-fixture-1", message.participantId)
        assertEquals(true, message.muted)
        assertEquals("director-fixture-1", message.by)
    }

    @Test
    fun `shared room closed fixture decodes the reason`() {
        val message = Protocol.parseServerMessage(fixture("room_closed.json"))

        assertTrue(message is RoomClosedMessage)
        message as RoomClosedMessage
        assertEquals("MEDIA", message.room)
        assertEquals("ended_by_director", message.reason)
        assertEquals("Room closed by director", roomClosedMessage(message.reason))
    }

    @Test
    fun `participant roster and server health messages decode`() {
        val participant = """{"id":"operator-2","name":"Camera 2","role":"operator",""" +
            """"cameraNumber":2,"connectionState":"reconnecting","muted":true,""" +
            """"joinedAt":"2026-10-22T09:57:00.000Z"}"""
        val joined = Protocol.parseServerMessage(
            """{"type":"participant_joined","participant":$participant,""" +
                """"room":{"name":"MEDIA","status":"open","capacity":11,"director":null,""" +
                """"operators":[$participant]}}""",
        )
        assertTrue(joined is ParticipantJoinedMessage)
        joined as ParticipantJoinedMessage
        assertEquals("reconnecting", joined.participant.connectionState)
        assertTrue(joined.participant.muted)

        val left = Protocol.parseServerMessage(
            """{"type":"participant_left","participantId":"operator-2",""" +
                """"room":{"name":"MEDIA","status":"open","capacity":11,"director":null,""" +
                """"operators":[]}}""",
        )
        assertTrue(left is ParticipantLeftMessage)
        left as ParticipantLeftMessage
        assertEquals("operator-2", left.participantId)

        val updated = Protocol.parseServerMessage(
            """{"type":"participant_updated","participant":$participant,""" +
                """"room":{"name":"MEDIA","status":"open","capacity":11,"director":null,""" +
                """"operators":[$participant]}}""",
        )
        assertTrue(updated is ParticipantUpdatedMessage)
        updated as ParticipantUpdatedMessage
        assertEquals(2, updated.participant.cameraNumber)

        val health = Protocol.parseServerMessage(
            """{"type":"server_health","status":"degraded","rooms":1,"operators":2,""" +
                """"clients":3,"uptimeSeconds":42,"livekitUrl":"ws://192.168.1.20:7880"}""",
        )
        assertTrue(health is ServerHealthMessage)
        health as ServerHealthMessage
        assertEquals("degraded", health.status)
        assertEquals(42L, health.uptimeSeconds)
    }

    @Test
    fun `every client command encodes with its wire type`() {
        assertEquals(
            "create_room",
            Protocol.json.decodeFromString(
                CreateRoomMessage.serializer(),
                Protocol.createRoom("  MEDIA  "),
            ).type,
        )
        assertEquals(
            "MEDIA",
            Protocol.json.decodeFromString(
                CreateRoomMessage.serializer(),
                Protocol.createRoom("  MEDIA  "),
            ).name,
        )
        assertEquals(
            "end_room",
            Protocol.json.decodeFromString(
                EndRoomMessage.serializer(),
                Protocol.endRoom(),
            ).type,
        )
        val join = Protocol.json.decodeFromString(
            JoinRoomMessage.serializer(),
            Protocol.joinRoom(room = "MEDIA", name = " Camera 1 ", cameraNumber = 3),
        )
        assertEquals("MEDIA", join.room)
        assertEquals("Camera 1", join.name)
        assertEquals(3, join.cameraNumber)
        assertEquals(
            "leave_room",
            Protocol.json.decodeFromString(
                LeaveRoomMessage.serializer(),
                Protocol.leaveRoom(),
            ).type,
        )
        assertEquals(
            4,
            Protocol.json.decodeFromString(
                SetCameraMessage.serializer(),
                Protocol.setCamera(4),
            ).cameraNumber,
        )
        val mute = Protocol.json.decodeFromString(
            SetMuteMessage.serializer(),
            Protocol.setMute("operator-1", muted = true),
        )
        assertEquals("operator-1", mute.participantId)
        assertTrue(mute.muted)
        assertEquals(
            "clear_mute",
            Protocol.json.decodeFromString(
                ClearMuteMessage.serializer(),
                Protocol.clearMute(),
            ).type,
        )
        assertEquals(
            "ping",
            Protocol.json.decodeFromString(PingMessage.serializer(), Protocol.ping()).type,
        )
    }

    @Test
    fun `unknown server messages are ignored instead of crashing`() {
        assertNull(Protocol.parseServerMessage("""{"type":"webrtc_offer","sdp":"stale"}"""))
        assertNull(Protocol.parseServerMessage("not json"))
        assertNull(Protocol.parseServerMessage("""{"type":"joined"}"""))
    }
}
