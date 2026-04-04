package com.pkt.live.data.repository

import android.util.Log
import com.google.gson.Gson
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.pkt.live.data.api.PickleTourApi
import com.pkt.live.data.model.*
import com.pkt.live.data.socket.CourtPresenceSocketManager
import com.pkt.live.data.socket.CourtRuntimeSocketManager
import com.pkt.live.data.socket.MatchSocketManager
import com.pkt.live.util.resolveMatchDisplayMode
import com.pkt.live.util.resolvePairDisplayName
import com.pkt.live.util.resolveSideDisplayName
import com.pkt.live.util.resolveTeamDisplayName
import com.pkt.live.streaming.Quality
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Single source of truth for all live data.
 * Combines REST API + Socket.IO into clean flows.
 */
class LiveRepository(
    private val api: PickleTourApi,
    private val socketManager: MatchSocketManager,
    private val courtPresenceSocketManager: CourtPresenceSocketManager,
    private val courtRuntimeSocketManager: CourtRuntimeSocketManager,
    private val gson: Gson,
) {
    companion object {
        private const val TAG = "LiveRepo"
        private const val MATCH_POLL_INTERVAL_MS = 12_000L
        private const val MATCH_POLL_BOOTSTRAP_INTERVAL_MS = 1_500L
        private const val MATCH_POLL_BOOTSTRAP_WINDOW_MS = 12_000L
        private const val MATCH_SOCKET_HEALTHCHECK_INTERVAL_MS = 5_000L
    }

    private val repoScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var matchPollJob: Job? = null
    private var polledMatchId: String? = null

    val overlayData: StateFlow<OverlayData> = socketManager.overlayData
    val socketConnected: StateFlow<Boolean> = socketManager.connected
    val matchStatus: StateFlow<String?> = socketManager.matchStatus
    val socketActiveMatchId: StateFlow<String?> = socketManager.activeMatchId
    val socketLastPayloadAtMs: StateFlow<Long> = socketManager.lastPayloadAtMs
    val socketErrors = socketManager.errors
    val courtPresenceByCourtId: StateFlow<Map<String, CourtLiveScreenPresence>> =
        courtPresenceSocketManager.presenceByCourtId
    val courtPresenceSocketConnected: StateFlow<Boolean> = courtPresenceSocketManager.connected
    val courtPresenceSocketErrors = courtPresenceSocketManager.errors
    val courtRuntimeSocketConnected: StateFlow<Boolean> = courtRuntimeSocketManager.connected
    val courtClusterRuntimeUpdates = courtRuntimeSocketManager.clusterUpdates
    val courtStationRuntimeUpdates = courtRuntimeSocketManager.stationUpdates
    val courtRuntimeSocketErrors = courtRuntimeSocketManager.errors

    // ==================== API calls ====================

    suspend fun getMe(): Result<UserMe> {
        return try {
            val resp = api.getMe()
            if (resp.isSuccessful && resp.body() != null) Result.success(resp.body()!!)
            else Result.failure(Exception("Get me failed: ${resp.code()}"))
        } catch (e: Exception) {
            Log.e(TAG, "getMe error", e)
            Result.failure(e)
        }
    }

    suspend fun loginWithPassword(body: LoginRequest): Result<LoginResponse> {
        return try {
            val resp = api.login(body)
            if (resp.isSuccessful && resp.body() != null) {
                Result.success(resp.body()!!)
            } else {
                val raw = runCatching { resp.errorBody()?.string() }.getOrNull()
                val msg = parseErrorMessage(raw)
                val userMessage = msg ?: "Đăng nhập thất bại"
                Result.failure(Exception(userMessage))
            }
        } catch (e: Exception) {
            Log.e(TAG, "loginWithPassword error", e)
            Result.failure(e)
        }
    }

    suspend fun getCourtRuntime(courtId: String): Result<LiveAppCourtRuntimeResponse> {
        return try {
            val resp = api.getCourtRuntime(courtId)
            if (resp.isSuccessful && resp.body() != null) {
                Result.success(resp.body()!!)
            } else {
                Result.failure(Exception("Get court runtime failed: ${resp.code()}"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "getCourtRuntime error", e)
            Result.failure(e)
        }
    }

    suspend fun getNextMatchByCourt(courtId: String, afterMatchId: String? = null): Result<String?> {
        return try {
            val resp = api.getNextMatchByCourt(courtId, afterMatchId)
            if (resp.isSuccessful && resp.body() != null) {
                Result.success(resp.body()!!.matchId?.trim()?.takeIf { it.isNotBlank() })
            } else {
                Result.failure(Exception("Get next match failed: ${resp.code()}"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "getNextMatchByCourt error", e)
            Result.failure(e)
        }
    }

    suspend fun getLiveAppBootstrap(): Result<LiveAppBootstrapResponse> {
        return try {
            val resp = api.getLiveAppBootstrap()
            if (resp.isSuccessful && resp.body() != null) {
                Result.success(resp.body()!!)
            } else {
                val raw = runCatching { resp.errorBody()?.string() }.getOrNull()
                val msg = parseErrorMessage(raw)
                Result.failure(
                    Exception(msg ?: "Không tải được quyền truy cập PickleTour Live (${resp.code()})")
                )
            }
        } catch (e: Exception) {
            Log.e(TAG, "getLiveAppBootstrap error", e)
            Result.failure(e)
        }
    }

    suspend fun listLiveAppCourtClusters(): Result<List<CourtClusterData>> {
        return try {
            val resp = api.listLiveAppCourtClusters()
            if (resp.isSuccessful && resp.body() != null) {
                Result.success(resp.body()!!.items.filter { it.id.isNotBlank() })
            } else {
                Result.failure(Exception("List court clusters failed: ${resp.code()}"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "listLiveAppCourtClusters error", e)
            Result.failure(e)
        }
    }

    suspend fun listLiveAppCourtStations(clusterId: String): Result<List<AdminCourtData>> {
        return try {
            val resp = api.listLiveAppCourtStations(clusterId)
            if (resp.isSuccessful && resp.body() != null) {
                Result.success(resp.body()!!.items.filter { it.id.isNotBlank() })
            } else {
                Result.failure(Exception("List court stations failed: ${resp.code()}"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "listLiveAppCourtStations error", e)
            Result.failure(e)
        }
    }

    suspend fun adminListCourts(tournamentId: String): Result<List<AdminCourtData>> {
        return try {
            val resp = api.adminListCourts(tournamentId)
            if (!resp.isSuccessful || resp.body() == null) {
                return Result.failure(Exception("List courts failed: ${resp.code()}"))
            }
            val items = parseList(resp.body()!!).mapNotNull { el ->
                runCatching { gson.fromJson(el, AdminCourtData::class.java) }.getOrNull()
            }.filter { it.id.isNotBlank() }
            Result.success(items)
        } catch (e: Exception) {
            Log.e(TAG, "adminListCourts error", e)
            Result.failure(e)
        }
    }

    suspend fun startCourtPresence(
        courtId: String,
        clientSessionId: String,
        screenState: String,
        matchId: String? = null,
    ): Result<CourtPresenceResponse> {
        return try {
            val body =
                CourtPresenceRequest(
                    clientSessionId = clientSessionId,
                    screenState = screenState,
                    matchId = matchId,
                    timestamp = currentIsoTimestampUtc(),
                )
            val resp = api.startCourtPresence(courtId, body)
            if (resp.isSuccessful && resp.body() != null) {
                Result.success(resp.body()!!)
            } else {
                val msg =
                    when (resp.code()) {
                        401 -> "Không xác thực được quyền giữ sân."
                        404 -> "Không tìm thấy sân."
                        409 -> "Sân này đang có thiết bị khác giữ màn live."
                        else -> "Không bắt đầu được giữ sân (${resp.code()})."
                    }
                Result.failure(Exception(msg))
            }
        } catch (e: Exception) {
            Log.e(TAG, "startCourtPresence error", e)
            Result.failure(e)
        }
    }

    suspend fun heartbeatCourtPresence(
        courtId: String,
        clientSessionId: String,
        screenState: String,
        matchId: String? = null,
    ): Result<CourtPresenceResponse> {
        return try {
            val body =
                CourtPresenceRequest(
                    clientSessionId = clientSessionId,
                    screenState = screenState,
                    matchId = matchId,
                    timestamp = currentIsoTimestampUtc(),
                )
            val resp = api.heartbeatCourtPresence(courtId, body)
            if (resp.isSuccessful && resp.body() != null) {
                Result.success(resp.body()!!)
            } else {
                Result.failure(Exception("Court presence heartbeat failed: ${resp.code()}"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "heartbeatCourtPresence error", e)
            Result.failure(e)
        }
    }

    suspend fun endCourtPresence(
        courtId: String,
        clientSessionId: String,
    ): Result<CourtPresenceResponse> {
        return try {
            val body =
                CourtPresenceRequest(
                    clientSessionId = clientSessionId,
                    timestamp = currentIsoTimestampUtc(),
                )
            val resp = api.endCourtPresence(courtId, body)
            if (resp.isSuccessful && resp.body() != null) {
                Result.success(resp.body()!!)
            } else {
                Result.failure(Exception("End court presence failed: ${resp.code()}"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "endCourtPresence error", e)
            Result.failure(e)
        }
    }

    suspend fun extendCourtPresencePreview(
        courtId: String,
        clientSessionId: String,
    ): Result<CourtPresenceResponse> {
        return try {
            val body =
                CourtPresenceRequest(
                    clientSessionId = clientSessionId,
                    timestamp = currentIsoTimestampUtc(),
                )
            val resp = api.extendCourtPresencePreview(courtId, body)
            if (resp.isSuccessful && resp.body() != null) {
                Result.success(resp.body()!!)
            } else {
                Result.failure(Exception("Extend preview court presence failed: ${resp.code()}"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "extendCourtPresencePreview error", e)
            Result.failure(e)
        }
    }

    /** Create live session → get RTMP URL */
    suspend fun createLiveSession(matchId: String, pageId: String? = null, forceNew: Boolean = false): Result<LiveSession> {
        return try {
            val resp = api.createLiveSession(matchId, if (forceNew) 1 else null, CreateLiveRequest(pageId))
            if (resp.isSuccessful && resp.body() != null) {
                Result.success(resp.body()!!)
            } else {
                val raw = runCatching { resp.errorBody()?.string() }.getOrNull()
                val msg = parseErrorMessage(raw)
                val userMessage = when (resp.code()) {
                    400 -> msg ?: "Không tạo được live (thiếu dữ liệu)."
                    401 -> "Bạn chưa đăng nhập hoặc token đã hết hạn."
                    403 -> msg ?: "Bạn không có quyền tạo live cho trận này."
                    404 -> msg ?: "Không tìm thấy trận (có thể sân chưa có trận hoặc trận đã kết thúc)."
                    429 -> "Bạn thao tác quá nhanh, thử lại sau."
                    in 500..599 -> "Server đang lỗi (${resp.code()}), thử lại sau."
                    else -> msg ?: "Không tạo được live (${resp.code()})."
                }
                Result.failure(Exception(userMessage))
            }
        } catch (e: Exception) {
            Log.e(TAG, "createLiveSession error", e)
            Result.failure(e)
        }
    }

    /** Notify backend stream started */
    suspend fun notifyStreamStarted(matchId: String, clientSessionId: String): Result<StreamNotifyResponse> {
        return try {
            val body = StreamNotifyRequest(
                platform = "facebook",
                timestamp = currentIsoTimestampUtc(),
                clientSessionId = clientSessionId,
            )
            val resp = api.notifyStreamStarted(matchId, body)
            if (resp.isSuccessful && resp.body() != null) Result.success(resp.body()!!)
            else Result.failure(Exception("Notify start failed: ${resp.code()}"))
        } catch (e: Exception) {
            Log.e(TAG, "notifyStreamStarted error", e)
            Result.failure(e) // non-fatal, don't crash
        }
    }

    /** Notify backend live lease heartbeat */
    suspend fun notifyStreamHeartbeat(matchId: String, clientSessionId: String): Result<StreamNotifyResponse> {
        return try {
            val body = StreamNotifyRequest(
                platform = "facebook",
                timestamp = currentIsoTimestampUtc(),
                clientSessionId = clientSessionId,
            )
            val resp = api.notifyStreamHeartbeat(matchId, body)
            if (resp.isSuccessful && resp.body() != null) Result.success(resp.body()!!)
            else Result.failure(Exception("Notify heartbeat failed: ${resp.code()}"))
        } catch (e: Exception) {
            Log.e(TAG, "notifyStreamHeartbeat error", e)
            Result.failure(e)
        }
    }

    /** Notify backend stream ended */
    suspend fun notifyStreamEnded(matchId: String, clientSessionId: String?): Result<StreamNotifyResponse> {
        return try {
            val body = StreamNotifyRequest(
                platform = "facebook",
                timestamp = currentIsoTimestampUtc(),
                clientSessionId = clientSessionId,
            )
            val resp = api.notifyStreamEnded(matchId, body)
            if (resp.isSuccessful && resp.body() != null) Result.success(resp.body()!!)
            else Result.failure(Exception("Notify end failed: ${resp.code()}"))
        } catch (e: Exception) {
            Log.e(TAG, "notifyStreamEnded error", e)
            Result.failure(e)
        }
    }

    /** Get overlay snapshot (initial data) */
    suspend fun getOverlaySnapshot(matchId: String): Result<MatchData> {
        return try {
            fetchOverlaySnapshot(matchId)
        } catch (e: Exception) {
            Log.e(TAG, "getOverlaySnapshot error", e)
            Result.failure(e)
        }
    }

    suspend fun getMatchRuntime(matchId: String): Result<MatchData> {
        return try {
            val runtime = fetchMatchRuntime(matchId)
            if (runtime.isSuccess) {
                runtime
            } else {
                fetchOverlaySnapshot(matchId)
            }
        } catch (e: Exception) {
            Log.e(TAG, "getMatchRuntime error", e)
            getOverlaySnapshot(matchId)
        }
    }

    /** Get match info */
    suspend fun getMatchInfo(matchId: String): Result<MatchData> {
        return try {
            val runtime = getMatchRuntime(matchId)
            if (runtime.isSuccess) return runtime

            val resp = api.getMatchInfo(matchId)
            if (resp.isSuccessful && resp.body() != null) {
                val normalized = normalizeMatchNames(resp.body()!!)
                socketManager.seedSnapshotData(
                    data = matchToOverlayData(normalized),
                    version = normalized.liveVersion,
                    status = normalized.status,
                )
                Result.success(normalized)
            } else {
                Result.failure(Exception("Match info failed: runtime / ${resp.code()}"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "getMatchInfo error", e)
            Result.failure(e)
        }
    }

    /** Get overlay config (sponsors, logos) */
    suspend fun getOverlayConfig(tournamentId: String? = null): Result<OverlayConfig> {
        return try {
            val resp = api.getOverlayConfig(tournamentId = tournamentId)
            if (resp.isSuccessful && resp.body() != null) {
                Result.success(resp.body()!!)
            } else {
                Result.failure(Exception("Overlay config failed: ${resp.code()}"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "getOverlayConfig error", e)
            Result.failure(e)
        }
    }

    // ==================== Socket ====================

    fun connectSocketSession(token: String) {
        socketManager.connect(token)
        courtRuntimeSocketManager.connect(token)
    }

    fun disconnectSocketSession() {
        stopMatchPolling()
        socketManager.disconnect()
        courtRuntimeSocketManager.disconnect()
    }

    fun connectSocket(token: String, matchId: String) {
        socketManager.connect(token)
        courtRuntimeSocketManager.connect(token)
        socketManager.joinMatch(matchId)
        startMatchPolling(matchId)
    }

    fun disconnectSocket() {
        stopMatchPolling()
        socketManager.leaveMatch()
    }

    fun seedOverlayData(data: OverlayData) {
        socketManager.seedOverlayData(data)
    }

    fun resetOverlayData() {
        socketManager.resetOverlayData()
    }

    fun watchTournamentCourtPresence(token: String, tournamentId: String) {
        val tid = tournamentId.trim()
        if (tid.isBlank()) return
        courtPresenceSocketManager.connect(token, tid)
    }

    fun unwatchTournamentCourtPresence() {
        courtPresenceSocketManager.disconnect()
    }

    fun watchCourtClusterRuntime(clusterId: String) {
        val cid = clusterId.trim()
        if (cid.isBlank()) return
        courtRuntimeSocketManager.watchCluster(cid)
    }

    fun unwatchCourtClusterRuntime(clusterId: String) {
        val cid = clusterId.trim()
        if (cid.isBlank()) return
        courtRuntimeSocketManager.unwatchCluster(cid)
    }

    fun watchCourtStationRuntime(stationId: String) {
        val sid = stationId.trim()
        if (sid.isBlank()) return
        courtRuntimeSocketManager.watchStation(sid)
    }

    fun unwatchCourtStationRuntime(stationId: String) {
        val sid = stationId.trim()
        if (sid.isBlank()) return
        courtRuntimeSocketManager.unwatchStation(sid)
    }

    private fun startMatchPolling(matchId: String) {
        val targetMatchId = matchId.trim()
        if (targetMatchId.isBlank()) return
        if (matchPollJob?.isActive == true && polledMatchId == targetMatchId) return

        stopMatchPolling()
        polledMatchId = targetMatchId
        val bootstrapStartedAtMs = System.currentTimeMillis()
        matchPollJob =
            repoScope.launch {
                while (isActive && polledMatchId == targetMatchId) {
                    val socketReady =
                        socketConnected.value &&
                            socketActiveMatchId.value == targetMatchId &&
                            socketLastPayloadAtMs.value > 0L
                    val withinBootstrapWindow =
                        System.currentTimeMillis() - bootstrapStartedAtMs < MATCH_POLL_BOOTSTRAP_WINDOW_MS
                    val shouldFetchSnapshot = !socketReady

                    if (shouldFetchSnapshot) {
                        val result = runCatching { fetchMatchRuntime(targetMatchId) }.getOrElse {
                            Log.e(TAG, "match polling failed", it)
                            Result.failure(it)
                        }
                        result.onFailure {
                            Log.w(TAG, "match polling snapshot failed: ${it.message}")
                        }
                    }
                    val nextDelay =
                        if (shouldFetchSnapshot && withinBootstrapWindow) {
                            MATCH_POLL_BOOTSTRAP_INTERVAL_MS
                        } else if (shouldFetchSnapshot) {
                            MATCH_POLL_INTERVAL_MS
                        } else {
                            MATCH_SOCKET_HEALTHCHECK_INTERVAL_MS
                        }
                    delay(nextDelay)
                }
            }
    }

    private fun stopMatchPolling() {
        matchPollJob?.cancel()
        matchPollJob = null
        polledMatchId = null
    }

    private suspend fun fetchMatchRuntime(matchId: String): Result<MatchData> {
        val resp = api.getMatchRuntime(matchId)
        if (!resp.isSuccessful || resp.body() == null) {
            return Result.failure(Exception("Match runtime failed: ${resp.code()}"))
        }
        val normalized = normalizeMatchNames(resp.body()!!)
        socketManager.seedSnapshotData(
            data = matchToOverlayData(normalized),
            version = normalized.liveVersion,
            status = normalized.status,
        )
        return Result.success(normalized)
    }

    private suspend fun fetchOverlaySnapshot(matchId: String): Result<MatchData> {
        val resp = api.getOverlaySnapshot(matchId)
        if (!resp.isSuccessful || resp.body() == null) {
            return Result.failure(Exception("Overlay snapshot failed: ${resp.code()}"))
        }
        val mapped = overlayToMatchData(resp.body()!!)
        if (mapped == null) {
            return Result.failure(Exception("Overlay snapshot parse failed"))
        }
        socketManager.seedSnapshotData(
            data = matchToOverlayData(mapped),
            version = mapped.liveVersion,
            status = mapped.status,
        )
        return Result.success(mapped)
    }

    private fun currentIsoTimestampUtc(): String {
        val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        format.timeZone = TimeZone.getTimeZone("UTC")
        return format.format(Date())
    }

    private fun parseList(root: JsonElement): List<JsonElement> {
        if (root.isJsonArray) return root.asJsonArray.toList()
        if (!root.isJsonObject) return emptyList()
        val obj = root.asJsonObject
        val keys = listOf("items", "tournaments", "list", "data", "results", "rows", "courts")
        for (k in keys) {
            val v = obj.get(k) ?: continue
            if (v.isJsonArray) return v.asJsonArray.toList()
        }
        return emptyList()
    }

    private fun parseErrorMessage(raw: String?): String? {
        if (raw.isNullOrBlank()) return null
        val obj = runCatching { gson.fromJson(raw, com.google.gson.JsonObject::class.java) }.getOrNull() ?: return null
        val keys = listOf("message", "error", "msg", "detail")
        for (k in keys) {
            val v = obj.get(k) ?: continue
            if (v.isJsonPrimitive && v.asJsonPrimitive.isString) {
                val s = v.asString.trim()
                if (s.isNotBlank()) return s
            }
        }
        return null
    }

    private fun overlayToMatchData(root: JsonElement): MatchData? {
        val obj = if (root.isJsonObject) root.asJsonObject else return null

        val id = obj.getStr("_id") ?: obj.getStr("id") ?: ""
        val labelKey = obj.getStr("labelKey") ?: ""
        val rawCode = obj.getStr("code") ?: ""
        val serverDisplayCode =
            obj.getStr("displayCode")
                ?: obj.getStr("codeResolved")
                ?: obj.getStr("roundCode")
        val resolvedDisplayCode = serverDisplayCode ?: computeDisplayCode(obj, labelKey)
        val code =
            rawCode.ifBlank {
                resolvedDisplayCode ?: labelKey
            }
        val status = obj.getStr("status") ?: ""
        val displayNameMode = resolveMatchDisplayMode(obj)
        val liveVersion = obj.getLong("liveVersion") ?: obj.getLong("version")

        val teamsObj = obj.getObj("teams")
        val pairAObj = obj.getObj("pairA")
        val pairBObj = obj.getObj("pairB")

        val teamAName = normalizeTeamName(
            resolveSideDisplayName(obj, "A")
                ?: resolvePairDisplayName(pairAObj, displayNameMode)
                ?: resolveTeamDisplayName(teamsObj?.getObj("A"), displayNameMode)
                ?: extractPlayers(pairAObj, displayNameMode)
                ?: obj.getStr("teamAName")
                ?: "Team A"
        )

        val teamBName = normalizeTeamName(
            resolveSideDisplayName(obj, "B")
                ?: resolvePairDisplayName(pairBObj, displayNameMode)
                ?: resolveTeamDisplayName(teamsObj?.getObj("B"), displayNameMode)
                ?: extractPlayers(pairBObj, displayNameMode)
                ?: obj.getStr("teamBName")
                ?: "Team B"
        )

        val seedA = obj.getInt("seedA") ?: teamsObj?.getObj("A")?.getInt("seed")
        val seedB = obj.getInt("seedB") ?: teamsObj?.getObj("B")?.getInt("seed")

        val tournamentObj = obj.getObj("tournament")
        val tournamentId =
            tournamentObj?.getStr("_id")
                ?: tournamentObj?.getStr("id")
                ?: obj.getStr("tournamentId")
                ?: obj.getStr("tid")
        val tournamentName = obj.getStr("tournamentName") ?: tournamentObj?.getStr("name") ?: ""
        val tournamentLogoUrl =
            obj.getStr("tournamentLogoUrl")
                ?: tournamentObj?.getObj("overlay")?.getStr("logoUrl")
                ?: tournamentObj?.getStr("logoUrl")
                ?: tournamentObj?.getStr("imageUrl")
        val tournamentInfo =
            if (!tournamentId.isNullOrBlank() || tournamentName.isNotBlank() || !tournamentLogoUrl.isNullOrBlank()) {
                TournamentInfo(
                    id = tournamentId.orEmpty(),
                    name = tournamentName,
                    displayNameMode = resolveMatchDisplayMode(tournamentObj ?: obj),
                    logoUrl = tournamentObj?.getObj("overlay")?.getStr("logoUrl")
                        ?: tournamentObj?.getStr("logoUrl")
                        ?: tournamentLogoUrl,
                    imageUrl = tournamentObj?.getStr("imageUrl") ?: tournamentLogoUrl,
                )
            } else {
                null
            }

        val courtObj = obj.getObj("court")
        val courtName = obj.getStr("courtName")
            ?: courtObj?.getStr("name")
            ?: courtObj?.getStr("label")
            ?: ""

        val roundLabel = obj.getStr("roundLabel") ?: obj.getStr("roundCode") ?: ""
        val stageName = obj.getStr("stageName") ?: obj.getStr("stageLabel") ?: ""
        val phaseText = obj.getStr("phaseText") ?: ""

        val currentGame = obj.getInt("currentGame")

        val gameScoresEl = obj.get("gameScores")
        val gameScores: List<SetScore>? =
            if (gameScoresEl != null && gameScoresEl.isJsonArray) {
                runCatching {
                    gameScoresEl.asJsonArray.mapIndexed { idx, el ->
                        val s = if (el.isJsonObject) el.asJsonObject else JsonObject()
                        SetScore(
                            index = idx + 1,
                            a = s.getInt("a"),
                            b = s.getInt("b"),
                            winner = s.getStr("winner") ?: "",
                            current = s.getBool("current") ?: (currentGame != null && idx == currentGame),
                        )
                    }
                }.getOrNull()
            } else {
                null
            }

        val currentScore = extractOverlayScore(obj, gameScores)
        val scoreA = currentScore?.first ?: 0
        val scoreB = currentScore?.second ?: 0

        val serveObj = obj.getObj("serve")
        val serveSide = serveObj?.getStr("side") ?: obj.getStr("serveSide") ?: "A"
        val serveCount = serveObj?.getInt("server") ?: obj.getInt("serveCount") ?: 1

        val isBreakEl = obj.get("isBreak")
        val breakNote = obj.getStr("breakNote")
            ?: if (isBreakEl != null && isBreakEl.isJsonObject) (isBreakEl.asJsonObject.getStr("note") ?: "") else ""

        val setsEl = obj.get("sets")

        return MatchData(
            id = id,
            code = code,
            displayCode = resolvedDisplayCode,
            displayNameMode = displayNameMode,
            liveVersion = liveVersion,
            teamAName = teamAName,
            teamBName = teamBName,
            scoreA = scoreA,
            scoreB = scoreB,
            serveSide = serveSide,
            serveCount = serveCount,
            status = status,
            tournamentName = tournamentName,
            courtName = courtName,
            tournamentLogoUrl = tournamentLogoUrl,
            stageName = stageName,
            phaseText = phaseText,
            roundLabel = roundLabel,
            seedA = seedA,
            seedB = seedB,
            isBreak = isBreakEl,
            breakNote = breakNote,
            sets = setsEl,
            gameScores = gameScores,
            tournament = tournamentInfo,
            court = null,
        )
    }

    private fun extractPlayers(
        pair: JsonObject?,
        displayNameMode: String = "nickname",
    ): String? {
        if (pair == null) return null
        return normalizeTeamName(resolvePairDisplayName(pair, displayNameMode))
    }

    private fun extractOverlayScore(
        obj: JsonObject,
        gameScores: List<SetScore>?,
    ): Pair<Int, Int>? {
        val topLevelA = obj.getInt("scoreA")
        val topLevelB = obj.getInt("scoreB")
        if (topLevelA != null || topLevelB != null) {
            return (topLevelA ?: 0) to (topLevelB ?: 0)
        }

        val scoreObj = obj.getObj("score")
        if (scoreObj != null) {
            val nestedA = scoreObj.getInt("A") ?: scoreObj.getInt("a")
            val nestedB = scoreObj.getInt("B") ?: scoreObj.getInt("b")
            if (nestedA != null || nestedB != null) {
                return (nestedA ?: 0) to (nestedB ?: 0)
            }
        }

        val active =
            gameScores
                ?.firstOrNull { it.current }
                ?: obj.getInt("currentGame")?.let { currentIdx -> gameScores?.getOrNull(currentIdx) }
                ?: gameScores?.lastOrNull()
        val activeA = active?.a
        val activeB = active?.b
        return if (activeA != null || activeB != null) {
            (activeA ?: 0) to (activeB ?: 0)
        } else {
            null
        }
    }

    private fun normalizeMatchNames(match: MatchData): MatchData {
        return match.copy(
            teamAName = normalizeTeamName(match.teamAName),
            teamBName = normalizeTeamName(match.teamBName),
        )
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

    private fun computeDisplayCode(obj: JsonObject, labelKey: String): String? {
        val format = obj.getStr("format")
        val bracketType = obj.getStr("bracketType")
        val type = obj.getObj("bracket")?.getStr("type")

        val groupLike = isGroupType(type) || isGroupType(bracketType) || isGroupType(format) || hasNonEmptyPool(obj)

        val order = obj.getInt("order")
        val t = if (order != null && order >= 0) order + 1 else extractTFromLabelKey(labelKey)
        if (t <= 0) return null

        return if (groupLike) {
            val b = resolvePoolIndex(obj)
            if (b != null) "V1-B$b-T$t" else "V1-T$t"
        } else {
            val r = obj.getInt("globalRound") ?: obj.getInt("round") ?: 1
            "V$r-T$t"
        }
    }

    suspend fun startMatchRecordingSession(
        matchId: String,
        courtId: String?,
        mode: StreamMode,
        quality: Quality,
        recordingSessionId: String,
    ): Result<MatchRecordingResponse> {
        return try {
            val resp =
                api.startMatchRecording(
                    StartMatchRecordingRequest(
                        matchId = matchId,
                        courtId = courtId,
                        mode = mode.name,
                        quality = quality.label,
                        recordingSessionId = recordingSessionId,
                    )
                )
            if (resp.isSuccessful && resp.body() != null) {
                Result.success(resp.body()!!)
            } else {
                Result.failure(Exception("Start recording failed: ${resp.code()}"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "startMatchRecordingSession error", e)
            Result.failure(e)
        }
    }

    suspend fun presignRecordingSegment(
        recordingId: String,
        segmentIndex: Int,
    ): Result<RecordingSegmentPresignResponse> {
        return try {
            val resp =
                api.presignRecordingSegment(
                    RecordingSegmentPresignRequest(
                        recordingId = recordingId,
                        segmentIndex = segmentIndex,
                    )
                )
            if (resp.isSuccessful && resp.body() != null) {
                Result.success(resp.body()!!)
            } else {
                Result.failure(Exception("Presign recording segment failed: ${resp.code()}"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "presignRecordingSegment error", e)
            Result.failure(e)
        }
    }

    suspend fun presignRecordingSegmentBatch(
        recordingId: String,
        startSegmentIndex: Int,
        count: Int = 10,
    ): Result<RecordingSegmentPresignBatchResponse> {
        return try {
            val resp =
                api.presignRecordingSegmentBatch(
                    RecordingSegmentPresignBatchRequest(
                        recordingId = recordingId,
                        startSegmentIndex = startSegmentIndex,
                        count = count,
                    )
                )
            if (resp.isSuccessful && resp.body() != null) {
                Result.success(resp.body()!!)
            } else {
                Result.failure(Exception("Presign recording batch failed: ${resp.code()}"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "presignRecordingSegmentBatch error", e)
            Result.failure(e)
        }
    }

    suspend fun presignRecordingLiveManifest(
        recordingId: String,
    ): Result<RecordingLiveManifestPresignResponse> {
        return try {
            val resp =
                api.presignRecordingLiveManifest(
                    RecordingLiveManifestPresignRequest(recordingId = recordingId)
                )
            if (resp.isSuccessful && resp.body() != null) {
                Result.success(resp.body()!!)
            } else {
                Result.failure(Exception("Presign recording live manifest failed: ${resp.code()}"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "presignRecordingLiveManifest error", e)
            Result.failure(e)
        }
    }

    suspend fun startMultipartRecordingSegment(
        recordingId: String,
        segmentIndex: Int,
    ): Result<RecordingMultipartStartResponse> {
        return try {
            val resp =
                api.startMultipartRecordingSegment(
                    RecordingMultipartStartRequest(
                        recordingId = recordingId,
                        segmentIndex = segmentIndex,
                    )
                )
            if (resp.isSuccessful && resp.body() != null) {
                Result.success(resp.body()!!)
            } else {
                Result.failure(Exception("Start multipart recording segment failed: ${resp.code()}"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "startMultipartRecordingSegment error", e)
            Result.failure(e)
        }
    }

    suspend fun presignMultipartRecordingSegmentPart(
        recordingId: String,
        segmentIndex: Int,
        partNumber: Int,
    ): Result<RecordingMultipartPartUrlResponse> {
        return try {
            val resp =
                api.presignMultipartRecordingSegmentPart(
                    RecordingMultipartPartUrlRequest(
                        recordingId = recordingId,
                        segmentIndex = segmentIndex,
                        partNumber = partNumber,
                    )
                )
            if (resp.isSuccessful && resp.body() != null) {
                Result.success(resp.body()!!)
            } else {
                Result.failure(Exception("Presign multipart recording part failed: ${resp.code()}"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "presignMultipartRecordingSegmentPart error", e)
            Result.failure(e)
        }
    }

    suspend fun reportMultipartRecordingSegmentProgress(
        recordingId: String,
        segmentIndex: Int,
        partNumber: Int,
        etag: String,
        sizeBytes: Long,
        totalSizeBytes: Long,
    ): Result<MatchRecordingResponse> {
        return try {
            val resp =
                api.reportMultipartRecordingSegmentProgress(
                    RecordingMultipartProgressRequest(
                        recordingId = recordingId,
                        segmentIndex = segmentIndex,
                        partNumber = partNumber,
                        etag = etag,
                        sizeBytes = sizeBytes,
                        totalSizeBytes = totalSizeBytes,
                    )
                )
            if (resp.isSuccessful && resp.body() != null) {
                Result.success(resp.body()!!)
            } else if (resp.isSuccessful) {
                Result.success(MatchRecordingResponse(ok = true))
            } else {
                Result.failure(Exception("Multipart recording progress failed: ${resp.code()}"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "reportMultipartRecordingSegmentProgress error", e)
            Result.failure(e)
        }
    }

    suspend fun completeMultipartRecordingSegment(
        recordingId: String,
        segmentIndex: Int,
        sizeBytes: Long,
        durationSeconds: Double,
        isFinal: Boolean,
        parts: List<RecordingMultipartCompletedPart>,
    ): Result<MatchRecordingResponse> {
        return try {
            val resp =
                api.completeMultipartRecordingSegment(
                    RecordingMultipartCompleteRequest(
                        recordingId = recordingId,
                        segmentIndex = segmentIndex,
                        sizeBytes = sizeBytes,
                        durationSeconds = durationSeconds,
                        isFinal = isFinal,
                        parts = parts,
                    )
                )
            if (resp.isSuccessful && resp.body() != null) {
                Result.success(resp.body()!!)
            } else {
                Result.failure(Exception("Complete multipart recording segment failed: ${resp.code()}"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "completeMultipartRecordingSegment error", e)
            Result.failure(e)
        }
    }

    suspend fun abortMultipartRecordingSegment(
        recordingId: String,
        segmentIndex: Int,
    ): Result<MatchRecordingResponse> {
        return try {
            val resp =
                api.abortMultipartRecordingSegment(
                    RecordingMultipartAbortRequest(
                        recordingId = recordingId,
                        segmentIndex = segmentIndex,
                    )
                )
            if (resp.isSuccessful && resp.body() != null) {
                Result.success(resp.body()!!)
            } else if (resp.isSuccessful) {
                Result.success(MatchRecordingResponse(ok = true))
            } else {
                Result.failure(Exception("Abort multipart recording segment failed: ${resp.code()}"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "abortMultipartRecordingSegment error", e)
            Result.failure(e)
        }
    }

    suspend fun completeRecordingSegment(
        recordingId: String,
        segmentIndex: Int,
        objectKey: String,
        etag: String?,
        sizeBytes: Long,
        durationSeconds: Double,
        isFinal: Boolean,
    ): Result<MatchRecordingResponse> {
        return try {
            val resp =
                api.completeRecordingSegment(
                    RecordingSegmentCompleteRequest(
                        recordingId = recordingId,
                        segmentIndex = segmentIndex,
                        objectKey = objectKey,
                        etag = etag,
                        sizeBytes = sizeBytes,
                        durationSeconds = durationSeconds,
                        isFinal = isFinal,
                    )
                )
            if (resp.isSuccessful && resp.body() != null) {
                Result.success(resp.body()!!)
            } else {
                Result.failure(Exception("Complete recording segment failed: ${resp.code()}"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "completeRecordingSegment error", e)
            Result.failure(e)
        }
    }

    suspend fun finalizeRecording(
        recordingId: String,
    ): Result<MatchRecordingResponse> {
        return try {
            val resp = api.finalizeRecording(FinalizeMatchRecordingRequest(recordingId))
            if (resp.isSuccessful && resp.body() != null) {
                Result.success(resp.body()!!)
            } else {
                Result.failure(Exception("Finalize recording failed: ${resp.code()}"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "finalizeRecording error", e)
            Result.failure(e)
        }
    }

    suspend fun getRecordingByMatch(matchId: String): Result<MatchRecordingResponse> {
        return try {
            val resp = api.getRecordingByMatch(matchId)
            if (resp.isSuccessful && resp.body() != null) {
                Result.success(resp.body()!!)
            } else {
                Result.failure(Exception("Get recording by match failed: ${resp.code()}"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "getRecordingByMatch error", e)
            Result.failure(e)
        }
    }

    private fun matchToOverlayData(match: MatchData): OverlayData {
        return OverlayData(
            tournamentName = match.tournament?.name?.takeIf { it.isNotBlank() } ?: match.tournamentName,
            courtName = match.court?.name?.takeIf { it.isNotBlank() } ?: match.courtName,
            tournamentLogoUrl = match.tournament?.imageUrl
                ?.takeIf { it.isNotBlank() }
                ?: match.tournament?.logoUrl?.takeIf { it.isNotBlank() }
                ?: match.tournamentLogoUrl?.takeIf { it.isNotBlank() },
            stageName = match.stageName,
            phaseText = match.phaseText,
            roundLabel = match.roundLabel,
            teamAName = match.teamAName,
            teamBName = match.teamBName,
            scoreA = match.scoreA,
            scoreB = match.scoreB,
            seedA = match.seedA,
            seedB = match.seedB,
            serveSide = match.serveSide,
            serveCount = match.serveCount,
            isBreak = match.isBreak?.let { !it.isJsonNull && runCatching { it.asBoolean }.getOrDefault(false) } ?: false,
            breakNote = match.breakNote,
            sets = match.gameScores ?: emptyList(),
        )
    }

    private fun isGroupType(raw: String?): Boolean {
        val x = raw?.trim()?.lowercase().orEmpty()
        return x == "group" || x == "round_robin" || x == "gsl" || x == "groups" || x == "rr" || x == "swiss"
    }

    private fun hasNonEmptyPool(obj: JsonObject): Boolean {
        if (!obj.has("pool")) return false
        val p = obj.get("pool") ?: return false
        if (p.isJsonObject) {
            val po = p.asJsonObject
            return !po.getStr("name").isNullOrBlank() || !po.getStr("key").isNullOrBlank() || !po.getStr("code").isNullOrBlank()
        }
        return false
    }

    private fun resolvePoolIndex(obj: JsonObject): Int? {
        val poolEl = obj.get("pool") ?: return null
        if (!poolEl.isJsonObject) return null
        val pool = poolEl.asJsonObject
        val cand = (
            pool.getStr("index")
                ?: pool.getStr("idx")
                ?: pool.getStr("code")
                ?: pool.getStr("key")
                ?: pool.getStr("name")
        )?.trim().orEmpty()
        if (cand.isBlank()) return null

        if (cand.matches(Regex("^\\d+$"))) {
            val n = cand.toIntOrNull()
            return if (n != null && n > 0) n else null
        }

        val mB = Regex("^B(\\d+)$", RegexOption.IGNORE_CASE).find(cand)
        if (mB != null) {
            val n = mB.groupValues.getOrNull(1)?.toIntOrNull()
            return if (n != null && n > 0) n else null
        }

        val upper = cand.uppercase()
        if (upper.length == 1) {
            val c = upper[0]
            if (c in 'A'..'Z') return c.code - 'A'.code + 1
        }

        val letterToken = Regex("\\b([A-Za-z])\\b").find(cand)?.groupValues?.getOrNull(1)
        if (!letterToken.isNullOrBlank()) {
            val c = letterToken.uppercase()[0]
            if (c in 'A'..'Z') return c.code - 'A'.code + 1
        }

        val numToken = Regex("\\b(\\d+)\\b").find(cand)?.groupValues?.getOrNull(1)?.toIntOrNull()
        if (numToken != null && numToken > 0) return numToken

        return null
    }

    private fun extractTFromLabelKey(labelKey: String): Int {
        val m = Regex("(\\d+)$").find(labelKey.trim())
        return m?.groupValues?.getOrNull(1)?.toIntOrNull() ?: 1
    }

    private fun extractId(v: JsonElement?): String? {
        if (v == null) return null
        return when {
            v is com.google.gson.JsonPrimitive && v.isString -> v.asString.takeIf { it.isNotBlank() }
            v is JsonObject -> v.getAsJsonPrimitive("_id")?.asString?.takeIf { it.isNotBlank() }
                ?: v.getAsJsonPrimitive("id")?.asString?.takeIf { it.isNotBlank() }
            v.isJsonPrimitive && v.asJsonPrimitive.isString -> v.asString.takeIf { it.isNotBlank() }
            v.isJsonObject -> v.asJsonObject.getAsJsonPrimitive("_id")?.asString?.takeIf { it.isNotBlank() }
                ?: v.asJsonObject.getAsJsonPrimitive("id")?.asString?.takeIf { it.isNotBlank() }
            else -> null
        }
    }

    private fun JsonObject.getStr(key: String): String? =
        if (has(key) && !get(key).isJsonNull) runCatching { get(key).asString }.getOrNull() else null

    private fun JsonObject.getInt(key: String): Int? =
        if (has(key) && !get(key).isJsonNull) runCatching { get(key).asInt }.getOrNull() else null

    private fun JsonObject.getLong(key: String): Long? =
        if (has(key) && !get(key).isJsonNull) runCatching { get(key).asLong }.getOrNull() else null

    private fun JsonObject.getBool(key: String): Boolean? =
        if (has(key) && !get(key).isJsonNull) runCatching { get(key).asBoolean }.getOrNull() else null

    private fun JsonObject.getObj(key: String): JsonObject? =
        if (has(key) && get(key).isJsonObject) getAsJsonObject(key) else null
}
