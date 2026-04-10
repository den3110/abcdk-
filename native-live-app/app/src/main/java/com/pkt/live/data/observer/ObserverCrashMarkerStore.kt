package com.pkt.live.data.observer

import android.content.Context

data class PendingObserverCrash(
    val crashId: String,
    val occurredAtMs: Long,
    val threadName: String,
    val throwableClass: String,
    val message: String,
)

class ObserverCrashMarkerStore(
    context: Context,
) {
    companion object {
        private const val PREFS_NAME = "observer_crash_marker"
        private const val KEY_CRASH_ID = "crash_id"
        private const val KEY_OCCURRED_AT_MS = "occurred_at_ms"
        private const val KEY_THREAD_NAME = "thread_name"
        private const val KEY_THROWABLE_CLASS = "throwable_class"
        private const val KEY_MESSAGE = "message"

        fun recordUnhandledCrash(
            context: Context,
            threadName: String,
            throwable: Throwable,
        ) {
            runCatching {
                ObserverCrashMarkerStore(context).markUnhandledCrash(threadName, throwable)
            }
        }
    }

    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun markUnhandledCrash(
        threadName: String,
        throwable: Throwable,
    ) {
        val occurredAtMs = System.currentTimeMillis()
        val crashId = "${occurredAtMs}_${threadName}_${throwable::class.java.simpleName}"
        prefs.edit()
            .putString(KEY_CRASH_ID, crashId)
            .putLong(KEY_OCCURRED_AT_MS, occurredAtMs)
            .putString(KEY_THREAD_NAME, threadName.take(80))
            .putString(KEY_THROWABLE_CLASS, throwable::class.java.name.take(160))
            .putString(KEY_MESSAGE, throwable.message.orEmpty().trim().take(240))
            .apply()
    }

    fun peekPendingCrash(): PendingObserverCrash? {
        val crashId = prefs.getString(KEY_CRASH_ID, null)?.trim().orEmpty()
        if (crashId.isBlank()) return null
        return PendingObserverCrash(
            crashId = crashId,
            occurredAtMs = prefs.getLong(KEY_OCCURRED_AT_MS, 0L),
            threadName = prefs.getString(KEY_THREAD_NAME, null)?.trim().orEmpty(),
            throwableClass = prefs.getString(KEY_THROWABLE_CLASS, null)?.trim().orEmpty(),
            message = prefs.getString(KEY_MESSAGE, null)?.trim().orEmpty(),
        )
    }

    fun clearPendingCrash(crashId: String? = null) {
        val currentCrashId = prefs.getString(KEY_CRASH_ID, null)?.trim().orEmpty()
        if (currentCrashId.isBlank()) return
        if (!crashId.isNullOrBlank() && crashId != currentCrashId) return
        prefs.edit().clear().apply()
    }
}
