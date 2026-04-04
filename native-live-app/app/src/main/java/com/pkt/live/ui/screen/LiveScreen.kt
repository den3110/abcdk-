package com.pkt.live.ui.screen

import android.app.Activity
import android.app.ActivityManager
import android.Manifest
import android.content.res.Configuration
import android.content.Context.BATTERY_SERVICE
import android.content.Context.POWER_SERVICE
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.os.StatFs
import android.provider.Settings
import android.view.WindowManager
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.pkt.live.BuildConfig
import com.pkt.live.data.model.StreamMode
import com.pkt.live.streaming.Quality
import com.pkt.live.streaming.RecoverySeverity
import com.pkt.live.streaming.RecoveryStage
import com.pkt.live.streaming.StreamState
import com.pkt.live.ui.LiveStreamViewModel
import com.pkt.live.ui.controls.StreamControls
import com.pkt.live.ui.controls.pinchToZoom
import com.pkt.live.ui.theme.LiveColors
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Main live stream screen composable.
 * Overlays on top of the camera SurfaceView.
 */
@Composable
fun LiveScreen(viewModel: LiveStreamViewModel) {
    val streamState by viewModel.streamState.collectAsState()
    val overlayData by viewModel.overlayData.collectAsState()
    val loading by viewModel.loading.collectAsState()
    val errorMessage by viewModel.errorMessage.collectAsState()
    val lastSocketError by viewModel.lastSocketError.collectAsState()
    val matchInfo by viewModel.matchInfo.collectAsState()
    val overlayConfig by viewModel.overlayConfig.collectAsState()
    val rtmpUrl by viewModel.rtmpUrl.collectAsState()
    val facebookLive by viewModel.facebookLive.collectAsState()
    val waitingForCourt by viewModel.waitingForCourt.collectAsState()
    val waitingForMatchLive by viewModel.waitingForMatchLive.collectAsState()
    val waitingForNextMatch by viewModel.waitingForNextMatch.collectAsState()
    val batterySaver by viewModel.batterySaver.collectAsState()
    val liveStartTime by viewModel.liveStartTime.collectAsState()
    val stats by viewModel.streamStats.collectAsState()
    val bitrateUpdatedAtMs by viewModel.bitrateUpdatedAtMs.collectAsState()
    val rtmpLastMessage by viewModel.rtmpLastMessage.collectAsState()
    val lastMemoryPressure by viewModel.lastMemoryPressure.collectAsState()
    val lastRecovery by viewModel.lastRecovery.collectAsState()
    val recoveryState by viewModel.recoveryState.collectAsState()
    val overlayHealth by viewModel.overlayHealth.collectAsState()
    val brandingLoadState by viewModel.brandingLoadState.collectAsState()
    val powerSaveMode by viewModel.powerSaveMode.collectAsState()
    val batteryTempC by viewModel.batteryTempC.collectAsState()
    val isCharging by viewModel.isCharging.collectAsState()
    val lastThermalEvent by viewModel.lastThermalEvent.collectAsState()
    val socketConnected by viewModel.socketConnected.collectAsState()
    val socketActiveMatchId by viewModel.socketActiveMatchId.collectAsState()
    val socketLastPayloadAtMs by viewModel.socketLastPayloadAtMs.collectAsState()
    val networkConnected by viewModel.networkConnected.collectAsState()
    val isWifi by viewModel.isWifi.collectAsState()
    val quality by viewModel.quality.collectAsState()
    val zoomLevel by viewModel.zoomLevel.collectAsState()
    val fallbackColorArgb by viewModel.fallbackColorArgb.collectAsState()
    val previewReady by viewModel.previewReady.collectAsState()
    val goLiveCountdownSeconds by viewModel.goLiveCountdownSeconds.collectAsState()
    val stopLiveCountdownSeconds by viewModel.stopLiveCountdownSeconds.collectAsState()
    val endingLive by viewModel.endingLive.collectAsState()
    val courtPresence by viewModel.courtPresence.collectAsState()
    val streamMode by viewModel.streamMode.collectAsState()
    val recordOnlyArmed by viewModel.recordOnlyArmed.collectAsState()
    val goLiveArmed by viewModel.goLiveArmed.collectAsState()
    val recordingUiState by viewModel.recordingUiState.collectAsState()
    val recordingStorageStatus by viewModel.recordingStorageStatus.collectAsState()
    val recordingEngineState by viewModel.recordingEngineState.collectAsState()
    val showModeSelector by viewModel.showModeSelector.collectAsState()
    val visibleIssue =
        errorMessage ?: (streamState as? StreamState.Error)
            ?.takeIf { !it.recoverable }
            ?.message
    val recoveringLiveSession =
        liveStartTime != null &&
            (
                streamState is StreamState.Connecting ||
                    streamState is StreamState.Reconnecting ||
                    ((streamState as? StreamState.Error)?.recoverable == true && recoveryState.stage != RecoveryStage.IDLE)
                )

    var loadingCollapsed by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(loading) {
        if (loading) loadingCollapsed = false
    }

    var showWarnings by rememberSaveable { mutableStateOf(false) }
    var showSignals by rememberSaveable { mutableStateOf(false) }
    var showDeviceInfo by rememberSaveable { mutableStateOf(false) }
    var endingOverlayHidden by rememberSaveable { mutableStateOf(false) }
    var pendingModeSelection by rememberSaveable(showModeSelector, streamMode) {
        mutableStateOf(streamMode ?: StreamMode.STREAM_AND_RECORD)
    }
    LaunchedEffect(endingLive, stopLiveCountdownSeconds) {
        if (endingLive || stopLiveCountdownSeconds != null) {
            endingOverlayHidden = false
        }
    }

    val context = LocalContext.current
    val activity = context as? Activity
    val configuration = LocalConfiguration.current
    val isPortraitLayout = configuration.orientation != Configuration.ORIENTATION_LANDSCAPE
    val currentDebugMatchId = viewModel.currentDebugMatchId()
    val currentDebugCourtId = viewModel.currentDebugCourtId()
    val cameraGranted =
        remember(context) {
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        }
    val micGranted =
        remember(context) {
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        }
    val overlayDataReady =
        matchInfo != null && (overlayData.teamAName != "Team A" || overlayData.teamBName != "Team B" || overlayData.scoreA != 0 || overlayData.scoreB != 0)
    val overlayVisualReady = overlayDataReady && overlayHealth.attached && !overlayHealth.reattaching
    val brandingConfigured = overlayConfig != null || !matchInfo?.tournamentLogoUrl.isNullOrBlank()
    val brandingLoading = brandingLoadState.isLoading
    val brandingAssetsReady =
        (!brandingLoadState.logoRequested || brandingLoadState.logoReady) &&
            (brandingLoadState.sponsorsRequested == 0 || brandingLoadState.sponsorsReady)
    val brandingReady = !brandingConfigured || brandingAssetsReady
    val overlayPreparing = overlayHealth.reattaching || (overlayDataReady && !overlayHealth.attached)
    val recordingWarningVisible =
        streamMode?.includesRecording == true &&
            recordingStorageStatus.warning &&
            !recordingStorageStatus.hardBlock &&
            !recordingStorageStatus.message.isNullOrBlank()
    val recordBadgeVisible =
        recordingEngineState.isRecording ||
            recordingUiState.status == "uploading" ||
            recordingUiState.status == "exporting"
    val waitingActivationChipLabel =
        when {
            waitingForNextMatch -> "Đang chờ trận kế tiếp"
            streamMode == StreamMode.RECORD_ONLY && recordOnlyArmed && waitingForMatchLive -> "Sẽ tự ghi khi trận LIVE"
            streamMode == StreamMode.RECORD_ONLY && recordOnlyArmed && waitingForCourt -> "Đang chờ trận"
            waitingForMatchLive && goLiveArmed -> "Đang chờ trận LIVE"
            waitingForCourt && goLiveArmed -> "Đang chờ trận"
            else -> null
        }
    val startActionText =
        when (streamMode) {
            StreamMode.RECORD_ONLY -> "Đang bắt đầu ghi hình trận..."
            StreamMode.STREAM_AND_RECORD -> "Đang bắt đầu phát trực tiếp và ghi hình..."
            else -> "Đang bắt đầu buổi phát trực tiếp..."
        }
    val stopActionText =
        when (streamMode) {
            StreamMode.RECORD_ONLY -> "Sẽ kết thúc ghi hình trận này..."
            StreamMode.STREAM_AND_RECORD -> "Sẽ kết thúc phát trực tiếp và ghi hình..."
            else -> "Sẽ kết thúc buổi phát trực tiếp..."
        }
    val endingActionText =
        when (streamMode) {
            StreamMode.RECORD_ONLY -> "Đang kết thúc ghi hình trận"
            StreamMode.STREAM_AND_RECORD -> "Đang kết thúc phát trực tiếp và ghi hình"
            else -> "Đang kết thúc buổi phát trực tiếp"
        }
    val goLiveCountdownVisible = goLiveCountdownSeconds != null
    val stopLiveCountdownVisible = stopLiveCountdownSeconds != null
    val suppressPreparationUi = goLiveCountdownVisible || stopLiveCountdownVisible || endingLive
    val streamIntentActive =
        liveStartTime != null ||
            streamState is StreamState.Connecting ||
            streamState is StreamState.Reconnecting ||
            waitingForCourt ||
            waitingForMatchLive ||
            waitingForNextMatch ||
            goLiveCountdownVisible ||
            stopLiveCountdownVisible ||
            endingLive
    val matchSwapLoading =
        loading &&
            !suppressPreparationUi &&
            previewReady &&
            !waitingForCourt &&
            !waitingForMatchLive &&
            !waitingForNextMatch &&
            visibleIssue == null
    val shouldShowStartupOverlayForAssets =
        (overlayPreparing || brandingLoading) &&
            streamState !is StreamState.Previewing
    val startupVisible =
        !suppressPreparationUi &&
        !matchSwapLoading &&
        !waitingForNextMatch &&
        (loading || !previewReady || shouldShowStartupOverlayForAssets) &&
            streamState !is StreamState.Live &&
            streamState !is StreamState.Connecting &&
            streamState !is StreamState.Reconnecting &&
            visibleIssue == null
    val waitingNextMatchVisible = waitingForNextMatch && visibleIssue == null
    val previewReleaseAtMs = remember(courtPresence?.previewReleaseAt) { parseIsoMillis(courtPresence?.previewReleaseAt) }
    var previousBrightness by remember { mutableStateOf<Float?>(null) }

    LaunchedEffect(activity, batterySaver) {
        if (activity == null) return@LaunchedEffect
        val window = activity.window
        val lp = window.attributes

        if (batterySaver) {
            if (previousBrightness == null) previousBrightness = lp.screenBrightness
            lp.screenBrightness = 0.03f
            window.attributes = lp
        } else {
            val prev = previousBrightness
            if (prev != null) {
                lp.screenBrightness = prev
                window.attributes = lp
                previousBrightness = null
            }
        }
    }

    DisposableEffect(activity) {
        onDispose {
            val a = activity ?: return@onDispose
            val prev = previousBrightness ?: return@onDispose
            val window = a.window
            val lp = window.attributes
            lp.screenBrightness = prev
            window.attributes = lp
            previousBrightness = null
        }
    }

    val shouldTick =
        streamState.isStreaming ||
            streamState is StreamState.Connecting ||
            streamState is StreamState.Reconnecting ||
            showWarnings ||
            showSignals ||
            showDeviceInfo ||
            lastRecovery != null ||
            lastMemoryPressure != null ||
            lastThermalEvent != null ||
            previewReleaseAtMs != null
    var nowMs by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val socketPayloadAgeSec =
        remember(nowMs, socketLastPayloadAtMs) {
            if (socketLastPayloadAtMs > 0L) ((nowMs - socketLastPayloadAtMs) / 1000L).toInt().coerceAtLeast(0) else null
        }
    val expectedSocketMatchId = currentDebugMatchId ?: matchInfo?.id?.trim()?.takeIf { it.isNotBlank() }
    val socketRoomMismatch =
        remember(expectedSocketMatchId, socketActiveMatchId) {
            !expectedSocketMatchId.isNullOrBlank() &&
                !socketActiveMatchId.isNullOrBlank() &&
                socketActiveMatchId != expectedSocketMatchId
        }
    val socketPayloadStale =
        remember(socketConnected, expectedSocketMatchId, socketPayloadAgeSec, socketRoomMismatch) {
            socketConnected &&
                !expectedSocketMatchId.isNullOrBlank() &&
                !socketRoomMismatch &&
                (socketPayloadAgeSec ?: Int.MAX_VALUE) >= 8
        }
    val previewHoldRemainingMs =
        previewReleaseAtMs?.let { releaseAt -> (releaseAt - nowMs).coerceAtLeast(0L) }
    val previewHoldWarningVisible =
        previewHoldRemainingMs != null &&
            previewHoldRemainingMs in 1..((courtPresence?.previewWarningMs ?: 300_000L).coerceAtLeast(60_000L)) &&
            courtPresence?.occupied?.occupied == true
    LaunchedEffect(shouldTick) {
        if (!shouldTick) return@LaunchedEffect
        while (true) {
            nowMs = System.currentTimeMillis()
            kotlinx.coroutines.delay(if (previewReleaseAtMs != null) 1000 else 1500)
        }
    }

    val density = LocalDensity.current
    var topBarHeightPx by remember { mutableIntStateOf(0) }
    val topBarHeightDp = remember(topBarHeightPx, density) { with(density) { topBarHeightPx.toDp() } }
    val overlayHint = remember(
        recoveringLiveSession,
        streamState,
        networkConnected,
        socketConnected,
        overlayDataReady,
        brandingReady,
        stats.currentBitrate,
        lastRecovery,
        overlayHealth,
        lastSocketError,
        rtmpLastMessage,
        nowMs,
        waitingForCourt,
        waitingForMatchLive,
        waitingForNextMatch,
    ) {
        buildOverlayHint(
            recoveringLiveSession = recoveringLiveSession,
            streamState = streamState,
            networkConnected = networkConnected,
            socketConnected = socketConnected,
            overlayDataReady = overlayDataReady,
            brandingReady = brandingReady,
            currentBitrate = stats.currentBitrate,
            lastRecovery = lastRecovery,
            overlayHealth = overlayHealth,
            lastSocketError = lastSocketError,
            rtmpLastMessage = rtmpLastMessage,
            nowMs = nowMs,
            waitingForCourt = waitingForCourt,
            waitingForMatchLive = waitingForMatchLive,
            waitingForNextMatch = waitingForNextMatch,
        )
    }
    val bitrateAgeSec = if (bitrateUpdatedAtMs > 0L) ((nowMs - bitrateUpdatedAtMs) / 1000).toInt() else null
    val memoryPressureAgeSec = lastMemoryPressure?.let { ((nowMs - it.atMs) / 1000).toInt() }
    val recoveryAgeSec = lastRecovery?.let { ((nowMs - it.atMs) / 1000).toInt() }
    val thermalAgeSec = lastThermalEvent?.let { ((nowMs - it.atMs) / 1000).toInt() }
    val hintItems = remember(
        streamState,
        streamMode,
        recordOnlyArmed,
        waitingForCourt,
        waitingForMatchLive,
        waitingForNextMatch,
        stats.currentBitrate,
        socketConnected,
        socketActiveMatchId,
        socketPayloadAgeSec,
        socketPayloadStale,
        socketRoomMismatch,
        networkConnected,
        bitrateAgeSec,
        memoryPressureAgeSec,
        recoveryAgeSec,
        lastRecovery,
        recoveryState,
        powerSaveMode,
        isCharging,
        batteryTempC,
        thermalAgeSec,
        quality,
    ) {
        buildList {
            if (!networkConnected) {
                add(HintItem("Mất kết nối mạng. Đang chờ có mạng để tự nối lại.", LiveColors.LiveRed, Icons.Default.SignalWifiOff))
            }
            if (streamMode == StreamMode.RECORD_ONLY && recordOnlyArmed && (waitingForCourt || waitingForMatchLive) && !waitingForNextMatch) {
                add(HintItem("Record only đang armed. App sẽ tự bắt đầu ghi khi trận chuyển sang LIVE.", LiveColors.Warning, Icons.Default.FiberManualRecord))
            }
            if (waitingForNextMatch) {
                add(HintItem(if (streamMode == StreamMode.RECORD_ONLY && recordOnlyArmed) "Trận trước đã kết thúc. App đang giữ camera và sẽ tự ghi khi trận kế tiếp chuyển LIVE." else "Trận trước đã kết thúc. App đang giữ camera và chờ trận kế tiếp trên sân này.", LiveColors.Warning, Icons.Default.HourglassTop))
            }
            if (streamState is StreamState.Reconnecting && !waitingForNextMatch) {
                add(HintItem("Đang reconnect RTMP...", LiveColors.Reconnecting, Icons.Default.Sync))
            }
            if (streamState is StreamState.Connecting && !waitingForNextMatch) {
                add(HintItem("Đang kết nối RTMP...", LiveColors.Warning, Icons.Default.CloudUpload))
            }
            if (powerSaveMode) {
                add(HintItem("Power Saver đang bật. App ưu tiên ổn định (có thể tự giảm chất lượng).", LiveColors.Warning, Icons.Default.BatterySaver))
            }
            if (isCharging) {
                add(HintItem("Đang sạc. Nếu máy nóng, app sẽ tự hạ chất lượng để tránh crash.", LiveColors.TextSecondary, Icons.Default.Power))
            }
            batteryTempC?.let { tempC ->
                if (tempC >= 44f) {
                    add(
                        HintItem(
                            "Nhiệt độ cao (${String.format("%.1f", tempC)}°C). Ưu tiên ổn định.",
                            LiveColors.Warning,
                            Icons.Default.DeviceThermostat,
                        )
                    )
                }
            }
            if (streamState is StreamState.Live) {
                if (stats.currentBitrate in 1..600_000) {
                    add(
                        HintItem(
                            "Bitrate thấp (${stats.currentBitrate / 1000} kbps). Thử đổi mạng hoặc hạ chất lượng.",
                            LiveColors.Warning,
                            Icons.Default.NetworkCheck,
                        )
                    )
                }
                if (bitrateAgeSec != null && bitrateAgeSec >= 18) {
                    add(
                        HintItem(
                            "Không nhận bitrate ${bitrateAgeSec}s. Nếu kéo dài, hệ thống sẽ tự khôi phục stream.",
                            LiveColors.Warning,
                            Icons.Default.Timelapse,
                        )
                    )
                }
            }
            lastSocketError?.takeIf { it.isNotBlank() }?.let { err ->
                add(HintItem(err, LiveColors.LiveRed, Icons.Default.LinkOff))
            }
            if (socketRoomMismatch) {
                add(
                    HintItem(
                        "Socket đã connected nhưng đang đổi sang room trận mới. App đang chờ payload của trận hiện tại.",
                        LiveColors.Warning,
                        Icons.Default.Sync,
                    )
                )
            } else if (socketPayloadStale) {
                add(
                    HintItem(
                        "Socket đang connected nhưng chưa có payload mới ${socketPayloadAgeSec ?: 0}s. App vẫn giữ poll 3s làm lớp backup.",
                        LiveColors.Warning,
                        Icons.Default.Link,
                    )
                )
            }
            if (!loading && matchInfo != null && !socketConnected) {
                add(HintItem("Socket overlay đang mất kết nối. Score/serve có thể không cập nhật realtime.", LiveColors.Warning, Icons.Default.LinkOff))
            }
            if (memoryPressureAgeSec != null && memoryPressureAgeSec in 0..60) {
                add(HintItem("Thiếu RAM. App đã tự giảm chất lượng để tránh crash.", LiveColors.Warning, Icons.Default.Memory))
            }
            if (thermalAgeSec != null && thermalAgeSec in 0..60) {
                add(HintItem("Máy nóng. App đã tự hạ chất lượng để tránh crash.", LiveColors.Warning, Icons.Default.DeviceThermostat))
            }
            if (recoveryAgeSec != null && recoveryAgeSec in 0..15) {
                add(HintItem("Đang tự khôi phục stream (${lastRecovery?.reason}).", LiveColors.AccentGreen, Icons.Default.AutoFixHigh))
            }
            if (recoveryState.stage != RecoveryStage.IDLE) {
                val recoveryColor =
                    when (recoveryState.severity) {
                        RecoverySeverity.CRITICAL -> LiveColors.LiveRed
                        RecoverySeverity.WARNING -> LiveColors.Warning
                        RecoverySeverity.INFO -> LiveColors.AccentGreen
                    }
                val recoveryIcon =
                    when (recoveryState.stage) {
                        RecoveryStage.DEGRADED -> Icons.Default.Speed
                        RecoveryStage.CAMERA_REBUILD, RecoveryStage.PIPELINE_REBUILD -> Icons.Default.Cameraswitch
                        RecoveryStage.OVERLAY_REBUILD -> Icons.Default.AutoFixHigh
                        RecoveryStage.FAIL_SOFT_GUARD -> Icons.Default.WarningAmber
                        else -> Icons.Default.Sync
                    }
                add(
                    HintItem(
                        "${recoveryState.summary} • budget còn ${recoveryState.budgetRemaining}",
                        recoveryColor,
                        recoveryIcon,
                    )
                )
            }
        }
    }
    val activeWarningItems =
        remember(
            hintItems,
            recordingWarningVisible,
            recordingStorageStatus.message,
            overlayHint,
            waitingForCourt,
            waitingForMatchLive,
            waitingForNextMatch,
            previewHoldWarningVisible,
            previewHoldRemainingMs,
        ) {
            buildList {
                addAll(hintItems)
                if (recordingWarningVisible) {
                    add(
                        HintItem(
                            text = recordingStorageStatus.message.orEmpty(),
                            color = LiveColors.Warning,
                            icon = Icons.Default.SaveAlt,
                        )
                    )
                }
                if (previewHoldWarningVisible) {
                    add(
                        HintItem(
                            text = "Preview của sân sắp hết hạn. Còn ${formatPresenceCountdown(previewHoldRemainingMs ?: 0L)} trước khi sân tự được mở lại.",
                            color = LiveColors.Warning,
                            icon = Icons.Default.HourglassTop,
                        )
                    )
                }
                if (!waitingForCourt && !waitingForMatchLive && !waitingForNextMatch && overlayHint.statusLabel != "Ổn định") {
                    add(
                        HintItem(
                            text = overlayHint.summary,
                            color = overlayHint.color,
                            icon = if (overlayHint.isReattaching) Icons.Default.Sync else Icons.Default.Info,
                        )
                    )
                }
            }
        }
    val warningCount = activeWarningItems.size
    val warningTint =
        remember(activeWarningItems, recordingStorageStatus.hardBlock) {
            when {
                activeWarningItems.any { it.color == LiveColors.LiveRed } || recordingStorageStatus.hardBlock -> LiveColors.LiveRed
                activeWarningItems.isNotEmpty() ->
                    activeWarningItems.firstOrNull { it.color != LiveColors.TextSecondary }?.color ?: LiveColors.Warning
                else -> Color.White.copy(alpha = 0.85f)
            }
        }
    val signalIssueCount =
        remember(
            networkConnected,
            socketRoomMismatch,
            socketPayloadStale,
            socketConnected,
            loading,
            matchInfo,
            waitingForCourt,
            waitingForMatchLive,
            waitingForNextMatch,
            overlayHint.statusLabel,
        ) {
            buildList {
                if (!networkConnected) add("network")
                if (socketRoomMismatch || socketPayloadStale) add("socket")
                if (!loading && matchInfo != null && !socketConnected) add("socket_disconnected")
                if (!waitingForCourt && !waitingForMatchLive && !waitingForNextMatch && overlayHint.statusLabel != "Ổn định") {
                    add("overlay")
                }
            }.distinct().size
        }
    val signalTint =
        remember(
            signalIssueCount,
            networkConnected,
            socketRoomMismatch,
            socketPayloadStale,
            loading,
            matchInfo,
            socketConnected,
            waitingForCourt,
            waitingForMatchLive,
            waitingForNextMatch,
            overlayHint,
        ) {
            when {
                !networkConnected -> LiveColors.LiveRed
                socketRoomMismatch || socketPayloadStale -> LiveColors.Warning
                !loading && matchInfo != null && !socketConnected -> LiveColors.Warning
                !waitingForCourt && !waitingForMatchLive && !waitingForNextMatch && overlayHint.statusLabel != "Ổn định" -> overlayHint.color
                signalIssueCount > 0 -> LiveColors.Warning
                else -> Color.White.copy(alpha = 0.85f)
            }
        }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .pinchToZoom(currentZoom = zoomLevel) { zoom ->
                viewModel.setZoom(zoom)
            },
    ) {
        // ---- Camera fallback color ----
        fallbackColorArgb?.let { argb ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color(argb))
            )
        }

        // Battery saver overlay (black screen, stream continues)
        if (batterySaver) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(
                        imageVector = Icons.Default.BatterySaver,
                        contentDescription = "Battery Saver",
                        tint = LiveColors.AccentGreen,
                        modifier = Modifier.size(48.dp),
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Battery Saver - Stream vẫn đang chạy",
                        color = LiveColors.TextSecondary,
                        fontSize = 14.sp,
                    )
                    Spacer(modifier = Modifier.height(24.dp))
                    TextButton(onClick = { viewModel.toggleBatterySaver() }) {
                        Text("Tắt Battery Saver", color = LiveColors.AccentGreen)
                    }
                }
            }
        }

        // ---- Top bar: LIVE badge + timer + network stats ----
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .align(Alignment.TopStart)
                .background(
                    Brush.verticalGradient(
                        colors = listOf(Color.Black.copy(alpha = 0.6f), Color.Transparent),
                    )
                )
                .padding(horizontal = 16.dp, vertical = 12.dp)
                .statusBarsPadding()
                .onSizeChanged { topBarHeightPx = it.height },
        ) {
            if (isPortraitLayout) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TopStatusLeftCluster(
                        streamState = streamState,
                        streamMode = streamMode,
                        recordOnlyArmed = recordOnlyArmed,
                        goLiveArmed = goLiveArmed,
                        waitingForCourt = waitingForCourt,
                        waitingForMatchLive = waitingForMatchLive,
                        waitingForNextMatch = waitingForNextMatch,
                        loading = loading,
                        loadingCollapsed = loadingCollapsed,
                        onExpandLoading = { loadingCollapsed = false },
                        recoveringLiveSession = recoveringLiveSession,
                        liveStartTime = liveStartTime,
                        waitingActivationChipLabel = waitingActivationChipLabel,
                        recordBadgeVisible = recordBadgeVisible,
                        recordingEngineState = recordingEngineState,
                        recordingUiState = recordingUiState,
                    )
                }

                Spacer(modifier = Modifier.height(8.dp))

                Box(modifier = Modifier.fillMaxWidth()) {
                    Row(
                        modifier = Modifier
                            .align(Alignment.CenterEnd)
                            .horizontalScroll(rememberScrollState()),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        TopStatusRightCluster(
                            waitingForCourt = waitingForCourt,
                            matchInfoLoaded = matchInfo != null,
                            loading = loading,
                            socketRoomMismatch = socketRoomMismatch,
                            socketPayloadStale = socketPayloadStale,
                            socketConnected = socketConnected,
                            networkConnected = networkConnected,
                            isWifi = isWifi,
                            streamState = streamState,
                            currentBitrate = stats.currentBitrate,
                            warningCount = warningCount,
                            warningTint = warningTint,
                            signalIssueCount = signalIssueCount,
                            signalTint = signalTint,
                            onShowWarnings = { showWarnings = true },
                            onShowSignals = { showSignals = true },
                            onShowDeviceInfo = { showDeviceInfo = true },
                            compact = true,
                        )
                    }
                }
            } else {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        TopStatusLeftCluster(
                            streamState = streamState,
                            streamMode = streamMode,
                            recordOnlyArmed = recordOnlyArmed,
                            goLiveArmed = goLiveArmed,
                            waitingForCourt = waitingForCourt,
                            waitingForMatchLive = waitingForMatchLive,
                            waitingForNextMatch = waitingForNextMatch,
                        loading = loading,
                        loadingCollapsed = loadingCollapsed,
                        onExpandLoading = { loadingCollapsed = false },
                        recoveringLiveSession = recoveringLiveSession,
                        liveStartTime = liveStartTime,
                        waitingActivationChipLabel = waitingActivationChipLabel,
                        recordBadgeVisible = recordBadgeVisible,
                        recordingEngineState = recordingEngineState,
                        recordingUiState = recordingUiState,
                    )
                }

                    Row(verticalAlignment = Alignment.CenterVertically) {
                        TopStatusRightCluster(
                            waitingForCourt = waitingForCourt,
                            matchInfoLoaded = matchInfo != null,
                            loading = loading,
                            socketRoomMismatch = socketRoomMismatch,
                            socketPayloadStale = socketPayloadStale,
                            socketConnected = socketConnected,
                            networkConnected = networkConnected,
                            isWifi = isWifi,
                            streamState = streamState,
                            currentBitrate = stats.currentBitrate,
                            warningCount = warningCount,
                            warningTint = warningTint,
                            signalIssueCount = signalIssueCount,
                            signalTint = signalTint,
                            onShowWarnings = { showWarnings = true },
                            onShowSignals = { showSignals = true },
                            onShowDeviceInfo = { showDeviceInfo = true },
                            compact = false,
                        )
                    }
                }
            }

        }

        // Scoreboard/logo/sponsor overlays are rendered directly into the GL stream
        // so preview and encoded video stay identical and do not duplicate.

        AnimatedVisibility(
            visible = waitingNextMatchVisible,
            enter = fadeIn(animationSpec = tween(180)) + scaleIn(initialScale = 0.98f, animationSpec = tween(180)),
            exit = fadeOut(animationSpec = tween(140)) + scaleOut(targetScale = 0.985f, animationSpec = tween(140)),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 24.dp),
                contentAlignment = Alignment.Center,
            ) {
                WaitingNextMatchCard(previewReady = previewReady)
            }
        }

        // ---- Bottom: Stream controls ----
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .align(Alignment.BottomCenter)
                .background(
                    Brush.verticalGradient(
                        colors = listOf(Color.Transparent, Color.Black.copy(alpha = 0.7f)),
                    )
                )
                .navigationBarsPadding()
                .padding(bottom = 12.dp),
        ) {
            StreamControls(
                viewModel = viewModel,
                streamState = streamState,
                hasLiveSession = liveStartTime != null,
            )
        }

        // ---- Loading overlay ----
        AnimatedVisibility(
            visible = matchSwapLoading,
            enter = fadeIn(animationSpec = tween(180)) + expandVertically(animationSpec = tween(180)),
            exit = fadeOut(animationSpec = tween(160)) + shrinkVertically(animationSpec = tween(160)),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .align(Alignment.TopCenter)
                    .padding(horizontal = 16.dp)
                    .padding(top = topBarHeightDp + 8.dp),
                contentAlignment = Alignment.TopStart,
            ) {
                MatchSwapLoadingChip(
                    label = when {
                        matchInfo == null -> "Đang nạp trận mới"
                        rtmpUrl.isNullOrBlank() -> "Đang xin stream mới"
                        overlayPreparing || brandingLoading -> "Đang đồng bộ overlay mới"
                        else -> "Đang chuyển sang trận mới"
                    },
                )
            }
        }

        AnimatedVisibility(
            visible = startupVisible && !loadingCollapsed,
            enter = fadeIn(animationSpec = tween(220)) + scaleIn(initialScale = 0.98f, animationSpec = tween(220)),
            exit = fadeOut(animationSpec = tween(180)) + scaleOut(targetScale = 0.985f, animationSpec = tween(180)),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.7f)),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(color = LiveColors.AccentGreen)
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(
                        text = when {
                            waitingForNextMatch -> "Đang chờ trận kế tiếp trên sân..."
                            waitingForCourt -> "Đang chờ sân có trận..."
                            streamMode == StreamMode.RECORD_ONLY && recordOnlyArmed && waitingForMatchLive -> "Đang chờ trận LIVE để tự ghi hình..."
                            waitingForMatchLive -> "Trận chưa LIVE - đang chờ..."
                            matchInfo == null -> "Đang tải thông tin trận đấu..."
                            streamMode == StreamMode.RECORD_ONLY -> "Đang chuẩn bị ghi hình tự động..."
                            rtmpUrl.isNullOrBlank() -> "Đang tạo RTMP..."
                            else -> "Đang chuẩn bị phát..."
                        },
                        color = Color.White,
                        fontSize = 14.sp,
                    )
                    Spacer(modifier = Modifier.height(18.dp))
                    StartupChecklist(
                        cameraReady = cameraGranted && previewReady,
                        micReady = micGranted && previewReady,
                        matchReady = matchInfo != null,
                        overlayReady = overlayVisualReady,
                        overlayLoading = overlayPreparing,
                        brandingReady = brandingReady,
                        brandingLoading = brandingLoading,
                        networkReady = networkConnected,
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                    TextButton(onClick = { loadingCollapsed = true }) {
                        Text("Thu gọn", color = LiveColors.AccentGreen)
                    }
                }
            }
        }

        // ---- Error snackbar ----
        visibleIssue?.let { msg ->
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .align(Alignment.TopCenter)
                    .padding(horizontal = 16.dp, vertical = 12.dp)
                    .padding(top = 72.dp)
                    .statusBarsPadding(),
            ) {
                Card(
                    colors = CardDefaults.cardColors(containerColor = LiveColors.LiveRed),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            imageVector = Icons.Default.ErrorOutline,
                            contentDescription = null,
                            tint = Color.White,
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = msg,
                            color = Color.White,
                            fontSize = 13.sp,
                            modifier = Modifier.weight(1f),
                        )
                        IconButton(onClick = { viewModel.dismissError() }) {
                            Icon(
                                imageVector = Icons.Default.Close,
                                contentDescription = "Dismiss",
                                tint = Color.White,
                            )
                        }
                    }
                }
            }
        }

        goLiveCountdownSeconds?.let { seconds ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.76f)),
                contentAlignment = Alignment.Center,
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(
                        text = seconds.toString(),
                        color = Color.White,
                        fontSize = 108.sp,
                        fontWeight = FontWeight.Light,
                    )
                    Spacer(modifier = Modifier.height(18.dp))
                    Text(
                        text = startActionText,
                        color = Color.White.copy(alpha = 0.88f),
                        fontSize = 15.sp,
                    )
                    Spacer(modifier = Modifier.height(28.dp))
                    FilledTonalButton(
                        onClick = { viewModel.cancelGoLiveCountdown() },
                        colors = ButtonDefaults.filledTonalButtonColors(
                            containerColor = Color.White.copy(alpha = 0.16f),
                            contentColor = Color.White,
                        ),
                        shape = RoundedCornerShape(999.dp),
                    ) {
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = "Cancel countdown",
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Hủy")
                    }
                }
            }
        }

        stopLiveCountdownSeconds?.let { seconds ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.78f)),
                contentAlignment = Alignment.Center,
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(
                        text = seconds.toString(),
                        color = Color.White,
                        fontSize = 108.sp,
                        fontWeight = FontWeight.Light,
                    )
                    Spacer(modifier = Modifier.height(18.dp))
                    Text(
                        text = stopActionText,
                        color = Color.White.copy(alpha = 0.88f),
                        fontSize = 15.sp,
                    )
                    Spacer(modifier = Modifier.height(28.dp))
                    FilledTonalButton(
                        onClick = { viewModel.cancelStopLiveCountdown() },
                        colors = ButtonDefaults.filledTonalButtonColors(
                            containerColor = Color.White.copy(alpha = 0.16f),
                            contentColor = Color.White,
                        ),
                        shape = RoundedCornerShape(999.dp),
                    ) {
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = "Cancel stop countdown",
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Hủy")
                    }
                }
            }

        }

        if (endingLive && stopLiveCountdownSeconds == null && !endingOverlayHidden) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.78f)),
                contentAlignment = Alignment.Center,
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    CircularProgressIndicator(
                        color = Color.White,
                        strokeWidth = 3.dp,
                        modifier = Modifier.size(56.dp),
                    )
                    Spacer(modifier = Modifier.height(20.dp))
                    Text(
                        text = endingActionText,
                        color = Color.White,
                        fontSize = 22.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
        }

        if (showModeSelector) {
            ModeSelectorOverlay(
                selectedMode = pendingModeSelection,
                storageStatus = recordingStorageStatus,
                onSelect = { pendingModeSelection = it },
                onConfirm = { viewModel.confirmStreamMode(pendingModeSelection) },
            )
        }

        if (showWarnings) {
            AlertDialog(
                onDismissRequest = { showWarnings = false },
                confirmButton = {
                    TextButton(onClick = { showWarnings = false }) {
                        Text("Đóng")
                    }
                },
                title = { Text("Cảnh báo") },
                text = {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 520.dp)
                            .verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Text(
                            text = "Cảnh báo hiện tại",
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 13.sp,
                        )
                        if (activeWarningItems.isEmpty()) {
                            Text(
                                text = "Không có cảnh báo hoạt động. App đang tự xử lý ngầm nếu có recovery nhẹ.",
                                color = LiveColors.TextSecondary,
                                fontSize = 12.sp,
                            )
                        } else {
                            activeWarningItems.forEach { item ->
                                HintBanner(item = item)
                            }
                        }

                        if (previewHoldWarningVisible) {
                            TextButton(
                                onClick = viewModel::extendCourtPresencePreviewWindow,
                                contentPadding = PaddingValues(horizontal = 0.dp, vertical = 0.dp),
                            ) {
                                Text("Tiếp tục giữ sân")
                            }
                        }

                        HorizontalDivider(color = Color.White.copy(alpha = 0.1f))
                        Text(
                            text = "Tự khôi phục",
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 13.sp,
                        )
                        if (recoveryState.stage == RecoveryStage.IDLE) {
                            Text(
                                text = "Không có recovery chủ động. Nếu app vừa tự cứu xong, chi tiết gần nhất sẽ hiện ở phần overlay/tín hiệu.",
                                color = LiveColors.TextSecondary,
                                fontSize = 12.sp,
                            )
                        } else {
                            val recoveryColor =
                                when (recoveryState.severity) {
                                    RecoverySeverity.CRITICAL -> LiveColors.LiveRed
                                    RecoverySeverity.WARNING -> LiveColors.Warning
                                    RecoverySeverity.INFO -> LiveColors.AccentGreen
                                }
                            Text(
                                text = recoveryState.summary,
                                color = recoveryColor,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 12.sp,
                            )
                            recoveryState.detail?.takeIf { it.isNotBlank() }?.let { detail ->
                                Text(detail, fontSize = 12.sp, color = LiveColors.TextSecondary)
                            }
                            Text(
                                text = "Stage: ${recoveryState.stage.label} • Attempt: ${recoveryState.attempt} • Budget còn: ${recoveryState.budgetRemaining}",
                                fontSize = 12.sp,
                            )
                            Text(
                                text = "Quality hiện tại: ${quality.label}" + if (recoveryState.isFailSoftImminent) " • Sắp chạm ngưỡng bảo vệ" else "",
                                fontSize = 12.sp,
                            )
                            recoveryState.lastFatalReason?.takeIf { it.isNotBlank() }?.let { reason ->
                                Text("Nguồn lỗi gần nhất: $reason", fontSize = 12.sp)
                            }
                            recoveryState.activeMitigations.forEach { mitigation ->
                                Text("• $mitigation", fontSize = 12.sp, color = LiveColors.TextSecondary)
                            }
                        }

                    }
                },
            )
        }

        if (showSignals) {
            val liveUrl =
                facebookLive.watchUrl
                    ?: facebookLive.permalinkUrl
                    ?: matchInfo?.video

            AlertDialog(
                onDismissRequest = { showSignals = false },
                confirmButton = {
                    TextButton(onClick = { showSignals = false }) {
                        Text("Đóng")
                    }
                },
                title = { Text("Tín hiệu") },
                text = {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 520.dp)
                            .verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Text(
                            text = "Overlay",
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 13.sp,
                        )
                        Text(
                            text = overlayHint.summary,
                            color = overlayHint.color,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 12.sp,
                        )
                        Text("Trạng thái overlay: ${overlayHint.statusLabel}", fontSize = 12.sp, color = overlayHint.color)
                        Text("Overlay dữ liệu: " + if (overlayDataReady) "Đã có scoreboard" else "Chưa đủ dữ liệu để vẽ ổn định", fontSize = 12.sp)
                        Text("Logo / sponsor: " + if (brandingReady) "Đã có nguồn để tải" else "Chưa có hoặc đang tải", fontSize = 12.sp)
                        Text("Khởi tạo overlay: " + if (overlayPreparing) "Đang gắn / đồng bộ lại" else "Ổn định", fontSize = 12.sp)
                        Text(
                            text = "Nạp branding: " + if (brandingLoading) "Đang tải logo / sponsor" else if (brandingReady) "Đã sẵn sàng" else "Chưa xong",
                            fontSize = 12.sp,
                        )
                        overlayHealth.lastIssue?.let {
                            val ageSec = ((nowMs - overlayHealth.lastIssueAtMs) / 1000).coerceAtLeast(0L)
                            Text("Lý do overlay gần nhất: $it (${ageSec}s trước)", fontSize = 12.sp)
                        }
                        overlayHealth.lastEvent?.let {
                            Text("Sự kiện overlay gần nhất: $it", fontSize = 12.sp)
                        }
                        overlayHint.reasons.forEach { reason ->
                            Text("• $reason", fontSize = 12.sp, color = LiveColors.TextSecondary)
                        }

                        HorizontalDivider(color = Color.White.copy(alpha = 0.1f))
                        Text(
                            text = "Tín hiệu realtime",
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 13.sp,
                        )
                        Text("Mạng: " + (if (networkConnected) (if (isWifi) "Wi-Fi" else "4G/5G") else "OFFLINE"))
                        Text(
                            "Socket: " + when {
                                waitingForCourt -> "Chưa có trận trên sân -> sẽ tự kết nối khi có trận"
                                socketRoomMismatch -> "Đã kết nối nhưng đang chuyển sang room trận mới"
                                socketPayloadStale -> "Đã kết nối nhưng payload đang stale ${socketPayloadAgeSec ?: 0}s"
                                socketConnected -> "Đã kết nối"
                                else -> "Mất kết nối"
                            }
                        )
                        Text("Room match active: " + (socketActiveMatchId ?: "Chưa join room"))
                        Text(
                            "Payload socket: " + when {
                                socketRoomMismatch -> "Đang chờ payload của room mới"
                                socketPayloadAgeSec == null -> "Chưa nhận payload"
                                else -> "${socketPayloadAgeSec}s trước"
                            }
                        )
                        if (!lastSocketError.isNullOrBlank()) {
                            Text("Socket lỗi: $lastSocketError")
                        }
                        Text(
                            "API match: " + when {
                                matchInfo != null -> "OK"
                                waitingForCourt -> "Đang chờ sân có trận"
                                loading -> "Đang tải"
                                else -> "Chưa có"
                            }
                        )
                        Text(
                            "API overlay config: " + when {
                                waitingForCourt -> "Chờ có trận"
                                overlayConfig != null -> "OK"
                                loading -> "Đang tải"
                                else -> "Chưa có"
                            }
                        )
                        Text("Sponsors: " + (overlayConfig?.sponsors?.size ?: 0))
                        Text(
                            "RTMP URL: " + when {
                                waitingForNextMatch -> "Chờ trận kế tiếp"
                                waitingForMatchLive -> "Chờ trận LIVE"
                                waitingForCourt -> "Chờ có trận"
                                !rtmpUrl.isNullOrBlank() -> rtmpUrl
                                loading -> "Đang tạo"
                                else -> "Chưa có"
                            }
                        )

                        if (!rtmpUrl.isNullOrBlank()) {
                            val server = facebookLive.serverUrl?.trim()?.trimEnd('/')
                            val key = facebookLive.streamKey
                            if (!server.isNullOrBlank() && !key.isNullOrBlank()) {
                                Text("Server: $server")
                                Text("Key: $key")
                            }
                            val pageName = facebookLive.pageName
                            val pageId = facebookLive.pageId
                            if (!pageName.isNullOrBlank() || !pageId.isNullOrBlank()) {
                                Text("Page: " + (pageName ?: pageId ?: ""))
                            }
                        }
                        if (!liveUrl.isNullOrBlank()) {
                            Spacer(modifier = Modifier.height(6.dp))
                            Text("Live video: $liveUrl")
                        }
                        if (!rtmpUrl.isNullOrBlank() || !liveUrl.isNullOrBlank()) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                if (!rtmpUrl.isNullOrBlank()) {
                                    TextButton(onClick = {
                                        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                        cm.setPrimaryClip(ClipData.newPlainText("RTMP URL", rtmpUrl))
                                    }) {
                                        Text("Copy RTMP")
                                    }
                                }
                                if (!liveUrl.isNullOrBlank()) {
                                    TextButton(onClick = {
                                        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                        cm.setPrimaryClip(ClipData.newPlainText("Live URL", liveUrl))
                                    }) {
                                        Text("Copy Live URL")
                                    }
                                }
                            }
                        }
                        Text("Stream: " + when (streamState) {
                            is StreamState.Live -> "LIVE"
                            is StreamState.Connecting ->
                                if (waitingForMatchLive || waitingForCourt || waitingForNextMatch) {
                                    "Đang chờ"
                                } else {
                                    "Connecting"
                                }
                            is StreamState.Reconnecting ->
                                if (waitingForMatchLive || waitingForCourt || waitingForNextMatch) {
                                    "Đang chờ"
                                } else {
                                    "Reconnecting"
                                }
                            else -> when {
                                waitingForNextMatch -> "Đang chờ trận kế tiếp"
                                waitingForMatchLive -> "Đang chờ trận LIVE"
                                waitingForCourt -> "Đang chờ sân có trận"
                                else -> "Preview"
                            }
                        })
                        if (!rtmpLastMessage.isNullOrBlank() && !waitingForCourt && !waitingForMatchLive && !waitingForNextMatch) {
                            Text("RTMP: $rtmpLastMessage")
                        }
                    }
                },
            )
        }

        if (showDeviceInfo) {
            val deviceInfoRows =
                remember(
                    context,
                    currentDebugCourtId,
                    currentDebugMatchId,
                    streamState,
                    streamMode,
                    quality,
                    previewReady,
                    networkConnected,
                    isWifi,
                    socketConnected,
                    socketActiveMatchId,
                    socketPayloadAgeSec,
                    socketRoomMismatch,
                    socketPayloadStale,
                    stats.currentBitrate,
                    batteryTempC,
                    isCharging,
                    powerSaveMode,
                    lastThermalEvent,
                    recordingStorageStatus,
                    recordingUiState,
                    cameraGranted,
                    micGranted,
                ) {
                    buildDeviceInfoRows(
                        context = context,
                        courtId = currentDebugCourtId,
                        matchId = currentDebugMatchId,
                        streamState = streamState,
                        streamMode = streamMode,
                        quality = quality,
                        previewReady = previewReady,
                        networkConnected = networkConnected,
                        isWifi = isWifi,
                        socketConnected = socketConnected,
                        socketActiveMatchId = socketActiveMatchId,
                        socketPayloadAgeSec = socketPayloadAgeSec,
                        socketRoomMismatch = socketRoomMismatch,
                        socketPayloadStale = socketPayloadStale,
                        bitrate = stats.currentBitrate,
                        batteryTempC = batteryTempC,
                        isCharging = isCharging,
                        powerSaveMode = powerSaveMode,
                        lastThermalEvent = lastThermalEvent,
                        storageStatus = recordingStorageStatus,
                        recordingUiState = recordingUiState,
                        cameraGranted = cameraGranted,
                        micGranted = micGranted,
                    )
                }

            AlertDialog(
                onDismissRequest = { showDeviceInfo = false },
                confirmButton = {
                    TextButton(onClick = { showDeviceInfo = false }) {
                        Text("Đóng")
                    }
                },
                title = { Text("Thiết bị") },
                text = {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 460.dp)
                            .verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        deviceInfoRows.forEach { (label, value) ->
                            DeviceInfoRow(label = label, value = value)
                        }
                    }
                },
            )
        }


    }
}

