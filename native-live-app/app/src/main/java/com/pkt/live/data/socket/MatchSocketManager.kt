package com.pkt.live.data.socket

import android.util.Log
import android.os.Handler
import android.os.HandlerThread
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.pkt.live.data.model.OverlayData
import com.pkt.live.data.model.SetScore
import com.pkt.live.util.hasMatchIdentityData
import com.pkt.live.util.isLightweightMatchPayload
import com.pkt.live.util.resolveSideDisplayName
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject
import java.net.URI
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/**
 * Socket.IO manager for real-time score updates.
 *
 * Anti-crash design:
 * - Conflated StateFlow for overlay data (no flooding)
 * - Auto-reconnect handled by socket.io-client
 * - Thread-safe state updates
 * - Lifecycle-aware connect/disconnect
 */
class MatchSocketManager(
    private val socketUrl: String,
    private val gson: Gson,
) {
    companion object {
        private const val TAG = "MatchSocket"
        private const val UPDATE_INTERVAL_MS = 50L
        private const val FORCE_RECONNECT_DELAY_MS = 3_000L
        private const val SNAPSHOT_KEEPALIVE_INTERVAL_MS = 15_000L
        private const val SNAPSHOT_STALE_AFTER_MS = 12_000L
        private val JOIN_BOOTSTRAP_BURST_DELAYS_MS = listOf(250L, 900L, 1_800L)
    }

    private var socket: Socket? = null
    private var currentToken: String? = null
    private var currentMatchId: String? = null
    private var joinedMatchId: String? = null

    private val _overlayData = MutableStateFlow(OverlayData())
    val overlayData: StateFlow<OverlayData> = _overlayData.asStateFlow()

    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected.asStateFlow()
    private val _matchStatus = MutableStateFlow<String?>(null)
    val matchStatus: StateFlow<String?> = _matchStatus.asStateFlow()
    private val _activeMatchId = MutableStateFlow<String?>(null)
    val activeMatchId: StateFlow<String?> = _activeMatchId.asStateFlow()
    private val _lastPayloadAtMs = MutableStateFlow(0L)
    val lastPayloadAtMs: StateFlow<Long> = _lastPayloadAtMs.asStateFlow()

    val errors = MutableSharedFlow<String>(
        extraBufferCapacity = 5,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )

    private val parseThread = HandlerThread("SocketParse").also { it.start() }
    private val parseHandler = Handler(parseThread.looper)
    private val pendingJson = AtomicReference<String?>(null)
    private val parseScheduled = AtomicBoolean(false)
    private val lastAppliedVersion = AtomicLong(-1L)
    private val lastAppliedUpdatedAtMs = AtomicLong(0L)
    private val lastSnapshotRequestAtMs = AtomicLong(0L)
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
    private val snapshotKeepAliveScheduled = AtomicBoolean(false)
    private val snapshotKeepAliveRunnable =
        object : Runnable {
            override fun run() {
                if (!snapshotKeepAliveScheduled.get()) return
                val targetMatchId = currentMatchId?.takeIf { it.isNotBlank() }
                val activeSocket = socket
                if (
                    !targetMatchId.isNullOrBlank() &&
                    activeSocket?.connected() == true &&
                    !manualDisconnect.get()
                ) {
                    val roomReady =
                        joinedMatchId == targetMatchId && _activeMatchId.value == targetMatchId
                    if (roomReady) {
                        val lastPayloadAtMs = _lastPayloadAtMs.value
                        val payloadFresh =
                            lastPayloadAtMs > 0L &&
                                System.currentTimeMillis() - lastPayloadAtMs < SNAPSHOT_STALE_AFTER_MS
                        if (!payloadFresh) {
                            requestSnapshotForCurrentMatch(
                                minIntervalMs = 0L,
                                reason = "keepalive_ping",
                            )
                        }
                    } else {
                        syncRoomSubscription(forceSnapshot = true)
                    }
                }
                if (snapshotKeepAliveScheduled.get()) {
                    parseHandler.postDelayed(this, SNAPSHOT_KEEPALIVE_INTERVAL_MS)
                }
            }
        }

    fun connect(token: String) {
        val normalizedToken = token.trim()
        if (normalizedToken.isBlank()) {
            disconnect()
            return
        }
        if (socket != null && currentToken == normalizedToken) {
            manualDisconnect.set(false)
            if (socket?.connected() == true) {
                return
            }
            cancelReconnectSchedule()
            reconnectInternal(normalizedToken)
            return
        }
        disconnectInternal(clearSessionState = true, resetOverlayState = false, markManualDisconnect = true)
        manualDisconnect.set(false)
        currentToken = normalizedToken
        openSocket(normalizedToken)
    }

    fun joinMatch(matchId: String) {
        val targetMatchId = matchId.trim()
        if (targetMatchId.isBlank()) return
        val changed = currentMatchId != targetMatchId
        currentMatchId = targetMatchId
        _activeMatchId.value = joinedMatchId?.takeIf { it == targetMatchId }
        if (changed) {
            pendingJson.set(null)
            parseScheduled.set(false)
            parseHandler.removeCallbacksAndMessages(null)
            snapshotKeepAliveScheduled.set(false)
            _lastPayloadAtMs.value = 0L
            _matchStatus.value = null
            joinedMatchId = null
            _activeMatchId.value = null
            lastAppliedVersion.set(-1L)
            lastAppliedUpdatedAtMs.set(0L)
            lastSnapshotRequestAtMs.set(0L)
            resetOverlayData()
        }
        scheduleBootstrapSnapshotBurst(targetMatchId, reason = "join_requested")
        val token = currentToken
        when {
            socket?.connected() == true -> syncRoomSubscription(forceSnapshot = true)
            !token.isNullOrBlank() -> {
                manualDisconnect.set(false)
                openSocket(token)
            }
            else -> errors.tryEmit("Socket chưa có token để join trận.")
        }
    }

    fun leaveMatch(resetOverlayState: Boolean = true) {
        val previousJoinedMatchId = joinedMatchId
        currentMatchId = null
        joinedMatchId = null
        _activeMatchId.value = null
        _lastPayloadAtMs.value = 0L
        _matchStatus.value = null
        lastAppliedVersion.set(-1L)
        lastAppliedUpdatedAtMs.set(0L)
        lastSnapshotRequestAtMs.set(0L)
        pendingJson.set(null)
        parseScheduled.set(false)
        parseHandler.removeCallbacksAndMessages(null)
        stopSnapshotKeepAlive()
        if (resetOverlayState) {
            resetOverlayData()
        }
        runCatching {
            if (!previousJoinedMatchId.isNullOrBlank() && socket?.connected() == true) {
                socket?.emit("match:leave", JSONObject().put("matchId", previousJoinedMatchId))
            }
        }.onFailure {
            Log.e(TAG, "Leave match room failed", it)
        }
    }

    private fun openSocket(token: String) {
        try {
            val opts = IO.Options().apply {
                forceNew = true
                reconnection = true
                reconnectionAttempts = Int.MAX_VALUE
                reconnectionDelay = 2000
                reconnectionDelayMax = 10000
                timeout = 20000
                path = "/socket.io"
                transports = arrayOf("websocket")
                auth = mapOf(
                    "token" to token,
                    "authorization" to "Bearer $token",
                )
                extraHeaders = mapOf(
                    "Authorization" to listOf("Bearer $token"),
                )
            }

            socket = IO.socket(URI.create(socketUrl), opts).apply {
                on(Socket.EVENT_CONNECT) {
                    Log.d(TAG, "Connected")
                    cancelReconnectSchedule()
                    manualDisconnect.set(false)
                    _connected.value = true
                    syncRoomSubscription(forceSnapshot = true)
                }

                on(Socket.EVENT_DISCONNECT) { args ->
                    val reason = args.firstOrNull()?.toString().orEmpty()
                    Log.d(TAG, "Disconnected: $reason")
                    _connected.value = false
                    joinedMatchId = null
                    _activeMatchId.value = null
                    if (!manualDisconnect.get()) {
                        scheduleReconnect("disconnect:$reason")
                    }
                }

                on(Socket.EVENT_CONNECT_ERROR) { args ->
                    val err = args.firstOrNull()?.toString() ?: "Unknown"
                    Log.e(TAG, "Connect error: $err")
                    _connected.value = false
                    _activeMatchId.value = null
                    errors.tryEmit("Socket error: $err")
                    if (!manualDisconnect.get()) {
                        scheduleReconnect("connect_error")
                    }
                }

                on("match:joined") { args ->
                    try {
                        val raw = args.firstOrNull() ?: return@on
                        val obj =
                            when (raw) {
                                is JSONObject -> raw
                                else -> JSONObject(raw.toString())
                            }
                        val ackMatchId = obj.optString("matchId").trim()
                        val expectedMatchId = currentMatchId?.trim().orEmpty()
                        if (ackMatchId.isBlank() || ackMatchId != expectedMatchId) return@on
                        joinedMatchId = ackMatchId
                        _activeMatchId.value = ackMatchId
                        requestSnapshotForCurrentMatch(
                            minIntervalMs = 0L,
                            reason = "join_ack",
                        )
                        scheduleBootstrapSnapshotBurst(ackMatchId, reason = "join_ack")
                    } catch (e: Exception) {
                        Log.e(TAG, "match:joined parse failed", e)
                    }
                }

                // Full snapshot on join
                on("match:snapshot") { args ->
                    enqueueParse(args)
                }

                // Real-time score updates
                on("score:updated") { args ->
                    enqueueParse(args)
                }

                // Back-compat / other patch events
                on("score:update") { args ->
                    enqueueParse(args)
                }
                on("match:update") { args ->
                    enqueueParse(args)
                }
                on("match:patched") { args ->
                    enqueueParse(args)
                }
                on("status:updated") { args ->
                    enqueueParse(args)
                }
                on("winner:updated") { args ->
                    enqueueParse(args)
                }

                connect()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Socket init failed", e)
            errors.tryEmit("Socket init: ${e.message}")
            _connected.value = false
            if (!manualDisconnect.get()) {
                scheduleReconnect("init_failed")
            }
        }
    }

    fun disconnect() {
        disconnectInternal(clearSessionState = true, resetOverlayState = true, markManualDisconnect = true)
    }

    fun resetOverlayData() {
        try {
            _overlayData.value = OverlayData()
        } catch (e: Exception) {
            Log.e(TAG, "Reset overlay data failed", e)
        }
    }

    fun seedOverlayData(data: OverlayData) {
        seedSnapshotData(data = data)
    }

    fun seedSnapshotData(
        data: OverlayData,
        version: Long? = null,
        status: String? = null,
    ) {
        try {
            if (isStalePayload(version, updatedAtMs = 0L)) {
                Log.d(
                    TAG,
                    "Drop stale polled snapshot for ${currentMatchId ?: "unknown"} (version=$version)",
                )
                return
            }
            val current = _overlayData.value
            if (current != data) {
                _overlayData.value = data
            }
            val normalizedStatus = status?.trim()?.takeIf { it.isNotBlank() }
            if (!normalizedStatus.isNullOrBlank() && _matchStatus.value != normalizedStatus) {
                _matchStatus.value = normalizedStatus
            }
            markPayloadApplied(version, updatedAtMs = 0L)
            markPayloadFresh()
        } catch (e: Exception) {
            Log.e(TAG, "Seed overlay data failed", e)
        }
    }

    fun seedMatchStatus(status: String?) {
        try {
            val normalized = status?.trim()?.takeIf { it.isNotBlank() }
            if (_matchStatus.value != normalized) {
                _matchStatus.value = normalized
            }
            if (!normalized.isNullOrBlank()) {
                markPayloadFresh()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Seed match status failed", e)
        }
    }

    private fun disconnectInternal(
        clearSessionState: Boolean,
        resetOverlayState: Boolean,
        markManualDisconnect: Boolean,
    ) {
        try {
            if (markManualDisconnect) {
                manualDisconnect.set(true)
            }
            cancelReconnectSchedule()
            joinedMatchId?.let { mid ->
                socket?.emit("match:leave", JSONObject().put("matchId", mid))
            }
            socket?.disconnect()
            socket?.off()
            socket = null
            _connected.value = false
            pendingJson.set(null)
            parseScheduled.set(false)
            parseHandler.removeCallbacksAndMessages(null)
            stopSnapshotKeepAlive()
            joinedMatchId = null
            _lastPayloadAtMs.value = 0L
            lastAppliedVersion.set(-1L)
            lastAppliedUpdatedAtMs.set(0L)
            lastSnapshotRequestAtMs.set(0L)
            if (clearSessionState) {
                currentMatchId = null
                currentToken = null
                _activeMatchId.value = null
                _matchStatus.value = null
                if (resetOverlayState) {
                    resetOverlayData()
                }
            } else if (resetOverlayState) {
                resetOverlayData()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Disconnect error", e)
        }
    }

    private fun scheduleReconnect(reason: String) {
        if (manualDisconnect.get()) return
        if (currentToken.isNullOrBlank()) return
        if (reconnectScheduled.getAndSet(true)) return
        Log.d(TAG, "Scheduling forced socket reconnect in ${FORCE_RECONNECT_DELAY_MS}ms ($reason)")
        parseHandler.postDelayed(reconnectRunnable, FORCE_RECONNECT_DELAY_MS)
    }

    private fun cancelReconnectSchedule() {
        reconnectScheduled.set(false)
        parseHandler.removeCallbacks(reconnectRunnable)
    }

    private fun reconnectInternal(token: String) {
        try {
            Log.d(TAG, "Forcing socket reconnect")
            disconnectInternal(
                clearSessionState = false,
                resetOverlayState = false,
                markManualDisconnect = false,
            )
            manualDisconnect.set(false)
            currentToken = token
            openSocket(token)
        } catch (e: Exception) {
            Log.e(TAG, "Forced socket reconnect failed", e)
            errors.tryEmit("Socket reconnect: ${e.message}")
            if (!manualDisconnect.get()) {
                scheduleReconnect("forced_reconnect_failed")
            }
        }
    }

    private fun enqueueParse(args: Array<Any>) {
        try {
            if (currentMatchId == null) return
            val raw = args.firstOrNull() ?: return
            val json = when (raw) {
                is JSONObject -> raw.toString()
                is String -> raw
                else -> raw.toString()
            }
            pendingJson.set(json)
            scheduleParse()
        } catch (e: Exception) {
            Log.e(TAG, "Parse error (non-fatal)", e)
        }
    }

    private fun scheduleParse() {
        if (currentMatchId == null) return
        if (parseScheduled.getAndSet(true)) return
        // Fix #4: Guard against posting to a dead HandlerThread
        if (!parseThread.isAlive) {
            parseScheduled.set(false)
            return
        }
        parseHandler.postDelayed({
            parseScheduled.set(false)
            if (currentMatchId != null) parseLatest()
        }, UPDATE_INTERVAL_MS)
    }

    private fun parseLatest() {
        val json = pendingJson.getAndSet(null) ?: return
        try {
            val expectedMatchId = currentMatchId ?: return
            val obj = gson.fromJson(json, JsonObject::class.java) ?: return

            val match = when {
                obj.has("match") && obj.get("match").isJsonObject -> obj.getAsJsonObject("match")
                obj.has("data") && obj.get("data").isJsonObject -> obj.getAsJsonObject("data")
                else -> obj
            }
            val payloadMatchId =
                obj.getStr("_id")
                    ?: obj.getStr("id")
                    ?: obj.getStr("matchId")
                    ?: obj.getObj("data")?.getStr("_id")
                    ?: obj.getObj("data")?.getStr("id")
                    ?: obj.getObj("data")?.getStr("matchId")
                    ?: match.getStr("_id")
                    ?: match.getStr("id")
                    ?: match.getStr("matchId")

            if (payloadMatchId != null && payloadMatchId != expectedMatchId) return

            val payloadVersion = extractPayloadVersion(obj, match)
            val payloadUpdatedAtMs = extractPayloadUpdatedAtMs(obj, match)
            if (isStalePayload(payloadVersion, payloadUpdatedAtMs)) {
                Log.d(
                    TAG,
                    "Drop stale socket payload for $expectedMatchId (version=$payloadVersion updatedAtMs=$payloadUpdatedAtMs)"
                )
                return
            }

            val current = _overlayData.value
            val lightweightPayload = isLightweightMatchPayload(obj, match)
            val missingIdentity = !hasMatchIdentityData(match)
            val needsIdentitySnapshot =
                current.teamAName.isBlank() ||
                    current.teamAName == "Team A" ||
                    current.teamBName.isBlank() ||
                    current.teamBName == "Team B"

            val currentScore = extractCurrentScore(match)
            val serve = extractServe(match)
            val nextStatus = match.getStr("status") ?: obj.getStr("status")
            val hasUsefulPayload =
                !lightweightPayload ||
                    payloadVersion != null ||
                    currentScore != null ||
                    serve != null ||
                    !nextStatus.isNullOrBlank()
            if (lightweightPayload || (missingIdentity && needsIdentitySnapshot) || !hasUsefulPayload) {
                requestSnapshotForCurrentMatch()
            }

            val nextTeamAName = if (!missingIdentity) extractTeamName(match, "A") else null
            val nextTeamBName = if (!missingIdentity) extractTeamName(match, "B") else null

            val updated = current.copy(
                teamAName = normalizeTeamName(nextTeamAName ?: current.teamAName),
                teamBName = normalizeTeamName(nextTeamBName ?: current.teamBName),
                scoreA = currentScore?.first ?: match.getInt("scoreA") ?: current.scoreA,
                scoreB = currentScore?.second ?: match.getInt("scoreB") ?: current.scoreB,
                serveSide = serve?.first ?: match.getStr("serveSide") ?: current.serveSide,
                serveCount = serve?.second ?: match.getInt("serveCount") ?: current.serveCount,
                isBreak = match.getBool("isBreak") ?: current.isBreak,
                breakNote = match.getStr("breakNote") ?: current.breakNote,
                stageName = match.getStr("stageName") ?: current.stageName,
                phaseText = match.getStr("phaseText") ?: current.phaseText,
                roundLabel = match.getStr("roundLabel") ?: current.roundLabel,
                tournamentName = extractTournamentName(match) ?: current.tournamentName,
                courtName = extractCourtName(match) ?: current.courtName,
                sets = extractSets(match) ?: current.sets,
            )
            if (updated != current) _overlayData.value = updated
            if (!nextStatus.isNullOrBlank() && nextStatus != _matchStatus.value) {
                _matchStatus.value = nextStatus
            }
            markPayloadApplied(payloadVersion, payloadUpdatedAtMs)
            if (hasUsefulPayload) {
                markPayloadFresh()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Parse error (non-fatal)", e)
        }
    }

    private fun syncRoomSubscription(forceSnapshot: Boolean) {
        val targetMatchId = currentMatchId?.takeIf { it.isNotBlank() }
        val alreadyJoined = joinedMatchId?.takeIf { it.isNotBlank() }
        val activeSocket = socket ?: return
        if (activeSocket.connected().not()) return

        if (!alreadyJoined.isNullOrBlank() && alreadyJoined != targetMatchId) {
            runCatching {
                activeSocket.emit("match:leave", JSONObject().put("matchId", alreadyJoined))
            }.onFailure {
                Log.e(TAG, "Leave previous room failed", it)
            }
            joinedMatchId = null
            _activeMatchId.value = null
        }

        if (!targetMatchId.isNullOrBlank()) {
            if (alreadyJoined != targetMatchId) {
                _activeMatchId.value = null
                runCatching {
                    activeSocket.emit("match:join", JSONObject().put("matchId", targetMatchId))
                }.onFailure {
                    Log.e(TAG, "Join match room failed", it)
                }
            }
            if (forceSnapshot) {
                requestSnapshotForCurrentMatch(
                    minIntervalMs = 0L,
                    reason = if (alreadyJoined == targetMatchId) "room_refresh" else "join_sync",
                )
            }
            startSnapshotKeepAlive()
        } else {
            stopSnapshotKeepAlive()
        }
    }

    private fun markPayloadFresh() {
        if (currentMatchId.isNullOrBlank()) return
        _lastPayloadAtMs.value = System.currentTimeMillis()
    }

    private fun requestSnapshotForCurrentMatch(
        minIntervalMs: Long = 600L,
        reason: String = "refresh",
    ) {
        val targetMatchId = currentMatchId?.takeIf { it.isNotBlank() } ?: return
        val activeSocket = socket ?: return
        if (activeSocket.connected().not()) return

        val now = System.currentTimeMillis()
        val last = lastSnapshotRequestAtMs.get()
        if (minIntervalMs > 0L && now - last < minIntervalMs) return
        lastSnapshotRequestAtMs.set(now)

        runCatching {
            activeSocket.emit(
                "match:snapshot:request",
                JSONObject()
                    .put("matchId", targetMatchId)
                    .put("reason", reason),
            )
        }.onFailure {
            Log.e(TAG, "Request snapshot failed", it)
        }
    }

    private fun startSnapshotKeepAlive() {
        if (currentMatchId.isNullOrBlank()) return
        // Fix #4: Guard against posting to a dead HandlerThread
        if (!parseThread.isAlive) return
        if (snapshotKeepAliveScheduled.getAndSet(true)) return
        parseHandler.postDelayed(snapshotKeepAliveRunnable, SNAPSHOT_KEEPALIVE_INTERVAL_MS)
    }

    private fun stopSnapshotKeepAlive() {
        snapshotKeepAliveScheduled.set(false)
        parseHandler.removeCallbacks(snapshotKeepAliveRunnable)
    }

    private fun scheduleBootstrapSnapshotBurst(
        matchId: String,
        reason: String,
    ) {
        val expectedMatchId = matchId.trim()
        if (expectedMatchId.isBlank()) return
        JOIN_BOOTSTRAP_BURST_DELAYS_MS.forEachIndexed { index, delayMs ->
            parseHandler.postDelayed(
                Runnable {
                    if (manualDisconnect.get()) return@Runnable
                    if (currentMatchId != expectedMatchId) return@Runnable
                    if (socket?.connected() != true) return@Runnable
                    requestSnapshotForCurrentMatch(
                        minIntervalMs = 0L,
                        reason = "${reason}_burst_${index + 1}",
                    )
                },
                delayMs,
            )
        }
    }

    private fun extractTeamName(obj: JsonObject, side: String): String? {
        val resolved = resolveSideDisplayName(obj, side, allowRawFallback = false)
        return resolved?.let(::normalizeTeamName)
    }

    private fun normalizeTeamName(raw: String?): String {
        val value = raw?.trim().orEmpty()
        if (value.isBlank()) return value
        return value
            .replace(Regex("\\s*&\\s*"), " / ")
            .replace(Regex("\\s*/\\s*"), " / ")
            .replace(Regex("\\s{2,}"), " ")
            .trim()
    }

    private fun extractCurrentScore(obj: JsonObject): Pair<Int, Int>? {
        obj.getInt("scoreA")?.let { a ->
            val b = obj.getInt("scoreB") ?: 0
            return a to b
        }
        val scoreObj = obj.getObj("score")
        if (scoreObj != null) {
            val a = scoreObj.getInt("A") ?: scoreObj.getInt("a")
            val b = scoreObj.getInt("B") ?: scoreObj.getInt("b")
            if (a != null && b != null) return a to b
        }

        val arr = obj.get("gameScores")?.takeIf { it.isJsonArray }?.asJsonArray ?: return null
        if (arr.size() <= 0) return null
        return runCatching {
            val currentIndex = obj.getInt("currentGame")
            val active =
                (0 until arr.size())
                    .mapNotNull { idx ->
                        arr[idx]
                            .takeIf { it.isJsonObject }
                            ?.asJsonObject
                    }.firstOrNull { it.getBool("current") == true }
                    ?: currentIndex
                        ?.takeIf { it in 0 until arr.size() }
                        ?.let { idx -> arr[idx].asJsonObject }
                    ?: arr[arr.size() - 1].asJsonObject
            val a = active.getInt("a") ?: active.getInt("scoreA") ?: 0
            val b = active.getInt("b") ?: active.getInt("scoreB") ?: 0
            a to b
        }.getOrNull()
    }

    private fun extractServe(obj: JsonObject): Pair<String, Int>? {
        val serveObj = obj.getObj("serve") ?: return null
        val side = serveObj.getStr("side")?.uppercase() ?: return null
        if (side != "A" && side != "B") return null
        val server = serveObj.getInt("server")
        val count = when (server) {
            1 -> 1
            2 -> 2
            else -> null
        }
        return side to (count ?: 1)
    }

    private fun extractTournamentName(obj: JsonObject): String? {
        if (obj.has("tournamentName")) return obj.getStr("tournamentName")
        if (obj.has("tournament") && obj.get("tournament").isJsonObject) {
            return obj.getAsJsonObject("tournament").getStr("name")
        }
        return null
    }

    private fun extractCourtName(obj: JsonObject): String? {
        if (obj.has("courtName")) return obj.getStr("courtName")
        if (obj.has("court") && obj.get("court").isJsonObject) {
            val court = obj.getAsJsonObject("court")
            return court.getStr("name") ?: court.getStr("label")
        }
        return null
    }

    private fun extractSets(obj: JsonObject): List<SetScore>? {
        val arr = when {
            obj.has("sets") && obj.get("sets").isJsonArray -> obj.getAsJsonArray("sets")
            obj.has("gameScores") && obj.get("gameScores").isJsonArray -> obj.getAsJsonArray("gameScores")
            else -> return null
        }
        return try {
            (0 until arr.size()).map { i ->
                val s = arr[i].asJsonObject
                SetScore(
                    index = s.getInt("index") ?: i,
                    a = s.getInt("a") ?: s.getInt("scoreA"),
                    b = s.getInt("b") ?: s.getInt("scoreB"),
                    winner = s.getStr("winner") ?: "",
                    current = s.getBool("current") ?: false,
                )
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun extractPayloadVersion(root: JsonObject, match: JsonObject): Long? {
        return sequenceOf(
            root.getLong("version"),
            root.getLong("liveVersion"),
            root.getObj("data")?.getLong("version"),
            root.getObj("data")?.getLong("liveVersion"),
            match.getLong("version"),
            match.getLong("liveVersion"),
        ).firstOrNull { it != null }
    }

    private fun extractPayloadUpdatedAtMs(root: JsonObject, match: JsonObject): Long {
        return sequenceOf(
            root.getStr("updatedAt"),
            root.getObj("data")?.getStr("updatedAt"),
            match.getStr("updatedAt"),
            root.getStr("startedAt"),
            match.getStr("startedAt"),
            root.getStr("createdAt"),
            match.getStr("createdAt"),
        ).mapNotNull { it }
            .mapNotNull(::parseTimestampMs)
            .firstOrNull() ?: 0L
    }

    private fun parseTimestampMs(value: String?): Long? {
        val normalized = value?.trim().orEmpty()
        if (normalized.isBlank()) return null
        normalized.toLongOrNull()?.let { numeric ->
            return if (numeric in 1_000_000_000L..9_999_999_999L) numeric * 1000L else numeric
        }

        val patterns = listOf(
            "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
            "yyyy-MM-dd'T'HH:mm:ssXXX",
            "yyyy-MM-dd'T'HH:mm:ss.SSSX",
            "yyyy-MM-dd'T'HH:mm:ssX",
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            "yyyy-MM-dd'T'HH:mm:ss'Z'",
        )
        for (pattern in patterns) {
            val parsed =
                runCatching {
                    SimpleDateFormat(pattern, Locale.US).apply {
                        timeZone = TimeZone.getTimeZone("UTC")
                        isLenient = true
                    }.parse(normalized)?.time
                }.getOrNull()
            if (parsed != null) return parsed
        }
        return null
    }

    private fun isStalePayload(version: Long?, updatedAtMs: Long): Boolean {
        val currentVersion = lastAppliedVersion.get()
        if (version != null && currentVersion >= 0L && version < currentVersion) {
            return true
        }

        val currentUpdatedAt = lastAppliedUpdatedAtMs.get()
        if (version != null && currentVersion >= 0L && version == currentVersion) {
            return updatedAtMs > 0L && currentUpdatedAt > 0L && updatedAtMs < currentUpdatedAt
        }

        if (version == null && currentUpdatedAt > 0L && updatedAtMs > 0L && updatedAtMs < currentUpdatedAt) {
            return true
        }

        return false
    }

    private fun markPayloadApplied(version: Long?, updatedAtMs: Long) {
        if (version != null) {
            val currentVersion = lastAppliedVersion.get()
            if (version > currentVersion) {
                lastAppliedVersion.set(version)
            }
        }
        if (updatedAtMs > 0L) {
            val currentUpdatedAt = lastAppliedUpdatedAtMs.get()
            if (updatedAtMs > currentUpdatedAt) {
                lastAppliedUpdatedAtMs.set(updatedAtMs)
            }
        }
    }

    // Extension helpers for safe JSON access
    private fun JsonObject.getStr(key: String): String? =
        if (has(key) && !get(key).isJsonNull) get(key).asString else null

    private fun JsonObject.getInt(key: String): Int? =
        if (has(key) && !get(key).isJsonNull) try { get(key).asInt } catch (_: Exception) { null } else null

    private fun JsonObject.getLong(key: String): Long? =
        if (has(key) && !get(key).isJsonNull) try { get(key).asLong } catch (_: Exception) { null } else null

    private fun JsonObject.getBool(key: String): Boolean? =
        if (has(key) && !get(key).isJsonNull) try { get(key).asBoolean } catch (_: Exception) { null } else null

    private fun JsonObject.getObj(key: String): JsonObject? =
        if (has(key) && get(key).isJsonObject) get(key).asJsonObject else null
}
