package com.pkt.live.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val DarkColorScheme = darkColorScheme(
    primary = Color(0xFF25C2A0),
    secondary = Color(0xFF4F46E5),
    background = Color.Black,
    surface = Color(0xFF1A1A1A),
    surfaceVariant = Color(0xFF2A2A2A),
    onPrimary = Color.White,
    onSecondary = Color.White,
    onBackground = Color.White,
    onSurface = Color.White,
    error = Color(0xFFEF4444),
    outline = Color(0xFF444444),
)

@Composable
fun PickletourLiveTheme(
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = DarkColorScheme,
        typography = Typography(),
        content = content,
    )
}

// Custom colors used in overlay
object LiveColors {
    val LiveRed = Color(0xFFEF4444)
    val LiveRedPulse = Color(0xFFDC2626)
    val AccentGreen = Color(0xFF25C2A0)
    val AccentBlue = Color(0xFF4F46E5)
    val SurfaceDark = Color(0xFF1A1A1A)
    val SurfaceDarker = Color(0xFF0D0D0D)
    val TextSecondary = Color(0xFFAAAAAA)
    val Warning = Color(0xFFF59E0B)
    val Reconnecting = Color(0xFFF97316)
}
