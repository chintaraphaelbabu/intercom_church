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
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.churchcomms.operator.control.ControlState
import com.churchcomms.operator.session.SessionState

@Composable
fun LiveScreen(
    state: SessionState,
    actions: OperatorActions,
    onBackToMixer: () -> Unit = {},
) {
    val joined = state.control as? ControlState.Joined
    val me = joined?.room?.operators?.firstOrNull { it.id == joined.participantId }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 8.dp),
    ) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = MaterialTheme.colorScheme.surface,
            shape = RoundedCornerShape(14.dp),
        ) {
            Column(Modifier.padding(16.dp)) {
                Text("Live View", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                Text("Room: ${joined?.room?.name ?: "-"}", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
                Text("Operator: ${me?.name ?: state.displayName.ifBlank { "You" }}", style = MaterialTheme.typography.bodyMedium)
                Text("Camera: ${me?.cameraNumber ?: state.cameraNumber ?: 1}", style = MaterialTheme.typography.bodyMedium)
                Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                    StatusChip(label = joined?.room?.status ?: "connected", accent = joined?.room?.status != "grace")
                    StatusChip(label = if (state.transmitting) "TRANSMITTING" else "listening", accent = state.transmitting)
                }
            }
        }

        Spacer(Modifier.height(16.dp))
        // Large PTT
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = MaterialTheme.colorScheme.primary,
            shape = RoundedCornerShape(14.dp),
        ) {
            Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("PUSH TO TALK", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = Color.White)
                Spacer(Modifier.height(4.dp))
                Text(state.transmitting.toString(), color = Color(0xFFE7D2B3))
            }
        }

        Spacer(Modifier.height(16.dp))
        // Master volume + state
        Surface(modifier = Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.surface, shape = RoundedCornerShape(14.dp)) {
            Column(Modifier.padding(16.dp)) {
                Text("Master volume", fontWeight = FontWeight.SemiBold)
                Slider(value = 1f, onValueChange = {}, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                    Text("Connection: ${if (state.transmitting) "live" else "ready"}", style = MaterialTheme.typography.bodySmall)
                    Text("Audio: ${if (state.media is com.churchcomms.operator.media.MediaState.Ready) "ready" else "connecting"}", style = MaterialTheme.typography.bodySmall)
                }
            }
        }

        Spacer(Modifier.height(12.dp))
        // Director absence countdown visible
        joined?.room?.graceDeadline?.let { deadline ->
            Surface(modifier = Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(12.dp)) {
                Column(Modifier.padding(12.dp)) {
                    Text("Director absence countdown", fontWeight = FontWeight.SemiBold, color = Color(0xFFFFC56B))
                    Text("Grace deadline: $deadline", style = MaterialTheme.typography.bodySmall, fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace)
                }
            }
        }

        Spacer(Modifier.height(12.dp))
        OutlinedButton(onClick = onBackToMixer, modifier = Modifier.fillMaxWidth()) { Text("Back to Mixer") }
        Spacer(Modifier.height(8.dp))
        OutlinedButton(onClick = actions.leave, modifier = Modifier.fillMaxWidth()) { Text("Leave room") }
    }
}

@Composable
private fun StatusChip(label: String, accent: Boolean = true) {
    Surface(
        color = if (accent) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(8.dp),
    ) {
        Text(label, modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp), color = if (accent) Color.White else MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelSmall)
    }
}
