package com.churchcomms.operator.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val ChurchCommsColors = darkColorScheme(
    primary = Color(0xFF4CC2A0),
    onPrimary = Color(0xFF06110D),
    primaryContainer = Color(0xFF16302A),
    onPrimaryContainer = Color(0xFFB9F2E0),
    secondary = Color(0xFF8FB3D9),
    onSecondary = Color(0xFF07121F),
    background = Color(0xFF0D1117),
    onBackground = Color(0xFFEEF2F7),
    surface = Color(0xFF161D27),
    onSurface = Color(0xFFEEF2F7),
    surfaceVariant = Color(0xFF1D2634),
    onSurfaceVariant = Color(0xFF93A1B5),
    error = Color(0xFFFF7A7A),
    onError = Color(0xFF2A1719),
)

@Composable
fun ChurchCommsTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = ChurchCommsColors,
        content = content,
    )
}
