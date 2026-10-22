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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.churchcomms.operator.control.ControlState
import com.churchcomms.operator.media.MediaState
import com.churchcomms.operator.protocol.RosterClient
import com.churchcomms.operator.session.SessionState

@Composable
fun SessionScreen(
    state: SessionState,
    actions: OperatorActions,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 8.dp),
    ) {
        when (val control = state.control) {
            ControlState.Disconnected -> {
                StatusCard(
                    title = "No active session",
                    detail = "Choose the director's laptop on the Join screen.",
                    busy = false,
                )
            }

            ControlState.Connecting -> StatusCard(
                title = "Connecting to the control server\u2026",
                detail = "Sending the v1 hello handshake.",
                busy = true,
            )

            is ControlState.Reconnecting -> {
                ErrorCard(
                    message = "The Wi-Fi dropped. Trying again with the stored session token.",
                    title = "RECONNECTING ${control.attempt}/${control.maxAttempts}",
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "Audio resumes automatically when the control server answers.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                )
                Spacer(Modifier.height(12.dp))
                OutlinedButton(
                    onClick = actions.leave,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Leave")
                }
            }

            is ControlState.Failed -> {
                ErrorCard(control.message)
                Spacer(Modifier.height(12.dp))
                if (control.canRetry) {
                    Button(
                        onClick = actions.retryConnection,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Retry")
                    }
                    Spacer(Modifier.height(8.dp))
                }
                OutlinedButton(
                    onClick = actions.leave,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Leave")
                }
            }

            is ControlState.Connected -> {
                StatusCard(
                    title = "Not in a room",
                    detail = "Choose an active room on the Join tab. The room list updates " +
                        "as the Director creates or ends rooms.",
                    busy = false,
                )
                Spacer(Modifier.height(12.dp))
                OutlinedButton(
                    onClick = actions.leave,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Back to discovery")
                }
            }

            is ControlState.Joined -> {
                JoinedContent(control)
                Spacer(Modifier.height(16.dp))
                DirectorAudioPanel(
                    state = state.media,
                    onJoinAudio = actions.joinDirectorAudio,
                    onLeaveAudio = actions.leaveAudio,
                )
                Spacer(Modifier.height(16.dp))
                RosterSection(
                    title = "Room roster",
                    roster = control.room.operators.map { participant ->
                        RosterClient(
                            id = participant.id,
                            name = participant.name,
                            clientType = if (participant.muted) {
                                "operator \u00b7 muted"
                            } else {
                                "operator"
                            },
                            appVersion = "camera ${participant.cameraNumber ?: "-"}",
                            connectedAt = participant.joinedAt,
                        )
                    },
                )
                Spacer(Modifier.height(12.dp))
                OutlinedButton(
                    onClick = actions.leave,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Leave room")
                }
            }
        }
    }
}

@Composable
private fun JoinedContent(control: ControlState.Joined) {
    val me = control.room.operators.firstOrNull { it.id == control.participantId }
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(14.dp),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement
                    .SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = control.room.name,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                )
                Chip(
                    label = if (control.room.status == "grace") "director offline" else "connected",
                    accent = control.room.status != "grace",
                )
            }
            Spacer(Modifier.height(10.dp))
            Fact("Camera", me?.cameraNumber?.toString() ?: "-")
            Fact("Operator", me?.name ?: control.participantId)
            Fact("Role", me?.role ?: "operator")
            Fact("Room status", control.room.status)
            Fact("Participants", "${control.room.operators.size + if (control.room.director != null) 1 else 0}")
            control.room.graceDeadline?.let { deadline ->
                Fact("Grace deadline", deadline, monospace = true)
            }
            control.health?.let { health ->
                Fact("Server health", "${health.status} \u00b7 ${health.rooms} rooms")
            }
        }
    }

    if (me?.muted == true) {
        Spacer(Modifier.height(12.dp))
        MuteBanner()
    }
}

@Composable
private fun MuteBanner() {    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = Color(0xFF332512),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(
                text = "Mic disabled by director",
                color = Color(0xFFFFC56B),
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = "Hold PTT with a fresh press to take the mic back.",
                color = Color(0xFFE7D2B3),
                style = MaterialTheme.typography.bodySmall,
            )
        }
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
                horizontalArrangement = Arrangement
                    .SpaceBetween,
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
                    text = "Connecting to LiveKit\u2026",
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

                is MediaState.Failed -> ErrorCard(state.message, title = "MEDIA_FAILED")
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
private fun RosterSection(title: String, roster: List<RosterClient>) {
    SectionTitle(title = title, trailing = roster.size.toString())
    Spacer(Modifier.height(8.dp))
    if (roster.isEmpty()) {
        Text(
            text = "No clients connected yet.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    } else {
        roster.forEach { client ->
            RosterRow(client)
            Spacer(Modifier.height(8.dp))
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
