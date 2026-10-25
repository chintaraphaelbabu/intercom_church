package com.churchcomms.operator.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.churchcomms.operator.control.ControlState
import com.churchcomms.operator.discovery.DiscoveryState
import com.churchcomms.operator.media.MediaState
import com.churchcomms.operator.protocol.Protocol
import com.churchcomms.operator.session.SessionState
import com.churchcomms.operator.ui.theme.FlatBlackBg
import com.churchcomms.operator.ui.theme.FlatBlackBorder
import com.churchcomms.operator.ui.theme.SquareShape

/**
 * Placeholder diagnostics surface. Ticket 12 fills in Wi-Fi/IP, LiveKit stats,
 * battery-optimization and permission details; the session facts it needs are
 * already aggregated in [SessionState].
 */
@Composable
fun DiagnosticsScreen(state: SessionState) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 8.dp),
    ) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = FlatBlackBg,
            shape = SquareShape,
            border = BorderStroke(width = 1.dp, color = FlatBlackBorder),
        ) {
            Column(Modifier.padding(16.dp)) {
                Text(
                    text = "Session diagnostics",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.height(10.dp))
                Fact("Protocol", "v${Protocol.VERSION}")
                Fact("Server", state.selectedServer?.displayName ?: "not selected")
                Fact("Address", state.selectedServer?.controlUrl ?: "-", monospace = true)
                Fact("LiveKit", state.selectedServer?.livekitUrl ?: "-", monospace = true)
                Fact("Discovery", discoveryLabel(state.discovery))
                Fact("Control", controlLabel(state.control))
                Fact("Media", mediaLabel(state.media))
                Fact("Output route", state.outputRoute ?: "-")
                Fact("Room", state.activeRoomName.ifBlank { "-" })
                Fact("Camera", state.cameraNumber?.toString() ?: "-")
                Fact("Operator name", state.displayName.ifBlank { "-" })
                Fact("Foreground service", if (state.serviceRunning) "running" else "stopped")
                Spacer(Modifier.height(8.dp))
                Text("OxygenOS battery help", fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleSmall)
                Text("Keep Wi-Fi on during sleep and disable battery optimization for Church Comms so mDNS continues. Go to Settings → Battery → App battery management → Church Comms → Unrestricted.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            }
        }
        Spacer(Modifier.height(12.dp))
        Text(
            text = "Wi-Fi/IP, LiveKit RTT/jitter/loss, mic permission and " +
                "battery-optimization details arrive with the diagnostics ticket.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

private fun discoveryLabel(state: DiscoveryState): String = when (state) {
    DiscoveryState.Idle -> "idle"
    DiscoveryState.Discovering -> "discovering"
    is DiscoveryState.Found -> "found ${state.servers.size}"
    is DiscoveryState.Failed -> "failed"
}

private fun controlLabel(state: ControlState): String = when (state) {
    ControlState.Disconnected -> "DISCONNECTED"
    ControlState.Connecting -> "CONNECTING"
    is ControlState.Connected -> "CONNECTED"
    is ControlState.Joined -> "JOINED"
    is ControlState.Reconnecting -> "RECONNECTING ${state.attempt}/${state.maxAttempts}"
    is ControlState.Failed -> "FAILED"
}

private fun mediaLabel(state: MediaState): String = when (state) {
    MediaState.Idle -> "idle"
    MediaState.WebRtcConnecting -> "WEBRTC_CONNECTING"
    is MediaState.Ready -> "READY"
    is MediaState.Failed -> "MEDIA_FAILED"
}
