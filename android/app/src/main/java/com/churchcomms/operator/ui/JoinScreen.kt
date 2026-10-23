package com.churchcomms.operator.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.churchcomms.operator.control.ControlState
import com.churchcomms.operator.discovery.DiscoveredServer
import com.churchcomms.operator.discovery.DiscoveryState
import com.churchcomms.operator.protocol.RoomSummary
import com.churchcomms.operator.session.SessionState
import com.churchcomms.operator.session.participantCount

@Composable
fun JoinScreen(
    state: SessionState,
    actions: OperatorActions,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 8.dp),
    ) {
        val failed = state.control as? ControlState.Failed
        if (failed != null) {
            val msg = failed.message
            when {
                msg.contains("Wi-Fi", ignoreCase = true) || msg.contains("network", ignoreCase = true) -> {
                    ErrorCard("No Wi-Fi: check that Wi-Fi is on and you are on the church network.", title = "No Wi-Fi")
                }
                msg.contains("LAN", ignoreCase = true) || msg.contains("unreachable", ignoreCase = true) -> {
                    ErrorCard("LAN unreachable: the director's laptop may be off or on a different network.", title = "LAN unreachable")
                }
                msg.contains("mDNS", ignoreCase = true) || msg.contains("discovery", ignoreCase = true) || msg.contains("_church-comms", ignoreCase = true) -> {
                    ErrorCard("mDNS unavailable: multicast is blocked or the director's server is not broadcasting.", title = "mDNS unavailable")
                }
                msg.contains("control server", ignoreCase = true) || msg.contains("server", ignoreCase = true) -> {
                    ErrorCard("Control server unreachable: connected but the server did not answer.", title = "Control server unreachable")
                }
                msg.contains("media", ignoreCase = true) || msg.contains("LiveKit", ignoreCase = true) -> {
                    ErrorCard("Media failure: LiveKit could not establish the audio room.", title = "Media failure")
                }
                else -> ErrorCard(msg)
            }
            Spacer(Modifier.height(12.dp))
            if (failed.canRetry) {
                Button(
                    onClick = actions.retryConnection,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Retry connection")
                }
                Spacer(Modifier.height(8.dp))
            }
            OutlinedButton(
                onClick = actions.leave,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Back to discovery")
            }
            Spacer(Modifier.height(24.dp))
        }

        state.notice?.let { notice ->
            StatusCard(
                title = "Room closed",
                detail = notice,
                busy = false,
            )
            Spacer(Modifier.height(16.dp))
        }

        Text(
            text = "Find the director's laptop",
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.SemiBold,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = "Discovery uses mDNS on the church Wi-Fi, so there is no address to type.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(Modifier.height(16.dp))

        when (val control = state.control) {
            is ControlState.Connected -> RoomLobby(
                state = state,
                rooms = control.rooms,
                actions = actions,
            )

            ControlState.Connecting -> StatusCard(
                title = "Connecting to the control server\u2026",
                detail = "Sending the v1 hello handshake.",
                busy = true,
            )

            is ControlState.Reconnecting -> StatusCard(
                title = "RECONNECTING ${control.attempt}/${control.maxAttempts}",
                detail = "Trying again with the stored session token.",
                busy = true,
            )

            is ControlState.Joined,
            is ControlState.Failed -> Unit

            ControlState.Disconnected -> DiscoveryContent(
                discovery = state.discovery,
                actions = actions,
            )
        }
    }
}

@Composable
private fun RoomLobby(
    state: SessionState,
    rooms: List<RoomSummary>,
    actions: OperatorActions,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(14.dp),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Connected to the control server",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Chip("connected", accent = true)
            }
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = state.displayName,
                onValueChange = actions.setDisplayName,
                label = { Text("Your name") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = "Joining as Camera ${state.cameraNumber ?: 1}",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }

    Spacer(Modifier.height(16.dp))
    SectionTitle("Active rooms", trailing = rooms.size.toString())
    Spacer(Modifier.height(8.dp))

    if (rooms.isEmpty()) {
        StatusCard(
            title = "No rooms open yet",
            detail = "The Director creates a room on the laptop. This list updates " +
                "as soon as the room appears.",
            busy = false,
        )
    } else {
        rooms.forEach { room ->
            RoomCard(
                room = room,
                canJoin = state.displayName.isNotBlank(),
                onJoin = { actions.joinRoom(room.name, state.cameraNumber ?: 1) },
            )
            Spacer(Modifier.height(10.dp))
        }
    }
}

@Composable
private fun RoomCard(
    room: RoomSummary,
    canJoin: Boolean,
    onJoin: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(12.dp),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    text = room.name,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = "${room.participantCount()} participants \u00b7 " +
                        "${room.operatorCount} of ${room.capacity - 1} cameras",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            Button(onClick = onJoin, enabled = canJoin) {
                Text("Join")
            }
        }
    }
}

@Composable
private fun DiscoveryContent(
    discovery: DiscoveryState,
    actions: OperatorActions,
) {
    when (discovery) {
        DiscoveryState.Idle -> Text(
            text = "Discovery is not running.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        DiscoveryState.Discovering -> StatusCard(
            title = "Looking for the director's laptop\u2026",
            detail = "Searching for _church-comms._tcp.local",
            busy = true,
        )

        is DiscoveryState.Failed -> {
            ErrorCard(discovery.message, title = "Discovery failed")
            Spacer(Modifier.height(12.dp))
            Button(
                onClick = actions.retryDiscovery,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Retry discovery")
            }
        }

        is DiscoveryState.Found -> {
            if (discovery.servers.isEmpty()) {
                StatusCard(
                    title = "No Church Comms server found yet",
                    detail = "Start the launcher on the director's laptop and keep " +
                        "both devices on the same Wi-Fi.",
                    busy = true,
                )
            } else {
                discovery.servers.forEach { server ->
                    ServerCard(server = server, onConnect = actions.connect)
                    Spacer(Modifier.height(10.dp))
                }
            }
        }
    }

    // Advanced — manual address only under Advanced
    Spacer(Modifier.height(16.dp))
    Surface(modifier = Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(12.dp)) {
        Column(Modifier.padding(12.dp)) {
            Text("Advanced", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(4.dp))
            Text("Manual server address (only when discovery fails)", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = "192.168.1.10:8080",
                onValueChange = {},
                label = { Text("IP:port") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                enabled = false,
            )
            Spacer(Modifier.height(4.dp))
            Text("OxygenOS battery help: keep Wi-Fi active in battery settings to allow mDNS.", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun ServerCard(
    server: DiscoveredServer,
    onConnect: (DiscoveredServer) -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(14.dp),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = server.displayName,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Chip("protocol v${server.protocolVersion ?: "?"}")
            }
            Spacer(Modifier.height(4.dp))
            Text(
                text = "${server.host}:${server.port}",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontFamily = FontFamily.Monospace,
                style = MaterialTheme.typography.bodySmall,
            )
            if (server.livekitUrl != null) {
                Text(
                    text = "LiveKit ${server.livekitUrl}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontFamily = FontFamily.Monospace,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            Spacer(Modifier.height(12.dp))
            Button(
                onClick = { onConnect(server) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Connect")
            }
        }
    }
}
