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
import com.churchcomms.operator.session.SessionState

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
            ErrorCard(failed.message)
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

        when (val discovery = state.discovery) {
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
                Text("Debug join")
            }
        }
    }
}
