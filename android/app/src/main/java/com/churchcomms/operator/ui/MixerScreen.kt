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
fun MixerScreen(
    state: SessionState,
    actions: OperatorActions,
    onGoLive: () -> Unit,
    onBackToSession: () -> Unit = {},
) {
    val joined = state.control as? ControlState.Joined
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
                Text("Mixer View", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                Text("Room: ${joined?.room?.name ?: "-"}", style = MaterialTheme.typography.bodyMedium)
                Text("You: Camera ${state.cameraNumber ?: 1}", style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(10.dp))
                Button(onClick = onGoLive, modifier = Modifier.fillMaxWidth()) { Text("Go Live") }
                Spacer(Modifier.height(4.dp))
                OutlinedButton(onClick = onBackToSession, modifier = Modifier.fillMaxWidth()) { Text("Back") }
            }
        }

        Spacer(Modifier.height(12.dp))
        Text("Roster & volumes", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(6.dp))

        val roster = joined?.room?.operators ?: emptyList()
        if (roster.isEmpty()) {
            Text("No other operators in room.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        } else {
            roster.forEach { op ->
                RosterVolumeRow(name = op.name, camera = op.cameraNumber ?: 1, muted = op.muted)
            }
        }
    }
}

@Composable
private fun RosterVolumeRow(name: String, camera: Int, muted: Boolean) {
    Surface(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(10.dp),
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Cam $camera · $name", fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
                if (muted) {
                    Spacer(Modifier.weight(1f))
                    Text("MUTED", color = Color(0xFFFFC56B), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelSmall)
                }
            }
            Spacer(Modifier.height(6.dp))
            Text("Level: ●●●○○", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            Slider(value = 0.75f, onValueChange = {}, modifier = Modifier.fillMaxWidth())
        }
    }
}
