package com.pkt.live.streaming

/**
 * Sealed class for stream lifecycle states.
 * No ambiguous states — every state is explicit.
 */
sealed class StreamState {
    data object Idle : StreamState()
    data object Previewing : StreamState()
    data class Connecting(val url: String) : StreamState()
    data class Live(val startedAt: Long) : StreamState()
    data class Reconnecting(val attempt: Int, val maxAttempts: Int = 3) : StreamState()
    data class Error(val message: String, val recoverable: Boolean = true) : StreamState()
    data object Stopped : StreamState()

    val isStreaming: Boolean
        get() = this is Live || this is Reconnecting

    val isPreviewActive: Boolean
        get() = this !is Idle && this !is Stopped
}

/**
 * Quality presets — max 720p to keep stable on all devices.
 */
enum class Quality(
    val label: String,
    val width: Int,
    val height: Int,
    val fps: Int,
    val bitrate: Int,
) {
    Q_720P_30("720p 30fps", 1280, 720, 30, 4_000_000),
    Q_720P_24("720p 24fps", 1280, 720, 24, 3_000_000),
    Q_540P_30("540p 30fps", 960, 540, 30, 2_500_000),
    Q_480P_30("480p 30fps", 854, 480, 30, 2_000_000),
    Q_480P_24("480p 24fps", 854, 480, 24, 1_800_000);

    companion object {
        val DEFAULT = Q_720P_30
    }
}

data class EncoderSurfaceSize(
    val width: Int = 1280,
    val height: Int = 720,
)