@Composable
private fun StartupChecklist(
    cameraReady: Boolean,
    micReady: Boolean,
    matchReady: Boolean,
    overlayReady: Boolean,
    overlayLoading: Boolean,
    brandingReady: Boolean,
    brandingLoading: Boolean,
    networkReady: Boolean,
) {
    Column(
        modifier = Modifier
            .clip(RoundedCornerShape(14.dp))
            .background(Color.White.copy(alpha = 0.08f))
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        StartupRow("Camera preview", cameraReady)
        StartupRow("Microphone", micReady)
        StartupRow("Dữ liệu trận", matchReady)
        StartupRow(
            label = "Overlay tỷ số",
            ready = overlayReady,
            detail = when {
                overlayLoading -> "Đang khởi tạo / gắn lại vào video"
                overlayReady -> "Đã sẵn sàng"
                else -> "Chờ dữ liệu và filter encoder"
            },
        )
        StartupRow(
            label = "Logo / sponsor",
            ready = brandingReady,
            detail = when {
                brandingLoading -> "Đang tải và render branding"
                brandingReady -> "Đã sẵn sàng"
                else -> "Chưa có hoặc chưa tải xong"
            },
        )
        StartupRow("Kết nối mạng", networkReady)
    }
}

@Composable
private fun StartupRow(
    label: String,
    ready: Boolean,
    detail: String? = null,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        if (ready) {
            Icon(
                imageVector = Icons.Default.CheckCircle,
                contentDescription = null,
                tint = LiveColors.AccentGreen,
                modifier = Modifier.size(16.dp),
            )
        } else {
            CircularProgressIndicator(
                modifier = Modifier.size(16.dp),
                strokeWidth = 2.dp,
                color = LiveColors.Warning,
            )
        }
        Spacer(modifier = Modifier.width(10.dp))
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                text = label,
                color = Color.White.copy(alpha = if (ready) 0.95f else 0.8f),
                fontSize = 12.sp,
            )
            detail?.takeIf { it.isNotBlank() }?.let {
                Text(
                    text = it,
                    color = Color.White.copy(alpha = 0.58f),
                    fontSize = 10.sp,
                )
            }
        }
    }
}

