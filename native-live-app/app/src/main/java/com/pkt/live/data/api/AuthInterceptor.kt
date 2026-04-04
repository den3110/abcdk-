package com.pkt.live.data.api

import android.util.Log
import com.google.firebase.crashlytics.FirebaseCrashlytics
import com.pkt.live.BuildConfig
import okhttp3.Interceptor
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Response

/**
 * OkHttp interceptor that adds Bearer token to all requests.
 * Token is set once from deeplink params and reused for the session.
 *
 * Fix #5: Also detects 401 responses and logs to Crashlytics
 * for token expiry tracking during long live sessions.
 */
class AuthInterceptor : Interceptor {

    companion object {
        private const val TAG = "AuthInterceptor"
    }

    @Volatile
    var token: String? = null

    private val apiBaseUrl = BuildConfig.BASE_URL.toHttpUrlOrNull()

    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        val t = token
        if (t.isNullOrBlank()) return chain.proceed(original)
        if (original.header("Authorization") != null) return chain.proceed(original)

        val apiUrl = apiBaseUrl
        if (apiUrl != null) {
            val requestUrl = original.url
            val sameApiOrigin =
                requestUrl.scheme == apiUrl.scheme &&
                    requestUrl.host == apiUrl.host &&
                    requestUrl.port == apiUrl.port
            if (!sameApiOrigin) {
                return chain.proceed(original)
            }
        }

        val authed = original.newBuilder()
            .header("Authorization", "Bearer $t")
            .build()
        val response = chain.proceed(authed)

        // Fix #5: Detect and log token expiry (401) for Crashlytics tracking
        if (response.code == 401) {
            val path = original.url.encodedPath
            Log.w(TAG, "Token expired (401) on $path")
            runCatching {
                FirebaseCrashlytics.getInstance().apply {
                    log("AUTH_401: Token expired on $path")
                    setCustomKey("last_401_path", path)
                    setCustomKey("last_401_at_ms", System.currentTimeMillis().toString())
                    recordException(
                        IllegalStateException("Token expired during live session: $path")
                    )
                }
            }
        }

        return response
    }
}
