package com.churchcomms.operator.control

import com.churchcomms.operator.discovery.DiscoveredServer
import com.churchcomms.operator.protocol.DebugRosterMessage
import com.churchcomms.operator.protocol.ErrorMessage
import com.churchcomms.operator.protocol.Protocol
import com.churchcomms.operator.protocol.RosterClient
import com.churchcomms.operator.protocol.ServerInfoMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
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
        val roster: List<RosterClient>,
    ) : ControlState

    data class Failed(val message: String) : ControlState
}

/**
 * The Operator's M0 control-channel client.
 *
 * It owns the WebSocket, the v1 hello handshake, and the debug roster. The UI
 * renders [state] without knowing anything about OkHttp.
 */
class ControlClient(
    private val appVersion: String,
    private val clientName: String,
    private val clientType: String = "operator",
    private val webSocketFactory: WebSocket.Factory = OkHttpClient(),
) {
    private val _state = MutableStateFlow<ControlState>(ControlState.Disconnected)
    val state: StateFlow<ControlState> = _state.asStateFlow()

    private var socket: WebSocket? = null
    private var targetUrl: String? = null
    private var manuallyClosed = false

    fun connect(server: DiscoveredServer) {
        closeSocket()
        manuallyClosed = false
        targetUrl = server.controlUrl
        _state.value = ControlState.Connecting

        val request = try {
            Request.Builder().url(server.controlUrl).build()
        } catch (_: IllegalArgumentException) {
            _state.value = ControlState.Failed(
                "The discovered server address is not valid: ${server.controlUrl}",
            )
            return
        }

        socket = webSocketFactory.newWebSocket(request, Listener())
    }

    fun disconnect() {
        manuallyClosed = true
        socket?.close(1000, "leaving")
        socket = null
        targetUrl = null
        _state.value = ControlState.Disconnected
    }

    private fun closeSocket() {
        socket?.cancel()
        socket = null
    }

    private inner class Listener : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            webSocket.send(Protocol.hello(name = clientName, appVersion = appVersion))
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            val message = Protocol.parseServerMessage(text) ?: return
            when (message) {
                is ServerInfoMessage -> _state.update { current ->
                    if (current is ControlState.Connected) {
                        current.copy(serverInfo = message)
                    } else {
                        ControlState.Connected(message, emptyList())
                    }
                }

                is DebugRosterMessage -> _state.update { current ->
                    if (current is ControlState.Connected) {
                        current.copy(roster = message.clients)
                    } else {
                        current
                    }
                }

                is ErrorMessage -> _state.value = ControlState.Failed(message.message)
                else -> Unit
            }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            if (manuallyClosed) {
                return
            }
            val address = targetUrl ?: "the control server"
            _state.value = ControlState.Failed(
                "Could not reach the control server at $address. " +
                    "Check that the launcher is running and both devices are on the same Wi-Fi.",
            )
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(1000, null)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            if (manuallyClosed) {
                return
            }
            if (_state.value !is ControlState.Failed) {
                _state.value = ControlState.Failed(
                    "Disconnected from the control server. Start the launcher and retry.",
                )
            }
        }
    }
}