private data class HintItem(
    val text: String,
    val color: Color,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
)

private data class OverlayHintState(
    val summary: String,
    val color: Color,
    val reasons: List<String>,
    val statusLabel: String,
    val isReattaching: Boolean,
)

@Composable
private fun TopStatusLeftCluster(
    streamState: StreamState,
    streamMode: StreamMode?,
    recordOnlyArmed: Boolean,
    goLiveArmed: Boolean,
    waitingForCourt: Boolean,
    waitingForMatchLive: Boolean,
    waitingForNextMatch: Boolean,
    loading: Boolean,
    loadingCollapsed: Boolean,
    onExpandLoading: () -> Unit,
    recoveringLiveSession: Boolean,
    liveStartTime: Long?,
    waitingActivationChipLabel: String?,
    recordBadgeVisible: Boolean,
    recordingEngineState: com.pkt.live.streaming.RecordingEngineState,
    recordingUiState: com.pkt.live.data.model.RecordingUiState,
) {
    val armedBadgeLabel =
        if (streamMode == StreamMode.RECORD_ONLY && recordOnlyArmed) "REC AUTO" else "LIVE"
    val storageTargetChipLabel =
        recordingUiState.activeStorageTargetId
            ?.takeIf { it.isNotBlank() }
            ?.let { "R2: $it" }
    val storageFailoverChipLabel =
        buildStorageFailoverChipLabel(recordingUiState.latestStorageFailover)

    when {
        waitingForNextMatch -> WaitingNextMatchBadge()
        streamState is StreamState.Live -> LiveBadge()
        streamState is StreamState.Reconnecting -> ReconnectingBadge(streamState)
        streamState is StreamState.Connecting -> {
            if (recoveringLiveSession) RecoveringBadge() else ConnectingBadge()
        }
        streamState is StreamState.Previewing -> {
            if (recoveringLiveSession) {
                RecoveringBadge()
            } else if (streamMode == StreamMode.RECORD_ONLY && recordOnlyArmed && (waitingForMatchLive || waitingForCourt || waitingForNextMatch)) {
                ArmedBadge(label = armedBadgeLabel)
            } else {
                PreviewBadge()
            }
        }
        else -> {
            if ((streamMode == StreamMode.RECORD_ONLY && recordOnlyArmed) || goLiveArmed) {
                ArmedBadge(label = armedBadgeLabel)
            } else {
                IdleBadge()
            }
        }
    }

    AnimatedVisibility(
        visible = loading && loadingCollapsed,
        enter = fadeIn(animationSpec = tween(180)) + expandHorizontally(animationSpec = tween(180)),
        exit = fadeOut(animationSpec = tween(180)) + shrinkHorizontally(animationSpec = tween(180)),
    ) {
        Row(
            modifier = Modifier
                .padding(start = 10.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(Color.Black.copy(alpha = 0.55f))
                .clickable(onClick = onExpandLoading)
                .padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            LiveIndicatorDot(
                size = 8.dp,
                color = LiveColors.LiveRed,
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = when {
                    waitingForNextMatch -> "Đang chờ trận kế tiếp..."
                    streamMode == StreamMode.RECORD_ONLY && recordOnlyArmed && (waitingForMatchLive || waitingForCourt) -> "Sẽ tự ghi khi trận LIVE..."
                    goLiveArmed -> "Đang chờ trận LIVE..."
                    else -> "Đang tải..."
                },
                color = Color.White,
                fontSize = 12.sp,
            )
        }
    }

    liveStartTime?.let { startTime ->
        Spacer(modifier = Modifier.width(12.dp))
        LiveTimer(startTime = startTime)
        if (recordBadgeVisible) {
            Spacer(modifier = Modifier.width(8.dp))
            RecordingStateChip(
                isRecording = recordingEngineState.isRecording,
                exporting = recordingUiState.status == "exporting",
                pendingUploads = recordingUiState.pendingUploads,
            )
        }
    }

    if (liveStartTime == null && !loading && !waitingActivationChipLabel.isNullOrBlank()) {
        Spacer(modifier = Modifier.width(12.dp))
        WaitingActivationChip(label = waitingActivationChipLabel)
    }

    if (!storageTargetChipLabel.isNullOrBlank()) {
        Spacer(modifier = Modifier.width(10.dp))
        RecordingStorageRouteChip(
            label = storageTargetChipLabel,
            highlighted = !storageFailoverChipLabel.isNullOrBlank(),
        )
    }

    if (!storageFailoverChipLabel.isNullOrBlank()) {
        Spacer(modifier = Modifier.width(8.dp))
        RecordingStorageRouteChip(
            label = storageFailoverChipLabel,
            highlighted = true,
        )
    }
}

@Composable
private fun RecordingStorageRouteChip(
    label: String,
    highlighted: Boolean,
) {
    Surface(
        color =
            if (highlighted) LiveColors.Warning.copy(alpha = 0.22f)
            else Color.Black.copy(alpha = 0.42f),
        contentColor = if (highlighted) LiveColors.Warning else Color.White.copy(alpha = 0.92f),
        shape = RoundedCornerShape(10.dp),
        tonalElevation = 0.dp,
        shadowElevation = 0.dp,
    ) {
        Text(
            text = label,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

private fun buildStorageFailoverChipLabel(
    entry: com.pkt.live.data.model.RecordingStorageFailoverEntry?,
): String? {
    val nextEntry = entry ?: return null
    val fromTarget = nextEntry.fromTargetId?.takeIf { it.isNotBlank() } ?: return null
    val toTarget = nextEntry.toTargetId?.takeIf { it.isNotBlank() } ?: return null
    if (fromTarget == toTarget) return null
    return "Failover: $fromTarget->$toTarget"
}

@Composable
private fun TopStatusRightCluster(
    waitingForCourt: Boolean,
    matchInfoLoaded: Boolean,
    loading: Boolean,
    socketRoomMismatch: Boolean,
    socketPayloadStale: Boolean,
    socketConnected: Boolean,
    networkConnected: Boolean,
    isWifi: Boolean,
    streamState: StreamState,
    currentBitrate: Long,
    warningCount: Int,
    warningTint: Color,
    signalIssueCount: Int,
    signalTint: Color,
    onShowWarnings: () -> Unit,
    onShowSignals: () -> Unit,
    onShowDeviceInfo: () -> Unit,
    compact: Boolean,
) {
    val iconSize = if (compact) 34.dp else 40.dp
    IconButton(
        onClick = onShowWarnings,
        modifier = Modifier.size(iconSize),
    ) {
        BadgedBox(
            badge = {
                if (warningCount > 0) {
                    Badge(containerColor = warningTint) {
                        Text(
                            text = warningCount.coerceAtMost(99).toString(),
                            fontSize = 10.sp,
                        )
                    }
                }
            },
        ) {
            Icon(
                imageVector = if (warningCount > 0) Icons.Default.WarningAmber else Icons.Default.Info,
                contentDescription = "Cảnh báo",
                tint = if (warningCount > 0) warningTint else Color.White.copy(alpha = 0.85f),
            )
        }
    }
    Spacer(modifier = Modifier.width(if (compact) 4.dp else 2.dp))
    IconButton(
        onClick = onShowSignals,
        modifier = Modifier.size(iconSize),
    ) {
        BadgedBox(
            badge = {
                if (signalIssueCount > 0) {
                    Badge(containerColor = signalTint) {
                        Text(
                            text = signalIssueCount.coerceAtMost(99).toString(),
                            fontSize = 10.sp,
                        )
                    }
                }
            },
        ) {
            Icon(
                imageVector = Icons.Default.NetworkCheck,
                contentDescription = "Tín hiệu",
                tint = signalTint,
            )
        }
    }
    Spacer(modifier = Modifier.width(if (compact) 4.dp else 2.dp))
    IconButton(
        onClick = onShowDeviceInfo,
        modifier = Modifier.size(iconSize),
    ) {
        Icon(
            imageVector = Icons.Default.Memory,
            contentDescription = "Thiết bị",
            tint = Color.White.copy(alpha = 0.85f),
        )
    }

    Box(
        modifier = Modifier
            .size(8.dp)
            .clip(RoundedCornerShape(4.dp))
            .background(
                when {
                    waitingForCourt -> Color.White.copy(alpha = 0.35f)
                    !matchInfoLoaded && loading -> Color.White.copy(alpha = 0.35f)
                    socketRoomMismatch || socketPayloadStale -> LiveColors.Warning
                    socketConnected -> LiveColors.AccentGreen
                    else -> LiveColors.LiveRed
                }
            )
    )
    Spacer(modifier = Modifier.width(8.dp))

    if (!networkConnected) {
        Text(
            text = "OFFLINE",
            color = LiveColors.LiveRed,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
        )
        Spacer(modifier = Modifier.width(10.dp))
    } else {
        Text(
            text = if (isWifi) "Wi-Fi" else "4G/5G",
            color = Color.White.copy(alpha = 0.75f),
            fontSize = 11.sp,
        )
        Spacer(modifier = Modifier.width(10.dp))
    }

    if (streamState.isStreaming && currentBitrate > 0) {
        Text(
            text = "${currentBitrate / 1000} kbps",
            color = Color.White.copy(alpha = 0.8f),
            fontSize = 11.sp,
        )
    }
}

private fun buildOverlayHint(
    recoveringLiveSession: Boolean,
    streamState: StreamState,
    networkConnected: Boolean,
    socketConnected: Boolean,
    overlayDataReady: Boolean,
    brandingReady: Boolean,
    currentBitrate: Long,
    lastRecovery: com.pkt.live.streaming.RecoveryEvent?,
    overlayHealth: com.pkt.live.streaming.OverlayHealth,
    lastSocketError: String?,
    rtmpLastMessage: String?,
    nowMs: Long,
    waitingForCourt: Boolean,
    waitingForMatchLive: Boolean,
    waitingForNextMatch: Boolean,
): OverlayHintState {
    if (waitingForCourt || waitingForMatchLive) {
        return OverlayHintState(
            summary =
                if (waitingForMatchLive) {
                    "Trận hiện tại chưa LIVE. App đang giữ preview và chờ điều kiện bắt đầu phiên."
                } else {
                    "Sân này chưa có trận. App đang giữ preview và chờ trận được gán vào sân."
                },
            color = LiveColors.Warning,
            reasons =
                if (waitingForMatchLive) {
                    listOf(
                        "RTMP và live session chưa được tạo ở giai đoạn này.",
                        "Khi trận chuyển sang LIVE, app mới xin live session, RTMP URL và bắt đầu phát/ghi theo mode đã chọn.",
                    )
                } else {
                    listOf(
                        "App mới chỉ giữ sân và camera preview.",
                        "Khi sân có trận, app sẽ nạp match info, overlay và socket theo trận đó.",
                    )
                },
            statusLabel = "Đang chờ",
            isReattaching = false,
        )
    }
    if (waitingForNextMatch) {
        return OverlayHintState(
            summary = "Overlay của trận cũ đã được dọn. App đang chờ dữ liệu từ trận kế tiếp.",
            color = LiveColors.Warning,
            reasons = listOf(
                "Trận trước đã kết thúc nên app đã ngắt socket/overlay cũ và chờ trận mới trên sân này.",
                "Khi sân có trận kế tiếp, app sẽ nạp lại match info, socket, scoreboard, logo giải và sponsor theo trận mới.",
            ),
            statusLabel = "Chờ trận",
            isReattaching = false,
        )
    }

    val reasons = buildList {
        if (overlayHealth.reattaching) {
            add("Overlay đang được gắn lại vào encoder sau khi filter GL vừa bị reset hoặc stream vừa phục hồi.")
        }
        if (!overlayHealth.lastIssue.isNullOrBlank()) {
            add(overlayHealth.lastIssue)
        }
        if (recoveringLiveSession || streamState is StreamState.Reconnecting) {
            add("Luồng đang reconnect nên encoder có thể vừa reset, overlay sẽ được gắn lại sau nhịp phục hồi.")
        }
        if (!networkConnected) {
            add("Thiết bị đang mất mạng, nên RTMP và branding có thể bị gián đoạn.")
        } else if (streamState is StreamState.Live && currentBitrate in 1..800_000) {
            add("Bitrate đang thấp, app có thể đang tự giảm chất lượng hoặc tự khôi phục stream.")
        }
        if (!socketConnected) {
            add("Socket overlay đang mất kết nối, score/serve có thể không cập nhật hoặc bị chậm.")
        }
        if (!overlayDataReady) {
            add("Dữ liệu overlay chưa đủ ổn định, scoreboard có thể chưa được render đầy đủ.")
        }
        if (!brandingReady) {
            add("Logo giải hoặc sponsor chưa tải xong, nên phần ảnh có thể chưa hiện.")
        }
        lastRecovery?.let {
            val ageSec = ((nowMs - it.atMs) / 1000).coerceAtLeast(0L)
            if (ageSec <= 30) {
                add("App vừa tự khôi phục stream vì `${it.reason}`, nên overlay có thể ẩn tạm trong lúc encoder dựng lại.")
            }
        }
        if (!lastSocketError.isNullOrBlank()) {
            add("Socket vừa báo lỗi: $lastSocketError")
        }
        if (!rtmpLastMessage.isNullOrBlank() && (
                rtmpLastMessage.contains("closed", ignoreCase = true) ||
                    rtmpLastMessage.contains("publish", ignoreCase = true) ||
                    rtmpLastMessage.contains("auth", ignoreCase = true)
                )
        ) {
            add("RTMP đang báo lỗi `$rtmpLastMessage`, app có thể đang xin lại session live.")
        }
        if (isEmpty()) {
            add("Overlay hiện được coi là sẵn sàng. Nếu vẫn mất, nhiều khả năng filter GL vừa bị reset và app đang tự gắn lại.")
        }
    }

    val color = when {
        overlayHealth.reattaching -> LiveColors.Reconnecting
        !overlayHealth.lastIssue.isNullOrBlank() -> LiveColors.Warning
        !networkConnected || recoveringLiveSession || streamState is StreamState.Reconnecting -> LiveColors.Reconnecting
        !overlayDataReady || !brandingReady || !socketConnected || (streamState is StreamState.Live && currentBitrate in 1..800_000) -> LiveColors.Warning
        else -> LiveColors.AccentGreen
    }
    val summary = when {
        overlayHealth.reattaching -> "Overlay đang được gắn lại vào encoder."
        !overlayHealth.lastIssue.isNullOrBlank() -> "Overlay vừa gặp lỗi và đang được tự gắn lại."
        !networkConnected || recoveringLiveSession || streamState is StreamState.Reconnecting ->
            "Overlay có thể đang ẩn vì stream/encoder đang phục hồi."
        !overlayDataReady || !brandingReady || !socketConnected || (streamState is StreamState.Live && currentBitrate in 1..800_000) ->
            "Overlay đang có dấu hiệu không ổn định."
        else -> "Overlay đang ở trạng thái bình thường."
    }
    val statusLabel = when {
        overlayHealth.reattaching -> "Gắn lại"
        !overlayHealth.lastIssue.isNullOrBlank() -> "Cảnh báo"
        !networkConnected || recoveringLiveSession || streamState is StreamState.Reconnecting -> "Phục hồi"
        else -> "Ổn định"
    }
    return OverlayHintState(
        summary = summary,
        color = color,
        reasons = reasons,
        statusLabel = statusLabel,
        isReattaching = overlayHealth.reattaching,
    )
}

@Composable
private fun MatchSwapLoadingChip(label: String) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(Color.Black.copy(alpha = 0.62f))
            .padding(horizontal = 12.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CircularProgressIndicator(
            modifier = Modifier.size(12.dp),
            strokeWidth = 1.8.dp,
            color = LiveColors.Warning,
        )
        Spacer(modifier = Modifier.width(8.dp))
        Text(
            text = label,
            color = Color.White,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
private fun HintBanner(item: HintItem) {
    Surface(
        color = item.color.copy(alpha = 0.92f),
        shape = RoundedCornerShape(12.dp),
        tonalElevation = 0.dp,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = item.icon,
                contentDescription = null,
                tint = Color.White,
                modifier = Modifier.size(18.dp),
            )
            Spacer(modifier = Modifier.width(10.dp))
            Text(
                text = item.text,
                color = Color.White,
                fontSize = 12.sp,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

private fun parseIsoMillis(raw: String?): Long? {
    val value = raw?.trim().orEmpty()
    if (value.isBlank()) return null
    val formats =
        listOf(
            "yyyy-MM-dd'T'HH:mm:ss.SSSX",
            "yyyy-MM-dd'T'HH:mm:ssX",
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            "yyyy-MM-dd'T'HH:mm:ss'Z'",
        )
    for (pattern in formats) {
        runCatching {
            SimpleDateFormat(pattern, Locale.US).parse(value)?.time
        }.getOrNull()?.let { return it }
    }
    return runCatching {
        Date(value.toLong()).time
    }.getOrNull()
}

private fun formatPresenceCountdown(remainingMs: Long): String {
    val totalSeconds = (remainingMs.coerceAtLeast(0L) / 1000L).toInt()
    val minutes = totalSeconds / 60
    val seconds = totalSeconds % 60
    return String.format(Locale.getDefault(), "%02d:%02d", minutes, seconds)
}

// ===== Status badges =====

@Composable
fun LiveBadge() {
    val infiniteTransition = rememberInfiniteTransition(label = "live_pulse")
    val alpha by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 0.3f,
        animationSpec = infiniteRepeatable(
            animation = tween(800, easing = EaseInOut),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "pulse",
    )

    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(LiveColors.LiveRed.copy(alpha = alpha))
            .padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LiveIndicatorDot(size = 8.dp, color = Color.White)
        Spacer(modifier = Modifier.width(6.dp))
        Text("LIVE", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 13.sp)
    }
}

@Composable
fun ConnectingBadge() {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(LiveColors.Warning.copy(alpha = 0.8f))
            .padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CircularProgressIndicator(
            modifier = Modifier.size(12.dp),
            strokeWidth = 2.dp,
            color = Color.White,
        )
        Spacer(modifier = Modifier.width(6.dp))
        Text("Connecting...", color = Color.White, fontSize = 12.sp)
    }
}

@Composable
fun ReconnectingBadge(state: StreamState.Reconnecting) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(LiveColors.Reconnecting.copy(alpha = 0.8f))
            .padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CircularProgressIndicator(
            modifier = Modifier.size(12.dp),
            strokeWidth = 2.dp,
            color = Color.White,
        )
        Spacer(modifier = Modifier.width(6.dp))
        Text(
            "Reconnecting ${state.attempt}/${state.maxAttempts}...",
            color = Color.White,
            fontSize = 12.sp,
        )
    }
}

@Composable
fun WaitingNextMatchBadge() {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(LiveColors.Warning.copy(alpha = 0.88f))
            .padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = Icons.Default.HourglassTop,
            contentDescription = null,
            tint = Color.White,
            modifier = Modifier.size(12.dp),
        )
        Spacer(modifier = Modifier.width(6.dp))
        Text("Chờ trận kế tiếp", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun IdleBadge() {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(Color.Gray.copy(alpha = 0.5f))
            .padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(Color.White.copy(alpha = 0.5f)),
        )
        Spacer(modifier = Modifier.width(6.dp))
        Text("IDLE", color = Color.White.copy(alpha = 0.7f), fontSize = 13.sp)
    }
}

@Composable
fun PreviewBadge() {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(Color.Gray.copy(alpha = 0.5f))
            .padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(Color.White.copy(alpha = 0.8f)),
        )
        Spacer(modifier = Modifier.width(6.dp))
        Text("PREVIEW", color = Color.White, fontSize = 13.sp)
    }
}

@Composable
fun RecoveringBadge() {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(LiveColors.Reconnecting.copy(alpha = 0.8f))
            .padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CircularProgressIndicator(
            modifier = Modifier.size(12.dp),
            strokeWidth = 2.dp,
            color = Color.White,
        )
        Spacer(modifier = Modifier.width(6.dp))
        Text("RECONNECTING", color = Color.White, fontSize = 12.sp)
    }
}

