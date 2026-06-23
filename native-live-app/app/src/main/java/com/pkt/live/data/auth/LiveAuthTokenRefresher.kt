package com.pkt.live.data.auth

import android.util.Log
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.pkt.live.BuildConfig
import com.pkt.live.data.api.AuthInterceptor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

class LiveAuthTokenRefresher(
    private val tokenStore: TokenStore,
    private val authInterceptor: AuthInterceptor,
    private val gson: Gson,
) {
    companion object {
        private const val TAG = "LiveAuthRefresh"
    }

    private val refreshMutex = Mutex()
    private val refreshClient =
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .writeTimeout(15, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()

    private val _tokenUpdates =
        MutableSharedFlow<AuthSession>(
            replay = 0,
            extraBufferCapacity = 4,
        )
    val tokenUpdates: SharedFlow<AuthSession> = _tokenUpdates.asSharedFlow()

    suspend fun refreshIfNeeded(
        staleAccessToken: String? = null,
        reason: String = "auth_401",
    ): Result<AuthSession> =
        refreshMutex.withLock {
            val current = tokenStore.getSessionOrNull()
                ?: return@withLock Result.failure(IllegalStateException("Không có phiên đăng nhập để refresh token."))
            val stale = staleAccessToken?.trim().orEmpty()
            if (stale.isNotBlank() && current.accessToken.trim() != stale) {
                authInterceptor.token = current.accessToken
                return@withLock Result.success(current)
            }

            val refreshToken = current.refreshToken?.trim().orEmpty()
            if (refreshToken.isBlank()) {
                return@withLock Result.failure(IllegalStateException("Phiên đăng nhập không có refresh token."))
            }

            val refreshed =
                withContext(Dispatchers.IO) {
                    requestRefreshToken(current, refreshToken, reason)
                }.getOrElse { error ->
                    return@withLock Result.failure(error)
                }

            tokenStore.saveSession(refreshed)
            authInterceptor.token = refreshed.accessToken
            _tokenUpdates.tryEmit(refreshed)
            Result.success(refreshed)
        }

    suspend fun upgradeLegacySessionIfNeeded(
        reason: String = "legacy_session_upgrade",
    ): Result<AuthSession> =
        refreshMutex.withLock {
            val current = tokenStore.getSessionOrNull()
                ?: return@withLock Result.failure(IllegalStateException("No saved auth session to upgrade."))
            if (!current.refreshToken.isNullOrBlank()) {
                return@withLock Result.success(current)
            }

            val accessToken = current.accessToken.trim()
            if (accessToken.isBlank()) {
                return@withLock Result.failure(IllegalStateException("Saved auth session has no access token."))
            }

            val upgraded =
                withContext(Dispatchers.IO) {
                    requestLiveSessionUpgrade(current, accessToken, reason)
                }.getOrElse { error ->
                    return@withLock Result.failure(error)
                }

            tokenStore.saveSession(upgraded)
            authInterceptor.token = upgraded.accessToken
            _tokenUpdates.tryEmit(upgraded)
            Result.success(upgraded)
        }

    fun refreshBlocking(staleAccessToken: String?): AuthSession? =
        runBlocking {
            refreshIfNeeded(staleAccessToken = staleAccessToken, reason = "okhttp_authenticator")
                .getOrNull()
        }

    private fun requestRefreshToken(
        current: AuthSession,
        refreshToken: String,
        reason: String,
    ): Result<AuthSession> {
        val body =
            FormBody.Builder()
                .add("grant_type", "refresh_token")
                .add("client_id", BuildConfig.OAUTH_CLIENT_ID)
                .add("refresh_token", refreshToken)
                .build()
        val request =
            Request.Builder()
                .url(BuildConfig.OAUTH_TOKEN_ENDPOINT)
                .header("Accept", "application/json")
                .post(body)
                .build()

        return try {
            refreshClient.newCall(request).execute().use { response ->
                val raw = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    Log.w(TAG, "Refresh token failed (${response.code}) reason=$reason body=${raw.take(180)}")
                    return Result.failure(IllegalStateException("Refresh token thất bại (${response.code})."))
                }

                val json = gson.fromJson(raw, JsonObject::class.java)
                val accessToken = json.get("access_token")?.asString?.trim().orEmpty()
                if (accessToken.isBlank()) {
                    return Result.failure(IllegalStateException("Server không trả access token mới."))
                }
                val nextRefreshToken =
                    json.get("refresh_token")?.asString?.trim()?.takeIf { it.isNotBlank() }
                        ?: refreshToken
                val nextIdToken =
                    json.get("id_token")?.asString?.trim()?.takeIf { it.isNotBlank() }
                        ?: current.idToken

                Log.i(TAG, "Live auth token refreshed reason=$reason")
                Result.success(
                    current.copy(
                        accessToken = accessToken,
                        refreshToken = nextRefreshToken,
                        idToken = nextIdToken,
                    )
                )
            }
        } catch (e: Exception) {
            Log.e(TAG, "Refresh token error", e)
            Result.failure(e)
        }
    }

    private fun requestLiveSessionUpgrade(
        current: AuthSession,
        accessToken: String,
        reason: String,
    ): Result<AuthSession> {
        val body =
            FormBody.Builder()
                .add("grant_type", "urn:pickletour:grant-type:live-session")
                .add("client_id", BuildConfig.OAUTH_CLIENT_ID)
                .build()
        val request =
            Request.Builder()
                .url(BuildConfig.OAUTH_TOKEN_ENDPOINT)
                .header("Accept", "application/json")
                .header("Authorization", "Bearer $accessToken")
                .post(body)
                .build()

        return try {
            refreshClient.newCall(request).execute().use { response ->
                val raw = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    Log.w(TAG, "Legacy session upgrade failed (${response.code}) reason=$reason body=${raw.take(180)}")
                    return Result.failure(IllegalStateException("Legacy auth session upgrade failed (${response.code})."))
                }

                val json = gson.fromJson(raw, JsonObject::class.java)
                val nextAccessToken = json.get("access_token")?.asString?.trim().orEmpty()
                val nextRefreshToken = json.get("refresh_token")?.asString?.trim().orEmpty()
                if (nextAccessToken.isBlank() || nextRefreshToken.isBlank()) {
                    return Result.failure(IllegalStateException("Server did not return upgraded live auth tokens."))
                }
                val nextIdToken =
                    json.get("id_token")?.asString?.trim()?.takeIf { it.isNotBlank() }
                        ?: current.idToken

                Log.i(TAG, "Legacy live auth session upgraded reason=$reason")
                Result.success(
                    current.copy(
                        accessToken = nextAccessToken,
                        refreshToken = nextRefreshToken,
                        idToken = nextIdToken,
                    )
                )
            }
        } catch (e: Exception) {
            Log.e(TAG, "Legacy session upgrade error", e)
            Result.failure(e)
        }
    }
}
