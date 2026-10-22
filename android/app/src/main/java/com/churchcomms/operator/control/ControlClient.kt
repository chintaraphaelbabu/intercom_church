package com.churchcomms.operator.control

import com.churchcomms.operator.discovery.DiscoveredServer
import com.churchcomms.operator.protocol.DebugRosterMessage
import com.churchcomms.operator.protocol.DirectorStateMessage
import com.churchcomms.operator.protocol.ErrorCodes
import com.churchcomms.operator.protocol.ErrorMessage
import com.churchcomms.operator.protocol.JoinRoomMessage
import com.churchcomms.operator.protocol.JoinedMessage
import com.churchcomms.operator.protocol.LiveKitCredentials
import com.churchcomms.operator.protocol.MuteStateMessage
import com.churchcomms.operator.protocol.ParticipantJoinedMessage
import com.churchcomms.operator.protocol.ParticipantLeftMessage
import com.churchcomms.operator.protocol.ParticipantUpdatedMessage
import com.churchcomms.operator.protocol.PongMessage
import com.churchcomms.operator.protocol.Protocol
import com.churchcomms.operator.protocol.RoomClosedMessage
import com.churchcomms.operator.protocol.RoomListMessage
import com.churchcomms.operator.protocol.RoomSnapshot
import com.churchcomms.operator.protocol.RoomSummary
import com.churchcomms.operator.protocol.RosterClient
import com.churchcomms.operator.protocol.ServerHealthMessage
import com.churchcomms.operator.protocol.ServerInfoMessage
import com.churchcomms.operator.protocol.roomClosedMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

sealed interface ControlState {
    data object Disconnected : ControlState

    data object Connecting : ControlState

    data class Connected(
        val serverInfo: ServerInfoMessage,
        val rooms: List<RoomSummary> = emptyList(),
        val roster: List<RosterClient> = emptyList(),
        val health: ServerHealthMessage? = null,
    ) : ControlState

    data class Joined(
        val participantId: String,
        val sessionToken: String,
        val room: RoomSnapshot,
        val livekit: LiveKitCredentials,
        val serverInfo: ServerInfoMessage? = null,
        val roster: List<RosterClient> = emptyList(),
        val health: ServerHealthMessage? = null,
        val mutedBy: String? = null,
    ) : ControlState

    data class Reconnecting(
        val attempt: Int,
        val maxAttempts: Int = ReconnectPolicy.MAX_ATTEMPTS,
    ) : ControlState

    data class Failed(
        val message: String,
        val canRetry: Boolean,
    ) : ControlState
}

/**
 * The control commands and state the rest of the app depends on. Keeping this
 * an interface lets [SessionController] be tested without OkHttp or Android.
 */
interface ControlChannel {
    val state: StateFlow<ControlState>

    fun connect(server: DiscoveredServer)
    fun retry()
    fun disconnect()

    fun createRoom(name: String)
    fun joinRoom(room: String, name: String, cameraNumber: Int)
    fun leaveRoom()
    fun endRoom()
    fun setCamera(cameraNumber: Int)
    fun setMute(participantId: String, muted: Boolean)
    fun clearMute()
}

/**
 * The Operator's control channel.
 *
 * It owns the WebSocket, the v1 hello handshake, the room/roster snapshots, and
 * automatic session resumption. The UI renders [state] without knowing anything
 * about OkHttp. Every reconnect sends the stored session token in `hello`, so
 * the server can restore the same participant and camera slot.
 *
 * Reconnect timing is injected ([delayForTest]) so JVM tests can run the full
 * five-attempt cycle deterministically.
 */
