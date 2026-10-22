package com.churchcomms.operator.ui

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
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.churchcomms.operator.discovery.DiscoveredServer
import com.churchcomms.operator.protocol.Protocol
import com.churchcomms.operator.session.SessionState

enum class OperatorScreen {
    Join,
    Session,
    Diagnostics,
}

data class OperatorActions(
    val connect: (DiscoveredServer) -> Unit,
    val retryDiscovery: () -> Unit,
    val retryConnection: () -> Unit,
    val leave: () -> Unit,
    val joinDirectorAudio: () -> Unit,
    val leaveAudio: () -> Unit,
    val clearMute: () -> Unit,
    val setDisplayName: (String) -> Unit,
    val joinRoom: (String, Int) -> Unit,
    val pressPtt: () -> Unit = {},
    val releasePtt: () -> Unit = {},
)

/**
 * Root of the Operator UI. The Activity only supplies state and intents, so
 * later tickets can replace the Session screen with Mixer/Live screens without
 * touching Activity lifecycle code.
 */
@Composable
fun OperatorApp(
    state: SessionState,
    actions: OperatorActions,
    onRequestNotificationPermission: () -> Unit,
) {
    var screen by rememberSaveable { mutableStateOf(OperatorScreen.Join) }

    // Backgrounding the app must never leave the microphone transmitting.
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) {
        actions.releasePtt()
    }

    LaunchedEffect(state.isSessionActive) {
        if (state.isSessionActive) {
            if (screen == OperatorScreen.Join) {
                screen = OperatorScreen.Session
            }
            onRequestNotificationPermission()
        } else if (screen == OperatorScreen.Session) {
            screen = OperatorScreen.Join
        }
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.safeDrawing),
        ) {
            Column(Modifier.padding(horizontal = 20.dp, vertical = 16.dp)) {
                Text(
                    text = "CHURCH PRODUCTION COMMS",
                    color = MaterialTheme.colorScheme.primary,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    text = "Operator",
                    style = MaterialTheme.typography.headlineLarge,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    text = "Protocol v${Protocol.VERSION} \u00b7 named rooms",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                )
                Spacer(Modifier.height(8.dp))
                Row(modifier = Modifier.fillMaxWidth()) {
                    ScreenTab(
                        label = "Join",
                        selected = screen == OperatorScreen.Join,
                        onClick = { screen = OperatorScreen.Join },
                    )
                    ScreenTab(
                        label = "Session",
                        selected = screen == OperatorScreen.Session,
                        onClick = { screen = OperatorScreen.Session },
                    )
                    ScreenTab(
                        label = "Diagnostics",
                        selected = screen == OperatorScreen.Diagnostics,
                        onClick = { screen = OperatorScreen.Diagnostics },
                    )
                }
            }

            Box(modifier = Modifier.weight(1f)) {
                when (screen) {
                    OperatorScreen.Join -> JoinScreen(state = state, actions = actions)
                    OperatorScreen.Session -> SessionScreen(state = state, actions = actions)
                    OperatorScreen.Diagnostics -> DiagnosticsScreen(state = state)
                }
            }
        }
    }
}

@Composable
private fun ScreenTab(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    TextButton(onClick = onClick) {
        Text(
            text = label,
            color = if (selected) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
        )
    }
}