@Composable
fun ArmedBadge(label: String = "LIVE") {
    val infiniteTransition = rememberInfiniteTransition(label = "armed_pulse")
    val alpha by infiniteTransition.animateFloat(
        initialValue = 0.95f,
        targetValue = 0.5f,
        animationSpec = infiniteRepeatable(
            animation = tween(700, easing = EaseInOut),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "pulse",
    )

    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(LiveColors.LiveRedPulse.copy(alpha = alpha))
            .padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LiveIndicatorDot(size = 8.dp, color = Color.White)
        Spacer(modifier = Modifier.width(6.dp))
        Text(label, color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun WaitingNextMatchCard(previewReady: Boolean) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color.Black.copy(alpha = 0.68f)),
        shape = RoundedCornerShape(18.dp),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 18.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Default.HourglassTop,
                    contentDescription = null,
                    tint = LiveColors.Warning,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(modifier = Modifier.width(10.dp))
                Text(
                    text = "Đang chờ trận kế tiếp",
                    color = Color.White,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            Text(
                text = if (previewReady) {
                    "Camera vẫn đang giữ preview. App đã dọn live và overlay của trận cũ, sẽ tự nạp overlay mới khi sân có trận tiếp theo."
                } else {
                    "App đang dựng lại preview để chờ trận kế tiếp. Khi có trận mới, overlay sẽ được nạp lại theo đúng trận đó."
                },
                color = Color.White.copy(alpha = 0.78f),
                fontSize = 12.sp,
                lineHeight = 17.sp,
            )
        }
    }
}