class ControlClient(
    private val appVersion: String,
    private val clientName: String,
    private val clientType: String = "operator",
    private val webSocketFactory: WebSocket.Factory = OkHttpClient(),
    private val tokenStore: SessionTokenStore = InMemorySessionTokenStore(),
    private val reconnectPolicy: ReconnectPolicy = ReconnectPolicy(),
    private val reconnectScope: CoroutineScope = CoroutineScope(
        SupervisorJob() + Dispatchers.IO,
    ),
    private val delayForTest: suspend (Long) -> Unit = { delay(it) },
) : ControlChannel {
    private val _state = MutableStateFlow<ControlState>(ControlState.Disconnected)
    override val state: StateFlow<ControlState> = _state.asStateFlow()

    private var socket: WebSocket? = null
    private var targetUrl: String? = null
    private var manuallyClosed = false
    private var fatal = false
    private var reconnectAttempt = 0
    private var reconnectJob: Job? = null
    private var clearMuteOnNextJoin = false

    override fun connect(server: DiscoveredServer) {
        manuallyClosed = false
        fatal = false
        reconnectAttempt = 0
        clearMuteOnNextJoin = false
        reconnectJob?.cancel()
        reconnectJob = null
        closeSocket()
        targetUrl = server.controlUrl
        _state.value = ControlState.Connecting
        openSocket()
    }

    override fun retry() {
        val url = targetUrl ?: return
        manuallyClosed = false
        fatal = false
        reconnectAttempt = 0
        clearMuteOnNextJoin = false
        reconnectJob?.cancel()
        reconnectJob = null
        closeSocket()
        targetUrl = url
        _state.value = ControlState.Connecting
        openSocket()
    }

    override fun disconnect() {
        manuallyClosed = true
        fatal = true
        reconnectJob?.cancel()
        reconnectJob = null
        reconnectAttempt = 0
        clearMuteOnNextJoin = false
        closeSocket()
        targetUrl = null
        tokenStore.clear()
        _state.value = ControlState.Disconnected
    }

    override fun createRoom(name: String) {
        send(Protocol.createRoom(name))
    }

    override fun joinRoom(room: String, name: String, cameraNumber: Int) {
        send(
            Protocol.encodeClientMessage(
                JoinRoomMessage(
                    room = room.trim(),
                    name = name.trim(),
                    cameraNumber = cameraNumber,
                ),
            ),
        )
    }

    override fun leaveRoom() {
        send(Protocol.leaveRoom())
        disconnect()
    }

    override fun endRoom() {
        send(Protocol.endRoom())
    }

    override fun setCamera(cameraNumber: Int) {
        send(Protocol.setCamera(cameraNumber))
    }

    override fun setMute(participantId: String, muted: Boolean) {
        send(Protocol.setMute(participantId, muted))
    }

    override fun clearMute() {
        send(Protocol.clearMute())
    }

    private fun send(message: String): Boolean =
        socket?.send(message) ?: false

    private fun openSocket() {
        val url = targetUrl ?: return
        val request = try {
            Request.Builder().url(url).build()
        } catch (_: IllegalArgumentException) {
            fail("The discovered server address is not valid: $url", canRetry = false)
            return
        }
        socket = webSocketFactory.newWebSocket(request, Listener())
    }

    private fun closeSocket() {
        val current = socket
        socket = null
        current?.cancel()
    }

    private fun scheduleReconnect(lastError: String) {
        if (manuallyClosed || fatal) {
            return
        }
        if (tokenStore.get() == null) {
            fail(lastError, canRetry = true)
            return
        }
        if (reconnectAttempt >= reconnectPolicy.maxAttempts) {
            fail(
                "Could not reconnect to the control server after " +
                    "${reconnectPolicy.maxAttempts} attempts.",
                canRetry = true,
            )
            return
        }

        val attempt = reconnectAttempt + 1
        reconnectAttempt = attempt
        _state.value = ControlState.Reconnecting(attempt, reconnectPolicy.maxAttempts)
        reconnectJob?.cancel()
        reconnectJob = reconnectScope.launch {
            delayForTest(reconnectPolicy.delayMillis(attempt))
            if (manuallyClosed || fatal) {
                return@launch
            }
            clearMuteOnNextJoin = true
            openSocket()
        }
    }

    private fun fail(message: String, canRetry: Boolean) {
        fatal = true
        reconnectJob?.cancel()
        reconnectJob = null
        closeSocket()
        _state.value = ControlState.Failed(message, canRetry)
    }

    private fun updateConnected(
        transform: (ControlState.Connected) -> ControlState.Connected,
    ) {
        val current = _state.value
        if (current is ControlState.Connected) {
            _state.value = transform(current)
        }
    }

    private fun updateJoined(
        transform: (ControlState.Joined) -> ControlState.Joined,
    ) {
        val current = _state.value
        if (current is ControlState.Joined) {
            _state.value = transform(current)
        }
    }

    private inner class Listener : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            if (webSocket !== socket) {
                return
            }
            // On a reconnect the UI keeps showing RECONNECTING until a server
            // message proves the session is back.
            if (reconnectAttempt == 0 && _state.value !is ControlState.Connecting) {
                _state.value = ControlState.Connecting
            }
            val sessionToken = tokenStore.get()
            if (sessionToken != null) {
                clearMuteOnNextJoin = true
            }
            webSocket.send(
                Protocol.hello(
                    name = clientName,
                    appVersion = appVersion,
                    clientType = clientType,
                    sessionToken = sessionToken,
                ),
            )
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            if (webSocket !== socket) {
                return
            }
            val message = Protocol.parseServerMessage(text) ?: return
            when (message) {
                is ServerInfoMessage -> {
                    val current = _state.value
                    _state.value = when (current) {
                        is ControlState.Connected -> current.copy(serverInfo = message)
                        is ControlState.Joined -> current.copy(serverInfo = message)
                        else -> ControlState.Connected(serverInfo = message)
                    }
                }

                is DebugRosterMessage -> {
                    val current = _state.value
                    _state.value = when (current) {
                        is ControlState.Connected -> current.copy(roster = message.clients)
                        is ControlState.Joined -> current.copy(roster = message.clients)
                        else -> current
                    }
                }

                is RoomListMessage -> updateConnected { it.copy(rooms = message.rooms) }

                is JoinedMessage -> {
                    tokenStore.save(message.sessionToken)
                    reconnectAttempt = 0
                    val current = _state.value
                    val room = if (clearMuteOnNextJoin) {
                        withClearedMuteOnResume(message.room, message.participantId)
                    } else {
                        message.room
                    }
                    clearMuteOnNextJoin = false
                    _state.value = ControlState.Joined(
                        participantId = message.participantId,
                        sessionToken = message.sessionToken,
                        room = room,
                        livekit = message.livekit,
                        serverInfo = (current as? ControlState.Connected)?.serverInfo
                            ?: (current as? ControlState.Joined)?.serverInfo,
                        roster = (current as? ControlState.Connected)?.roster
                            ?: (current as? ControlState.Joined)?.roster.orEmpty(),
                        health = (current as? ControlState.Connected)?.health
                            ?: (current as? ControlState.Joined)?.health,
                    )
                }

                is ParticipantJoinedMessage -> updateJoined {
                    it.copy(room = message.room)
                }

                is ParticipantLeftMessage -> updateJoined {
                    it.copy(room = message.room)
                }

                is ParticipantUpdatedMessage -> updateJoined {
                    it.copy(room = message.room)
                }

                is DirectorStateMessage -> updateJoined {
                    it.copy(room = message.room)
                }

                is MuteStateMessage -> updateJoined { current ->
                    if (message.participantId == current.participantId) {
                        current.copy(
                            room = current.room.withMute(
                                participantId = message.participantId,
                                muted = message.muted,
                            ),
                            mutedBy = message.by,
                        )
                    } else {
                        current.copy(
                            room = current.room.withMute(
                                participantId = message.participantId,
                                muted = message.muted,
                            ),
                        )
                    }
                }

                is RoomClosedMessage -> {
                    tokenStore.clear()
                    fail(roomClosedMessage(message.reason), canRetry = false)
                }

                is ServerHealthMessage -> {
                    val current = _state.value
                    _state.value = when (current) {
                        is ControlState.Connected -> current.copy(health = message)
                        is ControlState.Joined -> current.copy(health = message)
                        else -> current
                    }
                }

                is ErrorMessage -> {
                    if (message.code == ErrorCodes.SESSION_EXPIRED) {
                        tokenStore.clear()
                    }
                    fail(
                        message.message,
                        canRetry = message.code == ErrorCodes.SESSION_EXPIRED,
                    )
                }

                is PongMessage -> Unit
            }
        }

        override fun onFailure(
            webSocket: WebSocket,
            t: Throwable,
            response: Response?,
        ) {
            if (webSocket !== socket) {
                return
            }
            socket = null
            if (manuallyClosed || fatal) {
                return
            }
            val address = targetUrl ?: "the control server"
            scheduleReconnect(
                "Could not reach the control server at $address. " +
                    "Check that the launcher is running and both devices are on the same Wi-Fi.",
            )
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(1000, null)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            if (webSocket !== socket) {
                return
            }
            socket = null
            if (manuallyClosed || fatal) {
                return
            }
            scheduleReconnect("Disconnected from the control server. Retrying...")
        }
    }

    private fun withClearedMuteOnResume(
        room: RoomSnapshot,
        participantId: String,
    ): RoomSnapshot {
        // The server clears a force-mute on resume. Mirror that immediately so
        // the Operator cannot be shown as muted after a successful reconnect.
        val operators = room.operators.map { participant ->
            if (participant.id == participantId) participant.copy(muted = false) else participant
        }
        val director = room.director
        return room.copy(operators = operators).let { snapshot ->
            if (director?.id == participantId) {
                snapshot.copy(director = director.copy(muted = false))
            } else {
                snapshot
            }
        }
    }
}

private fun RoomSnapshot.withMute(participantId: String, muted: Boolean): RoomSnapshot {
    val operators = operators.map { participant ->
        if (participant.id == participantId) participant.copy(muted = muted) else participant
    }
    val director = director?.let { participant ->
        if (participant.id == participantId) participant.copy(muted = muted) else participant
    }
    return copy(operators = operators, director = director)
}
