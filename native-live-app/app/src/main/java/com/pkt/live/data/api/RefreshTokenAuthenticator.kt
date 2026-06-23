package com.pkt.live.data.api

import com.pkt.live.data.auth.LiveAuthTokenRefresher
import okhttp3.Authenticator
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route

class RefreshTokenAuthenticator(
    private val authInterceptor: AuthInterceptor,
    private val tokenRefresher: LiveAuthTokenRefresher,
) : Authenticator {

    override fun authenticate(route: Route?, response: Response): Request? {
        if (responseCount(response) >= 2) return null
        val staleToken =
            response.request.header("Authorization")
                ?.removePrefix("Bearer")
                ?.trim()
                ?.takeIf { it.isNotBlank() }
                ?: authInterceptor.token?.trim()
        val refreshed = tokenRefresher.refreshBlocking(staleToken) ?: return null
        val nextToken = refreshed.accessToken.trim()
        if (nextToken.isBlank() || nextToken == staleToken) return null
        return response.request.newBuilder()
            .header("Authorization", "Bearer $nextToken")
            .build()
    }

    private fun responseCount(response: Response): Int {
        var count = 1
        var prior = response.priorResponse
        while (prior != null) {
            count++
            prior = prior.priorResponse
        }
        return count
    }
}