@Composable
private fun LiveIndicatorDot(
    size: androidx.compose.ui.unit.Dp,
    color: Color,
) {
    val infiniteTransition = rememberInfiniteTransition(label = "dot")
    val alpha by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 0.25f,
        animationSpec = infiniteRepeatable(
            animation = tween(550, easing = EaseInOut),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "alpha",
    )
    val x by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 6f,
        animationSpec = infiniteRepeatable(
            animation = tween(550, easing = EaseInOut),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "x",
    )

    Box(
        modifier = Modifier
            .offset(x = x.dp)
            .size(size)
            .clip(RoundedCornerShape(999.dp))
            .background(color.copy(alpha = alpha)),
    )
}

@Composable
fun LiveTimer(startTime: Long) {
    var elapsed by remember { mutableLongStateOf(0L) }

    LaunchedEffect(startTime) {
        while (true) {
            elapsed = System.currentTimeMillis() - startTime
            kotlinx.coroutines.delay(1000)
        }
    }

    val secs = (elapsed / 1000).toInt()
    val h = secs / 3600
    val m = (secs % 3600) / 60
    val s = secs % 60
    val timeStr = if (h > 0) String.format("%d:%02d:%02d", h, m, s)
    else String.format("%02d:%02d", m, s)

    Text(
        text = timeStr,
        color = Color.White,
        fontSize = 14.sp,
        fontWeight = FontWeight.Medium,
    )
}

