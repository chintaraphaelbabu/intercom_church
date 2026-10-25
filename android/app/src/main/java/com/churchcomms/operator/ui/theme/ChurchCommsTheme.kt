package com.churchcomms.operator.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

val FlatBlackBg = Color(0xFF000000)
val FlatBlackBorder = Color(0xFF333333)
val SquareShape = RoundedCornerShape(0.dp)

private val ChurchCommsColors = darkColorScheme(
    primary = Color(0xFF333333),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFF000000),
    onPrimaryContainer = Color(0xFFFFFFFF),
    secondary = Color(0xFF333333),
    onSecondary = Color(0xFFFFFFFF),
    background = Color(0xFF000000),
    onBackground = Color(0xFFFFFFFF),
    surface = Color(0xFF333333),
    onSurface = Color(0xFFFFFFFF),
    surfaceVariant = Color(0xFF000000),
    onSurfaceVariant = Color(0xFFFFFFFF),
    error = Color(0xFF333333),
    onError = Color(0xFFFFFFFF),
)

@Composable
fun ChurchCommsTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = ChurchCommsColors,
        content = content,
    )
}
