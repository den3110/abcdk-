package com.pkt.live.util

import android.app.Activity
import android.content.pm.ActivityInfo
import android.util.Log

/**
 * Orientation lock utility.
 * Allows locking to landscape or portrait, or unlocking to auto.
 */
enum class OrientationMode {
    AUTO,
    LANDSCAPE,
    PORTRAIT;

    fun next(): OrientationMode = when (this) {
        AUTO -> LANDSCAPE
        LANDSCAPE -> PORTRAIT
        PORTRAIT -> AUTO
    }

    val label: String
        get() = when (this) {
            AUTO -> "Auto"
            LANDSCAPE -> "Landscape"
            PORTRAIT -> "Portrait"
        }
}

fun Activity.lockOrientation(mode: OrientationMode) {
    try {
        requestedOrientation = when (mode) {
            OrientationMode.AUTO -> ActivityInfo.SCREEN_ORIENTATION_FULL_USER
            OrientationMode.LANDSCAPE -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            OrientationMode.PORTRAIT -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
        }
        Log.d("OrientationLock", "Orientation set to ${mode.label}")
    } catch (e: Exception) {
        Log.e("OrientationLock", "Failed to lock orientation", e)
    }
}