@Composable
private fun RecordingStateChip(
    isRecording: Boolean,
    exporting: Boolean,
    pendingUploads: Int,
) {
    val bg =
        when {
            isRecording -> LiveColors.LiveRed.copy(alpha = 0.92f)
            exporting -> LiveColors.Warning.copy(alpha = 0.92f)
            else -> Color.Black.copy(alpha = 0.58f)
        }
    val label =
        when {
            isRecording -> "REC"
            exporting -> "Xuất video"
            pendingUploads > 0 -> "Tải $pendingUploads"
            else -> "Recording"
        }

    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(10.dp))
            .background(bg)
            .padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = if (isRecording) Icons.Default.FiberManualRecord else Icons.Default.SaveAlt,
            contentDescription = null,
            tint = Color.White,
            modifier = Modifier.size(14.dp),
        )
        Spacer(modifier = Modifier.width(6.dp))
        Text(
            text = label,
            color = Color.White,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
private fun LegacyModeSelectorOverlay(
    selectedMode: StreamMode,
    storageStatus: com.pkt.live.data.model.RecordingStorageStatus,
    onSelect: (StreamMode) -> Unit,
    onConfirm: () -> Unit,
) {
    val configuration = LocalConfiguration.current
    val modalMaxHeight = configuration.screenHeightDp.dp * 0.9f
    val contentScrollState = rememberScrollState()
    val buttonEnabled = !selectedMode.includesRecording || !storageStatus.hardBlock
    val highlightColor = storageStatusHighlightColor(storageStatus)
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.82f)),
        contentAlignment = Alignment.Center,
    ) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp, vertical = 18.dp)
                .heightIn(max = modalMaxHeight),
            colors = CardDefaults.cardColors(containerColor = LiveColors.SurfaceDark),
            shape = RoundedCornerShape(24.dp),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(22.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Column(
                    modifier = Modifier
                        .weight(1f, fill = false)
                        .verticalScroll(contentScrollState),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Text(
                        text = "Chọn chế độ phiên này",
                        color = Color.White,
                        fontSize = 24.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        text = "Chọn cách vận hành cho sân này trước khi thao tác. Chế độ sẽ được giữ xuyên suốt phiên hiện tại.",
                        color = LiveColors.TextSecondary,
                        fontSize = 13.sp,
                        lineHeight = 18.sp,
                    )

                    StreamMode.entries.forEach { mode ->
                        val selected = selectedMode == mode
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onSelect(mode) },
                            colors = CardDefaults.cardColors(
                                containerColor =
                                    if (selected) LiveColors.AccentGreen.copy(alpha = 0.16f)
                                    else Color.White.copy(alpha = 0.04f),
                            ),
                            border = androidx.compose.foundation.BorderStroke(
                                width = if (selected) 2.dp else 1.dp,
                                color =
                                    if (selected) LiveColors.AccentGreen
                                    else Color.White.copy(alpha = 0.10f),
                            ),
                            shape = RoundedCornerShape(18.dp),
                        ) {
                            Column(
                                modifier = Modifier.padding(16.dp),
                                verticalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                Text(
                                    text = mode.label,
                                    color = Color.White,
                                    fontSize = 16.sp,
                                    fontWeight = FontWeight.SemiBold,
                                )
                                Text(
                                    text = mode.description,
                                    color = LiveColors.TextSecondary,
                                    fontSize = 12.sp,
                                    lineHeight = 17.sp,
                                )
                                if (mode == StreamMode.RECORD_ONLY) {
                                    Text(
                                        text = "Bật một lần cho cả sân. App sẽ tự ghi hết trận này sang trận khác cho tới khi anh dừng phiên.",
                                        color = LiveColors.Warning,
                                        fontSize = 11.sp,
                                        lineHeight = 16.sp,
                                    )
                                }
                            }
                        }
                    }

                    if (selectedMode.includesRecording) {
                        Text(
                            text =
                                storageStatus.message
                                    ?: "Dung lượng trống: ${formatStorageBytes(storageStatus.availableBytes)} • Queue local: ${formatStorageBytes(storageStatus.pendingQueueBytes)}",
                            color = highlightColor,
                            fontSize = 12.sp,
                            lineHeight = 17.sp,
                        )
                        if (storageStatus.redWarning || storageStatus.hardBlock) {
                            Text(
                                text =
                                    if (storageStatus.hardBlock) "Cảnh báo đỏ: bộ nhớ đang quá thấp, app sẽ chặn ghi hình để tránh mất record."
                                    else "Cảnh báo đỏ: app vẫn cố ghi bằng cách tự chia segment ${storageStatus.segmentDurationSeconds}s. Nên giải phóng thêm dung lượng ngay.",
                                color = LiveColors.LiveRed,
                                fontSize = 12.sp,
                                lineHeight = 17.sp,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                        Spacer(modifier = Modifier.height(4.dp))
                        StorageRequirementLine(
                            label = "Còn trống",
                            value = formatStorageBytes(storageStatus.availableBytes),
                        )
                        StorageRequirementLine(
                            label = "Queue local",
                            value = formatStorageBytes(storageStatus.pendingQueueBytes),
                        )
                        StorageRequirementLine(
                            label = "Chế độ segment",
                            value = storageStrategyLabel(storageStatus),
                            valueColor = highlightColor,
                        )
                        StorageRequirementLine(
                            label = "Tối thiểu để bắt đầu ghi",
                            value = formatStorageBytes(storageStatus.minimumRequiredBytes),
                            valueColor = if (storageStatus.hardBlock) LiveColors.LiveRed else Color.White,
                        )
                        StorageRequirementLine(
                            label = "Mốc chạy chuẩn 60s",
                            value = formatStorageBytes(storageStatus.standardModeBytes),
                            valueColor = if (storageStatus.redWarning) LiveColors.LiveRed else Color.White,
                        )
                        StorageRequirementLine(
                            label = "Khuyến nghị để chạy ổn",
                            value = formatStorageBytes(storageStatus.recommendedBytes),
                        )
                        when {
                            storageStatus.minimumAdditionalBytesNeeded > 0L -> {
                                StorageRequirementLine(
                                    label = "Đang thiếu tối thiểu",
                                    value = formatStorageBytes(storageStatus.minimumAdditionalBytesNeeded),
                                    valueColor = LiveColors.LiveRed,
                                )
                            }
                            storageStatus.standardModeAdditionalBytesNeeded > 0L -> {
                                StorageRequirementLine(
                                    label = "Cần thêm để về mức chuẩn 60s",
                                    value = formatStorageBytes(storageStatus.standardModeAdditionalBytesNeeded),
                                    valueColor = LiveColors.LiveRed,
                                )
                            }
                            storageStatus.recommendedAdditionalBytesNeeded > 0L -> {
                                StorageRequirementLine(
                                    label = "Cần thêm để đạt mức khuyến nghị",
                                    value = formatStorageBytes(storageStatus.recommendedAdditionalBytesNeeded),
                                    valueColor = LiveColors.Warning,
                                )
                            }
                            else -> {
                                StorageRequirementLine(
                                    label = "Bộ nhớ ghi hình",
                                    value = "Đủ để bắt đầu",
                                    valueColor = LiveColors.AccentGreen,
                                )
                            }
                        }
                    }
                }

                Button(
                    onClick = onConfirm,
                    modifier = Modifier.fillMaxWidth(),
                    enabled = buttonEnabled,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (buttonEnabled) LiveColors.AccentGreen else Color.Gray.copy(alpha = 0.45f),
                        disabledContainerColor = Color.Gray.copy(alpha = 0.45f),
                    ),
                    shape = RoundedCornerShape(16.dp),
                ) {
                    Text("Tiếp tục", color = Color.White, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun ModeSelectorOverlay(
    selectedMode: StreamMode,
    storageStatus: com.pkt.live.data.model.RecordingStorageStatus,
    onSelect: (StreamMode) -> Unit,
    onConfirm: () -> Unit,
) {
    val configuration = LocalConfiguration.current
    val isLandscape = configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
    val buttonEnabled = !selectedMode.includesRecording || !storageStatus.hardBlock

    if (!isLandscape) {
        LegacyModeSelectorOverlay(
            selectedMode = selectedMode,
            storageStatus = storageStatus,
            onSelect = onSelect,
            onConfirm = onConfirm,
        )
        return
    }

    val modeScrollState = rememberScrollState()
    val detailScrollState = rememberScrollState()

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.82f)),
        contentAlignment = Alignment.Center,
    ) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp, vertical = 18.dp)
                .heightIn(max = 540.dp),
            colors = CardDefaults.cardColors(containerColor = LiveColors.SurfaceDark),
            shape = RoundedCornerShape(24.dp),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(22.dp),
                horizontalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                Column(
                    modifier = Modifier
                        .weight(1.15f)
                        .verticalScroll(modeScrollState),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Text(
                        text = "Chọn chế độ phiên này",
                        color = Color.White,
                        fontSize = 24.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        text = "Chọn cách vận hành cho sân này trước khi thao tác. Chế độ sẽ được giữ xuyên suốt phiên hiện tại.",
                        color = LiveColors.TextSecondary,
                        fontSize = 13.sp,
                        lineHeight = 18.sp,
                    )

                    StreamMode.entries.forEach { mode ->
                        ModeSelectorModeCard(
                            mode = mode,
                            selected = selectedMode == mode,
                            onSelect = { onSelect(mode) },
                        )
                    }
                }

                Column(
                    modifier = Modifier.weight(0.85f),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Column(
                        modifier = Modifier
                            .weight(1f, fill = false)
                            .verticalScroll(detailScrollState),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        ModeSelectorStorageBlock(
                            selectedMode = selectedMode,
                            storageStatus = storageStatus,
                        )
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.End,
                    ) {
                        Button(
                            onClick = onConfirm,
                            enabled = buttonEnabled,
                            modifier = Modifier.widthIn(min = 220.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = if (buttonEnabled) LiveColors.AccentGreen else Color.Gray.copy(alpha = 0.45f),
                                disabledContainerColor = Color.Gray.copy(alpha = 0.45f),
                            ),
                            shape = RoundedCornerShape(16.dp),
                        ) {
                            Text("Tiếp tục", color = Color.White, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ModeSelectorModeCard(
    mode: StreamMode,
    selected: Boolean,
    onSelect: () -> Unit,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onSelect),
        colors = CardDefaults.cardColors(
            containerColor =
                if (selected) LiveColors.AccentGreen.copy(alpha = 0.16f)
                else Color.White.copy(alpha = 0.04f),
        ),
        border = androidx.compose.foundation.BorderStroke(
            width = if (selected) 2.dp else 1.dp,
            color = if (selected) LiveColors.AccentGreen else Color.White.copy(alpha = 0.10f),
        ),
        shape = RoundedCornerShape(18.dp),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                text = mode.label,
                color = Color.White,
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = mode.description,
                color = LiveColors.TextSecondary,
                fontSize = 12.sp,
                lineHeight = 17.sp,
            )
            if (mode == StreamMode.RECORD_ONLY) {
                Text(
                    text = "Bật một lần cho cả sân. App sẽ tự ghi hết trận này sang trận khác cho tới khi anh dừng phiên.",
                    color = LiveColors.Warning,
                    fontSize = 11.sp,
                    lineHeight = 16.sp,
                )
            }
        }
    }
}

