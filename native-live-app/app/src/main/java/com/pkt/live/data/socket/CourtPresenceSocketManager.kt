package com.pkt.live.data.socket

import android.os.Handler
import android.os.Looper
import android.util.Log
import com.google.gson.Gson
import com.pkt.live.data.model.CourtLiveScreenPresence
import com.pkt.live.data.model.CourtLiveWatchSnapshot
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject
import java.net.URI
import java.util.concurrent.atomic.AtomicBoolean

class CourtPresenceSocketManager(
    private val socketUrl: String,
    private val gson: Gson,
) {
    companion object {
        private const val TAG = "CourtPresenceSocket"
        private const val FORCE_RECONNECT_DELAY_MS = 3_000L
    }

    private var socket: Socket? = null
    private var currentToken: String? = null
    private var currentTournamentId: String? = null
    private val handler = Handler(Looper.getMainLooper())
    private val manualDisconnect = AtomicBoolean(false)
    private val reconnectScheduled = AtomicBoolean(false)
    private val reconnectRunnable =
        Runnable {
            reconnectScheduled.set(false)
            val token = currentToken
            val tournamentId = currentTournamentId
            if (manualDisconnect.get() || token.isNullOrBlank() || tournamentId.isNullOrBlank()) return@Runnable
            if (socket?.connected() == true) return@Runnable
            reconnectInternal(token, tournamentId)
        }

    private val _presenceByCourtId =
        MutableStateFlow<Map<String, CourtLiveScreenPresence>>(emptyMap())
    val presenceByCourtId: StateFlow<Map<String, CourtLiveScreenPresence>> =
        _presenceByCourtId.asStateFlow()

    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected.asStateFlow()

    val errors =
        MutableSharedFlow<String>(
            extraBufferCapacity = 4,
            onBufferOverflow = BufferOverflow.DROP_OLDEST,
        )

    fun connect(token: String, tournamentId: String) {
        disconnect(resetState = true, markManualDisconnect = true)
        manualDisconnect.set(false)
        currentToken = token
        currentTournamentId = tournamentId
        openSocket(token, tournamentId)
    }

    fun disconnect(resetState: Boolean = true, markManualDisconnect: Boolean = true) {
        if (markManualDisconnect) {
            manualDisconnect.set(true)
        }
        cancelReconnect()
        runCatching { socket?.off() }
        runCatching {
            socket?.emit(
                "court-live:unwatch",
                JSONObject().put("tournamentId", currentTournamentId.orEmpty())
            )
        }
        runCatching { socket?.disconnect() }
        runCatching { socket?.close() }
        socket = null
        _connected.value = false
        if (resetState) {
            currentToken = null
            currentTournamentId = null
            _presenceByCourtId.value = emptyMap()
        }
    }

    private fun openSocket(token: String, tournamentId: String) {
        try {
            val opts =
                IO.Options().apply {
                    forceNew = true
                    reconnection = true
                    reconnectionAttempts = Int.MAX_VALUE
                    reconnectionDelay = 2_000
                    reconnectionDelayMax = 10_000
                    timeout = 20_000
                    path = "/socket.io"
                    transports = arrayOf("websocket")
                    auth =
                        mapOf(
                            "token" to token,
                            "authorization" to "Bearer $token",
                        )
                    extraHeaders =
                        mapOf(
                            "Authorization" to listOf("Bearer $token"),
                        )
                }

            socket =
                IO.socket(URI.create(socketUrl), opts).apply {
                    on(Socket.EVENT_CONNECT) {
                        Log.d(TAG, "Connected")
                        cancelReconnect()
                        manualDisconnect.set(false)
                        _connected.value = true
                        emit(
                            "court-live:watch",
                            JSONObject().put("tournamentId", tournamentId)
                        )
                    }

                    on(Socket.EVENT_DISCONNECT) { args ->
                        val reason = args.firstOrNull()?.toString().orEmpty()
                        Log.d(TAG, "Disconnected: $reason")
                        _connected.value = false
                        if (!manualDisconnect.get()) {
                            scheduleReconnect("disconnect:$reason")
                        }
                    }

                    on(Socket.EVENT_CONNECT_ERROR) { args ->
                        val err = args.firstOrNull()?.toString() ?: "Unknown"
                        Log.e(TAG, "Connect error: $err")
                        _connected.value = false
                        errors.tryEmit("Court live socket error: $err")
                        if (!manualDisconnect.get()) {
                            scheduleReconnect("connect_error")
                        }
                    }

                    on("court-live:update") { args ->
                        parseSnapshot(args.firstOrNull(), tournamentId)
                    }

                    connect()
                }
        } catch (e: Exception) {
            Log.e(TAG, "Socket init failed", e)
            _connected.value = false
            errors.tryEmit("Court live socket init: ${e.message}")
            if (!manualDisconnect.get()) {
                scheduleReconnect("init_failed")
            }
        }
    }

    private fun parseSnapshot(payload: Any?, expectedTournamentId: String) {
        val raw =
            when (payload) {
                is JSONObject -> payload.toString()
                is String -> payload
                else -> return
            }
        runCatching {
            gson.fromJson(raw, CourtLiveWatchSnapshot::class.java)
        }.onSuccess { snapshot ->
            if (snapshot.tournamentId.isBlank() || snapshot.tournamentId != expectedTournamentId) return@onSuccess
            _presenceByCourtId.value =
                snapshot.courts
                    .mapNotNull { item ->
                        val courtId = item.courtId.trim()
                        if (courtId.isBlank()) return@mapNotNull null
                        courtId to (item.liveScreenPresence ?: CourtLiveScreenPresence())
                    }
                    .toMap()
        }.onFailure {
            Log.e(TAG, "Failed to parse court live snapshot", it)
        }
    }

    private fun scheduleReconnect(reason: String) {
        if (reconnectScheduled.getAndSet(true)) return
        Log.d(TAG, "Scheduling forced reconnect in ${FORCE_RECONNECT_DELAY_MS}ms ($reason)")
        handler.removeCallbacks(reconnectRunnable)
        handler.postDelayed(reconnectRunnable, FORCE_RECONNECT_DELAY_MS)
    }

    private fun cancelReconnect() {
        reconnectScheduled.set(false)
        handler.removeCallbacks(reconnectRunnable)
    }

    private fun reconnectInternal(token: String, tournamentId: String) {
        Log.d(TAG, "Forced reconnect")
        disconnect(resetState = false, markManualDisconnect = false)
        openSocket(token, tournamentId)
    }
}
