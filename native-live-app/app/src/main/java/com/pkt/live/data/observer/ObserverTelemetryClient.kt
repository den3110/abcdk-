package com.pkt.live.data.observer

import android.util.Log
import com.google.gson.Gson
import com.pkt.live.BuildConfig
import com.pkt.live.data.api.AuthInterceptor
import com.pkt.live.data.model.LiveDeviceEventRequest
import com.pkt.live.data.model.LiveDeviceHeartbeatRequest
import com.pkt.live.data.model.ObserverIngestResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

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
        return if (trimmed.endsWith("/")) trimmed else "$trimmed/"
    }
}

class ObserverTelemetryClient(
    private val okHttpClient: OkHttpClient,
    private val gson: Gson,
    private val authInterceptor: AuthInterceptor,
) {
    companion object {
        private const val TAG = "ObserverTelemetry"
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
    }

    val isEnabled: Boolean
        get() = !LiveObserverConfig.observerBaseUrl.isNullOrBlank()

    suspend fun sendDeviceHeartbeat(
        body: LiveDeviceHeartbeatRequest,
    ): Result<ObserverIngestResponse> =
        post(
            path = "api/observer/ingest/live-devices/heartbeat",
            body = body,
            responseType = ObserverIngestResponse::class.java,
        )

    suspend fun sendDeviceEvent(
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
        val baseUrl = LiveObserverConfig.observerBaseUrl
            ?: return@withContext Result.failure(IllegalStateException("Observer VPS chưa được cấu hình."))
        val url = baseUrl.toHttpUrlOrNull()?.resolve(path)
            ?: return@withContext Result.failure(IllegalStateException("URL observer VPS không hợp lệ."))
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
                    throw IllegalStateException("Phiên đăng nhập không còn hợp lệ để gửi observer telemetry.")
                }
                if (!response.isSuccessful) {
                    throw IllegalStateException(parseObserverErrorMessage(raw, response.code))
                }
                if (raw.isBlank()) {
                    throw IllegalStateException("Observer VPS trả về phản hồi rỗng.")
                }
                gson.fromJson(raw, responseType)
                    ?: throw IllegalStateException("Observer VPS trả dữ liệu không hợp lệ.")
            }
        }.onFailure {
            Log.w(TAG, "Observer request failed on $path: ${it.message}")
        }
    }

    private fun parseObserverErrorMessage(raw: String, statusCode: Int): String {
        if (raw.isBlank()) {
            return "Observer VPS trả lỗi $statusCode."
        }
        return runCatching {
            val payload = gson.fromJson(raw, Map::class.java)
            sequenceOf(
                payload["message"] as? String,
                payload["error"] as? String,
                payload["reason"] as? String,
            ).firstOrNull { !it.isNullOrBlank() }
        }.getOrNull() ?: "Observer VPS trả lỗi $statusCode."
    }
}
