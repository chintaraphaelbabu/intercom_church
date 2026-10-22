package com.churchcomms.operator

import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.churchcomms.operator.control.ControlClient
import com.churchcomms.operator.control.ControlState
import com.churchcomms.operator.discovery.DiscoveredServer
import com.churchcomms.operator.discovery.DiscoveryService
import com.churchcomms.operator.discovery.DiscoveryState
import com.churchcomms.operator.media.HttpMediaTokenClient
import com.churchcomms.operator.media.LiveKitOperatorRoom
import com.churchcomms.operator.media.MediaState
import com.churchcomms.operator.media.OperatorMedia
import com.churchcomms.operator.protocol.Protocol
import com.churchcomms.operator.protocol.RosterClient
import com.churchcomms.operator.ui.theme.ChurchCommsTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val deviceName = Build.MODEL?.takeIf { it.isNotBlank() } ?: "Operator"
        val appVersion = BuildConfig.VERSION_NAME

        setContent {
            ChurchCommsTheme {
                val discovery = remember { DiscoveryService(applicationContext) }
                val control = remember {
                    ControlClient(appVersion = appVersion, clientName = deviceName)
                }
                val media = remember {
                    OperatorMedia(
                        tokenClient = HttpMediaTokenClient(),
                        createRoom = { LiveKitOperatorRoom(applicationContext) },
                    )
                }
                val scope = rememberCoroutineScope()
                val discoveryState by discovery.state.collectAsStateWithLifecycle()
                val controlState by control.state.collectAsStateWithLifecycle()
                val mediaState by media.state.collectAsStateWithLifecycle()
                var joinedServer by remember { mutableStateOf<DiscoveredServer?>(null) }

                DisposableEffect(Unit) {
                    discovery.start()
                    onDispose {
                        discovery.stop()
                        media.disconnect()
                        control.disconnect()
                    }
                }

                OperatorScreen(
                    discoveryState = discoveryState,
                    controlState = controlState,
                    mediaState = mediaState,
                    joinedServer = joinedServer,
                    onDebugJoin = { server ->
                        joinedServer = server
                        control.connect(server)
                    },
                    onRetryDiscovery = { discovery.retry() },
                    onJoinAudio = {
                        joinedServer?.let { server ->
                            scope.launch {
                                media.connect(
                                    tokenUrl = server.tokenUrl,
                                    preferredLivekitUrl = server.livekitUrl,
                                    name = deviceName,
                                )
                            }
                        }
                    },
                    onLeaveAudio = { media.disconnect() },
                    onLeave = {
                        media.disconnect()
                        joinedServer = null
                        control.disconnect()
                    },
                )
            }
        }
    }
}

@Composable
private fun OperatorScreen(
    discoveryState: DiscoveryState,
    controlState: ControlState,
    mediaState: MediaState,
    joinedServer: DiscoveredServer?,
    onDebugJoin: (DiscoveredServer) -> Unit,
    onRetryDiscovery: () -> Unit,
    onJoinAudio: () -> Unit,
    onLeaveAudio: () -> Unit,
    onLeave: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 16.dp),
        ) {
            Text(
                text = "CHURCH PRODUCTION COMMS",
                color = MaterialTheme.colorScheme.primary,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                letterSpacing = MaterialTheme.typography.labelSmall.letterSpacing,
            )
            Text(
                text = "Operator",
                style = MaterialTheme.typography.headlineLarge,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = "Protocol v${Protocol.VERSION} · debug walking skeleton",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )

            Spacer(Modifier.height(24.dp))

            when (controlState) {
                is ControlState.Connected -> ConnectedPanel(
                    state = controlState,
                    livekitUrl = joinedServer?.livekitUrl ?: controlState.serverInfo.livekitUrl,
                    mediaState = mediaState,
                    onJoinAudio = onJoinAudio,
                    onLeaveAudio = onLeaveAudio,
                    onLeave = onLeave,
                )

                is ControlState.Failed -> {
                    ErrorCard(controlState.message)
                    Spacer(Modifier.height(12.dp))
                    OutlinedButton(onClick = onLeave, modifier = Modifier.fillMaxWidth()) {
                        Text("Back to discovery")
                    }
                }

                ControlState.Connecting -> {
                    StatusCard(
                        title = "Connecting to the control server…",
                        detail = "Sending the v${Protocol.VERSION} hello handshake.",
                        busy = true,
                    )
                }

                ControlState.Disconnected -> DiscoveryPanel(
                    state = discoveryState,
                    onDebugJoin = onDebugJoin,
                    onRetry = onRetryDiscovery,
                )
            }
        }
    }
}

@Composable
private fun DiscoveryPanel(
    state: DiscoveryState,
    onDebugJoin: (DiscoveredServer) -> Unit,
    onRetry: () -> Unit,
) {
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

    when (state) {
        DiscoveryState.Idle -> Text(
            text = "Discovery is not running.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        DiscoveryState.Discovering -> StatusCard(
            title = "Looking for the director's laptop…",
            detail = "Searching for _church-comms._tcp.local",
            busy = true,
        )

        is DiscoveryState.Failed -> {
            ErrorCard(state.message)
            Spacer(Modifier.height(12.dp))
            Button(onClick = onRetry, modifier = Modifier.fillMaxWidth()) {
                Text("Retry discovery")
            }
        }

        is DiscoveryState.Found -> {
            if (state.servers.isEmpty()) {
                StatusCard(
                    title = "No Church Comms server found yet",
                    detail = "Start the launcher on the director's laptop and keep both devices on the same Wi-Fi.",
                    busy = true,
                )
            } else {
                state.servers.forEach { server ->
                    ServerCard(server = server, onDebugJoin = onDebugJoin)
                    Spacer(Modifier.height(10.dp))
                }
            }
        }
    }
}

