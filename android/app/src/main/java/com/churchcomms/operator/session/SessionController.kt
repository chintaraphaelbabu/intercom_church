package com.churchcomms.operator.session

import com.churchcomms.operator.control.ControlChannel
import com.churchcomms.operator.control.ControlState
import com.churchcomms.operator.discovery.DiscoveredServer
import com.churchcomms.operator.discovery.DiscoverySource
import com.churchcomms.operator.discovery.DiscoveryState
import com.churchcomms.operator.media.MediaController
import com.churchcomms.operator.media.MediaState
import com.churchcomms.operator.service.SessionServiceGateway
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The single aggregate view Compose renders. Discovery, control, media, the
 * selected join details, the audio route, and foreground-service state all come
 * from the same process-scoped controller.
 */
data class SessionState(
    val discovery: DiscoveryState = DiscoveryState.Idle,
    val control: ControlState = ControlState.Disconnected,
    val media: MediaState = MediaState.Idle,
    val selectedServer: DiscoveredServer? = null,
    val roomName: String = "",
    val displayName: String = "",
    val cameraNumber: Int? = null,
    val outputRoute: String? = null,
    val serviceRunning: Boolean = false,
) {
    val activeRoomName: String
        get() = (control as? ControlState.Joined)?.room?.name ?: roomName

    val isSessionActive: Boolean
        get() = control is ControlState.Connecting ||
            control is ControlState.Connected ||
            control is ControlState.Joined ||
            control is ControlState.Reconnecting
}

private data class JoinSelection(
    val server: DiscoveredServer? = null,
    val roomName: String = "",
    val displayName: String = "",
    val cameraNumber: Int? = null,
)

/**
 * Process-scoped owner of everything that must survive Activity recreation:
 * discovery, the control socket, LiveKit media, the selected server/room/camera,
 * the current output route, and the foreground service.
 *
 * The Application creates one instance. Activities only observe [state] and call
 * intents; they never construct clients themselves.
 */
