package com.pkt.live.data.socket

import android.os.Handler
import android.os.Looper
import android.util.Log
import com.google.gson.Gson
import com.pkt.live.data.model.CourtClusterRuntimeResponse
import com.pkt.live.data.model.CourtStationRuntimeResponse
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject
import java.net.URI
import java.util.LinkedHashSet
import java.util.concurrent.atomic.AtomicBoolean

class CourtRuntimeSocketManager(
    private val socketUrl: String,
    private val gson: Gson,
) {
    companion object {
        private const val TAG = "CourtRuntimeSocket"
        private const val FORCE_RECONNECT_DELAY_MS = 3_000L
    }

    private var socket: Socket? = null
    private var currentToken: String? = null
    private val watchedClusterIds = LinkedHashSet<String>()
    private val watchedStationIds = LinkedHashSet<String>()
    private val handler = Handler(Looper.getMainLooper())
    private val manualDisconnect = AtomicBoolean(false)
    private val reconnectScheduled = AtomicBoolean(false)
    private val reconnectRunnable =
        Runnable {
            reconnectScheduled.set(false)
            val token = currentToken
            if (manualDisconnect.get() || token.isNullOrBlank()) return@Runnable
            if (socket?.connected() == true) return@Runnable
            reconnectInternal(token)
        }

    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected.asStateFlow()

    private val _clusterUpdates =
        MutableSharedFlow<CourtClusterRuntimeResponse>(
            extraBufferCapacity = 8,
            onBufferOverflow = BufferOverflow.DROP_OLDEST,
        )
    val clusterUpdates = _clusterUpdates

    private val _stationUpdates =
        MutableSharedFlow<CourtStationRuntimeResponse>(
            extraBufferCapacity = 16,
            onBufferOverflow = BufferOverflow.DROP_OLDEST,
        )
    val stationUpdates = _stationUpdates

    val errors =
        MutableSharedFlow<String>(
            extraBufferCapacity = 4,
            onBufferOverflow = BufferOverflow.DROP_OLDEST,
        )

    fun connect(token: String) {
        val normalizedToken = token.trim()
        if (normalizedToken.isBlank()) {
            disconnect(resetState = true, markManualDisconnect = true)
            return
        }
        if (socket != null && currentToken == normalizedToken) {
            manualDisconnect.set(false)
            if (socket?.connected() == true) {
                emitCurrentWatchers()
                return
            }
            cancelReconnect()
            reconnectInternal(normalizedToken)
            return
        }
        disconnect(resetState = false, markManualDisconnect = true)
        manualDisconnect.set(false)
        currentToken = normalizedToken
        openSocket(normalizedToken)
    }

    fun disconnect(resetState: Boolean = true, markManualDisconnect: Boolean = true) {
        if (markManualDisconnect) {
            manualDisconnect.set(true)
        }
        cancelReconnect()
        runCatching { socket?.off() }
        watchedClusterIds.forEach { clusterId ->
            runCatching {
                socket?.emit(
                    "court-cluster:unwatch",
                    JSONObject().put("clusterId", clusterId),
                )
            }
        }
        watchedStationIds.forEach { stationId ->
            runCatching {
                socket?.emit(
                    "court-station:unwatch",
                    JSONObject().put("stationId", stationId),
                )
            }
        }
        runCatching { socket?.disconnect() }
        runCatching { socket?.close() }
        socket = null
        _connected.value = false
        if (resetState) {
            currentToken = null
            watchedClusterIds.clear()
            watchedStationIds.clear()
        }
    }

    fun watchCluster(clusterId: String) {
        val normalized = clusterId.trim()
        if (normalized.isBlank()) return
        watchedClusterIds.add(normalized)
        if (socket?.connected() == true) {
            runCatching {
                socket?.emit(
                    "court-cluster:watch",
                    JSONObject().put("clusterId", normalized),
                )
            }
        }
    }

    fun unwatchCluster(clusterId: String) {
        val normalized = clusterId.trim()
        if (normalized.isBlank()) return
        watchedClusterIds.remove(normalized)
        if (socket?.connected() == true) {
            runCatching {
                socket?.emit(
                    "court-cluster:unwatch",
                    JSONObject().put("clusterId", normalized),
                )
            }
        }
    }

    fun watchStation(stationId: String) {
        val normalized = stationId.trim()
        if (normalized.isBlank()) return
        watchedStationIds.add(normalized)
        if (socket?.connected() == true) {
            runCatching {
                socket?.emit(
                    "court-station:watch",
                    JSONObject().put("stationId", normalized),
                )
            }
        }
    }

    fun unwatchStation(stationId: String) {
        val normalized = stationId.trim()
        if (normalized.isBlank()) return
        watchedStationIds.remove(normalized)
        if (socket?.connected() == true) {
            runCatching {
                socket?.emit(
                    "court-station:unwatch",
                    JSONObject().put("stationId", normalized),
                )
            }
        }
    }

    private fun openSocket(token: String) {
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
                        emitCurrentWatchers()
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
                        errors.tryEmit("Court runtime socket error: $err")
                        if (!manualDisconnect.get()) {
                            scheduleReconnect("connect_error")
                        }
                    }

                    on("court-cluster:update") { args ->
                        parseClusterUpdate(args.firstOrNull())
                    }

                    on("court-station:update") { args ->
                        parseStationUpdate(args.firstOrNull())
                    }

                    connect()
                }
        } catch (e: Exception) {
            Log.e(TAG, "Socket init failed", e)
            _connected.value = false
            errors.tryEmit("Court runtime socket init: ${e.message}")
            if (!manualDisconnect.get()) {
                scheduleReconnect("init_failed")
            }
        }
    }

    private fun emitCurrentWatchers() {
        watchedClusterIds.forEach { clusterId ->
            runCatching {
                socket?.emit(
                    "court-cluster:watch",
                    JSONObject().put("clusterId", clusterId),
                )
            }
        }
        watchedStationIds.forEach { stationId ->
            runCatching {
                socket?.emit(
                    "court-station:watch",
                    JSONObject().put("stationId", stationId),
                )
            }
        }
    }

    private fun parseClusterUpdate(payload: Any?) {
        val raw =
            when (payload) {
                is JSONObject -> payload.toString()
                is String -> payload
                else -> return
            }
        runCatching {
            gson.fromJson(raw, CourtClusterRuntimeResponse::class.java)
        }.onSuccess { snapshot ->
            if (snapshot.cluster?.id.isNullOrBlank()) return@onSuccess
            _clusterUpdates.tryEmit(snapshot)
        }.onFailure {
            Log.e(TAG, "Failed to parse cluster update", it)
        }
    }

    private fun parseStationUpdate(payload: Any?) {
        val raw =
            when (payload) {
                is JSONObject -> payload.toString()
                is String -> payload
                else -> return
            }
        runCatching {
            gson.fromJson(raw, CourtStationRuntimeResponse::class.java)
        }.onSuccess { snapshot ->
            if (snapshot.station?.id.isNullOrBlank()) return@onSuccess
            _stationUpdates.tryEmit(snapshot)
        }.onFailure {
            Log.e(TAG, "Failed to parse station update", it)
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

    private fun reconnectInternal(token: String) {
        Log.d(TAG, "Forced reconnect")
        disconnect(resetState = false, markManualDisconnect = false)
        openSocket(token)
    }
}
