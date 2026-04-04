package com.pkt.live.data.api

import android.util.Log
import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException

/**
 * OkHttp Retry Interceptor with exponential backoff.
 *
 * Anti-crash: Prevents crash from transient network errors during
 * live streaming API calls. Retries failed requests up to [maxRetries]
 * times with increasing delay.
 *
 * This handles app-level retries (HTTP 500/502/503/504 errors),
 * while OkHttp's built-in retryOnConnectionFailure handles connection-level retries.
 */
class RetryInterceptor(
    private val maxRetries: Int = 3,
    private val initialDelayMs: Long = 1000,
) : Interceptor {

    companion object {
        private const val TAG = "RetryInterceptor"
    }

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        var lastException: IOException? = null
        var response: Response? = null

        for (attempt in 0..maxRetries) {
            try {
                // Close previous response before retrying
                response?.close()

                response = chain.proceed(request)

                // Success or client error (4xx) — don't retry
                if (response.isSuccessful || response.code in 400..499) {
                    return response
                }

                // Server error (5xx) — retry
                if (response.code in 500..599 && attempt < maxRetries) {
                    val delay = initialDelayMs * (1L shl attempt) // Exponential backoff
                    Log.w(TAG, "Server error ${response.code} on ${request.url} — retry ${attempt + 1}/$maxRetries in ${delay}ms")
                    response.close()
                    Thread.sleep(delay)
                    continue
                }

                return response
            } catch (e: IOException) {
                lastException = e
                if (attempt < maxRetries) {
                    val delay = initialDelayMs * (1L shl attempt)
                    Log.w(TAG, "IOException on ${request.url} — retry ${attempt + 1}/$maxRetries in ${delay}ms: ${e.message}")
                    try {
                        Thread.sleep(delay)
                    } catch (_: InterruptedException) {
                        Thread.currentThread().interrupt()
                        throw e
                    }
                }
            }
        }

        // All retries exhausted
        throw lastException ?: IOException("Retry exhausted for ${request.url}")
    }
}
