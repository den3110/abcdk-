package com.pkt.live.ui

import android.Manifest
import android.app.ActivityManager
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.pm.PackageManager
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonPrimitive
import com.pkt.live.data.api.AuthInterceptor
import com.pkt.live.data.auth.TokenStore
import com.pkt.live.data.observer.ObserverTelemetryClient
import com.pkt.live.data.observer.ObserverTelemetryConnectionState
import com.pkt.live.data.recording.MatchRecordingCoordinator
import com.pkt.live.data.model.*
import com.pkt.live.data.repository.LiveRepository
import com.pkt.live.streaming.OverlayBitmapRenderer
import com.pkt.live.streaming.OverlayHealth
import com.pkt.live.streaming.Quality
import com.pkt.live.streaming.RecordingEngineState
import com.pkt.live.streaming.RtmpStreamManager
import com.pkt.live.streaming.StreamState
import com.pkt.live.streaming.MemoryPressureEvent
import com.pkt.live.streaming.RecoveryEvent
import com.pkt.live.streaming.RecoverySeverity
import com.pkt.live.streaming.RecoveryStage
import com.pkt.live.streaming.StreamRecoveryState
import com.pkt.live.streaming.ThermalEvent
import com.pkt.live.util.NetworkMonitor
import com.pkt.live.util.OrientationMode
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.util.Locale
import java.util.concurrent.atomic.AtomicLong
import java.util.UUID
import kotlin.coroutines.coroutineContext

/**
 * ViewModel for the live stream screen.
 * Bridges data layer -> UI layer.
 * All state is reactive via StateFlow.
 */