class SessionController(
    private val discovery: DiscoverySource,
    private val control: ControlChannel,
    private val media: MediaController,
    private val service: SessionServiceGateway,
    defaultDisplayName: String,
    private val scope: CoroutineScope = CoroutineScope(
        SupervisorJob() + Dispatchers.Default,
    ),
) {
    private val selection = MutableStateFlow(
        JoinSelection(displayName = defaultDisplayName),
    )
    private val serviceRunning = MutableStateFlow(false)

    val state: StateFlow<SessionState> = combine(
        discovery.state,
        control.state,
        media.state,
        selection,
        serviceRunning,
    ) { discoveryState, controlState, mediaState, selectionState, serviceIsRunning ->
        SessionState(
            discovery = discoveryState,
            control = controlState,
            media = mediaState,
            selectedServer = selectionState.server,
            roomName = selectionState.roomName,
            displayName = selectionState.displayName,
            cameraNumber = selectionState.cameraNumber,
            outputRoute = (mediaState as? MediaState.Ready)?.outputRoute,
            serviceRunning = serviceIsRunning,
        )
    }.stateIn(
        scope = scope,
        started = SharingStarted.Eagerly,
        initialValue = SessionState(
            discovery = discovery.state.value,
            control = control.state.value,
            media = media.state.value,
            displayName = defaultDisplayName,
        ),
    )

    private var started = false
    private var serviceRoom: String? = null
    private var lastLivekitToken: String? = null

    init {
        scope.launch {
            control.state.collect(::onControlState)
        }
    }

    fun start() {
        if (started) {
            return
        }
        started = true
        discovery.start()
    }

    fun connect(server: DiscoveredServer) {
        val current = selection.value
        if (current.server?.serviceName != server.serviceName) {
            lastLivekitToken = null
        }
        selection.update { it.copy(server = server) }
        discovery.stop()
        control.connect(server)
    }

    fun retryConnection() {
        control.retry()
    }

    fun retryDiscovery() {
        discovery.retry()
    }

    fun createRoom(name: String) {
        selection.update { it.copy(roomName = name.trim()) }
        control.createRoom(name)
    }

    fun joinRoom(
        roomName: String,
        displayName: String = selection.value.displayName,
        cameraNumber: Int,
    ) {
        selection.update {
            it.copy(
                roomName = roomName.trim(),
                displayName = displayName.trim(),
                cameraNumber = cameraNumber,
            )
        }
        control.joinRoom(room = roomName, name = displayName, cameraNumber = cameraNumber)
    }

    fun endRoom() {
        control.endRoom()
    }

    /**
     * Leave everything: send `leave_room` when joined, close media, stop the
     * foreground service, and return discovery to the join screen.
     */
    fun leave() {
        control.leaveRoom()
        media.disconnect()
        stopSessionService()
        lastLivekitToken = null
        selection.update {
            it.copy(
                roomName = "",
                cameraNumber = null,
            )
        }
        if (started) {
            discovery.start()
        }
    }

    fun setDisplayName(name: String) {
        selection.update { it.copy(displayName = name) }
    }

    fun selectRoom(name: String) {
        selection.update { it.copy(roomName = name.trim()) }
    }

    fun setCameraNumber(cameraNumber: Int) {
        selection.update { it.copy(cameraNumber = cameraNumber) }
    }

    /** Operator changes camera while in a room; the server validates the slot. */
    fun changeCamera(cameraNumber: Int) {
        selection.update { it.copy(cameraNumber = cameraNumber) }
        control.setCamera(cameraNumber)
    }

    fun setMute(participantId: String, muted: Boolean) {
        control.setMute(participantId, muted)
    }

    fun clearMute() {
        control.clearMute()
    }

    /** Debug path kept from ticket 02: fetch a token and hear the Director. */
    fun joinDirectorAudio() {
        val server = selection.value.server ?: return
        scope.launch {
            media.connect(
                tokenUrl = server.tokenUrl,
                preferredLivekitUrl = server.livekitUrl,
                name = selection.value.displayName.ifBlank { "Operator" },
            )
        }
    }

    fun leaveAudio() {
        media.disconnect()
    }

    private fun onControlState(controlState: ControlState) {
        when (controlState) {
            is ControlState.Joined -> {
                applyJoinedSelection(controlState)
                startSessionService(controlState.room.name)
                connectMediaIfNeeded(controlState)
            }

            is ControlState.Reconnecting -> Unit

            is ControlState.Failed -> {
                stopSessionService()
                lastLivekitToken = null
                media.disconnect()
            }

            ControlState.Disconnected -> {
                stopSessionService()
                lastLivekitToken = null
            }

            ControlState.Connecting,
            is ControlState.Connected,
            -> Unit
        }
    }

    private fun applyJoinedSelection(joined: ControlState.Joined) {
        val me = joined.room.operators.firstOrNull { it.id == joined.participantId }
            ?: joined.room.director?.takeIf { it.id == joined.participantId }
        selection.update {
            it.copy(
                roomName = joined.room.name,
                cameraNumber = me?.cameraNumber ?: it.cameraNumber,
                displayName = me?.name ?: it.displayName,
            )
        }
    }

    private fun connectMediaIfNeeded(joined: ControlState.Joined) {
        if (lastLivekitToken == joined.livekit.token &&
            (media.state.value is MediaState.Ready ||
                media.state.value is MediaState.WebRtcConnecting)
        ) {
            return
        }
        lastLivekitToken = joined.livekit.token
        val url = selection.value.server?.livekitUrl ?: joined.livekit.url
        scope.launch {
            media.connectDirect(url = url, token = joined.livekit.token)
        }
    }

    private fun startSessionService(roomName: String) {
        if (serviceRoom == roomName) {
            return
        }
        if (serviceRoom != null) {
            runCatching { service.stop() }
        }
        val serviceStarted = runCatching { service.start(roomName) }.isSuccess
        if (serviceStarted) {
            serviceRoom = roomName
            serviceRunning.value = true
        }
    }

    private fun stopSessionService() {
        if (serviceRoom != null) {
            runCatching { service.stop() }
            serviceRoom = null
        }
        serviceRunning.value = false
    }
}
