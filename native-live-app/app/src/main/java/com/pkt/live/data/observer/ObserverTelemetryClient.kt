package com.pkt.live.data.observer

import android.content.Context
import android.os.SystemClock
import android.util.Log
import com.google.gson.Gson
import com.pkt.live.BuildConfig
import com.pkt.live.data.api.AuthInterceptor
import com.pkt.live.data.model.LiveDeviceEventRequest
import com.pkt.live.data.model.LiveDeviceEventsBatchRequest
import com.pkt.live.data.model.LiveDeviceHeartbeatRequest
import com.pkt.live.data.model.LiveDeviceTelemetryEvent
import com.pkt.live.data.model.LiveDeviceTelemetryEventPayload
import com.pkt.live.data.model.ObserverIngestResponse
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

object LiveObserverConfig {
    @Volatile
    private var observerBaseUrlOverride: String? = null

    @Volatile
    private var observerBaseUrlOverrideActive: Boolean = false

    val observerBaseUrl: String?
        get() {
            if (observerBaseUrlOverrideActive) {
                return observerBaseUrlOverride
            }
            return normalizeObserverBaseUrl(BuildConfig.LIVE_OBSERVER_URL)
        }

    fun setObserverBaseUrlOverride(raw: String?) {
        observerBaseUrlOverrideActive = true
        observerBaseUrlOverride = normalizeObserverBaseUrl(raw)
    }

    fun clearObserverBaseUrlOverride() {
        observerBaseUrlOverrideActive = false
        observerBaseUrlOverride = null
    }

    private fun normalizeObserverBaseUrl(raw: String?): String? {
        val trimmed = raw?.trim().orEmpty()
        if (trimmed.isBlank()) return null
        val parsed = trimmed.toHttpUrlOrNull() ?: return null
        val scheme = parsed.scheme.lowercase()
        val host = parsed.host.lowercase()
        val allowHttp =
            scheme == "http" &&
                (host == "localhost" ||
                    host == "127.0.0.1" ||
                    host.endsWith(".local") ||
                    isPrivateIpv4Host(host))
        if (scheme != "https" && !allowHttp) {
            return null
        }
        return if (trimmed.endsWith("/")) trimmed else "$trimmed/"
    }

    private fun isPrivateIpv4Host(host: String): Boolean {
        val parts = host.split(".")
        if (parts.size != 4) return false
        val octets = parts.map { it.toIntOrNull() ?: return false }
        return when {
            octets[0] == 10 -> true
            octets[0] == 192 && octets[1] == 168 -> true
            octets[0] == 172 && octets[1] in 16..31 -> true
            else -> false
        }
    }
}

data class ObserverTelemetryConnectionState(
    val baseUrl: String? = null,
    val enabled: Boolean = false,
    val pendingEventCount: Int = 0,
    val consecutiveFailureCount: Int = 0,
    val lastSuccessAtMs: Long? = null,
    val lastFailureAtMs: Long? = null,
    val lastErrorMessage: String? = null,
    val suspendedUntilEpochMs: Long? = null,
)