class LiveStreamViewModel(
    private val repository: LiveRepository,
    val streamManager: RtmpStreamManager,
    private val authInterceptor: AuthInterceptor,
    private val tokenStore: TokenStore,
    val overlayRenderer: OverlayBitmapRenderer,
    private val networkMonitor: NetworkMonitor,
    private val appContext: Context,
    private val recordingCoordinator: MatchRecordingCoordinator,
    private val observerTelemetryClient: ObserverTelemetryClient,
) : ViewModel() {

    companion object {
        private const val TAG = "LiveVM"
        private const val DEFAULT_COURT_WATCH_POLL_INTERVAL_MS = 5_000L
        private const val MATCH_LIVE_WAIT_POLL_INTERVAL_MS = 3_000L
    }

    // ===== Params from deeplink =====
    private var matchId: String = ""
    private var token: String = ""
    private var pageId: String? = null
    private var courtId: String = ""
    private var watchedCourtStationId: String? = null
    private var waitCourtJob: Job? = null
    private var waitMatchLiveJob: Job? = null
    private var initJob: Job? = null
    private var observersStarted: Boolean = false
    private var autoGoLive: Boolean = false
    private var lastRtmpRefreshMs: Long = 0L
    private val sessionEpoch = AtomicLong(0L)
    private val courtWatchEpoch = AtomicLong(0L)
    private var pendingSwitchMatchId: String? = null
    private var activeLiveMatchId: String? = null
    private var handledTerminalStatusMatchId: String? = null
    private var streamClientSessionId: String? = null
    private var leaseHeartbeatJob: Job? = null
    private var leaseId: String? = null
    private var leaseHeartbeatIntervalMs: Long = 15_000L
    private var lastLeaseRecoveryMs: Long = 0L
    private var courtPresenceClientSessionId: String? = null
    private var courtPresenceHeartbeatJob: Job? = null
    private var courtPresenceHeartbeatIntervalMs: Long = 5_000L
    private var liveScreenForeground: Boolean = false
    private var freshEntryRequired: Boolean = false
    private var goLiveCountdownJob: Job? = null
    private var stopLiveCountdownJob: Job? = null
    private var endingLiveDismissJob: Job? = null
    private var backgroundExitJob: Job? = null
    private var liveDeviceTelemetryJob: Job? = null
    private val liveDeviceTelemetryClientSessionId = UUID.randomUUID().toString()
    private val liveDeviceId = resolveLiveDeviceId()
    private var lastTelemetryOverlayEventKey: String? = null
    private var lastTelemetryRecoveryEventKey: String? = null
    private var lastTelemetryThermalEventKey: String? = null
    private var lastTelemetryMemoryPressureEventKey: String? = null

    private val vmExceptionHandler = CoroutineExceptionHandler { _, throwable ->
        if (throwable is CancellationException) return@CoroutineExceptionHandler
        Log.e(TAG, "Unhandled ViewModel coroutine exception", throwable)
        if (_errorMessage.value.isNullOrBlank()) {
            _errorMessage.value = "Đã chặn lỗi nội bộ để tránh crash app."
        }
    }

    // ===== UI State =====
    val streamState = streamManager.state
    val streamStats = streamManager.stats
    val bitrateUpdatedAtMs = streamManager.bitrateUpdatedAtMs
    val rtmpLastMessage = streamManager.rtmpLastMessage
    val lastMemoryPressure: StateFlow<MemoryPressureEvent?> = streamManager.lastMemoryPressure
    val lastRecovery: StateFlow<RecoveryEvent?> = streamManager.lastRecovery
    val recoveryState: StateFlow<StreamRecoveryState> = streamManager.recoveryState
    val overlayHealth: StateFlow<OverlayHealth> = streamManager.overlayHealth
    val brandingLoadState = overlayRenderer.brandingLoadState
    val recordingEngineState: StateFlow<RecordingEngineState> = streamManager.recordingState
    val recordingUiState = recordingCoordinator.recordingUiState
    val recordingStorageStatus = recordingCoordinator.storageStatus
    val streamMode = recordingCoordinator.selectedMode
    val powerSaveMode = streamManager.powerSaveMode
    val batteryTempC = streamManager.batteryTempC
    val isCharging = streamManager.isCharging
    val lastThermalEvent: StateFlow<ThermalEvent?> = streamManager.lastThermalEvent
    val torchOn = streamManager.torchOn
    val micMuted = streamManager.micMuted
    val previewReady = streamManager.previewReady
    val isFrontCamera = streamManager.isFrontCamera
    val zoomLevel = streamManager.zoomLevel

    val overlayData = repository.overlayData
    val socketConnected = repository.socketConnected
    val socketActiveMatchId = repository.socketActiveMatchId
    val socketLastPayloadAtMs = repository.socketLastPayloadAtMs
    val networkConnected = networkMonitor.isConnected
    val isWifi = networkMonitor.isWifi

    private val _rtmpUrl = MutableStateFlow<String?>(null)
    val rtmpUrl: StateFlow<String?> = _rtmpUrl.asStateFlow()
    private val _facebookLive = MutableStateFlow(FacebookLive())
    val facebookLive: StateFlow<FacebookLive> = _facebookLive.asStateFlow()

    private val _waitingForCourt = MutableStateFlow(false)
    val waitingForCourt: StateFlow<Boolean> = _waitingForCourt.asStateFlow()

    private val _waitingForMatchLive = MutableStateFlow(false)
    val waitingForMatchLive: StateFlow<Boolean> = _waitingForMatchLive.asStateFlow()

    private val _waitingForNextMatch = MutableStateFlow(false)
    val waitingForNextMatch: StateFlow<Boolean> = _waitingForNextMatch.asStateFlow()

    private val _matchInfo = MutableStateFlow<MatchData?>(null)
    val matchInfo: StateFlow<MatchData?> = _matchInfo.asStateFlow()

    private val _matchTransitioning = MutableStateFlow(false)
    val matchTransitioning: StateFlow<Boolean> = _matchTransitioning.asStateFlow()

    private val _overlayConfig = MutableStateFlow<OverlayConfig?>(null)
    val overlayConfig: StateFlow<OverlayConfig?> = _overlayConfig.asStateFlow()

    private val _quality = MutableStateFlow(Quality.DEFAULT)
    val quality: StateFlow<Quality> = _quality.asStateFlow()

    private val _loading = MutableStateFlow(true)
    val loading: StateFlow<Boolean> = _loading.asStateFlow()

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage.asStateFlow()

    private val _lastSocketError = MutableStateFlow<String?>(null)
    val lastSocketError: StateFlow<String?> = _lastSocketError.asStateFlow()

    private val _preflightDialog = MutableStateFlow<PreflightDialogState?>(null)
    val preflightDialog: StateFlow<PreflightDialogState?> = _preflightDialog.asStateFlow()

    private val _liveStartTime = MutableStateFlow<Long?>(null)
    val liveStartTime: StateFlow<Long?> = _liveStartTime.asStateFlow()
    private val _goLiveCountdownSeconds = MutableStateFlow<Int?>(null)
    val goLiveCountdownSeconds: StateFlow<Int?> = _goLiveCountdownSeconds.asStateFlow()
    private val _stopLiveCountdownSeconds = MutableStateFlow<Int?>(null)
    val stopLiveCountdownSeconds: StateFlow<Int?> = _stopLiveCountdownSeconds.asStateFlow()
    private val _endingLive = MutableStateFlow(false)
    val endingLive: StateFlow<Boolean> = _endingLive.asStateFlow()

    private val _batterySaver = MutableStateFlow(false)
    val batterySaver: StateFlow<Boolean> = _batterySaver.asStateFlow()

    private val _orientationMode = MutableStateFlow(OrientationMode.AUTO)
    val orientationMode: StateFlow<OrientationMode> = _orientationMode.asStateFlow()

    private val _fallbackColorArgb = MutableStateFlow<Int?>(null)
    val fallbackColorArgb: StateFlow<Int?> = _fallbackColorArgb.asStateFlow()
    private val _courtPresence = MutableStateFlow<CourtPresenceResponse?>(null)
    val courtPresence: StateFlow<CourtPresenceResponse?> = _courtPresence.asStateFlow()
    private val _showModeSelector = MutableStateFlow(true)
    val showModeSelector: StateFlow<Boolean> = _showModeSelector.asStateFlow()
    private val _recordOnlyArmed = MutableStateFlow(false)
    val recordOnlyArmed: StateFlow<Boolean> = _recordOnlyArmed.asStateFlow()
    private val _goLiveArmed = MutableStateFlow(false)
    val goLiveArmed: StateFlow<Boolean> = _goLiveArmed.asStateFlow()
    private val _recoveryDialogDismissedAtMs = MutableStateFlow(0L)
    val operatorRecoveryDialog: StateFlow<OperatorRecoveryDialogState?> =
        combine(recoveryState, streamState, rtmpLastMessage, quality, _recoveryDialogDismissedAtMs) {
                recovery, state, lastMessage, currentQuality, dismissedAt ->
            buildOperatorRecoveryDialog(
                recovery = recovery,
                streamState = state,
                rtmpLastMessage = lastMessage,
                quality = currentQuality,
                dismissedAt = dismissedAt,
            )
        }.stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private fun resolveOverlayTournamentId(match: MatchData?): String? =
        match?.tournament?.id?.trim()?.takeIf { it.isNotBlank() }

    private fun nextSessionEpoch(): Long = sessionEpoch.incrementAndGet()

    private fun isSessionCurrent(epoch: Long): Boolean = sessionEpoch.get() == epoch

    private fun nextCourtWatchEpoch(): Long = courtWatchEpoch.incrementAndGet()

    private fun isCourtWatchCurrent(epoch: Long): Boolean = courtWatchEpoch.get() == epoch

    private suspend fun waitForStreamSwitchReady(timeoutMs: Long = 2_500L) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val state = streamManager.state.value
            val ready =
                state !is StreamState.Live &&
                    state !is StreamState.Connecting &&
                    state !is StreamState.Reconnecting
            if (ready) return
            delay(120)
        }
    }

    private fun resetMatchScopedState() {
        goLiveCountdownJob?.cancel()
        goLiveCountdownJob = null
        stopLiveCountdownJob?.cancel()
        stopLiveCountdownJob = null
        _goLiveCountdownSeconds.value = null
        _stopLiveCountdownSeconds.value = null
        _endingLive.value = false
        _lastSocketError.value = null
        _errorMessage.value = null
        _recoveryDialogDismissedAtMs.value = 0L
        _rtmpUrl.value = null
        _facebookLive.value = FacebookLive()
        _matchInfo.value = null
        _overlayConfig.value = null
        streamManager.clearRtmpDiagnostics()
        handledTerminalStatusMatchId = null
        lastTelemetryOverlayEventKey = null
        lastTelemetryRecoveryEventKey = null
        lastTelemetryThermalEventKey = null
        lastTelemetryMemoryPressureEventKey = null
        _waitingForMatchLive.value = false
        _waitingForNextMatch.value = false
        waitMatchLiveJob?.cancel()
        waitMatchLiveJob = null
        leaseHeartbeatJob?.cancel()
        leaseHeartbeatJob = null
        streamClientSessionId = null
        leaseId = null
        leaseHeartbeatIntervalMs = 15_000L
        repository.resetOverlayData()
        overlayRenderer.updateData(com.pkt.live.data.model.OverlayData())
        overlayRenderer.refresh()
    }

    private fun watchCourtStationRuntime(stationId: String?) {
        val normalized = stationId?.trim().orEmpty()
        val current = watchedCourtStationId?.trim().orEmpty()
        if (normalized == current) return
        if (current.isNotBlank()) {
            repository.unwatchCourtStationRuntime(current)
        }
        watchedCourtStationId = normalized.takeIf { it.isNotBlank() }
        watchedCourtStationId?.let(repository::watchCourtStationRuntime)
    }

    private fun clearCourtStationRuntimeWatch() {
        val current = watchedCourtStationId?.trim().orEmpty()
        if (current.isNotBlank()) {
            repository.unwatchCourtStationRuntime(current)
        }
        watchedCourtStationId = null
    }

    private fun applyCourtRuntimeSnapshot(
        runtime: LiveAppCourtRuntimeResponse?,
        token: String,
        pageId: String?,
    ) {
        if (runtime == null) return
        val currentCourtMatchId = runtime.currentMatchId?.trim().takeIf { !it.isNullOrBlank() }
        val currentKnownMatchId = this.matchId.takeIf { it.isNotBlank() }

        // No match on court
        if (currentCourtMatchId.isNullOrBlank()) {
            val shouldPreserveActiveSession =
                !currentKnownMatchId.isNullOrBlank() &&
                    (hasActiveLivestreamState() || recordingEngineState.value.isRecording)
            if (shouldPreserveActiveSession) {
                return
            }
            if (!currentKnownMatchId.isNullOrBlank()) {
                pendingSwitchMatchId = null
                matchId = ""
                resetMatchScopedState()
            }
            _waitingForCourt.value = true
            _waitingForNextMatch.value = false
            _loading.value = false
            return
        }

        // Court reports same match we already know about
        if (currentCourtMatchId == currentKnownMatchId) {
            // If this match was already handled as terminal, stay in waiting state
            if (handledTerminalStatusMatchId == currentKnownMatchId) {
                return
            }
            _waitingForCourt.value = false
            _waitingForNextMatch.value = false
            return
        }

        // Court reports a different match — potential switch
        val foundMatchId =
            currentCourtMatchId.takeIf { it.isNotBlank() && it != currentKnownMatchId }

        if (!foundMatchId.isNullOrBlank()) {
            // Skip if this match was already handled as terminal (loop guard)
            if (foundMatchId == handledTerminalStatusMatchId) {
                _waitingForCourt.value = true
                return
            }
            _waitingForCourt.value = false
            _waitingForNextMatch.value = false
            if (
                !_matchTransitioning.value &&
                foundMatchId != this.matchId &&
                foundMatchId != pendingSwitchMatchId
            ) {
                switchToMatch(foundMatchId, token, pageId)
            }
        }
    }

    private suspend fun trySwitchToNextCourtMatchFallback(
        courtId: String,
        token: String,
        pageId: String?,
        runtime: LiveAppCourtRuntimeResponse?,
    ) {
        return
    }

    private fun isTerminalMatchStatus(status: String): Boolean =
        when (status.trim().lowercase()) {
            "ended", "finished", "completed", "done", "closed", "final", "cancelled", "canceled" -> true
            else -> false
        }

    private fun isLiveMatch(match: MatchData?): Boolean =
        match?.status?.trim()?.equals("live", ignoreCase = true) == true

    private fun hasActiveLivestreamState(): Boolean {
        val state = streamManager.state.value
        return _liveStartTime.value != null ||
            state is StreamState.Live ||
            state is StreamState.Connecting ||
            state is StreamState.Reconnecting ||
            streamManager.wantsToKeepStreaming()
    }

    private fun buildOperatorRecoveryDialog(
        recovery: StreamRecoveryState,
        streamState: StreamState,
        rtmpLastMessage: String?,
        quality: Quality,
        dismissedAt: Long,
    ): OperatorRecoveryDialogState? {
        if (recovery.stage == RecoveryStage.IDLE) return null
        val keepLiveIntent = streamManager.wantsToKeepStreaming() || hasActiveLivestreamState()
        if (!keepLiveIntent) return null
        if (!recovery.isFailSoftImminent && dismissedAt > 0L && recovery.atMs <= dismissedAt) return null

        val title =
            when (recovery.severity) {
                RecoverySeverity.CRITICAL -> "Live đang tự cứu ở mức nghiêm trọng"
                RecoverySeverity.WARNING -> "Live đang tự hồi phục"
                RecoverySeverity.INFO -> "Live đang tối ưu lại"
            }
        val detail = buildString {
            append(recovery.detail ?: recovery.summary)
            append("\n\n")
            append("Stage: ${recovery.stage.label}")
            append(" • Attempt: ${recovery.attempt}")
            append(" • Budget còn lại: ${recovery.budgetRemaining}")
            append(" • Quality hiện tại: ${quality.label}")
            if (streamState is StreamState.Reconnecting) {
                append("\nRTMP đang reconnect ${streamState.attempt}/${streamState.maxAttempts}.")
            }
            if (!rtmpLastMessage.isNullOrBlank()) {
                append("\nRTMP: $rtmpLastMessage")
            }
            recovery.lastFatalReason?.takeIf { it.isNotBlank() }?.let {
                append("\nNguồn lỗi gần nhất: $it")
            }
        }

        return OperatorRecoveryDialogState(
            title = title,
            summary = recovery.summary,
            detail = detail,
            severity = recovery.severity,
            stage = recovery.stage,
            attempt = recovery.attempt,
            budgetRemaining = recovery.budgetRemaining,
            activeMitigations = recovery.activeMitigations,
            lastFatalReason = recovery.lastFatalReason,
            isFailSoftImminent = recovery.isFailSoftImminent,
        )
    }

    private fun isWaitingForActivation(): Boolean =
        _waitingForCourt.value || _waitingForMatchLive.value || _waitingForNextMatch.value

    private fun isMatchSocketError(error: String?): Boolean {
        val normalized = error?.trim().orEmpty()
        return normalized.startsWith("Socket error:", ignoreCase = true) ||
            normalized.startsWith("Socket reconnect:", ignoreCase = true)
    }

    private fun isCourtRuntimeSocketError(error: String?): Boolean {
        val normalized = error?.trim().orEmpty()
        return normalized.startsWith("Court runtime socket error:", ignoreCase = true)
    }

    private fun shouldClearRecoveredMatchSocketError(
        connected: Boolean,
        activeMatchId: String?,
        lastPayloadAtMs: Long,
    ): Boolean {
        if (!connected) return false
        val currentMatchId = matchId.trim()
        if (currentMatchId.isBlank()) return true
        return activeMatchId?.trim() == currentMatchId || lastPayloadAtMs > 0L
    }

    private fun requiresModeSelection(): Boolean = primaryMode() == null || _showModeSelector.value

    private fun launchGuarded(
        name: String,
        dispatcher: CoroutineDispatcher = Dispatchers.Main.immediate,
        onErrorMessage: String? = null,
        block: suspend CoroutineScope.() -> Unit,
    ): Job = viewModelScope.launch(dispatcher + vmExceptionHandler) {
        try {
            block()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.e(TAG, "$name failed", e)
            if (!onErrorMessage.isNullOrBlank()) {
                _errorMessage.value = onErrorMessage
            }
        }
    }

    private fun ensureStreamClientSessionId(forceNew: Boolean = false): String {
        val existingSessionId = streamClientSessionId
        if (forceNew || existingSessionId.isNullOrBlank()) {
            val newSessionId = UUID.randomUUID().toString()
            streamClientSessionId = newSessionId
            leaseId = null
            leaseHeartbeatIntervalMs = 15_000L
            return newSessionId
        }
        return existingSessionId
    }

    private fun ensureCourtPresenceClientSessionId(forceNew: Boolean = false): String {
        val existingSessionId = courtPresenceClientSessionId
        if (forceNew || existingSessionId.isNullOrBlank()) {
            val newSessionId = UUID.randomUUID().toString()
            courtPresenceClientSessionId = newSessionId
            courtPresenceHeartbeatIntervalMs = 5_000L
            return newSessionId
        }
        return existingSessionId
    }

    private fun shouldMaintainLease(state: StreamState): Boolean =
        state is StreamState.Live || state is StreamState.Connecting || state is StreamState.Reconnecting

    private fun applyCourtPresenceResponse(response: CourtPresenceResponse) {
        response.clientSessionId?.takeIf { it.isNotBlank() }?.let {
            courtPresenceClientSessionId = it
        }
        response.heartbeatIntervalMs?.takeIf { it >= 5_000L }?.let {
            courtPresenceHeartbeatIntervalMs = it
        }
        _courtPresence.value = response
    }

    private fun clearCourtPresenceLocalState() {
        courtPresenceHeartbeatJob?.cancel()
        courtPresenceHeartbeatJob = null
        _courtPresence.value = null
        courtPresenceClientSessionId = null
        courtPresenceHeartbeatIntervalMs = 5_000L
    }

    private fun currentCourtPresenceScreenState(): String {
        val state = streamManager.state.value
        return when {
            stopLiveCountdownJob?.isActive == true || _endingLive.value -> "ending_live"
            goLiveCountdownJob?.isActive == true -> "starting_countdown"
            waitingForNextMatch.value -> "waiting_for_next_match"
            waitingForCourt.value || waitingForMatchLive.value -> "waiting_for_court"
            state is StreamState.Live -> "live"
            state is StreamState.Connecting -> "connecting"
            state is StreamState.Reconnecting -> "reconnecting"
            state is StreamState.Previewing -> "preview"
            else -> "idle"
        }
    }

    fun currentDebugMatchId(): String? = matchId.trim().takeIf { it.isNotBlank() }

    fun currentDebugCourtId(): String? = courtId.trim().takeIf { it.isNotBlank() }

    private fun shouldMaintainCourtPresence(): Boolean =
        liveScreenForeground && courtId.isNotBlank() && token.isNotBlank()

    fun selectStreamMode(mode: StreamMode) {
        recordingCoordinator.selectMode(mode)
        recordingCoordinator.refreshStorageStatusAsync(_quality.value)
    }

    private fun armRecordOnlySession() {
        _recordOnlyArmed.value = true
        setAutoGoLive(true)
    }

    private fun disarmRecordOnlySession(clearWaitingState: Boolean = true) {
        _recordOnlyArmed.value = false
        if (primaryMode() == StreamMode.RECORD_ONLY) {
            setAutoGoLive(false)
            if (clearWaitingState) {
                _waitingForMatchLive.value = false
                _waitingForNextMatch.value = false
            }
        }
    }

    private fun setAutoGoLive(value: Boolean) {
        autoGoLive = value
        _goLiveArmed.value = value
    }

    fun confirmStreamMode(mode: StreamMode) {
        selectStreamMode(mode)
        _showModeSelector.value = false
        _errorMessage.value = null
        if (mode == StreamMode.RECORD_ONLY) {
            _recordOnlyArmed.value = false
            setAutoGoLive(false)
            _waitingForMatchLive.value = false
            _waitingForNextMatch.value = false
        } else {
            disarmRecordOnlySession(clearWaitingState = false)
            setAutoGoLive(false)
        }
    }

    fun reopenModeSelector() {
        _showModeSelector.value = true
    }

    private fun primaryMode(): StreamMode? = streamMode.value

    private fun currentSessionHasRecording(): Boolean =
        primaryMode()?.includesRecording == true || recordingEngineState.value.isRecording

    private fun currentSessionHasLivestream(): Boolean =
        primaryMode()?.includesLivestream == true || hasActiveLivestreamState()

    private fun canAutoRestartPreviewWhileWaiting(): Boolean =
        liveScreenForeground &&
            backgroundExitJob?.isActive != true &&
            !_showModeSelector.value &&
            primaryMode() != null

    private suspend fun maybeStartRecordingForCurrentMatch(
        allowSoftFailureForLivestream: Boolean,
    ): Boolean {
        val mode = primaryMode() ?: run {
            _showModeSelector.value = true
            return false
        }
        if (!mode.includesRecording) return true

        val targetMatchId = matchId.takeIf { it.isNotBlank() } ?: run {
            val message = "Chưa có trận để ghi hình."
            recordingCoordinator.noteSoftError(message)
            _errorMessage.value = message
            return false
        }

        val currentRecording = recordingEngineState.value
        if (currentRecording.isRecording && currentRecording.matchId == targetMatchId) {
            return true
        }

        val storageStatus = recordingCoordinator.checkStorageBeforeMatchRecording(_quality.value)
        streamManager.setRecordingSegmentDurationMs(storageStatus.segmentDurationSeconds * 1000L)
        if (storageStatus.hardBlock) {
            val message =
                storageStatus.message
                    ?: "Không đủ bộ nhớ để bắt đầu ghi hình."
            recordingCoordinator.noteSoftError(message)
            if (allowSoftFailureForLivestream) {
                _errorMessage.value = "$message Livestream vẫn tiếp tục."
                return true
            }
            _errorMessage.value = message
            return false
        }

        val preparedRecording =
            recordingCoordinator.prepareForMatchRecording(
                matchId = targetMatchId,
                courtId = courtId.takeIf { it.isNotBlank() },
                quality = _quality.value,
            ).getOrElse { error ->
                val message = error.message ?: "Không chuẩn bị được ghi hình."
                recordingCoordinator.noteSoftError(message)
                if (allowSoftFailureForLivestream) {
                    _errorMessage.value = "$message Livestream vẫn tiếp tục."
                    return true
                }
                _errorMessage.value = message
                return false
            }

        val recordingSessionId =
            preparedRecording.recordingSessionId.ifBlank { UUID.randomUUID().toString() }
        val started =
            streamManager.startMatchRecording(
                matchId = targetMatchId,
                recordingId = preparedRecording.id,
                recordingSessionId = recordingSessionId,
            ).getOrElse { error ->
                val message = error.message ?: "Không bắt đầu được ghi hình."
                recordingCoordinator.noteSoftError(message)
                if (allowSoftFailureForLivestream) {
                    _errorMessage.value = "$message Livestream vẫn tiếp tục."
                    return true
                }
                _errorMessage.value = message
                return false
            }

        recordingCoordinator.markRecordingStarted()
        return started == Unit
    }

    private suspend fun stopRecordingIfNeeded(
        reason: String,
        softMessage: String? = null,
    ) {
        if (!recordingEngineState.value.isRecording && !currentSessionHasRecording()) return
        streamManager.stopMatchRecording(finalize = true, reason = reason)
            .onFailure {
                val message = it.message ?: "Không kết thúc được ghi hình."
                recordingCoordinator.noteSoftError(message)
                _errorMessage.value = message
            }
        recordingCoordinator.markRecordingStoppedSoft(softMessage)
    }

    private suspend fun startRecordOnly() {
        if (recordingEngineState.value.isRecording || recordingUiState.value.status == "preparing") {
            return
        }
        if (_matchTransitioning.value) {
            _errorMessage.value = "Đang chuyển trận, chưa thể ghi hình."
            return
        }
        val targetMatchId = matchId.takeIf { it.isNotBlank() } ?: run {
            _errorMessage.value = "Chưa có trận để ghi hình."
            return
        }
        recordingCoordinator.setLiveCriticalPathBusy(true)
        try {
            _errorMessage.value = null
            _loading.value = false
            _waitingForCourt.value = false
            _waitingForMatchLive.value = false
            if (!runGoLiveCountdown(targetMatchId)) return
            maybeStartRecordingForCurrentMatch(allowSoftFailureForLivestream = false)
        } finally {
            recordingCoordinator.setLiveCriticalPathBusy(false)
        }
    }

    private suspend fun completeStopPrimarySession() {
        val mode = primaryMode()
        val stopRecording = mode?.includesRecording == true || recordingEngineState.value.isRecording
        val stopLivestream = mode?.includesLivestream == true || hasActiveLivestreamState()

        if (stopRecording) {
            stopRecordingIfNeeded(reason = "user_stop")
        }
        if (stopLivestream) {
            streamManager.stopStream()
        } else {
            dismissEndingLiveSoon(700L)
        }
    }

    private suspend fun startCourtPresenceIfNeeded(forceNewSession: Boolean = false): Boolean {
        if (freshEntryRequired) return false
        val targetCourtId = courtId.takeIf { it.isNotBlank() } ?: return true
        val sessionId = ensureCourtPresenceClientSessionId(forceNew = forceNewSession)
        val response =
            withContext(Dispatchers.IO) {
                repository.startCourtPresence(
                    courtId = targetCourtId,
                    clientSessionId = sessionId,
                    screenState = currentCourtPresenceScreenState(),
                    matchId = matchId.takeIf { it.isNotBlank() },
                )
            }
        return response.fold(
            onSuccess = { payload ->
                applyCourtPresenceResponse(payload)
                when (payload.status?.trim()?.lowercase()) {
                    "blocked" -> {
                        clearCourtPresenceLocalState()
                        _loading.value = false
                        _waitingForCourt.value = false
                        _waitingForNextMatch.value = false
                        _errorMessage.value =
                            "Sân này đang có thiết bị khác giữ màn live. Hãy chọn sân khác hoặc đợi sân này tự động được trả."
                        false
                    }
                    else -> {
                        if (
                            _errorMessage.value?.contains("Sân đã được trả lại", ignoreCase = true) == true ||
                                _errorMessage.value?.contains("Giữ sân đã hết hạn", ignoreCase = true) == true ||
                                _errorMessage.value?.contains("thiết bị khác giữ", ignoreCase = true) == true
                        ) {
                            _errorMessage.value = null
                        }
                        true
                    }
                }
            },
            onFailure = {
                Log.e(TAG, "startCourtPresence failed softly: ${it.message}")
                true
            },
        )
    }

    private fun startCourtPresenceHeartbeatLoop() {
        if (freshEntryRequired) return
        if (!shouldMaintainCourtPresence()) return
        val targetCourtId = courtId
        val sessionId = ensureCourtPresenceClientSessionId()
        if (
            courtPresenceHeartbeatJob?.isActive == true &&
                targetCourtId == courtId &&
                courtPresenceClientSessionId == sessionId
        ) {
            return
        }

        courtPresenceHeartbeatJob?.cancel()
        courtPresenceHeartbeatJob =
            launchGuarded(name = "courtPresenceHeartbeatLoop") {
                while (
                    isActive &&
                        shouldMaintainCourtPresence() &&
                        courtId == targetCourtId &&
                        courtPresenceClientSessionId == sessionId
                ) {
                    val result =
                        repository.heartbeatCourtPresence(
                            courtId = targetCourtId,
                            clientSessionId = sessionId,
                            screenState = currentCourtPresenceScreenState(),
                            matchId = matchId.takeIf { it.isNotBlank() },
                        )
                    result.onSuccess { payload ->
                        applyCourtPresenceResponse(payload)
                        when (payload.status?.trim()?.lowercase()) {
                            "blocked" -> {
                                clearCourtPresenceLocalState()
                                _errorMessage.value =
                                    "Sân này vừa được thiết bị khác giữ. App sẽ dừng giữ sân này trên máy hiện tại."
                                _waitingForCourt.value = false
                                _waitingForNextMatch.value = false
                            }
                            "expired", "released" -> {
                                clearCourtPresenceLocalState()
                                _errorMessage.value =
                                    if (payload.reason == "preview_stale_auto" || payload.reason == "not_found") {
                                        "Sân đã được trả lại do preview quá lâu. Hãy quay lại màn chọn sân nếu muốn giữ tiếp."
                                    } else {
                                        "Giữ sân đã hết hạn."
                                    }
                            }
                            else -> {
                                if (
                                    _errorMessage.value?.contains("Sân đã được trả lại", ignoreCase = true) == true ||
                                        _errorMessage.value?.contains("Giữ sân đã hết hạn", ignoreCase = true) == true
                                ) {
                                    _errorMessage.value = null
                                }
                            }
                        }
                    }.onFailure {
                        Log.e(TAG, "court presence heartbeat failed softly: ${it.message}")
                    }

                    delay(courtPresenceHeartbeatIntervalMs.coerceAtLeast(5_000L))
                }
            }
    }

    private fun endCourtPresenceAsync() {
        val targetCourtId = courtId.takeIf { it.isNotBlank() }
        val sessionId = courtPresenceClientSessionId?.takeIf { it.isNotBlank() }
        clearCourtPresenceLocalState()
        if (targetCourtId.isNullOrBlank() || sessionId.isNullOrBlank()) return
        launchGuarded(name = "endCourtPresence", dispatcher = Dispatchers.IO) {
            repository.endCourtPresence(targetCourtId, sessionId)
        }
    }

    private fun applyLeaseResponse(response: StreamNotifyResponse) {
        response.clientSessionId?.takeIf { it.isNotBlank() }?.let {
            streamClientSessionId = it
        }
        response.leaseId?.takeIf { it.isNotBlank() }?.let {
            leaseId = it
        }
        response.heartbeatIntervalMs?.takeIf { it >= 5_000L }?.let {
            leaseHeartbeatIntervalMs = it
        }
    }

    private fun maybeRecoverExpiredLease(targetMatchId: String, reason: String) {
        val now = System.currentTimeMillis()
        if (!autoGoLive || targetMatchId.isBlank()) return
        if (freshEntryRequired || isWaitingForActivation()) return
        if (matchId != targetMatchId) return
        if (now - lastLeaseRecoveryMs < 10_000L) return
        lastLeaseRecoveryMs = now

        leaseHeartbeatJob?.cancel()
        leaseHeartbeatJob = null
        leaseId = null
        ensureStreamClientSessionId(forceNew = true)
        _lastSocketError.value = "Live lease $reason. Đang xin lại session live."

        launchGuarded(name = "recoverExpiredLease") {
            repository.createLiveSession(targetMatchId, pageId, forceNew = true).onSuccess { session ->
                if (this@LiveStreamViewModel.matchId != targetMatchId) return@onSuccess
                _facebookLive.value = session.facebook ?: FacebookLive()
                val newUrl = session.facebook?.buildRtmpUrl()
                if (!newUrl.isNullOrBlank()) {
                    _rtmpUrl.value = newUrl
                    activeLiveMatchId = targetMatchId
                    streamManager.startStream(newUrl)
                }
            }.onFailure {
                Log.e(TAG, "recoverExpiredLease failed: ${it.message}")
            }
        }
    }

    private fun startLeaseHeartbeatLoop(targetMatchId: String, clientSessionId: String) {
        if (targetMatchId.isBlank()) return
        if (leaseHeartbeatJob?.isActive == true && streamClientSessionId == clientSessionId) return

        leaseHeartbeatJob?.cancel()
        leaseHeartbeatJob = launchGuarded(name = "leaseHeartbeatLoop") {
            while (
                isActive &&
                activeLiveMatchId == targetMatchId &&
                streamClientSessionId == clientSessionId
            ) {
                val currentState = streamManager.state.value
                if (shouldMaintainLease(currentState)) {
                    val result = if (leaseId.isNullOrBlank()) {
                        repository.notifyStreamStarted(targetMatchId, clientSessionId)
                    } else {
                        repository.notifyStreamHeartbeat(targetMatchId, clientSessionId)
                    }

                    result.onSuccess { response ->
                        applyLeaseResponse(response)
                        val leaseStatus = response.leaseStatus?.trim()?.lowercase().orEmpty()
                        val leaseOk = response.ok && (leaseStatus.isBlank() || leaseStatus == "active")
                        if (!leaseOk && leaseStatus in setOf("expired", "not_found", "ended", "conflict")) {
                            maybeRecoverExpiredLease(targetMatchId, leaseStatus)
                        }
                    }.onFailure {
                        Log.e(TAG, "lease heartbeat failed: ${it.message}")
                    }
                }

                delay(leaseHeartbeatIntervalMs.coerceAtLeast(5_000L))
            }
        }
    }

    private fun clearActiveLiveSession(notifyEnd: Boolean) {
        val hadLiveSession = _liveStartTime.value != null
        val endedMatchId = activeLiveMatchId
        val endedClientSessionId = streamClientSessionId

        _liveStartTime.value = null
        activeLiveMatchId = null
        leaseHeartbeatJob?.cancel()
        leaseHeartbeatJob = null
        leaseId = null
        streamClientSessionId = null
        leaseHeartbeatIntervalMs = 15_000L

        if (notifyEnd && hadLiveSession && !endedMatchId.isNullOrBlank()) {
            launchGuarded(name = "notifyStreamEnded") {
                repository.notifyStreamEnded(endedMatchId, endedClientSessionId)
            }
        }
    }

    private fun enterWaitingForNextMatch() {
        _loading.value = false
        _endingLive.value = false
        stopLiveCountdownJob?.cancel()
        stopLiveCountdownJob = null
        _stopLiveCountdownSeconds.value = null
        _errorMessage.value = null
        _lastSocketError.value = null
        _waitingForMatchLive.value = false
        _waitingForCourt.value = true
        _waitingForNextMatch.value = true
        _rtmpUrl.value = null
        _facebookLive.value = FacebookLive()
        // Keep matchId — needed by polling guard to detect "same ended match"
        // and avoid re-triggering switchToMatch in a loop.
        // Clear display data so overlay doesn't show stale match info while waiting.
        _matchInfo.value = null
        _overlayConfig.value = null
        repository.resetOverlayData()
        overlayRenderer.updateData(com.pkt.live.data.model.OverlayData())
        overlayRenderer.refresh()
        streamManager.clearRtmpDiagnostics()
        repository.disconnectSocket()
    }

    /**
     * Initialize with deeplink params. Called once from Activity.
     */
    fun init(matchId: String, token: String, pageId: String? = null) {
        if (!freshEntryRequired && this.matchId == matchId && this.token == token && this.pageId == pageId) return
        setAutoGoLive(false)
        freshEntryRequired = false
        recordingCoordinator.clearModeSelection()
        recordingCoordinator.refreshStorageStatusAsync(_quality.value)
        _showModeSelector.value = true
        val sessionEpoch = nextSessionEpoch()
        nextCourtWatchEpoch()
        waitCourtJob?.cancel()
        waitCourtJob = null
        waitMatchLiveJob?.cancel()
        waitMatchLiveJob = null
        pendingSwitchMatchId = null
        _matchTransitioning.value = false
        courtId = ""
        clearCourtStationRuntimeWatch()
        _waitingForCourt.value = false
        val targetMatchId = matchId.trim()
        this.matchId = targetMatchId
        this.token = token
        this.pageId = pageId
        resetMatchScopedState()

        // Set auth token for API calls
        authInterceptor.token = token

        ensureObservers()
        overlayRenderer.start()

        initJob?.cancel()
        // Load all data
        initJob = launchGuarded(
            name = "init",
            dispatcher = Dispatchers.Default,
            onErrorMessage = "Khởi tạo thất bại.",
        ) {
            _loading.value = true
            try {
                // 1. Connect socket for real-time updates
                withContext(Dispatchers.IO) {
                    repository.connectSocket(token, targetMatchId)
                }
                if (!isSessionCurrent(sessionEpoch) || this@LiveStreamViewModel.matchId != targetMatchId) return@launchGuarded

                // 2. Load match info
                withContext(Dispatchers.IO) {
                    repository.getMatchInfo(targetMatchId)
                }.onSuccess { match ->
                    if (!isSessionCurrent(sessionEpoch) || this@LiveStreamViewModel.matchId != targetMatchId) return@onSuccess
                    _matchInfo.value = match
                    seedOverlayFromMatch(match)
                    (match.courtStationId ?: match.court?.id)
                        ?.trim()
                        ?.takeIf { it.isNotBlank() }
                        ?.let { resolvedCourtId ->
                        if (this@LiveStreamViewModel.courtId.isBlank()) {
                            this@LiveStreamViewModel.courtId = resolvedCourtId
                            watchCourtStationRuntime(resolvedCourtId)
                            if (liveScreenForeground) {
                                launchGuarded(name = "claimCourtPresenceFromMatch") {
                                    if (!startCourtPresenceIfNeeded()) return@launchGuarded
                                    startCourtPresenceHeartbeatLoop()
                                }
                            }
                        }
                    }
                    Log.d(TAG, "Match loaded: ${match.teamAName} vs ${match.teamBName}")
                }.onFailure { e ->
                    Log.e(TAG, "Match info failed", e)
                }
                if (!isSessionCurrent(sessionEpoch) || this@LiveStreamViewModel.matchId != targetMatchId) return@launchGuarded

                // 3. Load overlay config (sponsors)
                withContext(Dispatchers.IO) {
                    repository.getOverlayConfig(resolveOverlayTournamentId(_matchInfo.value))
                }.onSuccess { config ->
                    if (!isSessionCurrent(sessionEpoch) || this@LiveStreamViewModel.matchId != targetMatchId) return@onSuccess
                    _overlayConfig.value = config
                    Log.d(TAG, "Overlay config loaded: ${config.sponsors.size} sponsors")
                }.onFailure { e ->
                    Log.e(TAG, "Overlay config failed", e)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Init failed", e)
                if (isSessionCurrent(sessionEpoch) && this@LiveStreamViewModel.matchId == targetMatchId) {
                    _errorMessage.value = "Khởi tạo thất bại: ${e.message}"
                }
            } finally {
                if (isSessionCurrent(sessionEpoch) && this@LiveStreamViewModel.matchId == targetMatchId) {
                    _loading.value = false
                }
            }
        }
    }

    // ===== Actions =====

    fun initByCourt(courtId: String, token: String, pageId: String? = null) {
        val cid = courtId.trim()
        if (cid.isBlank()) {
            _errorMessage.value = "Thiếu courtId"
            return
        }
        if (!freshEntryRequired && this.courtId == cid && this.token == token && this.pageId == pageId && this.matchId.isBlank()) return

        nextSessionEpoch()
        val courtWatchEpoch = nextCourtWatchEpoch()
        freshEntryRequired = false
        recordingCoordinator.clearModeSelection()
        recordingCoordinator.refreshStorageStatusAsync(_quality.value)
        _showModeSelector.value = true
        _recordOnlyArmed.value = false
        setAutoGoLive(false)
        pendingSwitchMatchId = null
        _matchTransitioning.value = false
        this.courtId = cid
        watchCourtStationRuntime(cid)
        this.matchId = ""
        this.token = token
        this.pageId = pageId
        _waitingForCourt.value = true
        _waitingForNextMatch.value = false

        authInterceptor.token = token

        _loading.value = true
        resetMatchScopedState()
        _waitingForCourt.value = true

        repository.connectSocketSession(token)
        repository.disconnectSocket()

        ensureObservers()
        overlayRenderer.start()
        streamManager.startPreview(_quality.value)
        _loading.value = false
        _errorMessage.value = null

        waitCourtJob?.cancel()
        waitCourtJob = launchGuarded(
            name = "waitCourt",
            onErrorMessage = "Không theo dõi được sân để mở live.",
        ) goLiveGuarded@{
            if (!startCourtPresenceIfNeeded()) return@goLiveGuarded
            if (liveScreenForeground) {
                startCourtPresenceHeartbeatLoop()
            }
            while (isActive) {
                if (!isCourtWatchCurrent(courtWatchEpoch) || this@LiveStreamViewModel.courtId != cid) return@goLiveGuarded
                val courtRuntime = repository.getCourtRuntime(cid).getOrNull()
                applyCourtRuntimeSnapshot(courtRuntime, token, pageId)
                trySwitchToNextCourtMatchFallback(cid, token, pageId, courtRuntime)
                delay(courtRuntime?.recommendedPollIntervalMs ?: DEFAULT_COURT_WATCH_POLL_INTERVAL_MS)
            }
        }
    }

    fun onHostResumed() {
        liveScreenForeground = true
        if (freshEntryRequired) return
        if (courtId.isBlank()) return
        if (matchId.isNotBlank() && _matchInfo.value == null && token.isNotBlank() && initJob?.isActive != true) {
            init(matchId, token, pageId)
            return
        }
        if (matchId.isBlank() && token.isNotBlank() && waitCourtJob?.isActive != true) {
            initByCourt(courtId, token, pageId)
            return
        }
        launchGuarded(name = "resumeCourtPresence") {
            if (!startCourtPresenceIfNeeded()) return@launchGuarded
            startCourtPresenceHeartbeatLoop()
        }
    }

    fun onHostPaused() {
        liveScreenForeground = false
        courtPresenceHeartbeatJob?.cancel()
        courtPresenceHeartbeatJob = null
    }

    fun onHostStopped(isChangingConfigurations: Boolean) {
        if (isChangingConfigurations) return
        courtPresenceHeartbeatJob?.cancel()
        courtPresenceHeartbeatJob = null
        endCourtPresenceAsync()
        performBackgroundExitAsync()
    }

    fun onHostDestroyed(isFinishing: Boolean, isChangingConfigurations: Boolean) {
        liveScreenForeground = false
        if (isChangingConfigurations) return
        if (isFinishing && backgroundExitJob?.isActive != true) {
            endCourtPresenceAsync()
            performBackgroundExitAsync()
            return
        }
        clearCourtPresenceLocalState()
    }

    fun extendCourtPresencePreviewWindow() {
        val targetCourtId = courtId.takeIf { it.isNotBlank() } ?: return
        val sessionId = courtPresenceClientSessionId?.takeIf { it.isNotBlank() } ?: return
        launchGuarded(name = "extendCourtPresencePreview", dispatcher = Dispatchers.IO) {
            repository.extendCourtPresencePreview(targetCourtId, sessionId).onSuccess { payload ->
                applyCourtPresenceResponse(payload)
            }.onFailure {
                Log.e(TAG, "extendCourtPresencePreview failed softly: ${it.message}")
            }
        }
    }

    fun goLive() {
        val mode = primaryMode()
        if (mode == null) {
            _showModeSelector.value = true
            return
        }
        if (mode == StreamMode.RECORD_ONLY) {
            if (_matchTransitioning.value) {
                armRecordOnlySession()
                _errorMessage.value = null
                return
            }
            if (matchId.isBlank()) {
                if (_waitingForCourt.value) {
                    armRecordOnlySession()
                    _loading.value = false
                    _errorMessage.value = null
                    return
                }
                _errorMessage.value = "Chưa có trận để ghi hình."
                return
            }

            armRecordOnlySession()
            _waitingForNextMatch.value = false
            val sessionEpoch = this.sessionEpoch.get()
            val targetMatchId = matchId
            val currentIsLive = _matchInfo.value?.status?.trim()?.equals("live", ignoreCase = true) == true
            if (currentIsLive) {
                _loading.value = false
                _waitingForMatchLive.value = false
                launchGuarded(name = "startRecordOnlyLiveMatch") {
                    startRecordOnly()
                }
                return
            }

            _errorMessage.value = null
            _loading.value = false
            _rtmpUrl.value = null
            _facebookLive.value = FacebookLive()
            clearActiveLiveSession(notifyEnd = false)
            streamManager.clearRtmpDiagnostics()
            _waitingForMatchLive.value = true
            waitMatchLiveJob?.cancel()
            waitMatchLiveJob =
                launchGuarded(
                    name = "waitMatchLiveForRecordOnly",
                    onErrorMessage = "Không theo dõi được trạng thái trận để ghi hình.",
                ) {
                    while (isActive) {
                        if (!isSessionCurrent(sessionEpoch) || this@LiveStreamViewModel.matchId != targetMatchId) return@launchGuarded
                        withContext(Dispatchers.IO) {
                            repository.getMatchInfo(targetMatchId)
                        }.onSuccess { match ->
                            if (!isSessionCurrent(sessionEpoch) || this@LiveStreamViewModel.matchId != targetMatchId) return@onSuccess
                            _matchInfo.value = match
                        }
                        val nowLive = _matchInfo.value?.status?.trim()?.equals("live", ignoreCase = true) == true
                        if (nowLive) break
                        delay(MATCH_LIVE_WAIT_POLL_INTERVAL_MS)
                    }
                    if (!isSessionCurrent(sessionEpoch) || this@LiveStreamViewModel.matchId != targetMatchId) return@launchGuarded
                    _waitingForMatchLive.value = false
                    startRecordOnly()
                }
            return
        }

        if (_matchTransitioning.value) {
            setAutoGoLive(true)
            _errorMessage.value = null
            return
        }
        if (matchId.isBlank()) {
            if (_waitingForCourt.value) {
                setAutoGoLive(true)
                _errorMessage.value = null
                return
            }
            _errorMessage.value = "Chưa có trận để live."
            return
        }
        setAutoGoLive(true)
        _waitingForNextMatch.value = false
        val sessionEpoch = this.sessionEpoch.get()
        val targetMatchId = matchId
        val currentIsLive = _matchInfo.value?.status?.trim()?.equals("live", ignoreCase = true) == true
        if (currentIsLive) {
            startStreamWithLiveSession()
            return
        }

        _errorMessage.value = null
        _loading.value = true
        waitMatchLiveJob?.cancel()
        waitMatchLiveJob = null

        launchGuarded(
            name = "goLive",
            onErrorMessage = "Không thể bắt đầu quy trình go live.",
        ) goLiveGuarded@{
            withContext(Dispatchers.IO) {
                repository.getMatchInfo(targetMatchId)
            }.onSuccess { match ->
                if (!isSessionCurrent(sessionEpoch) || this@LiveStreamViewModel.matchId != targetMatchId) return@onSuccess
                _matchInfo.value = match
            }.onFailure { e ->
                if (isSessionCurrent(sessionEpoch) && this@LiveStreamViewModel.matchId == targetMatchId) {
                    _loading.value = false
                    _errorMessage.value = e.message ?: "Không tải được thông tin trận"
                }
                return@goLiveGuarded
            }
            if (!isSessionCurrent(sessionEpoch) || this@LiveStreamViewModel.matchId != targetMatchId) return@goLiveGuarded

            val isLiveNow = _matchInfo.value?.status?.trim()?.equals("live", ignoreCase = true) == true
            if (isLiveNow) {
                _loading.value = false
                _waitingForMatchLive.value = false
                startStreamWithLiveSession()
                return@goLiveGuarded
            }

            _loading.value = false
            _waitingForMatchLive.value = true
            _rtmpUrl.value = null
            _facebookLive.value = FacebookLive()
            clearActiveLiveSession(notifyEnd = false)
            streamManager.clearRtmpDiagnostics()
            _errorMessage.value = null
            waitMatchLiveJob?.cancel()
            waitMatchLiveJob = launchGuarded(
                name = "waitMatchLive",
                onErrorMessage = "Không theo dõi được trạng thái trận live.",
            ) {
                while (isActive) {
                    if (!isSessionCurrent(sessionEpoch) || this@LiveStreamViewModel.matchId != targetMatchId) return@launchGuarded
                    withContext(Dispatchers.IO) {
                        repository.getMatchInfo(targetMatchId)
                    }.onSuccess { match ->
                        if (!isSessionCurrent(sessionEpoch) || this@LiveStreamViewModel.matchId != targetMatchId) return@onSuccess
                        _matchInfo.value = match
                    }
                    val nowLive = _matchInfo.value?.status?.trim()?.equals("live", ignoreCase = true) == true
                    if (nowLive) break
                    delay(MATCH_LIVE_WAIT_POLL_INTERVAL_MS)
                }
                if (!isSessionCurrent(sessionEpoch) || this@LiveStreamViewModel.matchId != targetMatchId) return@launchGuarded
                _waitingForMatchLive.value = false
                _loading.value = false
                startStreamWithLiveSession()
            }
        }
    }

    private fun startPrimarySession() {
        val mode = primaryMode()
        if (mode == null) {
            _showModeSelector.value = true
            return
        }
        when (mode) {
            StreamMode.RECORD_ONLY -> {
                armRecordOnlySession()
                goLive()
            }
            StreamMode.STREAM_AND_RECORD,
            StreamMode.STREAM_ONLY,
            -> goLive()
        }
    }

    fun onGoLiveClicked() {
        val mode = primaryMode()
        if (mode == null) {
            _showModeSelector.value = true
            return
        }
        if (matchId.isBlank()) {
            if (_waitingForCourt.value && (mode.includesLivestream || mode == StreamMode.RECORD_ONLY)) {
                beginWaitingForCourtCountdown(mode)
                return
            }
            _errorMessage.value =
                if (mode == StreamMode.RECORD_ONLY) {
                    "Chưa có trận để ghi hình."
                } else {
                    "Chưa có trận để live."
                }
            return
        }
        if (courtId.isNotBlank() && mode.includesLivestream) {
            setAutoGoLive(true)
        }
        val issues = computePreflightIssues(mode)
        val hasBlocker = issues.any { it.severity == PreflightSeverity.BLOCKER }
        val hasWarning = issues.any { it.severity == PreflightSeverity.WARNING }

        if (!hasBlocker && !hasWarning) {
            startPrimarySession()
            return
        }

        _preflightDialog.value = PreflightDialogState(
            issues = issues,
            canProceed = !hasBlocker,
        )
    }

    fun dismissPreflight() {
        _preflightDialog.value = null
    }

    fun proceedPreflight() {
        val canProceed = _preflightDialog.value?.canProceed == true
        _preflightDialog.value = null
        if (canProceed) startPrimarySession()
    }

    fun stopLive() {
        if (primaryMode() == StreamMode.RECORD_ONLY) {
            disarmRecordOnlySession()
        } else {
            setAutoGoLive(false)
        }
        goLiveCountdownJob?.cancel()
        goLiveCountdownJob = null
        _goLiveCountdownSeconds.value = null
        pendingSwitchMatchId = null
        _matchTransitioning.value = false
        _waitingForMatchLive.value = false
        _waitingForNextMatch.value = false
        waitMatchLiveJob?.cancel()
        waitMatchLiveJob = null
        initJob?.cancel()
        leaseHeartbeatJob?.cancel()
        leaseHeartbeatJob = null
        val shouldCountdownStop = hasActiveLivestreamState() || recordingEngineState.value.isRecording
        if (shouldCountdownStop) {
            beginStopLiveCountdown()
            return
        }
        stopLiveCountdownJob?.cancel()
        stopLiveCountdownJob = null
        _stopLiveCountdownSeconds.value = null
        if (_liveStartTime.value == null) {
            leaseId = null
            streamClientSessionId = null
            leaseHeartbeatIntervalMs = 15_000L
        }
        _endingLive.value = false
        streamManager.stopStream()
    }

    fun toggleTorch() = streamManager.toggleTorch()
    fun toggleMic() = streamManager.toggleMic()
    fun switchCamera() = streamManager.switchCamera()
    fun setZoom(level: Float) = streamManager.setZoom(level)

    fun changeQuality(quality: Quality) {
        _quality.value = quality
        streamManager.changeQuality(quality)
    }

    fun onDeviceOrientationChanged(orientation: Int) {
        streamManager.onDeviceOrientationChanged(orientation)
    }

    fun toggleBatterySaver() {
        _batterySaver.value = !_batterySaver.value
    }

    fun setFallbackColorArgb(argb: Int?) {
        _fallbackColorArgb.value = argb
    }

    fun cycleOrientation(): OrientationMode {
        val next = _orientationMode.value.next()
        _orientationMode.value = next
        return next
    }

    fun dismissError() {
        _errorMessage.value = null
    }

    fun dismissRecoveryDialog() {
        _recoveryDialogDismissedAtMs.value = System.currentTimeMillis()
    }

    fun requestEmergencyRecoveryDegrade() {
        _recoveryDialogDismissedAtMs.value = 0L
        streamManager.requestEmergencyRecoveryDegrade()
    }

    fun requestCameraPipelineRebuild() {
        _recoveryDialogDismissedAtMs.value = 0L
        streamManager.requestCameraPipelineRebuild()
    }

    fun cancelGoLiveCountdown() {
        setAutoGoLive(false)
        if (primaryMode() == StreamMode.RECORD_ONLY) {
            _recordOnlyArmed.value = false
        }
        goLiveCountdownJob?.cancel()
        goLiveCountdownJob = null
        _goLiveCountdownSeconds.value = null
        if (_liveStartTime.value == null) {
            _loading.value = false
        }
    }

    fun cancelStopLiveCountdown() {
        stopLiveCountdownJob?.cancel()
        stopLiveCountdownJob = null
        _stopLiveCountdownSeconds.value = null
    }

    private fun dismissEndingLiveSoon(delayMs: Long = 1_200L) {
        if (!_endingLive.value) return
        endingLiveDismissJob?.cancel()
        endingLiveDismissJob = launchGuarded(name = "dismissEndingLive") {
            delay(delayMs)
            _endingLive.value = false
        }
    }

    private fun resetLiveSessionUiForBackgroundExit() {
        goLiveCountdownJob?.cancel()
        goLiveCountdownJob = null
        _goLiveCountdownSeconds.value = null
        stopLiveCountdownJob?.cancel()
        stopLiveCountdownJob = null
        _stopLiveCountdownSeconds.value = null
        endingLiveDismissJob?.cancel()
        endingLiveDismissJob = null
        waitMatchLiveJob?.cancel()
        waitMatchLiveJob = null
        initJob?.cancel()
        initJob = null
        waitCourtJob?.cancel()
        waitCourtJob = null
        clearCourtStationRuntimeWatch()
        pendingSwitchMatchId = null
        _matchTransitioning.value = false
        _waitingForCourt.value = false
        _waitingForMatchLive.value = false
        _waitingForNextMatch.value = false
        _loading.value = false
        _endingLive.value = false
        _preflightDialog.value = null
        _lastSocketError.value = null
        _errorMessage.value = null
    }

    private fun performBackgroundExitAsync() {
        if (backgroundExitJob?.isActive == true) return
        backgroundExitJob = launchGuarded(name = "backgroundExit") {
            recordingCoordinator.setLiveCriticalPathBusy(true)
            try {
                nextSessionEpoch()
                nextCourtWatchEpoch()
                liveScreenForeground = false
                freshEntryRequired = true
                setAutoGoLive(false)
                disarmRecordOnlySession(clearWaitingState = true)
                resetLiveSessionUiForBackgroundExit()
                resetMatchScopedState()

                val hadLivestream =
                    hasActiveLivestreamState() ||
                        _liveStartTime.value != null ||
                        streamManager.wantsToKeepStreaming()

                if (recordingEngineState.value.isRecording) {
                    stopRecordingIfNeeded(
                        reason = "background_exit",
                        softMessage = "Đã dừng ghi hình khi rời màn live.",
                    )
                }

                clearActiveLiveSession(notifyEnd = hadLivestream)
                repository.disconnectSocket()
                clearCourtStationRuntimeWatch()
                repository.resetOverlayData()
                overlayRenderer.stop()
                matchId = ""
                _rtmpUrl.value = null
                _facebookLive.value = FacebookLive()
                streamManager.handleBackgroundExit(clearCurrentUrl = true)
                recordingCoordinator.clearModeSelection()
                _showModeSelector.value = true
            } finally {
                recordingCoordinator.setLiveCriticalPathBusy(false)
                backgroundExitJob = null
            }
        }
    }

    fun showLiveIssue(message: String) {
        _loading.value = false
        _endingLive.value = false
        goLiveCountdownJob?.cancel()
        goLiveCountdownJob = null
        _goLiveCountdownSeconds.value = null
        stopLiveCountdownJob?.cancel()
        stopLiveCountdownJob = null
        _stopLiveCountdownSeconds.value = null
        pendingSwitchMatchId = null
        _matchTransitioning.value = false
        _waitingForCourt.value = false
        _waitingForMatchLive.value = false
        _waitingForNextMatch.value = false
        _errorMessage.value = message
    }

    private suspend fun runGoLiveCountdown(targetMatchId: String): Boolean {
        val state = streamManager.state.value
        if (
            state is StreamState.Live ||
            state is StreamState.Connecting ||
            state is StreamState.Reconnecting
        ) {
            return true
        }

        val currentJob = coroutineContext[Job]
        goLiveCountdownJob = currentJob
        return try {
            for (value in 3 downTo 1) {
                if (!autoGoLive || this.matchId != targetMatchId || _matchTransitioning.value) {
                    return false
                }
                _goLiveCountdownSeconds.value = value
                delay(1_000L)
            }
            autoGoLive && this.matchId == targetMatchId && !_matchTransitioning.value
        } finally {
            if (goLiveCountdownJob === currentJob) {
                goLiveCountdownJob = null
            }
            _goLiveCountdownSeconds.value = null
        }
    }

    private fun beginWaitingForCourtCountdown(mode: StreamMode) {
        if (goLiveCountdownJob?.isActive == true) return
        launchGuarded(name = "goLiveWaitingForCourtCountdown") {
            val targetCourtId = courtId
            if (targetCourtId.isBlank() || !_waitingForCourt.value) return@launchGuarded
            val currentJob = coroutineContext[Job]
            goLiveCountdownJob = currentJob
            try {
                for (value in 3 downTo 1) {
                    if (courtId != targetCourtId || !_waitingForCourt.value || _matchTransitioning.value) {
                        return@launchGuarded
                    }
                    _goLiveCountdownSeconds.value = value
                    delay(1_000L)
                }
                if (courtId != targetCourtId || !_waitingForCourt.value || _matchTransitioning.value) {
                    return@launchGuarded
                }
                if (mode == StreamMode.RECORD_ONLY) {
                    armRecordOnlySession()
                } else {
                    setAutoGoLive(true)
                }
                _loading.value = false
                _errorMessage.value = null
            } finally {
                if (goLiveCountdownJob === currentJob) {
                    goLiveCountdownJob = null
                }
                _goLiveCountdownSeconds.value = null
            }
        }
    }

    private fun shouldMaintainActiveLiveStopCountdown(): Boolean {
        return hasActiveLivestreamState() || recordingEngineState.value.isRecording
    }

    private fun beginStopLiveCountdown() {
        if (stopLiveCountdownJob?.isActive == true) return
        recordingCoordinator.setLiveCriticalPathBusy(true)
        endingLiveDismissJob?.cancel()
        _endingLive.value = false
        stopLiveCountdownJob =
            launchGuarded(name = "stopLiveCountdown") {
                val currentJob = coroutineContext[Job]
                try {
                    for (value in 5 downTo 1) {
                        if (!shouldMaintainActiveLiveStopCountdown()) return@launchGuarded
                        _stopLiveCountdownSeconds.value = value
                        delay(1_000L)
                    }
                    _stopLiveCountdownSeconds.value = null
                    if (!shouldMaintainActiveLiveStopCountdown()) return@launchGuarded
                    _endingLive.value = true
                    completeStopPrimarySession()
                } finally {
                    _stopLiveCountdownSeconds.value = null
                    if (stopLiveCountdownJob === currentJob) {
                        stopLiveCountdownJob = null
                    }
                    recordingCoordinator.setLiveCriticalPathBusy(false)
                }
            }
    }

    private fun ensureObservers() {
        if (observersStarted) return
        observersStarted = true

        launchGuarded(name = "observeSocketErrors") {
            repository.socketErrors.collect { error ->
                if (freshEntryRequired || isWaitingForActivation()) return@collect
                Log.e(TAG, "Socket error: $error")
                _lastSocketError.value = error
            }
        }

        launchGuarded(name = "observeCourtRuntimeSocketErrors") {
            repository.courtRuntimeSocketErrors.collect { error ->
                if (freshEntryRequired) return@collect
                Log.e(TAG, "Court runtime socket error: $error")
                _lastSocketError.value = error
            }
        }

        launchGuarded(name = "observeSocketRecovery") {
            combine(
                repository.socketConnected,
                repository.socketActiveMatchId,
                repository.socketLastPayloadAtMs,
            ) { connected, activeMatchId, lastPayloadAtMs ->
                Triple(connected, activeMatchId, lastPayloadAtMs)
            }.collect { (connected, activeMatchId, lastPayloadAtMs) ->
                val currentError = _lastSocketError.value
                if (!isMatchSocketError(currentError)) return@collect
                if (shouldClearRecoveredMatchSocketError(connected, activeMatchId, lastPayloadAtMs)) {
                    _lastSocketError.value = null
                }
            }
        }

        launchGuarded(name = "observeCourtRuntimeSocketRecovery") {
            repository.courtRuntimeSocketConnected.collect { connected ->
                val currentError = _lastSocketError.value
                if (!connected || !isCourtRuntimeSocketError(currentError)) return@collect
                _lastSocketError.value = null
            }
        }

        launchGuarded(name = "observeNetwork") {
            networkMonitor.isConnected.collect { connected ->
                streamManager.onNetworkAvailabilityChanged(connected)
            }
        }

        launchGuarded(name = "observeRecordingStorageStatus") {
            recordingCoordinator.storageStatus.collect { status ->
                streamManager.setRecordingSegmentDurationMs(status.segmentDurationSeconds * 1000L)
            }
        }

        overlayRenderer.onBitmapReady = { bmp ->
            if (!freshEntryRequired) {
                streamManager.updateOverlayBitmap(bmp)
            }
        }
        streamManager.onRecordingSegmentClosed = { segment ->
            recordingCoordinator.onSegmentCompleted(segment)
        }
        recordingCoordinator.onStorageExhausted = { storage ->
            launchGuarded(name = "onRecordingStorageExhausted") {
                val message =
                    storage.message ?: "Đã dừng ghi hình do sắp hết bộ nhớ."
                if (recordingEngineState.value.isRecording) {
                    streamManager.stopMatchRecording(
                        finalize = true,
                        reason = "storage_exhausted",
                    )
                }
                recordingCoordinator.markRecordingStoppedSoft(message)
                _errorMessage.value =
                    if (currentSessionHasLivestream()) {
                        "$message Livestream vẫn tiếp tục."
                    } else {
                        message
                    }
            }
        }
        launchGuarded(name = "observeEncoderSize") {
            streamManager.encoderSize.collect { size ->
                overlayRenderer.updateOutputSize(size.width, size.height)
            }
        }
        launchGuarded(name = "observeOverlayData") {
            combine(repository.overlayData, overlayConfig, matchInfo) { data, cfg, match ->
                mergeOverlayForRenderer(data = data, cfg = cfg, match = match)
            }.collect { data ->
                if (freshEntryRequired) return@collect
                overlayRenderer.updateData(data)
            }
        }

        launchGuarded(name = "observeOverlayKeepAlive") {
            repository.socketLastPayloadAtMs
                .debounce(800L)
                .collect { refreshedAtMs ->
                if (freshEntryRequired || refreshedAtMs <= 0L) return@collect
                overlayRenderer.refresh()
                streamManager.nudgeOverlayFromFreshData("payload_refresh")
            }
        }

        launchGuarded(name = "observeMatchInfoForWaitingState") {
            matchInfo.collect { match ->
                if (freshEntryRequired) return@collect
                if (
                    _waitingForNextMatch.value &&
                    match != null &&
                    match.id.isNotBlank() &&
                    !isTerminalMatchStatus(match.status)
                ) {
                    _waitingForNextMatch.value = false
                    _waitingForCourt.value = false
                }
            }
        }

        launchGuarded(name = "observeCourtStationRuntimeUpdates") {
            repository.courtStationRuntimeUpdates.collect { snapshot ->
                if (freshEntryRequired) return@collect
                val watchedCourtId = courtId.takeIf { it.isNotBlank() } ?: return@collect
                val station = snapshot.station ?: return@collect
                if (station.id != watchedCourtId) return@collect

                val liveSnapshotMatch = snapshot.currentMatch?.takeIf(::isLiveMatch)
                // Don't overwrite _matchInfo from court station snapshot — it lacks
                // populated team names (defaults to "Team A"/"Team B") and would cause
                // overlay flicker. Full match data is loaded by switchToMatch/getMatchInfo.

                val runtime =
                    LiveAppCourtRuntimeResponse(
                        ok = true,
                        courtId = station.id,
                        courtStationId = station.id,
                        courtClusterId = snapshot.cluster?.id ?: station.clusterId,
                        courtClusterName = snapshot.cluster?.name ?: station.clusterName,
                        tournamentId = station.currentTournamentId,
                        name = station.name ?: station.label,
                        status = station.status,
                        isActive = true,
                        currentMatchId =
                            liveSnapshotMatch?.id?.takeIf { id ->
                                id.isNotBlank() &&
                                    id == station.currentMatchId?.trim()
                            },
                        nextMatchId = null,
                        assignmentMode = station.assignmentMode,
                        queueCount = station.queueCount,
                        listEnabled =
                            (station.assignmentMode ?: "").trim()
                                .equals("queue", ignoreCase = true),
                        remainingManualCount = station.queueCount,
                    )
                applyCourtRuntimeSnapshot(runtime, token, pageId)
            }
        }

        launchGuarded(name = "observeStreamState") {
            streamManager.state.collect { state ->
                if (freshEntryRequired) return@collect
                if (
                    isWaitingForActivation() &&
                    !streamManager.wantsToKeepStreaming() &&
                    (state is StreamState.Connecting ||
                        state is StreamState.Reconnecting ||
                        state is StreamState.Error)
                ) {
                    streamManager.clearRtmpDiagnostics()
                    return@collect
                }
                when (state) {
                    is StreamState.Live -> {
                        val liveMatchId = activeLiveMatchId ?: matchId.takeIf { it.isNotBlank() }
                        endingLiveDismissJob?.cancel()
                        _endingLive.value = false
                        if (_stopLiveCountdownSeconds.value == null) {
                            stopLiveCountdownJob?.cancel()
                            stopLiveCountdownJob = null
                        }
                        _waitingForNextMatch.value = false
                        if (_liveStartTime.value == null) {
                            _liveStartTime.value = state.startedAt
                            activeLiveMatchId = liveMatchId
                        }
                        if (!liveMatchId.isNullOrBlank()) {
                            val clientSessionId = ensureStreamClientSessionId()
                            startLeaseHeartbeatLoop(liveMatchId, clientSessionId)
                        }
                    }
                    is StreamState.Stopped -> {
                        stopLiveCountdownJob?.cancel()
                        stopLiveCountdownJob = null
                        _stopLiveCountdownSeconds.value = null
                        clearActiveLiveSession(notifyEnd = true)
                        dismissEndingLiveSoon()
                        if (
                            _waitingForNextMatch.value &&
                            !previewReady.value &&
                            canAutoRestartPreviewWhileWaiting()
                        ) {
                            streamManager.startPreview(_quality.value)
                        }
                    }
                    is StreamState.Error -> {
                        val keepRecovering =
                            state.recoverable &&
                                streamManager.wantsToKeepStreaming()
                        if (keepRecovering) {
                            val liveMatchId = activeLiveMatchId ?: matchId.takeIf { it.isNotBlank() }
                            val sessionId = streamClientSessionId ?: ensureStreamClientSessionId()
                            if (!liveMatchId.isNullOrBlank() && !sessionId.isNullOrBlank()) {
                                startLeaseHeartbeatLoop(liveMatchId, sessionId)
                            }
                            return@collect
                        }
                        stopLiveCountdownJob?.cancel()
                        stopLiveCountdownJob = null
                        _stopLiveCountdownSeconds.value = null
                        clearActiveLiveSession(notifyEnd = true)
                        dismissEndingLiveSoon()
                    }
                    is StreamState.Previewing -> {
                        if (!streamManager.wantsToKeepStreaming()) {
                            stopLiveCountdownJob?.cancel()
                            stopLiveCountdownJob = null
                            _stopLiveCountdownSeconds.value = null
                        }
                        if (!streamManager.wantsToKeepStreaming()) {
                            dismissEndingLiveSoon()
                        }
                        if (_liveStartTime.value != null && !streamManager.wantsToKeepStreaming()) {
                            clearActiveLiveSession(notifyEnd = true)
                        }
                    }
                    is StreamState.Connecting, is StreamState.Reconnecting -> {
                        val liveMatchId = activeLiveMatchId ?: matchId.takeIf { it.isNotBlank() }
                        val sessionId = streamClientSessionId
                        if (!liveMatchId.isNullOrBlank() && !sessionId.isNullOrBlank()) {
                            startLeaseHeartbeatLoop(liveMatchId, sessionId)
                        }
                    }
                    else -> Unit
                }
            }
        }

        launchGuarded(name = "observeMatchStatus") {
            repository.matchStatus.collect { status ->
                if (freshEntryRequired) return@collect
                val normalized = status?.trim()?.lowercase().orEmpty()
                if (normalized.isBlank()) return@collect
                if (normalized == "live") {
                    handledTerminalStatusMatchId = null
                    return@collect
                }
                val liveMatchId = activeLiveMatchId ?: matchId.takeIf { it.isNotBlank() } ?: return@collect
                val isArmed = autoGoLive || _recordOnlyArmed.value
                if (_liveStartTime.value == null && !recordingEngineState.value.isRecording && !isArmed) return@collect
                if (!isTerminalMatchStatus(normalized)) return@collect
                if (handledTerminalStatusMatchId == liveMatchId) return@collect
                handledTerminalStatusMatchId = liveMatchId
                if (courtId.isNotBlank()) {
                    enterWaitingForNextMatch()
                } else {
                    showLiveIssue("Trận đã kết thúc. App đang đóng phiên hiện tại của trận này.")
                }
                launchGuarded(name = "stopPrimarySessionOnMatchEnd") {
                    if (recordingEngineState.value.isRecording) {
                        stopRecordingIfNeeded(reason = "match_finished")
                    }
                    // Must call clearActiveLiveSession BEFORE stopStream because
                    // stopStream may transition to Previewing (not Stopped) if
                    // camera preview is still active, in which case the Stopped
                    // observer never fires and notifyStreamEnded never gets called.
                    if (hasActiveLivestreamState()) {
                        clearActiveLiveSession(notifyEnd = true)
                        streamManager.stopStream()
                    }
                }
            }
        }

        // Auto refresh RTMP if server closes channel or stream misconfigured
        launchGuarded(name = "observeRtmpRefresh") {
            combine(streamManager.state, streamManager.rtmpLastMessage) { s, msg -> s to (msg ?: "") }
                .collect { (s, msg) ->
                    if (freshEntryRequired || isWaitingForActivation()) return@collect
                    val now = System.currentTimeMillis()
                    val canRefreshFromState =
                        s is StreamState.Reconnecting ||
                            (s is StreamState.Error && s.recoverable && streamManager.wantsToKeepStreaming())
                    val shouldRefresh =
                        canRefreshFromState &&
                        msg.isNotBlank() &&
                        (
                            msg.contains("Channel is already closed", ignoreCase = true) ||
                            msg.contains("publish failed", ignoreCase = true) ||
                            msg.contains("configure stream", ignoreCase = true) ||
                            msg.contains("auth", ignoreCase = true)
                        ) &&
                        now - lastRtmpRefreshMs >= 8_000L

                    if (shouldRefresh && autoGoLive && matchId.isNotBlank()) {
                        lastRtmpRefreshMs = now
                        launchGuarded(name = "refreshRtmpSession") {
                            repository.createLiveSession(matchId, pageId, forceNew = true).onSuccess { session ->
                                _facebookLive.value = session.facebook ?: FacebookLive()
                                val newUrl = session.facebook?.buildRtmpUrl()
                                if (!newUrl.isNullOrBlank() && newUrl != _rtmpUrl.value) {
                                    leaseHeartbeatJob?.cancel()
                                    leaseHeartbeatJob = null
                                    leaseId = null
                                    ensureStreamClientSessionId(forceNew = true)
                                    _rtmpUrl.value = newUrl
                                    streamManager.startStream(newUrl)
                                }
                            }.onFailure {
                                // keep reconnect logic; just record error
                                Log.e(TAG, "Auto refresh RTMP failed: ${it.message}")
                            }
                        }
                    }
                }
        }

        launchGuarded(name = "observeRecoveryState") {
            recoveryState.collect { recovery ->
                recordingCoordinator.setRecoveryBusy(recovery.stage != RecoveryStage.IDLE)
                if (recovery.stage == RecoveryStage.IDLE) {
                    _recoveryDialogDismissedAtMs.value = 0L
                }
            }
        }

        startLiveDeviceTelemetryLoop()

        launchGuarded(name = "observeObserverOverlayTelemetry") {
            overlayHealth.collect { state ->
                sendOverlayTelemetryEventIfNeeded(state)
            }
        }

        launchGuarded(name = "observeObserverRecoveryTelemetry") {
            combine(lastRecovery, recoveryState) { event, recovery ->
                event to recovery
            }.collect { (event, recovery) ->
                if (event != null) {
                    sendRecoveryTelemetryEventIfNeeded(event, recovery)
                }
            }
        }

        launchGuarded(name = "observeObserverThermalTelemetry") {
            lastThermalEvent.collect { event ->
                if (event != null) {
                    sendThermalTelemetryEvent(event)
                }
            }
        }

        launchGuarded(name = "observeObserverMemoryTelemetry") {
            lastMemoryPressure.collect { event ->
                if (event != null) {
                    sendMemoryPressureTelemetryEvent(event)
                }
            }
        }
    }

    /**
     * Seed overlay data from the API match response so the scoreboard
     * appears immediately -- before the first socket snapshot arrives.
     */
    private fun seedOverlayFromMatch(match: MatchData) {
        val current = repository.overlayData.value
        val needsSeed =
            current.teamAName == "Team A" ||
                current.teamBName == "Team B" ||
                (current.teamAName.isBlank() && current.teamBName.isBlank())
        if (!needsSeed) return
        val seeded = current.copy(
            teamAName = match.teamAName.takeIf { it.isNotBlank() } ?: current.teamAName,
            teamBName = match.teamBName.takeIf { it.isNotBlank() } ?: current.teamBName,
            scoreA = match.scoreA,
            scoreB = match.scoreB,
            serveSide = match.serveSide.takeIf { it.isNotBlank() } ?: current.serveSide,
            serveCount = match.serveCount,
            tournamentName = match.tournamentName.takeIf { it.isNotBlank() }
                ?: match.tournament?.name.orEmpty(),
            courtName = match.courtName.takeIf { it.isNotBlank() }
                ?: match.court?.name.orEmpty(),
            stageName = match.stageName.takeIf { it.isNotBlank() } ?: current.stageName,
            phaseText = match.phaseText.takeIf { it.isNotBlank() } ?: current.phaseText,
            roundLabel = match.roundLabel.takeIf { it.isNotBlank() } ?: current.roundLabel,
            seedA = match.seedA,
            seedB = match.seedB,
            tournamentLogoUrl = match.tournamentLogoUrl
                ?: match.tournament?.imageUrl
                ?: match.tournament?.logoUrl,
        )
        repository.seedOverlayData(seeded)
    }
    private fun mergeOverlayForRenderer(
        data: OverlayData,
        cfg: OverlayConfig?,
        match: MatchData?,
    ): OverlayData {
        return data.copy(
            tournamentName = data.tournamentName.ifBlank { match?.tournamentName.orEmpty() },
            courtName = data.courtName.ifBlank { match?.courtName.orEmpty() },
            seedA = data.seedA ?: match?.seedA,
            seedB = data.seedB ?: match?.seedB,
            stageName = data.stageName.ifBlank { match?.stageName.orEmpty() },
            phaseText = data.phaseText.ifBlank { match?.phaseText.orEmpty() },
            roundLabel = data.roundLabel.ifBlank { match?.roundLabel.orEmpty() },
            tournamentLogoUrl =
                cfg?.tournamentImageUrl?.takeIf { it.isNotBlank() }
                    ?: data.tournamentLogoUrl?.takeIf { it.isNotBlank() }
                    ?: match?.tournamentLogoUrl?.takeIf { it.isNotBlank() }
                    ?: match?.tournament?.imageUrl?.takeIf { it.isNotBlank() }
                    ?: match?.tournament?.logoUrl?.takeIf { it.isNotBlank() },
            webLogoUrl = cfg?.webLogoUrl?.takeIf { it.isNotBlank() },
            sponsorLogos = cfg?.sponsors?.mapNotNull { it.logoUrl } ?: emptyList(),
        )
    }

    private fun extractId(v: JsonElement?): String? {
        if (v == null) return null
        return when {
            v is JsonPrimitive && v.isString -> v.asString.takeIf { it.isNotBlank() }
            v is JsonObject -> v.getAsJsonPrimitive("_id")?.asString?.takeIf { it.isNotBlank() }
                ?: v.getAsJsonPrimitive("id")?.asString?.takeIf { it.isNotBlank() }
            v.isJsonPrimitive && v.asJsonPrimitive.isString -> v.asString.takeIf { it.isNotBlank() }
            v.isJsonObject -> v.asJsonObject.getAsJsonPrimitive("_id")?.asString?.takeIf { it.isNotBlank() }
                ?: v.asJsonObject.getAsJsonPrimitive("id")?.asString?.takeIf { it.isNotBlank() }
            else -> null
        }
    }

    private fun switchToMatch(newMatchId: String, token: String, pageId: String?) {
        val mid = newMatchId.trim()
        if (mid.isBlank()) return
        if (pendingSwitchMatchId == mid && _matchTransitioning.value) return

        // Clear terminal guard — this is a genuinely new match
        handledTerminalStatusMatchId = null
        val sessionEpoch = nextSessionEpoch()
        recordingCoordinator.setLiveCriticalPathBusy(true)
        pendingSwitchMatchId = mid
        _matchTransitioning.value = true
        initJob?.cancel()
        initJob = launchGuarded(
            name = "switchToMatch",
            dispatcher = Dispatchers.Default,
            onErrorMessage = "Không đổi được trận đang live.",
        ) {
            try {
                _waitingForNextMatch.value = false
                if (recordingEngineState.value.isRecording) {
                    stopRecordingIfNeeded(reason = "switch_match")
                }
                val s = streamManager.state.value
                if (autoGoLive && (s is StreamState.Live || s is StreamState.Connecting || s is StreamState.Reconnecting)) {
                    streamManager.stopStream()
                    waitForStreamSwitchReady()
                }

                matchId = mid
                this@LiveStreamViewModel.pageId = pageId
                resetMatchScopedState()
                _loading.value = true

                withContext(Dispatchers.IO) {
                    repository.connectSocket(token, mid)
                }
                if (!isSessionCurrent(sessionEpoch) || this@LiveStreamViewModel.matchId != mid) return@launchGuarded

                withContext(Dispatchers.IO) {
                    repository.getMatchInfo(mid)
                }.onSuccess { match ->
                    if (!isSessionCurrent(sessionEpoch) || this@LiveStreamViewModel.matchId != mid) return@onSuccess
                    _matchInfo.value = match
                    seedOverlayFromMatch(match)
                    (match.courtStationId ?: match.court?.id)
                        ?.trim()
                        ?.takeIf { it.isNotBlank() }
                        ?.let { resolvedCourtId ->
                        if (this@LiveStreamViewModel.courtId.isBlank()) {
                            this@LiveStreamViewModel.courtId = resolvedCourtId
                            watchCourtStationRuntime(resolvedCourtId)
                        }
                    }
                }
                if (!isSessionCurrent(sessionEpoch) || this@LiveStreamViewModel.matchId != mid) return@launchGuarded

                withContext(Dispatchers.IO) {
                    repository.getOverlayConfig(resolveOverlayTournamentId(_matchInfo.value))
                }.onSuccess { config ->
                    if (!isSessionCurrent(sessionEpoch) || this@LiveStreamViewModel.matchId != mid) return@onSuccess
                    _overlayConfig.value = config
                }
            } catch (e: Exception) {
                if (isSessionCurrent(sessionEpoch) && this@LiveStreamViewModel.matchId == mid) {
                    _errorMessage.value = e.message ?: "Không đổi được trận"
                }
            } finally {
                if (pendingSwitchMatchId == mid) {
                    pendingSwitchMatchId = null
                    _matchTransitioning.value = false
                }
                recordingCoordinator.setLiveCriticalPathBusy(false)
                if (isSessionCurrent(sessionEpoch) && this@LiveStreamViewModel.matchId == mid) {
                    _loading.value = false
                    if (autoGoLive) goLive()
                }
            }
        }
    }

    private fun startStreamWithLiveSession() {
        if (_matchTransitioning.value) return
        val mode = primaryMode()
        val url = _rtmpUrl.value
        if (!url.isNullOrBlank()) {
            activeLiveMatchId = matchId.takeIf { it.isNotBlank() }
            ensureStreamClientSessionId()
            launchGuarded(name = "startStreamWithExistingSession") {
                recordingCoordinator.setLiveCriticalPathBusy(true)
                try {
                    _loading.value = false
                    if (!runGoLiveCountdown(matchId)) return@launchGuarded
                    streamManager.startStream(url)
                    if (mode?.includesRecording == true) {
                        maybeStartRecordingForCurrentMatch(allowSoftFailureForLivestream = true)
                    }
                } finally {
                    recordingCoordinator.setLiveCriticalPathBusy(false)
                }
            }
            return
        }
        val sessionEpoch = this.sessionEpoch.get()
        val targetMatchId = matchId
        val targetPageId = pageId
        if (freshEntryRequired || isWaitingForActivation()) {
            _loading.value = false
            _rtmpUrl.value = null
            _facebookLive.value = FacebookLive()
            streamManager.clearRtmpDiagnostics()
            return
        }
        _loading.value = true
        _errorMessage.value = null
        launchGuarded(
            name = "startStreamWithLiveSession",
            onErrorMessage = "Không tạo được live session.",
        ) {
            recordingCoordinator.setLiveCriticalPathBusy(true)
            repository.createLiveSession(targetMatchId, targetPageId, forceNew = false).onSuccess { session ->
                if (!isSessionCurrent(sessionEpoch) || this@LiveStreamViewModel.matchId != targetMatchId) return@onSuccess
                _facebookLive.value = session.facebook ?: FacebookLive()
                val newUrl = session.facebook?.buildRtmpUrl()
                _rtmpUrl.value = newUrl
                if (newUrl != null) {
                    activeLiveMatchId = targetMatchId
                    ensureStreamClientSessionId()
                    _loading.value = false
                    if (!runGoLiveCountdown(targetMatchId)) return@onSuccess
                    streamManager.startStream(newUrl)
                    if (mode?.includesRecording == true) {
                        maybeStartRecordingForCurrentMatch(allowSoftFailureForLivestream = true)
                    }
                } else {
                    _errorMessage.value = "Không nhận được RTMP URL từ server"
                }
            }.onFailure { e ->
                if (isSessionCurrent(sessionEpoch) && this@LiveStreamViewModel.matchId == targetMatchId) {
                    _errorMessage.value = "Tạo live session thất bại: ${e.message}"
                }
            }.also {
                if (isSessionCurrent(sessionEpoch) && this@LiveStreamViewModel.matchId == targetMatchId) {
                    _loading.value = false
                }
                recordingCoordinator.setLiveCriticalPathBusy(false)
            }
        }
    }


    private fun routeLabelForTelemetry(): String =
        when {
            _waitingForNextMatch.value -> "waiting_for_next_match"
            _waitingForCourt.value -> "waiting_for_court"
            _waitingForMatchLive.value -> "waiting_for_match_live"
            _matchTransitioning.value -> "switching_match"
            hasActiveLivestreamState() -> "live_stream"
            streamManager.state.value.isPreviewActive -> "preview"
            else -> "idle"
        }

    private val observerTelemetryEnabled: Boolean
        get() = observerTelemetryClient.isEnabled

    val observerConnectionState: StateFlow<ObserverTelemetryConnectionState>
        get() = observerTelemetryClient.connectionState

    private val liveDeviceTelemetrySourceName: String
        get() = "pickletour-live-app-android"

    private val liveDeviceTelemetryIntervalMs: Int
        get() = 10_000

    private val shouldPublishLiveDeviceTelemetry: Boolean
        get() =
            observerTelemetryEnabled &&
                !authInterceptor.token.isNullOrBlank() &&
                networkMonitor.isConnected.value

    private fun startLiveDeviceTelemetryLoop() {
        observerTelemetryClient.refreshConnectionState()
        if (liveDeviceTelemetryJob?.isActive == true) return
        liveDeviceTelemetryJob =
            launchGuarded(name = "liveDeviceTelemetryLoop") {
                while (isActive) {
                    sendLiveDeviceHeartbeat()
                    delay(maxOf(liveDeviceTelemetryIntervalMs.toLong(), 3_000L))
                }
            }
    }

    private suspend fun sendLiveDeviceHeartbeat(force: Boolean = false) {
        if (!force && !shouldPublishLiveDeviceTelemetry) return
        val status = buildLiveDeviceTelemetryStatus()
        observerTelemetryClient.sendDeviceHeartbeat(
            LiveDeviceHeartbeatRequest(
                source = liveDeviceTelemetrySourceName,
                deviceId = liveDeviceId,
                capturedAt = currentIsoTimestampUtc(),
                heartbeatIntervalMs = liveDeviceTelemetryIntervalMs,
                status = status,
            )
        )
    }

    private suspend fun sendLiveDeviceEvent(
        type: String,
        level: String,
        reasonCode: String,
        reasonText: String,
        stage: String? = null,
        severity: String? = null,
        payload: LiveDeviceTelemetryEventPayload? = null,
    ) {
        if (!shouldPublishLiveDeviceTelemetry) return
        val status = buildLiveDeviceTelemetryStatus()
        observerTelemetryClient.sendDeviceEvent(
            LiveDeviceEventRequest(
                source = liveDeviceTelemetrySourceName,
                deviceId = liveDeviceId,
                capturedAt = currentIsoTimestampUtc(),
                event =
                    LiveDeviceTelemetryEvent(
                        type = type,
                        level = level,
                        reasonCode = reasonCode,
                        reasonText = reasonText,
                        stage = stage?.trim()?.takeIf { it.isNotBlank() },
                        severity = severity?.trim()?.takeIf { it.isNotBlank() },
                        occurredAt = currentIsoTimestampUtc(),
                        courtId = status.court.id,
                        courtName = status.court.name,
                        matchId = status.match.id,
                        matchCode = status.match.code,
                        operatorUserId = status.operatorInfo.userId,
                        operatorName = status.operatorInfo.displayName,
                        payload = payload,
                    ),
                status = status,
            )
        )
    }

    private fun buildLiveDeviceTelemetryStatus(): LiveDeviceTelemetryStatus {
        val savedSession = tokenStore.getSessionOrNull()
        val activeMatch = matchInfo.value
        val socketPayloadStale = isSocketPayloadStale()
        val socketRoomMismatch = isSocketRoomMismatch()
        val overlay = overlayHealth.value
        val overlayIssue = overlay.lastIssue?.trim()?.takeIf { it.isNotBlank() }
        val thermalRawValue = currentThermalStatusRawValue()
        val thermalStateLabel = thermalStateLabel(thermalRawValue, batteryTempC.value)
        val thermalWarning = isThermalWarning(thermalRawValue, batteryTempC.value)
        val thermalCritical = isThermalCritical(thermalRawValue, batteryTempC.value)
        val storageStatus = recordingStorageStatus.value
        val batteryLevelPercent = currentBatteryLevelPercent()
        val batteryLowWarning = (batteryLevelPercent ?: 100) in 0..20 && !isCharging.value
        val diagnostics = buildTelemetryDiagnostics()

        return LiveDeviceTelemetryStatus(
            platform = "android",
            clientSessionId = liveDeviceTelemetryClientSessionId,
            deviceId = liveDeviceId,
            screenState = currentCourtPresenceScreenState(),
            routeLabel = routeLabelForTelemetry(),
            app =
                LiveDeviceTelemetryAppInfo(
                    bundleId = appContext.packageName,
                    appVersion = com.pkt.live.BuildConfig.VERSION_NAME,
                    buildNumber = com.pkt.live.BuildConfig.VERSION_CODE.toString(),
                    liveMode =
                        primaryMode()?.name?.lowercase(Locale.ROOT) ?: "unselected",
                    quality = _quality.value.label,
                ),
            device =
                LiveDeviceTelemetryDeviceInfo(
                    name = resolveDeviceDisplayName(),
                    model = Build.MODEL,
                    manufacturer = Build.MANUFACTURER,
                    brand = Build.BRAND,
                    product = Build.PRODUCT,
                    systemName = "Android",
                    systemVersion = Build.VERSION.RELEASE ?: Build.VERSION.SDK_INT.toString(),
                ),
            operatorInfo =
                LiveDeviceTelemetryOperatorInfo(
                    userId = savedSession?.userId?.trim()?.takeIf { it.isNotBlank() },
                    displayName = savedSession?.displayName?.trim()?.takeIf { it.isNotBlank() },
                    role = "operator",
                ),
            route =
                LiveDeviceTelemetryRouteInfo(
                    label = routeLabelForTelemetry(),
                    waitingForCourt = _waitingForCourt.value,
                    waitingForMatchLive = _waitingForMatchLive.value,
                    waitingForNextMatch = _waitingForNextMatch.value,
                    freshEntryRequired = freshEntryRequired,
                    appIsActive = liveScreenForeground,
                ),
            court =
                LiveDeviceTelemetryCourtInfo(
                    id = courtId.trim().takeIf { it.isNotBlank() },
                    name =
                        activeMatch?.courtName?.trim()?.takeIf { it.isNotBlank() }
                            ?: listOf(
                                activeMatch?.court?.label?.trim(),
                                activeMatch?.court?.name?.trim(),
                            ).firstOrNull { !it.isNullOrBlank() },
                    clusterId = activeMatch?.courtClusterId?.trim()?.takeIf { it.isNotBlank() },
                    clusterName = activeMatch?.courtClusterName?.trim()?.takeIf { it.isNotBlank() },
                ),
            match =
                LiveDeviceTelemetryMatchInfo(
                    id = activeMatch?.id?.trim()?.takeIf { it.isNotBlank() },
                    code =
                        activeMatch?.displayCode?.trim()?.takeIf { it.isNotBlank() }
                            ?: activeMatch?.code?.trim()?.takeIf { it.isNotBlank() },
                    status = activeMatch?.status?.trim()?.takeIf { it.isNotBlank() },
                    tournamentName =
                        activeMatch?.tournamentName?.trim()?.takeIf { it.isNotBlank() }
                            ?: activeMatch?.tournament?.name?.trim()?.takeIf { it.isNotBlank() },
                ),
            stream =
                LiveDeviceTelemetryStreamInfo(
                    state = streamStateSummary(streamManager.state.value),
                    bitrate = streamStats.value.currentBitrate.toInt(),
                    quality = _quality.value.label,
                    socketConnected = socketConnected.value,
                    runtimeSocketConnected = repository.courtRuntimeSocketConnected.value,
                    presenceSocketConnected = repository.courtPresenceSocketConnected.value,
                    activeSocketMatchId = socketActiveMatchId.value?.trim()?.takeIf { it.isNotBlank() },
                    socketPayloadStale = socketPayloadStale,
                    liveStartedAt = toIsoTimestamp(_liveStartTime.value),
                    rtmpMessage = rtmpLastMessage.value?.trim()?.takeIf { it.isNotBlank() },
                ),
            recording =
                LiveDeviceTelemetryRecordingInfo(
                    stateText = recordingUiState.value.status,
                    pendingUploads = recordingUiState.value.pendingUploads,
                    pendingQueueBytes = storageStatus.pendingQueueBytes,
                    pendingFinalizations = 0,
                    segmentCount = recordingEngineState.value.segmentIndex,
                    uploadMode = primaryMode()?.name?.lowercase(Locale.ROOT),
                    playbackUrl = recordingUiState.value.playbackUrl?.trim()?.takeIf { it.isNotBlank() },
                    storageFreeBytes = storageStatus.availableBytes,
                    storageTotalBytes = currentStorageTotalBytes(),
                    warning = storageStatus.warning,
                    redWarning = storageStatus.redWarning,
                    hardBlock = storageStatus.hardBlock,
                ),
            overlay =
                LiveDeviceTelemetryOverlayInfo(
                    attached = overlay.attached,
                    healthy =
                        overlay.attached &&
                            !overlay.reattaching &&
                            overlayIssue.isNullOrBlank() &&
                            !socketPayloadStale &&
                            !socketRoomMismatch,
                    reattaching = overlay.reattaching,
                    snapshotFresh = !socketPayloadStale,
                    roomMismatch = socketRoomMismatch,
                    issue = overlayIssue,
                    issueAtMs = overlay.lastIssueAtMs,
                    lastEvent = overlay.lastEvent?.trim()?.takeIf { it.isNotBlank() },
                ),
            presence = _courtPresence.value,
            network =
                LiveDeviceTelemetryNetworkInfo(
                    connected = networkMonitor.isConnected.value,
                    wifi = networkMonitor.isWifi.value,
                    lowPowerModeEnabled = streamManager.powerSaveMode.value,
                ),
            battery =
                LiveDeviceTelemetryBatteryInfo(
                    levelPercent = batteryLevelPercent,
                    state = if (isCharging.value) "charging" else "battery",
                    lowWarning = batteryLowWarning,
                ),
            thermal =
                LiveDeviceTelemetryThermalInfo(
                    state = thermalStateLabel,
                    stateRawValue = thermalRawValue,
                    warning = thermalWarning,
                    critical = thermalCritical,
                    lastEventAtMs = lastThermalEvent.value?.atMs,
                    lastEventSummary = latestThermalEventSummary(),
                    memoryPressureSummary = latestMemoryPressureSummary(),
                    tempC = batteryTempC.value,
                ),
            recovery = recoveryState.value,
            warnings = buildTelemetryWarnings(),
            diagnostics = diagnostics,
        )
    }

    private fun buildTelemetryWarnings(): List<String> {
        val warnings = mutableSetOf<String>()
        computePreflightIssues(primaryMode() ?: StreamMode.STREAM_ONLY)
            .mapTo(warnings) { it.title }

        val batteryLevel = currentBatteryLevelPercent()
        if ((batteryLevel ?: 100) in 0..20 && !isCharging.value) {
            warnings.add("Pin yếu")
        }
        if (isThermalCritical(currentThermalStatusRawValue(), batteryTempC.value)) {
            warnings.add("Thiết bị quá nóng")
        } else if (isThermalWarning(currentThermalStatusRawValue(), batteryTempC.value)) {
            warnings.add("Thiết bị đang nóng")
        }
        if (isSocketPayloadStale()) {
            warnings.add("Socket overlay đang stale")
        }
        if (isSocketRoomMismatch()) {
            warnings.add("Socket đang ở sai room match")
        }
        if (recordingStorageStatus.value.hardBlock) {
            warnings.add("Bộ nhớ ghi hình không đủ")
        } else if (recordingStorageStatus.value.redWarning || recordingStorageStatus.value.warning) {
            warnings.add("Bộ nhớ ghi hình đang thấp")
        }
        overlayHealth.value.lastIssue?.trim()?.takeIf { it.isNotBlank() }?.let(warnings::add)
        _lastSocketError.value?.trim()?.takeIf { it.isNotBlank() }?.let(warnings::add)
        return warnings.toList().sorted()
    }

    private fun buildTelemetryDiagnostics(): List<String> =
        listOfNotNull(
            rtmpLastMessage.value?.trim()?.takeIf { it.isNotBlank() }?.let { "rtmp:$it" },
            overlayHealth.value.lastEvent?.trim()?.takeIf { it.isNotBlank() }?.let { "overlay:$it" },
            overlayHealth.value.lastIssue?.trim()?.takeIf { it.isNotBlank() }?.let { "overlay_issue:$it" },
            _lastSocketError.value?.trim()?.takeIf { it.isNotBlank() }?.let { "socket:$it" },
            recordingUiState.value.errorMessage?.trim()?.takeIf { it.isNotBlank() }?.let { "recording:$it" },
            recordingStorageStatus.value.message?.trim()?.takeIf { it.isNotBlank() }?.let { "storage:$it" },
        ).take(10)

    private suspend fun sendOverlayTelemetryEventIfNeeded(state: OverlayHealth) {
        val reasonCode = overlayReasonCode(state)
        val issueText =
            state.lastIssue?.trim()?.takeIf { it.isNotBlank() }
                ?: state.lastEvent?.trim()?.takeIf { it.isNotBlank() }
        val key =
            listOf(
                reasonCode,
                issueText.orEmpty(),
                state.lastIssueAtMs.toString(),
                if (state.attached) "1" else "0",
                if (isSocketPayloadStale()) "1" else "0",
                if (isSocketRoomMismatch()) "1" else "0",
                if (state.reattaching) "1" else "0",
            ).joinToString("|")

        val previousKey = lastTelemetryOverlayEventKey
        if (previousKey == key) return
        lastTelemetryOverlayEventKey = key

        if (previousKey == null && reasonCode == "healthy") return

        val reasonText: String
        val eventType: String
        val level: String

        if (reasonCode == "healthy") {
            reasonText = "Overlay đã hồi phục và quay lại trạng thái ổn định."
            eventType = "overlay_restored"
            level = "info"
        } else {
            reasonText = issueText ?: "Overlay đang có dấu hiệu bất thường."
            eventType = "overlay_issue"
            level = if (reasonCode == "overlay_detached") "error" else "warn"
        }

        sendLiveDeviceEvent(
            type = eventType,
            level = level,
            reasonCode = reasonCode,
            reasonText = reasonText,
            stage = recoveryState.value.stage.name.lowercase(Locale.ROOT),
            severity = recoveryState.value.severity.name.lowercase(Locale.ROOT),
            payload =
                LiveDeviceTelemetryEventPayload(
                    summary = state.lastEvent?.trim()?.takeIf { it.isNotBlank() } ?: reasonText,
                    detail = issueText,
                    overlayIssue = state.lastIssue?.trim()?.takeIf { it.isNotBlank() },
                    thermalState = thermalStateLabel(currentThermalStatusRawValue(), batteryTempC.value),
                    memoryPressure = latestMemoryPressureSummary(),
                    diagnostics = buildTelemetryDiagnostics().take(8),
                ),
        )
    }

    private suspend fun sendRecoveryTelemetryEventIfNeeded(
        event: RecoveryEvent,
        recovery: StreamRecoveryState,
    ) {
        val key =
            listOf(
                event.reason,
                event.atMs.toString(),
                recovery.stage.name,
                recovery.severity.name,
                recovery.attempt.toString(),
            ).joinToString("|")
        if (lastTelemetryRecoveryEventKey == key) return
        lastTelemetryRecoveryEventKey = key

        sendLiveDeviceEvent(
            type = "recovery_event",
            level = recoveryLogLevel(recovery.severity),
            reasonCode = "stream_recovery",
            reasonText = event.reason,
            stage = recovery.stage.name.lowercase(Locale.ROOT),
            severity = recovery.severity.name.lowercase(Locale.ROOT),
            payload =
                LiveDeviceTelemetryEventPayload(
                    summary = recovery.summary.ifBlank { event.reason },
                    detail = recovery.detail?.trim()?.takeIf { it.isNotBlank() },
                    overlayIssue = overlayHealth.value.lastIssue?.trim()?.takeIf { it.isNotBlank() },
                    thermalState = thermalStateLabel(currentThermalStatusRawValue(), batteryTempC.value),
                    memoryPressure = latestMemoryPressureSummary(),
                    diagnostics = buildTelemetryDiagnostics().take(8),
                ),
        )
    }

    private suspend fun sendThermalTelemetryEvent(event: ThermalEvent) {
        val key = "${event.atMs}|${event.tempC}"
        if (lastTelemetryThermalEventKey == key) return
        lastTelemetryThermalEventKey = key

        val thermalRawValue = currentThermalStatusRawValue()
        val critical = isThermalCritical(thermalRawValue, event.tempC)
        val reasonCode = if (critical) "thermal_critical" else "thermal_warning"
        val reasonText = "Thiết bị ghi nhận sự kiện nhiệt: ${thermalStateLabel(thermalRawValue, event.tempC)}."

        sendLiveDeviceEvent(
            type = "thermal_event",
            level = if (critical) "error" else "warn",
            reasonCode = reasonCode,
            reasonText = reasonText,
            stage = recoveryState.value.stage.name.lowercase(Locale.ROOT),
            severity = recoveryState.value.severity.name.lowercase(Locale.ROOT),
            payload =
                LiveDeviceTelemetryEventPayload(
                    summary = reasonText,
                    detail = latestThermalEventSummary(),
                    overlayIssue = overlayHealth.value.lastIssue?.trim()?.takeIf { it.isNotBlank() },
                    thermalState = thermalStateLabel(thermalRawValue, event.tempC),
                    memoryPressure = latestMemoryPressureSummary(),
                    diagnostics = buildTelemetryDiagnostics().take(8),
                ),
        )
    }

    private suspend fun sendMemoryPressureTelemetryEvent(event: MemoryPressureEvent) {
        val key = "${event.level}|${event.atMs}"
        if (lastTelemetryMemoryPressureEventKey == key) return
        lastTelemetryMemoryPressureEventKey = key

        sendLiveDeviceEvent(
            type = "memory_pressure_event",
            level = if (event.level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL) "error" else "warn",
            reasonCode = "memory_pressure",
            reasonText = memoryPressureSummary(event.level),
            stage = recoveryState.value.stage.name.lowercase(Locale.ROOT),
            severity = recoveryState.value.severity.name.lowercase(Locale.ROOT),
            payload =
                LiveDeviceTelemetryEventPayload(
                    summary = memoryPressureSummary(event.level),
                    detail = latestMemoryPressureSummary(),
                    overlayIssue = overlayHealth.value.lastIssue?.trim()?.takeIf { it.isNotBlank() },
                    thermalState = thermalStateLabel(currentThermalStatusRawValue(), batteryTempC.value),
                    memoryPressure = latestMemoryPressureSummary(),
                    diagnostics = buildTelemetryDiagnostics().take(8),
                ),
        )
    }

    private fun overlayReasonCode(state: OverlayHealth): String {
        val issue = state.lastIssue?.trim()?.lowercase(Locale.ROOT).orEmpty()
        return when {
            !state.attached -> "overlay_detached"
            state.reattaching -> "overlay_reattaching"
            isSocketRoomMismatch() -> "socket_room_mismatch"
            isSocketPayloadStale() -> "overlay_snapshot_stale"
            issue.contains("memory") -> "memory_pressure"
            issue.contains("thermal") || issue.contains("heat") -> "thermal_pressure"
            issue.contains("room") -> "socket_room_mismatch"
            issue.contains("snapshot") -> "overlay_snapshot_stale"
            issue.contains("fail-soft") || issue.contains("failsoft") -> "overlay_fail_soft"
            issue.isNotBlank() -> "overlay_issue"
            else -> "healthy"
        }
    }

    private fun recoveryLogLevel(severity: RecoverySeverity): String =
        when (severity) {
            RecoverySeverity.INFO -> "info"
            RecoverySeverity.WARNING -> "warn"
            RecoverySeverity.CRITICAL -> "error"
        }

    private fun streamStateSummary(state: StreamState): String =
        when (state) {
            is StreamState.Idle -> "idle"
            is StreamState.Previewing -> "preview"
            is StreamState.Connecting -> "connecting"
            is StreamState.Live -> "live"
            is StreamState.Reconnecting -> "reconnecting"
            is StreamState.Error -> "error"
            is StreamState.Stopped -> "stopped"
        }

    private fun resolveLiveDeviceId(): String {
        val androidId =
            runCatching {
                Settings.Secure.getString(appContext.contentResolver, Settings.Secure.ANDROID_ID)
            }.getOrNull()?.trim().orEmpty()
        if (androidId.isNotBlank()) {
            return androidId
        }
        return "android-${UUID.randomUUID()}"
    }

    private fun resolveDeviceDisplayName(): String {
        val settingName =
            listOf(
                runCatching {
                    Settings.Global.getString(appContext.contentResolver, "device_name")
                }.getOrNull(),
                runCatching {
                    Settings.Secure.getString(appContext.contentResolver, "bluetooth_name")
                }.getOrNull(),
            )
                .map { it?.trim().orEmpty() }
                .firstOrNull { it.isNotBlank() && !isRawDeviceModelName(it) }
        if (!settingName.isNullOrBlank()) {
            return settingName
        }

        val manufacturer = Build.MANUFACTURER.trim()
        val brand = Build.BRAND.trim()
        val model = Build.MODEL.trim()
        val labelBrand =
            listOf(manufacturer, brand)
                .firstOrNull { it.isNotBlank() && !model.contains(it, ignoreCase = true) }
                ?.replaceFirstChar { char ->
                    if (char.isLowerCase()) char.titlecase(Locale.ROOT) else char.toString()
                }
        return listOf(labelBrand, model)
            .filter { !it.isNullOrBlank() }
            .joinToString(" ")
            .ifBlank { model.ifBlank { "Android device" } }
    }

    private fun isRawDeviceModelName(value: String): Boolean {
        val normalized = value.trim()
        if (normalized.equals(Build.MODEL.trim(), ignoreCase = true)) return true
        return normalized.matches(Regex("(?i)^(SM|SC|SHV|GT|SCH|SGH|LM|XT|CPH|VOG|LYA|MHA)[-_ ]?[A-Z0-9].*"))
    }

    private fun currentBatteryLevelPercent(): Int? {
        val batteryManager =
            appContext.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager ?: return null
        val value = batteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        return value.takeIf { it in 0..100 }
    }

    private fun currentStorageTotalBytes(): Long =
        runCatching {
            android.os.StatFs(appContext.filesDir.absolutePath).totalBytes
        }.getOrDefault(0L)

    private fun currentThermalStatusRawValue(): Int {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return 0
        val powerManager = appContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
        return powerManager?.currentThermalStatus ?: 0
    }

    private fun thermalStateLabel(status: Int, tempC: Float?): String =
        when {
            status >= thermalStatusSevere() || (tempC ?: 0f) >= 46f -> "critical"
            status >= thermalStatusModerate() || (tempC ?: 0f) >= 43f -> "warning"
            status > 0 || (tempC ?: 0f) >= 40f -> "warm"
            else -> "normal"
        }

    private fun isThermalWarning(status: Int, tempC: Float?): Boolean =
        status >= thermalStatusModerate() || (tempC ?: 0f) >= 43f

    private fun isThermalCritical(status: Int, tempC: Float?): Boolean =
        status >= thermalStatusSevere() || (tempC ?: 0f) >= 46f

    private fun thermalStatusModerate(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) PowerManager.THERMAL_STATUS_MODERATE else 2

    private fun thermalStatusSevere(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) PowerManager.THERMAL_STATUS_SEVERE else 4

    private fun latestThermalEventSummary(): String? =
        lastThermalEvent.value?.let { event ->
            "Nhiệt độ pin ${String.format(Locale.US, "%.1f", event.tempC)}°C"
        }

    private fun latestMemoryPressureSummary(): String? =
        lastMemoryPressure.value?.let { memoryPressureSummary(it.level) }

    private fun memoryPressureSummary(level: Int): String =
        when {
            level >= ComponentCallbacks2.TRIM_MEMORY_COMPLETE -> "Bộ nhớ rất thấp, hệ thống đang chuẩn bị thu hồi mạnh."
            level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL -> "Bộ nhớ chạy nền đang rất căng, dễ rơi vào fail-soft."
            level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW -> "Bộ nhớ chạy nền thấp."
            level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_MODERATE -> "Bộ nhớ bắt đầu chịu áp lực."
            else -> "Có tín hiệu áp lực bộ nhớ."
        }

    private fun isSocketPayloadStale(nowMs: Long = System.currentTimeMillis()): Boolean {
        val lastPayloadAtMs = socketLastPayloadAtMs.value
        if (lastPayloadAtMs <= 0L) return false
        return socketConnected.value && nowMs - lastPayloadAtMs >= 20_000L
    }

    private fun isSocketRoomMismatch(): Boolean {
        val currentMatchId = matchId.trim()
        val activeSocketMatch = socketActiveMatchId.value?.trim().orEmpty()
        return socketConnected.value &&
            currentMatchId.isNotBlank() &&
            activeSocketMatch.isNotBlank() &&
            activeSocketMatch != currentMatchId
    }

    private fun toIsoTimestamp(timestampMs: Long?): String? =
        timestampMs?.takeIf { it > 0L }?.let { Instant.ofEpochMilli(it).toString() }

    private fun currentIsoTimestampUtc(): String = Instant.now().toString()

    private fun computePreflightIssues(
        mode: StreamMode = primaryMode() ?: StreamMode.STREAM_ONLY,
    ): List<PreflightIssue> {
        val issues = ArrayList<PreflightIssue>(8)

        val cameraGranted = ContextCompat.checkSelfPermission(appContext, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        val micGranted =
            ContextCompat.checkSelfPermission(appContext, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

        if (!cameraGranted) {
            issues.add(
                PreflightIssue(
                    severity = PreflightSeverity.BLOCKER,
                    title = "Thiếu quyền Camera",
                    detail = "Cần cấp quyền Camera để live.",
                )
            )
        }
        if (!micGranted) {
            issues.add(
                PreflightIssue(
                    severity = PreflightSeverity.BLOCKER,
                    title = "Thiếu quyền Micro",
                    detail = "Cần cấp quyền Micro để live.",
                )
            )
        }

        val hasCamera = appContext.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
        if (!hasCamera) {
            issues.add(
                PreflightIssue(
                    severity = PreflightSeverity.BLOCKER,
                    title = "Thiết bị không có camera",
                    detail = "Máy không hỗ trợ camera.",
                )
            )
        }

        val connected = networkMonitor.isConnected.value
        if (!connected && mode.includesLivestream) {
            issues.add(
                PreflightIssue(
                    severity = PreflightSeverity.BLOCKER,
                    title = "Mất mạng",
                    detail = "Không có kết nối mạng ổn định để live.",
                )
            )
        } else if (!connected && mode.includesRecording) {
            issues.add(
                PreflightIssue(
                    severity = PreflightSeverity.INFO,
                    title = "Đang offline",
                    detail = "Vẫn có thể ghi hình. App sẽ tải các đoạn ghi lên sau khi có mạng.",
                )
            )
        }

        val powerSave = streamManager.powerSaveMode.value
        if (powerSave) {
            issues.add(
                PreflightIssue(
                    severity = PreflightSeverity.WARNING,
                    title = "Đang bật tiết kiệm pin",
                    detail = "Dễ bị giới hạn CPU/mạng, có thể gây lag hoặc tự ngắt stream.",
                )
            )
        }

        val tempC = streamManager.batteryTempC.value
        if (tempC != null && tempC >= 46f) {
            issues.add(
                PreflightIssue(
                    severity = PreflightSeverity.WARNING,
                    title = "Máy đang nóng",
                    detail = "Nhiệt độ pin cao có thể làm app bị kill hoặc camera/encoder lỗi.",
                )
            )
        }

        val charging = streamManager.isCharging.value
        if (!charging) {
            issues.add(
                PreflightIssue(
                    severity = PreflightSeverity.INFO,
                    title = "Không cắm sạc",
                    detail = "Live lâu dễ tụt pin, máy giảm hiệu năng.",
                )
            )
        }

        val activityManager = appContext.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        if (activityManager != null) {
            if (activityManager.isLowRamDevice) {
                issues.add(
                    PreflightIssue(
                        severity = PreflightSeverity.WARNING,
                        title = "Thiết bị ít RAM",
                        detail = "Máy thuộc nhóm low-RAM, nguy cơ thiếu bộ nhớ khi live lâu.",
                    )
                )
            }

            val memInfo = ActivityManager.MemoryInfo()
            activityManager.getMemoryInfo(memInfo)
            if (memInfo.lowMemory) {
                issues.add(
                    PreflightIssue(
                        severity = PreflightSeverity.WARNING,
                        title = "Bộ nhớ đang thấp",
                        detail = "Hệ thống báo low memory, nguy cơ crash/kill cao hơn.",
                    )
                )
            } else {
                val availMb = memInfo.availMem / (1024L * 1024L)
                if (availMb in 1..450) {
                    issues.add(
                        PreflightIssue(
                            severity = PreflightSeverity.WARNING,
                            title = "RAM trống thấp",
                            detail = "RAM trống khoảng ${availMb}MB, live lâu dễ thiếu RAM.",
                        )
                    )
                }
            }
        }

        val hasWarningOrBlocker = issues.any { it.severity != PreflightSeverity.INFO }
        return if (hasWarningOrBlocker) issues else emptyList()
    }

    override fun onCleared() {
        super.onCleared()
        nextSessionEpoch()
        setAutoGoLive(false)
        _recordOnlyArmed.value = false
        activeLiveMatchId = null
        initJob?.cancel()
        waitCourtJob?.cancel()
        waitMatchLiveJob?.cancel()
        leaseHeartbeatJob?.cancel()
        leaseHeartbeatJob = null
        courtPresenceHeartbeatJob?.cancel()
        courtPresenceHeartbeatJob = null
        goLiveCountdownJob?.cancel()
        goLiveCountdownJob = null
        stopLiveCountdownJob?.cancel()
        stopLiveCountdownJob = null
        liveDeviceTelemetryJob?.cancel()
        liveDeviceTelemetryJob = null
        recordingCoordinator.setRecoveryBusy(false)
        recordingCoordinator.setLiveCriticalPathBusy(false)
        endingLiveDismissJob?.cancel()
        endingLiveDismissJob = null
        overlayRenderer.onBitmapReady = null
        overlayRenderer.stop()
        overlayRenderer.release()
        repository.disconnectSocket()
        clearCourtStationRuntimeWatch()
        streamManager.release()
    }
}

enum class PreflightSeverity {
    BLOCKER,
    WARNING,
    INFO,
}

data class PreflightIssue(
    val severity: PreflightSeverity,
    val title: String,
    val detail: String,
)

data class PreflightDialogState(
    val issues: List<PreflightIssue>,
    val canProceed: Boolean,
)

data class OperatorRecoveryDialogState(
    val title: String,
    val summary: String,
    val detail: String,
    val severity: RecoverySeverity,
    val stage: RecoveryStage,
    val attempt: Int,
    val budgetRemaining: Int,
    val activeMitigations: List<String>,
    val lastFatalReason: String?,
    val isFailSoftImminent: Boolean,
)