@Composable
private fun ModeSelectorStorageBlock(
    selectedMode: StreamMode,
    storageStatus: com.pkt.live.data.model.RecordingStorageStatus,
) {
    val highlightColor = storageStatusHighlightColor(storageStatus)
    if (!selectedMode.includesRecording) {
        Text(
            text = "Chế độ này chỉ livestream nên không cần kiểm tra bộ nhớ ghi hình. Anh có thể tiếp tục ngay.",
            color = LiveColors.TextSecondary,
            fontSize = 12.sp,
            lineHeight = 18.sp,
        )
        return
    }

    Text(
        text =
            storageStatus.message
                ?: "Dung lượng trống: ${formatStorageBytes(storageStatus.availableBytes)} • Queue local: ${formatStorageBytes(storageStatus.pendingQueueBytes)}",
        color = highlightColor,
        fontSize = 12.sp,
        lineHeight = 17.sp,
    )
    if (storageStatus.redWarning || storageStatus.hardBlock) {
        Text(
            text =
                if (storageStatus.hardBlock) "Cảnh báo đỏ: bộ nhớ đang quá thấp, app sẽ chặn ghi hình để tránh mất record."
                else "Cảnh báo đỏ: app vẫn cố ghi bằng cách tự chia segment ${storageStatus.segmentDurationSeconds}s. Nên giải phóng thêm dung lượng ngay.",
            color = LiveColors.LiveRed,
            fontSize = 12.sp,
            lineHeight = 17.sp,
            fontWeight = FontWeight.Bold,
        )
    }
    Spacer(modifier = Modifier.height(4.dp))
    StorageRequirementLine(
        label = "Còn trống",
        value = formatStorageBytes(storageStatus.availableBytes),
    )
    StorageRequirementLine(
        label = "Queue local",
        value = formatStorageBytes(storageStatus.pendingQueueBytes),
    )
    StorageRequirementLine(
        label = "Chế độ segment",
        value = storageStrategyLabel(storageStatus),
        valueColor = highlightColor,
    )
    StorageRequirementLine(
        label = "Tối thiểu để bắt đầu ghi",
        value = formatStorageBytes(storageStatus.minimumRequiredBytes),
        valueColor = if (storageStatus.hardBlock) LiveColors.LiveRed else Color.White,
    )
    StorageRequirementLine(
        label = "Mốc chạy chuẩn 60s",
        value = formatStorageBytes(storageStatus.standardModeBytes),
        valueColor = if (storageStatus.redWarning) LiveColors.LiveRed else Color.White,
    )
    StorageRequirementLine(
        label = "Khuyến nghị để chạy ổn",
        value = formatStorageBytes(storageStatus.recommendedBytes),
    )
    when {
        storageStatus.minimumAdditionalBytesNeeded > 0L -> {
            StorageRequirementLine(
                label = "Đang thiếu tối thiểu",
                value = formatStorageBytes(storageStatus.minimumAdditionalBytesNeeded),
                valueColor = LiveColors.LiveRed,
            )
        }
        storageStatus.standardModeAdditionalBytesNeeded > 0L -> {
            StorageRequirementLine(
                label = "Cần thêm để về mức chuẩn 60s",
                value = formatStorageBytes(storageStatus.standardModeAdditionalBytesNeeded),
                valueColor = LiveColors.LiveRed,
            )
        }
        storageStatus.recommendedAdditionalBytesNeeded > 0L -> {
            StorageRequirementLine(
                label = "Cần thêm để đạt mức khuyến nghị",
                value = formatStorageBytes(storageStatus.recommendedAdditionalBytesNeeded),
                valueColor = LiveColors.Warning,
            )
        }
        else -> {
            StorageRequirementLine(
                label = "Bộ nhớ ghi hình",
                value = "Đủ để bắt đầu",
                valueColor = LiveColors.AccentGreen,
            )
        }
    }
}

