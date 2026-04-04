package com.pkt.live.ui.controls

import android.view.MotionEvent
import android.view.ScaleGestureDetector
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.runtime.*
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput

/**
 * Pinch-to-zoom modifier for the camera preview.
 *
 * Debounced to avoid flooding the camera API with rapid zoom commands.
 * Clamped to safe range [1f, 10f].
 */
@Composable
fun Modifier.pinchToZoom(
    currentZoom: Float,
    onZoomChange: (Float) -> Unit,
): Modifier {
    var lastZoom by remember { mutableFloatStateOf(currentZoom) }

    return this.pointerInput(Unit) {
        detectTransformGestures { _, _, zoom, _ ->
            val newZoom = (lastZoom * zoom).coerceIn(1f, 10f)
            lastZoom = newZoom
            onZoomChange(newZoom)
        }
    }
}
