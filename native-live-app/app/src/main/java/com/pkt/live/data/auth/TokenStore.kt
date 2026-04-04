package com.pkt.live.data.auth

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.KeyStore
import java.util.concurrent.atomic.AtomicReference

data class AuthSession(
    val accessToken: String,
    val refreshToken: String? = null,
    val idToken: String? = null,
    val userId: String? = null,
    val displayName: String? = null,
)

class TokenStore(
    context: Context,
) {
    companion object {
        private const val TAG = "TokenStore"
        private const val FILE_NAME = "auth_store"
        private const val KEY_ACCESS_TOKEN = "access_token"
        private const val KEY_REFRESH_TOKEN = "refresh_token"
        private const val KEY_ID_TOKEN = "id_token"
        private const val KEY_USER_ID = "user_id"
        private const val KEY_DISPLAY_NAME = "display_name"
    }

    private val appContext = context.applicationContext
    private val memorySession = AtomicReference<AuthSession?>(null)

    private fun createPrefs(): SharedPreferences {
        val masterKey = MasterKey.Builder(appContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            appContext,
            FILE_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    private fun repairBrokenStore() {
        runCatching {
            appContext.deleteSharedPreferences(FILE_NAME)
        }.onFailure {
            Log.w(TAG, "deleteSharedPreferences failed during repair", it)
        }
        runCatching {
            val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            if (keyStore.containsAlias(MasterKey.DEFAULT_MASTER_KEY_ALIAS)) {
                keyStore.deleteEntry(MasterKey.DEFAULT_MASTER_KEY_ALIAS)
            }
        }.onFailure {
            Log.w(TAG, "Master key repair failed", it)
        }
    }

    private fun prefsOrNull(allowRepair: Boolean = true): SharedPreferences? {
        return runCatching { createPrefs() }
            .onFailure { error ->
                Log.e(TAG, "Encrypted prefs open failed", error)
            }
            .getOrElse {
                if (!allowRepair) return null
                repairBrokenStore()
                runCatching { createPrefs() }
                    .onFailure { retryError ->
                        Log.e(TAG, "Encrypted prefs reopen failed after repair", retryError)
                    }
                    .getOrNull()
            }
    }

    private fun readSessionFromPrefs(prefs: SharedPreferences): AuthSession? {
        val accessToken = prefs.getString(KEY_ACCESS_TOKEN, null)?.trim().orEmpty()
        if (accessToken.isBlank()) return null
        return AuthSession(
            accessToken = accessToken,
            refreshToken = prefs.getString(KEY_REFRESH_TOKEN, null),
            idToken = prefs.getString(KEY_ID_TOKEN, null),
            userId = prefs.getString(KEY_USER_ID, null),
            displayName = prefs.getString(KEY_DISPLAY_NAME, null),
        )
    }

    fun getSessionOrNull(): AuthSession? {
        memorySession.get()?.takeIf { it.accessToken.isNotBlank() }?.let { return it }
        val prefs = prefsOrNull() ?: return null
        val session =
            runCatching { readSessionFromPrefs(prefs) }
                .onFailure { error ->
                    Log.e(TAG, "Read session failed", error)
                }
                .getOrNull()
        memorySession.set(session)
        return session
    }

    fun saveSession(session: AuthSession) {
        val normalized =
            session.copy(
                accessToken = session.accessToken.trim(),
                refreshToken = session.refreshToken?.trim(),
                idToken = session.idToken?.trim(),
                userId = session.userId?.trim(),
                displayName = session.displayName?.trim(),
            )
        memorySession.set(normalized)
        val prefs = prefsOrNull() ?: return
        runCatching {
            prefs.edit()
                .putString(KEY_ACCESS_TOKEN, normalized.accessToken)
                .putString(KEY_REFRESH_TOKEN, normalized.refreshToken)
                .putString(KEY_ID_TOKEN, normalized.idToken)
                .putString(KEY_USER_ID, normalized.userId)
                .putString(KEY_DISPLAY_NAME, normalized.displayName)
                .apply()
        }.onFailure {
            Log.e(TAG, "Persist session failed softly", it)
        }
    }

    fun updateUser(displayName: String?, userId: String?) {
        memorySession.updateAndGet { current ->
            current?.copy(
                displayName = displayName?.trim(),
                userId = userId?.trim(),
            )
        }
        val prefs = prefsOrNull() ?: return
        runCatching {
            prefs.edit()
                .putString(KEY_DISPLAY_NAME, displayName?.trim())
                .putString(KEY_USER_ID, userId?.trim())
                .apply()
        }.onFailure {
            Log.e(TAG, "Persist user metadata failed softly", it)
        }
    }

    fun clear() {
        memorySession.set(null)
        val prefs = prefsOrNull(allowRepair = false)
        if (prefs != null) {
            runCatching { prefs.edit().clear().apply() }
                .onFailure {
                    Log.e(TAG, "Clear session failed softly", it)
                }
        } else {
            repairBrokenStore()
        }
    }
}