@Composable
private fun ServerCard(
    server: DiscoveredServer,
    onDebugJoin: (DiscoveredServer) -> Unit,
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
                onClick = { onDebugJoin(server) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Debug join")
            }
        }
    }
}

@Composable
private fun ConnectedPanel(
    state: ControlState.Connected,
    livekitUrl: String,
    mediaState: MediaState,
    onJoinAudio: () -> Unit,
    onLeaveAudio: () -> Unit,
    onLeave: () -> Unit,
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
                    text = "Control server",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Chip("connected", accent = true)
            }
            Spacer(Modifier.height(10.dp))
            Fact("Protocol", "v${state.serverInfo.protocol}")
            Fact("Server ID", state.serverInfo.serverId, monospace = true)
            Fact("LiveKit", livekitUrl, monospace = true)
            Fact("Server time", state.serverInfo.serverTime)
        }
    }

    Spacer(Modifier.height(16.dp))
    DirectorAudioPanel(
        state = mediaState,
        onJoinAudio = onJoinAudio,
        onLeaveAudio = onLeaveAudio,
    )

    Spacer(Modifier.height(16.dp))
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = "Debug roster",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = state.roster.size.toString(),
            color = MaterialTheme.colorScheme.primary,
            fontWeight = FontWeight.Bold,
        )
    }
    Spacer(Modifier.height(8.dp))
    if (state.roster.isEmpty()) {
        Text(
            text = "No clients connected yet.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    } else {
        state.roster.forEach { client ->
            RosterRow(client)
            Spacer(Modifier.height(8.dp))
        }
    }

    Spacer(Modifier.height(8.dp))
    Text(
        text = "This is the M0 debug connection. Audio comes next.",
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.bodySmall,
    )
    Spacer(Modifier.height(12.dp))
    OutlinedButton(onClick = onLeave, modifier = Modifier.fillMaxWidth()) {
        Text("Disconnect")
    }
}

@Composable
private fun DirectorAudioPanel(
    state: MediaState,
    onJoinAudio: () -> Unit,
    onLeaveAudio: () -> Unit,
) {
    val label = when (state) {
        MediaState.Idle -> "not joined"
        MediaState.WebRtcConnecting -> "WEBRTC_CONNECTING"
        is MediaState.Ready -> "READY"
        is MediaState.Failed -> "MEDIA_FAILED"
    }
    val accent = state is MediaState.Ready

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
                    text = "Director audio",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Chip(label, accent = accent)
            }
            Spacer(Modifier.height(10.dp))

            when (state) {
                MediaState.Idle -> Text(
                    text = "Join the media room to hear the Director through the headset.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                )

                MediaState.WebRtcConnecting -> Text(
                    text = "Connecting to LiveKit…",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                )

                is MediaState.Ready -> {
                    Fact("State", "READY")
                    Fact("Output route", state.outputRoute)
                    Fact(
                        "Director",
                        if (state.directorAudio) "live" else "waiting for audio",
                    )
                }

                is MediaState.Failed -> MediaErrorCard(state.message)
            }

            Spacer(Modifier.height(12.dp))
            when (state) {
                MediaState.Idle -> Button(
                    onClick = onJoinAudio,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Join Director audio")
                }

                is MediaState.Failed -> Button(
                    onClick = onJoinAudio,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Retry audio")
                }

                else -> OutlinedButton(
                    onClick = onLeaveAudio,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Leave audio")
                }
            }
        }
    }
}

@Composable
private fun MediaErrorCard(message: String) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = Color(0xFF2A1719),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(
                text = "MEDIA_FAILED",
                color = MaterialTheme.colorScheme.error,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(4.dp))
            Text(message, color = Color(0xFFF3C6C6))
        }
    }
}

@Composable
private fun RosterRow(client: RosterClient) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(10.dp),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column {
                Text(client.name, fontWeight = FontWeight.SemiBold)
                Text(
                    text = "app ${client.appVersion}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            Chip(client.clientType)
        }
    }
}

@Composable
private fun StatusCard(title: String, detail: String, busy: Boolean) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(14.dp),
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (busy) {
                CircularProgressIndicator(
                    modifier = Modifier.size(22.dp),
                    strokeWidth = 2.dp,
                )
                Spacer(Modifier.size(14.dp))
            }
            Column {
                Text(title, fontWeight = FontWeight.SemiBold)
                Text(
                    text = detail,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

@Composable
private fun ErrorCard(message: String) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = Color(0xFF2A1719),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(
                text = "Connection problem",
                color = MaterialTheme.colorScheme.error,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(4.dp))
            Text(message, color = Color(0xFFF3C6C6))
        }
    }
}

@Composable
private fun Fact(label: String, value: String, monospace: Boolean = false) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            text = label,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
        )
        Text(
            text = value,
            fontFamily = if (monospace) FontFamily.Monospace else FontFamily.Default,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.Medium,
        )
    }
}

@Composable
private fun Chip(label: String, accent: Boolean = false) {
    val color = if (accent) {
        MaterialTheme.colorScheme.primary
    } else {
        MaterialTheme.colorScheme.onSurfaceVariant
    }
    Box(
        modifier = Modifier
            .background(
                color = color.copy(alpha = 0.14f),
                shape = RoundedCornerShape(999.dp),
            )
            .padding(horizontal = 10.dp, vertical = 4.dp),
    ) {
        Text(
            text = label,
            color = color,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
        )
    }
}