@Composable
private fun WaitingActivationChip(label: String) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(10.dp))
            .background(LiveColors.Warning.copy(alpha = 0.92f))
            .padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = Icons.Default.HourglassTop,
            contentDescription = null,
            tint = Color.White,
            modifier = Modifier.size(14.dp),
        )
        Spacer(modifier = Modifier.width(6.dp))
        Text(
            text = label,
            color = Color.White,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

private fun storageStatusHighlightColor(
    storageStatus: com.pkt.live.data.model.RecordingStorageStatus,
): Color =
    when {
        storageStatus.hardBlock || storageStatus.redWarning -> LiveColors.LiveRed
        storageStatus.warning -> LiveColors.Warning
        else -> LiveColors.TextSecondary
    }

private fun storageStrategyLabel(
    storageStatus: com.pkt.live.data.model.RecordingStorageStatus,
): String =
    if (storageStatus.lowStorageOptimized) {
        "Tự tối ưu ${storageStatus.segmentDurationSeconds}s"
    } else {
        "Chuẩn ${storageStatus.segmentDurationSeconds}s"
    }

private fun formatStorageBytes(bytes: Long): String {
    if (bytes <= 0L) return "0 B"
    val kb = 1024.0
    val mb = kb * 1024.0
    val gb = mb * 1024.0
    return when {
        bytes >= gb -> String.format("%.2f GB", bytes / gb)
        bytes >= mb -> String.format("%.1f MB", bytes / mb)
        bytes >= kb -> String.format("%.1f KB", bytes / kb)
        else -> "$bytes B"
    }
}

@Composable
private fun StorageRequirementLine(
    label: String,
    value: String,
    valueColor: Color = Color.White,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label,
            color = LiveColors.TextSecondary,
            fontSize = 12.sp,
        )
        Spacer(modifier = Modifier.width(12.dp))
        Text(
            text = value,
            color = valueColor,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
private fun DeviceInfoRow(
    label: String,
    value: String,
) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            text = label,
            color = LiveColors.TextSecondary,
            fontSize = 11.sp,
        )
        Text(
            text = value,
            color = Color.White,
            fontSize = 13.sp,
            lineHeight = 18.sp,
        )
    }
}

private fun buildDeviceInfoRows(
    context: Context,
    courtId: String?,
    matchId: String?,
    streamState: StreamState,
    streamMode: StreamMode?,
    quality: Quality,
    previewReady: Boolean,
    networkConnected: Boolean,
    isWifi: Boolean,
    socketConnected: Boolean,
    socketActiveMatchId: String?,
    socketPayloadAgeSec: Int?,
    socketRoomMismatch: Boolean,
    socketPayloadStale: Boolean,
    bitrate: Long,
    batteryTempC: Float?,
    isCharging: Boolean,
    powerSaveMode: Boolean,
    lastThermalEvent: com.pkt.live.streaming.ThermalEvent?,
    storageStatus: com.pkt.live.data.model.RecordingStorageStatus,
    recordingUiState: com.pkt.live.data.model.RecordingUiState,
    cameraGranted: Boolean,
    micGranted: Boolean,
): List<Pair<String, String>> {
    val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
    val memInfo =
        ActivityManager.MemoryInfo().also {
            activityManager?.getMemoryInfo(it)
        }
    val isLowRamDevice = activityManager?.isLowRamDevice ?: false
    val statFs = runCatching { StatFs(context.filesDir.absolutePath) }.getOrNull()
    val totalStorage = statFs?.totalBytes ?: 0L
    val freeStorage = statFs?.availableBytes ?: 0L
    val batteryManager = context.getSystemService(BATTERY_SERVICE) as? BatteryManager
    val batteryLevel =
        batteryManager
            ?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
            ?.takeIf { it in 0..100 }
    val powerManager = context.getSystemService(POWER_SERVICE) as? PowerManager
    val thermalStatus =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            powerManager?.currentThermalStatus
        } else {
            null
        }
    val androidId =
        runCatching {
            Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
        }.getOrNull().orEmpty().ifBlank { "Không lấy được" }
    val packageInfo =
        runCatching {
            @Suppress("DEPRECATION")
            context.packageManager.getPackageInfo(context.packageName, 0)
        }.getOrNull()
    val versionCode =
        packageInfo?.let {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) it.longVersionCode else @Suppress("DEPRECATION") it.versionCode.toLong()
        } ?: 0L
    val socketStatus =
        when {
            socketRoomMismatch -> "Đã kết nối nhưng đang chờ room trận mới"
            socketPayloadStale -> "Đã kết nối nhưng payload stale ${socketPayloadAgeSec ?: 0}s"
            socketConnected -> "Đã kết nối"
            else -> "Mất kết nối"
        }
    val payloadStatus =
        when {
            socketRoomMismatch -> "Đang chờ payload của room mới"
            socketPayloadAgeSec == null -> "Chưa nhận payload"
            else -> "${socketPayloadAgeSec}s trước"
        }
    val recordingStatus =
        buildString {
            append(
                when {
                    recordingUiState.isRecording -> "Đang ghi"
                    recordingUiState.exporting -> "Đang xuất video trận"
                    recordingUiState.status.isNotBlank() -> recordingUiState.status
                    else -> "idle"
                }
            )
            if (recordingUiState.pendingUploads > 0) {
                append(" • chờ tải ${recordingUiState.pendingUploads}")
            }
        }

    return buildList {
        add("Mã thiết bị" to androidId)
        add("App build" to "${BuildConfig.VERSION_NAME} ($versionCode)")
        add("Model / hãng" to "${Build.MANUFACTURER} ${Build.MODEL}".trim())
        add("Thiết bị / product" to "${Build.DEVICE} / ${Build.PRODUCT}")
        add("Android / SDK" to "${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})")
        add("ABI" to Build.SUPPORTED_ABIS.joinToString().ifBlank { "Không rõ" })
        add(
            "RAM" to
                "Tổng ${formatStorageBytes(memInfo.totalMem)} • Trống ${formatStorageBytes(memInfo.availMem)} • " +
                "lowMemory=${if (memInfo.lowMemory) "Có" else "Không"} • lowRamDevice=${if (isLowRamDevice) "Có" else "Không"}"
        )
        add(
            "Storage app" to
                "Tổng ${formatStorageBytes(totalStorage)} • Trống ${formatStorageBytes(freeStorage)} • Queue local ${formatStorageBytes(storageStatus.pendingQueueBytes)}"
        )
        add(
            "Ngưỡng ghi hình" to
                "Tối thiểu ${formatStorageBytes(storageStatus.minimumRequiredBytes)} • Khuyến nghị ${formatStorageBytes(storageStatus.recommendedBytes)}"
        )
        add(
            "Ghi hình" to
                "$recordingStatus${storageStatus.estimatedRunwayMinutes?.let { " • runway ~${it} phút" }.orEmpty()}"
        )
        storageStatus.message?.takeIf { it.isNotBlank() }?.let { add("Cảnh báo bộ nhớ" to it) }
        add(
            "Pin / nguồn" to
                buildString {
                    append("Pin ${batteryLevel?.let { "$it%" } ?: "Không rõ"}")
                    append(" • Sạc ${if (isCharging) "Có" else "Không"}")
                    append(" • Power saver ${if (powerSaveMode) "Bật" else "Tắt"}")
                }
        )
        add(
            "Nhiệt độ / thermal" to
                buildString {
                    append("Pin ${batteryTempC?.let { String.format(Locale.getDefault(), "%.1f°C", it) } ?: "Không rõ"}")
                    append(" • Thermal ${thermalStatusLabel(thermalStatus)}")
                    lastThermalEvent?.let {
                        append(" • Sự kiện gần nhất ${String.format(Locale.getDefault(), "%.1f°C", it.tempC)}")
                    }
                }
        )
        add("Quyền / preview" to "Camera ${if (cameraGranted) "OK" else "Thiếu"} • Mic ${if (micGranted) "OK" else "Thiếu"} • Preview ${if (previewReady) "Sẵn sàng" else "Chưa sẵn sàng"}")
        add("Mạng" to if (!networkConnected) "OFFLINE" else if (isWifi) "Wi-Fi" else "4G/5G")
        add("Socket match" to socketStatus)
        add("Room match active" to (socketActiveMatchId ?: "Chưa join room"))
        add("Payload socket" to payloadStatus)
        add("Bitrate hiện tại" to if (bitrate > 0L) "${bitrate / 1000} kbps" else "0 kbps")
        add("Court / Match" to "Court ${courtId ?: "-"} • Match ${matchId ?: "-"}")
        add("Stream state" to streamStateLabel(streamState))
        add("Mode hiện tại" to (streamMode?.label ?: "Chưa chọn"))
        add("Quality" to quality.label)
    }
}

private fun thermalStatusLabel(status: Int?): String {
    if (status == null) return "Không rõ"
    return when (status) {
        PowerManager.THERMAL_STATUS_NONE -> "Bình thường"
        PowerManager.THERMAL_STATUS_LIGHT -> "Nhẹ"
        PowerManager.THERMAL_STATUS_MODERATE -> "Vừa"
        PowerManager.THERMAL_STATUS_SEVERE -> "Cao"
        PowerManager.THERMAL_STATUS_CRITICAL -> "Nghiêm trọng"
        PowerManager.THERMAL_STATUS_EMERGENCY -> "Khẩn cấp"
        PowerManager.THERMAL_STATUS_SHUTDOWN -> "Sắp tắt máy"
        else -> status.toString()
    }
}

private fun streamStateLabel(state: StreamState): String =
    when (state) {
        is StreamState.Idle -> "Idle"
        is StreamState.Previewing -> "Previewing"
        is StreamState.Connecting -> "Connecting"
        is StreamState.Live -> "Live"
        is StreamState.Reconnecting -> "Reconnecting ${state.attempt}/${state.maxAttempts}"
        is StreamState.Error -> "Error: ${state.message}"
        is StreamState.Stopped -> "Stopped"
    }