class ObserverTelemetryClient(
    appContext: Context,
    private val okHttpClient: OkHttpClient,
    private val gson: Gson,
    private val authInterceptor: AuthInterceptor,
) {
    companion object {
        private const val TAG = "ObserverTelemetry"
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
        private const val LOG_THROTTLE_MS = 60_000L
        private const val COOLDOWN_SHORT_MS = 15_000L
        private const val COOLDOWN_MEDIUM_MS = 60_000L
        private const val COOLDOWN_LONG_MS = 5 * 60_000L
        private const val EVENT_BATCH_WINDOW_MS = 1_500L
        private const val EVENT_BATCH_MAX_SIZE = 8
        private const val EVENT_QUEUE_MAX_SIZE = 24
    }

    private val observerScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val queueLock = Any()
    private val pendingEventQueue = mutableListOf<LiveDeviceEventRequest>()
    private val crashMarkerStore = ObserverCrashMarkerStore(appContext)
    private val _connectionState =
        MutableStateFlow(
            ObserverTelemetryConnectionState(
                baseUrl = LiveObserverConfig.observerBaseUrl,
                enabled = !LiveObserverConfig.observerBaseUrl.isNullOrBlank(),
            )
        )

    @Volatile
    private var activeBaseUrlKey: String? = null

    @Volatile
    private var consecutiveFailureCount: Int = 0

    @Volatile
    private var disabledUntilElapsedMs: Long = 0L

    @Volatile
    private var lastLoggedFailureAtMs: Long = 0L

    @Volatile
    private var lastLoggedFailureFingerprint: String = ""

    @Volatile
    private var pendingEventFirstQueuedAtMs: Long = 0L

    @Volatile
    private var pendingEventFlushJob: Job? = null

    val connectionState: StateFlow<ObserverTelemetryConnectionState> = _connectionState.asStateFlow()

    val isEnabled: Boolean
        get() {
            syncConnectionState()
            return !LiveObserverConfig.observerBaseUrl.isNullOrBlank()
        }

    fun refreshConnectionState() {
        syncConnectionState()
    }

    suspend fun sendDeviceHeartbeat(
        body: LiveDeviceHeartbeatRequest,
    ): Result<ObserverIngestResponse> {
        syncConnectionState()
        val result =
            post(
                path = "api/observer/ingest/live-devices/heartbeat",
                body = body,
                responseType = ObserverIngestResponse::class.java,
            )
        if (result.isSuccess) {
            flushRecoveredCrashMarkerIfNeeded(body)
            flushPendingDeviceEvents(force = true)
        }
        return result
    }

    suspend fun sendDeviceEvent(
        body: LiveDeviceEventRequest,
    ): Result<ObserverIngestResponse> {
        syncConnectionState()
        if (!isEnabled) {
            return Result.failure(IllegalStateException("Observer telemetry is disabled."))
        }
        if (isImmediateEvent(body)) {
            flushPendingDeviceEvents(force = true)
            return postSingleDeviceEvent(body)
        }

        val batchToFlush = enqueueDeferredEvent(body)
        if (batchToFlush.isNotEmpty()) {
            return postDeviceEventBatch(batchToFlush)
        }

        return Result.success(
            ObserverIngestResponse(
                ok = true,
                source = body.source,
                deviceId = body.deviceId,
            )
        )
    }

    private fun enqueueDeferredEvent(body: LiveDeviceEventRequest): List<LiveDeviceEventRequest> {
        synchronized(queueLock) {
            if (pendingEventQueue.size >= EVENT_QUEUE_MAX_SIZE) {
                pendingEventQueue.removeAt(0)
            }
            pendingEventQueue.add(body)
            if (pendingEventFirstQueuedAtMs <= 0L) {
                pendingEventFirstQueuedAtMs = SystemClock.elapsedRealtime()
            }
            val now = SystemClock.elapsedRealtime()
            val queueAgeMs = now - pendingEventFirstQueuedAtMs
            if (pendingEventQueue.size >= EVENT_BATCH_MAX_SIZE || queueAgeMs >= EVENT_BATCH_WINDOW_MS) {
                return drainPendingEventsLocked().also {
                    syncConnectionState()
                }
            }
            schedulePendingEventFlushLocked()
            syncConnectionState()
            return emptyList()
        }
    }

    private fun schedulePendingEventFlushLocked() {
        if (pendingEventFlushJob?.isActive == true) return
        pendingEventFlushJob =
            observerScope.launch {
                delay(EVENT_BATCH_WINDOW_MS)
                flushPendingDeviceEvents(force = true)
            }
    }

    private suspend fun flushPendingDeviceEvents(force: Boolean) {
        val events =
            synchronized(queueLock) {
                if (pendingEventQueue.isEmpty()) {
                    pendingEventFlushJob?.cancel()
                    pendingEventFlushJob = null
                    syncConnectionState()
                    return@synchronized emptyList()
                }
                if (!force) {
                    val queueAgeMs =
                        if (pendingEventFirstQueuedAtMs > 0L) {
                            SystemClock.elapsedRealtime() - pendingEventFirstQueuedAtMs
                        } else {
                            0L
                        }
                    if (pendingEventQueue.size < EVENT_BATCH_MAX_SIZE && queueAgeMs < EVENT_BATCH_WINDOW_MS) {
                        return@synchronized emptyList()
                    }
                }
                drainPendingEventsLocked()
            }
        syncConnectionState()
        if (events.isNotEmpty()) {
            postDeviceEventBatch(events)
        }
    }

    private fun drainPendingEventsLocked(): List<LiveDeviceEventRequest> {
        val drained = pendingEventQueue.toList()
        pendingEventQueue.clear()
        pendingEventFirstQueuedAtMs = 0L
        pendingEventFlushJob?.cancel()
        pendingEventFlushJob = null
        return drained
    }

    private suspend fun flushRecoveredCrashMarkerIfNeeded(body: LiveDeviceHeartbeatRequest) {
        val crash = crashMarkerStore.peekPendingCrash() ?: return
        val status = body.status
        val detail =
            listOf(
                crash.throwableClass.takeIf { it.isNotBlank() },
                crash.message.takeIf { it.isNotBlank() },
            ).joinToString(" • ")
        val diagnostics =
            listOf(
                "crashId:${crash.crashId}",
                "thread:${crash.threadName}",
                "occurredAtMs:${crash.occurredAtMs}",
            ).filter { it.isNotBlank() }

        val eventBody =
            LiveDeviceEventRequest(
                source = body.source,
                deviceId = body.deviceId,
                capturedAt = nowIsoUtc(),
                event =
                    LiveDeviceTelemetryEvent(
                        type = "app_crash_recovered",
                        level = "error",
                        reasonCode = "app_crash_recovered",
                        reasonText = "App đã bị crash ở phiên trước và vừa khởi động lại.",
                        stage = status.recovery.stage.name.lowercase(),
                        severity = status.recovery.severity.name.lowercase(),
                        occurredAt = nowIsoUtc(),
                        courtId = status.court.id,
                        courtName = status.court.name,
                        matchId = status.match.id,
                        matchCode = status.match.code,
                        operatorUserId = status.operatorInfo.userId,
                        operatorName = status.operatorInfo.displayName,
                        payload =
                            LiveDeviceTelemetryEventPayload(
                                summary = "App crash recovered after restart",
                                detail = detail.ifBlank { null },
                                overlayIssue = status.overlay.issue,
                                thermalState = status.thermal.state,
                                memoryPressure = status.thermal.memoryPressureSummary,
                                diagnostics = diagnostics,
                            ),
                    ),
                status = status,
            )

        postSingleDeviceEvent(eventBody).onSuccess {
            crashMarkerStore.clearPendingCrash(crash.crashId)
        }
    }

    private fun isImmediateEvent(body: LiveDeviceEventRequest): Boolean {
        val level = body.event.level.trim().lowercase()
        val reasonCode = body.event.reasonCode.trim().lowercase()
        if (level == "error") return true
        return reasonCode in
            setOf(
                "overlay_detached",
                "socket_room_mismatch",
                "stream_recovery",
                "thermal_critical",
                "recording_error",
                "app_crash_recovered",
                "app_crash_suspected",
            )
    }

    private suspend fun postDeviceEventBatch(
        events: List<LiveDeviceEventRequest>,
    ): Result<ObserverIngestResponse> {
        if (events.isEmpty()) {
            return Result.success(ObserverIngestResponse(ok = true))
        }
        return post(
            path = "api/observer/ingest/live-devices/events",
            body =
                LiveDeviceEventsBatchRequest(
                    source = events.first().source,
                    capturedAt = nowIsoUtc(),
                    events = events,
                ),
            responseType = ObserverIngestResponse::class.java,
        )
    }

    private suspend fun postSingleDeviceEvent(
        body: LiveDeviceEventRequest,
    ): Result<ObserverIngestResponse> =
        post(
            path = "api/observer/ingest/live-devices/event",
            body = body,
            responseType = ObserverIngestResponse::class.java,
        )

    private suspend fun <T> post(
        path: String,
        body: Any,
        responseType: Class<T>,
    ): Result<T> = withContext(Dispatchers.IO) {
        val baseUrl =
            LiveObserverConfig.observerBaseUrl
                ?: return@withContext Result.failure(IllegalStateException("Observer telemetry is not configured."))
        onBaseUrlObserved(baseUrl)
        if (isTemporarilySuspended()) {
            return@withContext Result.failure(
                ObserverTemporarilySuspendedException(
                    "Observer telemetry is temporarily paused to avoid request spam."
                )
            )
        }
        val url =
            baseUrl.toHttpUrlOrNull()?.resolve(path)
                ?: return@withContext Result.failure(IllegalStateException("Observer URL is invalid."))
        val requestBody = gson.toJson(body).toRequestBody(JSON_MEDIA_TYPE)
        val requestBuilder =
            Request.Builder()
                .url(url)
                .post(requestBody)
                .header("Accept", "application/json")
                .header("Content-Type", "application/json")

        authInterceptor.token?.trim()?.takeIf { it.isNotBlank() }?.let { token ->
            requestBuilder.header("Authorization", "Bearer $token")
        }

        runCatching {
            okHttpClient.newCall(requestBuilder.build()).execute().use { response ->
                val raw = response.body?.string().orEmpty()
                if (response.code == 401) {
                    throw ObserverHttpException(
                        statusCode = response.code,
                        message = "Observer auth is no longer valid.",
                    )
                }
                if (!response.isSuccessful) {
                    throw ObserverHttpException(
                        statusCode = response.code,
                        message = parseObserverErrorMessage(raw, response.code),
                    )
                }
                if (raw.isBlank()) {
                    throw IllegalStateException("Observer returned an empty response.")
                }
                gson.fromJson(raw, responseType)
                    ?: throw IllegalStateException("Observer returned an invalid response payload.")
            }
        }.onSuccess {
            recordSuccess()
        }.onFailure {
            if (it is ObserverTemporarilySuspendedException) return@onFailure
            recordFailure(baseUrl = baseUrl, path = path, error = it)
        }
    }

    private fun parseObserverErrorMessage(raw: String, statusCode: Int): String {
        if (raw.isBlank()) {
            return "Observer returned HTTP $statusCode."
        }
        return runCatching {
            val payload = gson.fromJson(raw, Map::class.java)
            sequenceOf(
                payload["message"] as? String,
                payload["error"] as? String,
                payload["reason"] as? String,
            ).firstOrNull { !it.isNullOrBlank() }
        }.getOrNull() ?: "Observer returned HTTP $statusCode."
    }

    private fun onBaseUrlObserved(baseUrl: String) {
        if (activeBaseUrlKey == baseUrl) return
        synchronized(this) {
            if (activeBaseUrlKey == baseUrl) return
            activeBaseUrlKey = baseUrl
            consecutiveFailureCount = 0
            disabledUntilElapsedMs = 0L
            lastLoggedFailureAtMs = 0L
            lastLoggedFailureFingerprint = ""
            synchronized(queueLock) {
                pendingEventQueue.clear()
                pendingEventFirstQueuedAtMs = 0L
                pendingEventFlushJob?.cancel()
                pendingEventFlushJob = null
            }
        }
        syncConnectionState(
            baseUrl = baseUrl,
            enabled = true,
            consecutiveFailureCount = 0,
            suspendedUntilEpochMs = null,
            resetHistory = true,
        )
    }

    private fun isTemporarilySuspended(): Boolean =
        SystemClock.elapsedRealtime() < disabledUntilElapsedMs

    private fun recordSuccess() {
        consecutiveFailureCount = 0
        disabledUntilElapsedMs = 0L
        syncConnectionState(
            lastSuccessAtMs = System.currentTimeMillis(),
            lastErrorMessage = null,
            consecutiveFailureCount = 0,
            suspendedUntilEpochMs = null,
        )
    }

    private fun recordFailure(
        baseUrl: String,
        path: String,
        error: Throwable,
    ) {
        onBaseUrlObserved(baseUrl)
        val now = SystemClock.elapsedRealtime()
        val failureCount = consecutiveFailureCount + 1
        consecutiveFailureCount = failureCount

        val cooldownMs =
            when {
                error is ObserverHttpException && error.statusCode == 401 -> COOLDOWN_LONG_MS
                failureCount >= 10 -> COOLDOWN_LONG_MS
                failureCount >= 6 -> COOLDOWN_MEDIUM_MS
                failureCount >= 3 -> COOLDOWN_SHORT_MS
                else -> 0L
            }
        if (cooldownMs > 0L) {
            disabledUntilElapsedMs = maxOf(disabledUntilElapsedMs, now + cooldownMs)
        }

        val fingerprint = "${error::class.java.simpleName}|${error.message}|$path|$failureCount"
        val shouldLog =
            failureCount == 1 ||
                cooldownMs > 0L ||
                fingerprint != lastLoggedFailureFingerprint ||
                now - lastLoggedFailureAtMs >= LOG_THROTTLE_MS
        if (shouldLog) {
            lastLoggedFailureAtMs = now
            lastLoggedFailureFingerprint = fingerprint
            val cooldownSuffix =
                if (cooldownMs > 0L) " • cooldown ${cooldownMs / 1000}s" else ""
            Log.w(
                TAG,
                "Observer request failed on $path (attempt=$failureCount$cooldownSuffix): ${error.message}"
            )
        }
        syncConnectionState(
            baseUrl = baseUrl,
            enabled = true,
            lastFailureAtMs = System.currentTimeMillis(),
            lastErrorMessage = error.message ?: error::class.java.simpleName,
            consecutiveFailureCount = failureCount,
            suspendedUntilEpochMs =
                if (disabledUntilElapsedMs > now) {
                    System.currentTimeMillis() + (disabledUntilElapsedMs - now)
                } else {
                    null
                },
        )
    }

    private fun syncConnectionState(
        baseUrl: String? = LiveObserverConfig.observerBaseUrl,
        enabled: Boolean = !baseUrl.isNullOrBlank(),
        lastSuccessAtMs: Long? = _connectionState.value.lastSuccessAtMs,
        lastFailureAtMs: Long? = _connectionState.value.lastFailureAtMs,
        lastErrorMessage: String? = _connectionState.value.lastErrorMessage,
        consecutiveFailureCount: Int = this.consecutiveFailureCount,
        suspendedUntilEpochMs: Long? = _connectionState.value.suspendedUntilEpochMs,
        resetHistory: Boolean = false,
    ) {
        val pendingCount =
            synchronized(queueLock) {
                pendingEventQueue.size
            }
        val previous = _connectionState.value
        _connectionState.value =
            ObserverTelemetryConnectionState(
                baseUrl = baseUrl,
                enabled = enabled,
                pendingEventCount = pendingCount,
                consecutiveFailureCount = consecutiveFailureCount,
                lastSuccessAtMs = if (resetHistory) null else (lastSuccessAtMs ?: previous.lastSuccessAtMs),
                lastFailureAtMs = if (resetHistory) null else (lastFailureAtMs ?: previous.lastFailureAtMs),
                lastErrorMessage = if (resetHistory) null else (lastErrorMessage ?: previous.lastErrorMessage),
                suspendedUntilEpochMs = suspendedUntilEpochMs?.takeIf { it > System.currentTimeMillis() },
            )
    }

    private fun nowIsoUtc(): String {
        val formatter =
            SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            }
        return formatter.format(Date())
    }

    private class ObserverHttpException(
        val statusCode: Int,
        message: String,
    ) : IllegalStateException(message)

    private class ObserverTemporarilySuspendedException(
        message: String,
    ) : IllegalStateException(message)
}
