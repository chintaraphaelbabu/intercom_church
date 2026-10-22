package com.churchcomms.operator.ui

import android.view.HapticFeedbackConstants
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

private val TransmittingColor = Color(0xFFB3261E)
private val TransmittingText = Color(0xFFFFF7F6)

/**
 * The large hold-to-talk control. A press transmits; release, pointer cancel,
 * dragging out of the control, or composition/lifecycle teardown stops it.
 * There is deliberately no dialog and no tap-to-latch mode.
 */
@Composable
fun PttButton(
    transmitting: Boolean,
    enabled: Boolean,
    onPress: () -> Unit,
    onRelease: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val view = LocalView.current
    val currentOnPress by rememberUpdatedState(onPress)
    val currentOnRelease by rememberUpdatedState(onRelease)

    val container = when {
        transmitting -> TransmittingColor
        enabled -> MaterialTheme.colorScheme.primaryContainer
        else -> MaterialTheme.colorScheme.surfaceVariant
    }
    val content = when {
        transmitting -> TransmittingText
        enabled -> MaterialTheme.colorScheme.onPrimaryContainer
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    val headline = when {
        transmitting -> "TRANSMITTING"
        enabled -> "HOLD TO TALK"
        else -> "MIC NOT READY"
    }
    val detail = when {
        transmitting -> "Release to listen"
        enabled -> "Release to stop"
        else -> "Waiting for LiveKit audio"
    }

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .height(168.dp)
            .semantics(mergeDescendants = true) {
                role = Role.Button
                contentDescription = if (enabled) {
                    "Push to talk"
                } else {
                    "Push to talk, microphone not ready"
                }
                stateDescription = if (transmitting) {
                    "Transmitting"
                } else {
                    "Listening"
                }
            }
            .pointerInput(enabled) {
                if (!enabled) {
                    return@pointerInput
                }
                detectTapGestures(
                    onPress = {
                        // One short tick on press only; no repeating pattern.
                        view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                        try {
                            currentOnPress()
                            tryAwaitRelease()
                        } finally {
                            currentOnRelease()
                        }
                    },
                )
            },
        shape = RoundedCornerShape(28.dp),
        color = container,
        contentColor = content,
        border = BorderStroke(
            width = 2.dp,
            color = if (transmitting) {
                TransmittingText.copy(alpha = 0.55f)
            } else {
                MaterialTheme.colorScheme.outline.copy(alpha = 0.5f)
            },
        ),
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = headline,
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = detail,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}
