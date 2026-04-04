package com.pkt.live.ui.controls

import android.Manifest
import android.content.res.Configuration
import android.content.pm.PackageManager
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.pkt.live.data.model.MatchData
import com.pkt.live.streaming.Quality
import com.pkt.live.streaming.StreamState
import com.pkt.live.ui.LiveStreamViewModel
import com.pkt.live.ui.PreflightDialogState
import com.pkt.live.ui.PreflightSeverity
import com.pkt.live.ui.theme.LiveColors
import com.pkt.live.util.OrientationMode
import com.pkt.live.util.lockOrientation
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Bottom control bar with stream controls.
 * All buttons with haptic feedback and clear state indication.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun StreamControls(
    viewModel: LiveStreamViewModel,
    streamState: StreamState,
    hasLiveSession: Boolean = false,
) {
    val torchOn by viewModel.torchOn.collectAsState()
    val micMuted by viewModel.micMuted.collectAsState()
    val previewReady by viewModel.previewReady.collectAsState()
    val isFrontCamera by viewModel.isFrontCamera.collectAsState()
    val quality by viewModel.quality.collectAsState()
    val matchInfo by viewModel.matchInfo.collectAsState()
    val loading by viewModel.loading.collectAsState()
    val rtmpUrl by viewModel.rtmpUrl.collectAsState()
    val batterySaver by viewModel.batterySaver.collectAsState()
    val orientationMode by viewModel.orientationMode.collectAsState()
    val zoomLevel by viewModel.zoomLevel.collectAsState()
    val fallbackColorArgb by viewModel.fallbackColorArgb.collectAsState()
    val waitingForMatchLive by viewModel.waitingForMatchLive.collectAsState()
    val waitingForCourt by viewModel.waitingForCourt.collectAsState()
    val waitingForNextMatch by viewModel.waitingForNextMatch.collectAsState()
    val matchTransitioning by viewModel.matchTransitioning.collectAsState()
    val streamMode by viewModel.streamMode.collectAsState()
    val recordOnlyArmed by viewModel.recordOnlyArmed.collectAsState()
    val goLiveArmed by viewModel.goLiveArmed.collectAsState()
    val recordingUiState by viewModel.recordingUiState.collectAsState()
    val recordingEngineState by viewModel.recordingEngineState.collectAsState()
    val recordingStorageStatus by viewModel.recordingStorageStatus.collectAsState()
    var showQualityPicker by remember { mutableStateOf(false) }
    var showSettings by remember { mutableStateOf(false) }
    val preflightDialog by viewModel.preflightDialog.collectAsState()
    val configuration = LocalConfiguration.current
    val isLandscape = configuration.orientation == Configuration.ORIENTATION_LANDSCAPE

    // Get activity for orientation lock
    val context = androidx.compose.ui.platform.LocalContext.current
    val activity = context as? android.app.Activity
    val scope = rememberCoroutineScope()

    var showExitDialog by remember { mutableStateOf(false) }
    var showRecordingRequestDetails by remember { mutableStateOf(false) }
    var controlThrottleUntilMs by remember { mutableLongStateOf(0L) }
    val requestingStream =
        loading &&
            previewReady &&
            matchInfo != null &&
            rtmpUrl.isNullOrBlank() &&
            !waitingForCourt &&
            !waitingForMatchLive &&
            !waitingForNextMatch &&
            streamState !is StreamState.Live &&
            streamState !is StreamState.Connecting &&
            streamState !is StreamState.Reconnecting

    fun tryAcquireControlWindow(): Boolean {
        val now = System.currentTimeMillis()
        return if (now < controlThrottleUntilMs) {
            false
        } else {
            controlThrottleUntilMs = now + 450L
            true
        }
    }

    LaunchedEffect(activity, orientationMode) {
        activity?.lockOrientation(orientationMode)
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // Quality label + zoom badge
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = quality.label,
                color = LiveColors.TextSecondary,
                fontSize = 11.sp,
            )
            if (zoomLevel > 1.1f) {
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "🔍 ${String.format("%.1fx", zoomLevel)}",
                    color = LiveColors.AccentGreen,
                    fontSize = 11.sp,
                )
            }
        }
        Spacer(modifier = Modifier.height(8.dp))

        // Main control row
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Torch
            ControlButton(
                icon = if (torchOn) Icons.Default.FlashOn else Icons.Default.FlashOff,
                label = "Flash",
                active = torchOn,
                onClick = {
                    if (!tryAcquireControlWindow()) return@ControlButton
                    val hasFlash = context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_FLASH)
                    when {
                        !hasFlash -> Toast.makeText(context, "Thiết bị không có đèn flash.", Toast.LENGTH_SHORT).show()
                        isFrontCamera -> Toast.makeText(context, "Không bật flash khi dùng camera trước.", Toast.LENGTH_SHORT).show()
                        streamState is StreamState.Connecting || streamState is StreamState.Reconnecting ->
                            Toast.makeText(context, "Đang kết nối, chưa bật được flash.", Toast.LENGTH_SHORT).show()
                        else -> {
                            val before = viewModel.torchOn.value
                            runCatching { viewModel.toggleTorch() }.onFailure {
                                Toast.makeText(context, it.message ?: "Không bật được flash.", Toast.LENGTH_SHORT).show()
                            }
                            scope.launch {
                                delay(350)
                                val after = viewModel.torchOn.value
                                if (after == before) {
                                    Toast.makeText(
                                        context,
                                        "Không bật được flash (emulator có thể không hỗ trợ hoặc camera chưa sẵn sàng).",
                                        Toast.LENGTH_SHORT
                                    ).show()
                                } else {
                                    Toast.makeText(
                                        context,
                                        if (after) "Đã bật flash." else "Đã tắt flash.",
                                        Toast.LENGTH_SHORT
                                    ).show()
                                }
                            }
                        }
                    }
                },
            )

            // Mic
            ControlButton(
                icon = if (micMuted) Icons.Default.MicOff else Icons.Default.Mic,
                label = "Mic",
                active = !micMuted,
                activeColor = if (micMuted) LiveColors.LiveRed else LiveColors.AccentGreen,
                onClick = {
                    if (!tryAcquireControlWindow()) return@ControlButton
                    val micGranted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
                    when {
                        !micGranted -> Toast.makeText(context, "Chưa cấp quyền Micro.", Toast.LENGTH_SHORT).show()
                        streamState is StreamState.Connecting || streamState is StreamState.Reconnecting ->
                            Toast.makeText(context, "Đang kết nối, chưa bật/tắt được mic.", Toast.LENGTH_SHORT).show()
                        !previewReady -> Toast.makeText(context, "Camera đang khởi tạo, thử lại sau 1-2 giây.", Toast.LENGTH_SHORT).show()
                        else -> {
                            val before = viewModel.micMuted.value
                            runCatching { viewModel.toggleMic() }.onFailure {
                                Toast.makeText(context, it.message ?: "Không bật/tắt được mic.", Toast.LENGTH_SHORT).show()
                            }
                            scope.launch {
                                delay(350)
                                val after = viewModel.micMuted.value
                                if (after == before) {
                                    Toast.makeText(
                                        context,
                                        "Không bật/tắt được mic (thiết bị không hỗ trợ hoặc mic đang bận).",
                                        Toast.LENGTH_SHORT
                                    ).show()
                                } else {
                                    Toast.makeText(
                                        context,
                                        if (after) "Đã tắt mic." else "Đã bật mic.",
                                        Toast.LENGTH_SHORT
                                    ).show()
                                }
                            }
                        }
                    }
                },
            )

            // GO LIVE / STOP button (large)
            GoLiveButton(
                streamState = streamState,
                hasLiveSession = hasLiveSession,
                streamMode = streamMode,
                armed = if (streamMode == com.pkt.live.data.model.StreamMode.RECORD_ONLY) recordOnlyArmed else goLiveArmed,
                waitingForMatchLive = waitingForMatchLive,
                waitingForCourt = waitingForCourt,
                waitingForNextMatch = waitingForNextMatch,
                requestingStream = requestingStream,
                matchTransitioning = matchTransitioning,
                isRecording = recordingEngineState.isRecording,
                recordingBusy = recordingUiState.status == "preparing",
                onGoLive = { viewModel.onGoLiveClicked() },
                onStop = { viewModel.stopLive() },
            )

            // Switch camera
            ControlButton(
                icon = Icons.Default.Cameraswitch,
                label = "Flip",
                onClick = {
                    when {
                        !tryAcquireControlWindow() -> Unit
                        streamState is StreamState.Connecting || streamState is StreamState.Reconnecting ->
                            Toast.makeText(context, "Đang kết nối, chưa đổi camera được.", Toast.LENGTH_SHORT).show()
                        !previewReady -> Toast.makeText(context, "Camera đang khởi tạo, thử lại sau 1-2 giây.", Toast.LENGTH_SHORT).show()
                        else -> viewModel.switchCamera()
                    }
                },
            )

            // Quality
            ControlButton(
                icon = Icons.Default.HighQuality,
                label = "Quality",
                onClick = {
                    when {
                        !tryAcquireControlWindow() -> Unit
                        streamState is StreamState.Connecting || streamState is StreamState.Reconnecting ->
                            Toast.makeText(context, "Đang kết nối, chưa đổi chất lượng được.", Toast.LENGTH_SHORT).show()
                        else -> showQualityPicker = true
                    }
                },
            )
        }

        Spacer(modifier = Modifier.height(8.dp))

        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.Center,
            verticalArrangement = Arrangement.spacedBy(if (isLandscape) 0.dp else 6.dp),
        ) {
            ControlButtonSmall(
                icon = Icons.Default.BatterySaver,
                label = "Battery",
                active = batterySaver,
                onClick = { viewModel.toggleBatterySaver() },
            )

            ControlButtonSmall(
                icon = Icons.Default.ScreenRotation,
                label = orientationMode.label,
                active = orientationMode != com.pkt.live.util.OrientationMode.AUTO,
                onClick = {
                    val next = viewModel.cycleOrientation()
                    activity?.lockOrientation(next)
                },
            )

            ControlButtonSmall(
                icon = Icons.Default.Settings,
                label = "Cài đặt",
                active = fallbackColorArgb != null,
                onClick = { showSettings = true },
            )

            ControlButtonSmall(
                icon = Icons.Default.ReceiptLong,
                label = "Request",
                active = recordingUiState.activeRecordingId != null || recordingUiState.pendingUploads > 0,
                onClick = { showRecordingRequestDetails = true },
            )

            ControlButtonSmall(
                icon = Icons.Default.Close,
                label = "Thoát",
                onClick = { showExitDialog = true },
            )
        }
    }

    if (showExitDialog) {
        AlertDialog(
            onDismissRequest = { showExitDialog = false },
            confirmButton = {
                Button(
                    onClick = {
                        showExitDialog = false
                        viewModel.stopLive()
                        activity?.finish()
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = LiveColors.LiveRed),
                ) {
                    Text("Thoát")
                }
            },
            dismissButton = {
                TextButton(onClick = { showExitDialog = false }) {
                    Text("Hủy")
                }
            },
            title = { Text("Thoát livestream?") },
            text = {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 440.dp)
                        .verticalScroll(rememberScrollState()),
                ) {
                    Text("Live sẽ dừng lại và quay về màn trước.")
                }
            },
        )
    }

    // Quality picker dialog
    if (showQualityPicker) {
        QualityPickerDialog(
            currentQuality = quality,
            onSelect = { q ->
                viewModel.changeQuality(q)
                showQualityPicker = false
            },
            onDismiss = { showQualityPicker = false },
        )
    }

    if (showSettings) {
        LiveSettingsDialog(
            currentFallbackColorArgb = fallbackColorArgb,
            currentMatch = matchInfo,
            currentQuality = quality,
            streamState = streamState,
            streamMode = streamMode,
            recordOnlyArmed = recordOnlyArmed,
            waitingForCourt = waitingForCourt,
            waitingForMatchLive = waitingForMatchLive,
            waitingForNextMatch = waitingForNextMatch,
            recordingUiState = recordingUiState,
            recordingStorageStatus = recordingStorageStatus,
            onSetFallbackColorArgb = { viewModel.setFallbackColorArgb(it) },
            onDismiss = { showSettings = false },
        )
    }

    if (showRecordingRequestDetails) {
        RecordingRequestDetailsDialog(
            currentMatch = matchInfo,
            currentQuality = quality,
            streamState = streamState,
            streamMode = streamMode,
            recordOnlyArmed = recordOnlyArmed,
            waitingForCourt = waitingForCourt,
            waitingForMatchLive = waitingForMatchLive,
            waitingForNextMatch = waitingForNextMatch,
            requestingStream = requestingStream,
            rtmpReady = !rtmpUrl.isNullOrBlank(),
            recordingUiState = recordingUiState,
            recordingStorageStatus = recordingStorageStatus,
            onDismiss = { showRecordingRequestDetails = false },
        )
    }

    preflightDialog?.let { state ->
        PreflightDialog(
            state = state,
            onDismiss = { viewModel.dismissPreflight() },
            onProceed = { viewModel.proceedPreflight() },
        )
    }
}

@Composable
private fun PreflightDialog(
    state: PreflightDialogState,
    onDismiss: () -> Unit,
    onProceed: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            if (state.canProceed) {
                Button(
                    onClick = onProceed,
                    colors = ButtonDefaults.buttonColors(containerColor = LiveColors.LiveRed),
                ) {
                    Text("Vẫn tiếp tục")
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(if (state.canProceed) "Hủy" else "Đóng")
            }
        },
        title = { Text("Kiểm tra thiết bị trước khi live") },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 440.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    text = if (state.canProceed) {
                        "Phát hiện yếu tố có thể làm live kém ổn định hoặc crash trên máy này."
                    } else {
                        "Thiết bị hiện chưa đủ điều kiện để live."
                    },
                    color = LiveColors.TextSecondary,
                    fontSize = 12.sp,
                )
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    state.issues.forEach { issue ->
                        val color = when (issue.severity) {
                            PreflightSeverity.BLOCKER -> LiveColors.LiveRed
                            PreflightSeverity.WARNING -> LiveColors.Warning
                            PreflightSeverity.INFO -> LiveColors.TextSecondary
                        }
                        Card(
                            colors = CardDefaults.cardColors(containerColor = color.copy(alpha = 0.12f)),
                            shape = RoundedCornerShape(12.dp),
                        ) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                Text(
                                    text = issue.title,
                                    color = color,
                                    fontWeight = FontWeight.SemiBold,
                                    fontSize = 13.sp,
                                )
                                Spacer(modifier = Modifier.height(2.dp))
                                Text(
                                    text = issue.detail,
                                    color = LiveColors.TextSecondary,
                                    fontSize = 12.sp,
                                )
                            }
                        }
                    }
                }
            }
        },
    )
}

@Composable
fun GoLiveButton(
    streamState: StreamState,
    hasLiveSession: Boolean,
    streamMode: com.pkt.live.data.model.StreamMode?,
    armed: Boolean,
    waitingForMatchLive: Boolean,
    waitingForCourt: Boolean,
    waitingForNextMatch: Boolean,
    requestingStream: Boolean,
    matchTransitioning: Boolean,
    isRecording: Boolean,
    recordingBusy: Boolean,
    onGoLive: () -> Unit,
    onStop: () -> Unit,
) {
    val isRecordOnly = streamMode == com.pkt.live.data.model.StreamMode.RECORD_ONLY
    val isLive = streamState is StreamState.Live
    val isRecordOnlyWaiting =
        isRecordOnly &&
            armed &&
            !isRecording &&
            (waitingForMatchLive || waitingForCourt || waitingForNextMatch)
    val isRecoveringLive =
        hasLiveSession &&
            streamState !is StreamState.Live &&
            streamState !is StreamState.Stopped &&
            streamState !is StreamState.Idle &&
            streamState !is StreamState.Error
    val isLivestreamWaiting =
        !isRecordOnly &&
            armed &&
            !isLive &&
            !requestingStream &&
            !matchTransitioning &&
            !isRecoveringLive &&
            streamState !is StreamState.Connecting &&
            streamState !is StreamState.Reconnecting &&
            (waitingForMatchLive || waitingForCourt || waitingForNextMatch)
    val canStop =
        if (isRecordOnly) {
            isRecording || armed
        } else {
            isLive || armed || isRecoveringLive || streamState is StreamState.Connecting || streamState is StreamState.Reconnecting || waitingForNextMatch
        }
    val isBusy =
        if (isRecordOnly) {
            recordingBusy || matchTransitioning
        } else {
            requestingStream || matchTransitioning || isRecoveringLive || streamState is StreamState.Connecting || streamState is StreamState.Reconnecting
        }

    val bgColor = when {
        isRecordOnly && isRecording -> LiveColors.LiveRed
        isRecordOnlyWaiting -> LiveColors.Warning
        isLivestreamWaiting -> LiveColors.Warning
        isRecordOnly && isBusy -> LiveColors.Warning
        isLive -> LiveColors.LiveRed
        requestingStream -> Color.White.copy(alpha = 0.18f)
        matchTransitioning -> LiveColors.Warning
        isRecoveringLive || streamState is StreamState.Reconnecting -> LiveColors.Reconnecting
        waitingForNextMatch -> LiveColors.Warning
        isBusy || armed -> LiveColors.LiveRedPulse
        else -> LiveColors.AccentGreen
    }

    Button(
        onClick = {
            when {
                (requestingStream && !isRecordOnly) || matchTransitioning -> Unit
                canStop -> onStop()
                else -> onGoLive()
            }
        },
        modifier = Modifier
            .size(72.dp)
            .clip(CircleShape),
        colors = ButtonDefaults.buttonColors(containerColor = bgColor),
        contentPadding = PaddingValues(0.dp),
        shape = CircleShape,
        enabled = !(requestingStream && !isRecordOnly) && !matchTransitioning,
    ) {
        when {
            isRecordOnly && isRecording -> {
                Icon(
                    imageVector = Icons.Default.Stop,
                    contentDescription = "Stop recording",
                    tint = Color.White,
                    modifier = Modifier.size(28.dp),
                )
            }
            isRecordOnly && isBusy -> {
                CircularProgressIndicator(
                    modifier = Modifier.size(28.dp),
                    strokeWidth = 3.dp,
                    color = Color.White,
                )
            }
            isRecordOnlyWaiting -> {
                Icon(
                    imageVector = Icons.Default.HourglassTop,
                    contentDescription = "Record only armed",
                    tint = Color.White,
                    modifier = Modifier.size(28.dp),
                )
            }
            isLivestreamWaiting -> {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(
                        imageVector = Icons.Default.Stop,
                        contentDescription = "Stop waiting",
                        tint = Color.White,
                        modifier = Modifier.size(22.dp),
                    )
                    Text(
                        text = "CHỜ",
                        fontSize = 9.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White,
                    )
                }
            }
            isLive -> {
                Icon(
                    imageVector = Icons.Default.Stop,
                    contentDescription = "Stop",
                    tint = Color.White,
                    modifier = Modifier.size(28.dp),
                )
            }
            requestingStream -> {
                CircularProgressIndicator(
                    modifier = Modifier.size(26.dp),
                    strokeWidth = 3.dp,
                    color = Color.White,
                )
            }
            matchTransitioning -> {
                CircularProgressIndicator(
                    modifier = Modifier.size(28.dp),
                    strokeWidth = 3.dp,
                    color = Color.White,
                )
            }
            isBusy -> {
                CircularProgressIndicator(
                    modifier = Modifier.size(28.dp),
                    strokeWidth = 3.dp,
                    color = Color.White,
                )
            }
            waitingForNextMatch -> {
                Icon(
                    imageVector = Icons.Default.HourglassTop,
                    contentDescription = "Waiting next match",
                    tint = Color.White,
                    modifier = Modifier.size(28.dp),
                )
            }
            isRecordOnly -> {
                Text(
                    text = "AUTO",
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                )
            }
            else -> {
                Text(
                    text = "GO LIVE",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                )
            }
        }
    }
}

@Composable
fun ControlButton(
    icon: ImageVector,
    label: String,
    active: Boolean = false,
    activeColor: Color = LiveColors.AccentGreen,
    onClick: () -> Unit,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        IconButton(
            onClick = onClick,
            modifier = Modifier
                .size(44.dp)
                .clip(CircleShape)
                .background(
                    if (active) activeColor.copy(alpha = 0.2f)
                    else Color.White.copy(alpha = 0.1f)
                ),
        ) {
            Icon(
                imageVector = icon,
                contentDescription = label,
                tint = if (active) activeColor else Color.White,
                modifier = Modifier.size(22.dp),
            )
        }
        Spacer(modifier = Modifier.height(2.dp))
        Text(
            text = label,
            color = Color.White.copy(alpha = 0.6f),
            fontSize = 10.sp,
        )
    }
}

@Composable
fun ControlButtonSmall(
    icon: ImageVector,
    label: String,
    active: Boolean = false,
    onClick: () -> Unit,
) {
    TextButton(onClick = onClick) {
        Icon(
            imageVector = icon,
            contentDescription = label,
            tint = if (active) LiveColors.AccentGreen else LiveColors.TextSecondary,
            modifier = Modifier.size(18.dp),
        )
        Spacer(modifier = Modifier.width(4.dp))
        Text(
            text = label,
            color = if (active) LiveColors.AccentGreen else LiveColors.TextSecondary,
            fontSize = 11.sp,
        )
    }
}

@Composable
fun SettingsDialog(
    currentFallbackColorArgb: Int?,
    currentMatch: MatchData?,
    currentQuality: Quality,
    streamState: StreamState,
    onSetFallbackColorArgb: (Int?) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Cài đặt", fontWeight = FontWeight.Bold) },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 440.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text(
                    "Màu nền camera (Fallback)",
                    color = LiveColors.TextSecondary,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    val colors = listOf(
                        null to "Tắt",
                        0xFF22C55E.toInt() to "Xanh",
                        0xFF3B82F6.toInt() to "Xanh dương",
                        0xFFEF4444.toInt() to "Đỏ",
                        0xFF000000.toInt() to "Đen",
                    )

                    colors.forEach { (argb, label) ->
                        val selected = currentFallbackColorArgb == argb
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            modifier = Modifier.clickable { onSetFallbackColorArgb(argb) },
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(36.dp)
                                    .clip(CircleShape)
                                    .background(argb?.let { Color(it) } ?: Color.Transparent)
                                    .border(
                                        width = if (selected) 2.dp else 1.dp,
                                        color = if (selected) LiveColors.AccentGreen else Color.White.copy(alpha = 0.3f),
                                        shape = CircleShape,
                                    ),
                                contentAlignment = Alignment.Center,
                            ) {
                                if (argb == null) {
                                    Icon(
                                        Icons.Default.Block,
                                        contentDescription = null,
                                        modifier = Modifier.size(20.dp),
                                        tint = Color.White.copy(alpha = 0.5f),
                                    )
                                }
                            }
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = label,
                                fontSize = 10.sp,
                                color = if (selected) LiveColors.AccentGreen else Color.White,
                            )
                        }
                    }
                }

                Text(
                    "Sử dụng khi camera bị lỗi hoặc không thể kết nối.",
                    color = LiveColors.TextSecondary,
                    fontSize = 11.sp,
                )
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("Xong", color = LiveColors.AccentGreen)
            }
        },
        containerColor = LiveColors.SurfaceDark,
    )
}

@Composable
fun LiveSettingsDialog(
    currentFallbackColorArgb: Int?,
    currentMatch: MatchData?,
    currentQuality: Quality,
    streamState: StreamState,
    streamMode: com.pkt.live.data.model.StreamMode?,
    recordOnlyArmed: Boolean,
    waitingForCourt: Boolean,
    waitingForMatchLive: Boolean,
    waitingForNextMatch: Boolean,
    recordingUiState: com.pkt.live.data.model.RecordingUiState,
    recordingStorageStatus: com.pkt.live.data.model.RecordingStorageStatus,
    onSetFallbackColorArgb: (Int?) -> Unit,
    onDismiss: () -> Unit,
) {
    val waitingForActivation = waitingForCourt || waitingForMatchLive || waitingForNextMatch
    val streamStatusLabel =
        when {
            waitingForNextMatch -> "Đang chờ trận kế tiếp"
            waitingForCourt -> "Đang chờ sân có trận"
            waitingForMatchLive && streamMode == com.pkt.live.data.model.StreamMode.RECORD_ONLY && recordOnlyArmed -> "Đang chờ trận LIVE để tự ghi"
            waitingForMatchLive -> "Đang chờ trận LIVE"
            else -> when (streamState) {
                is StreamState.Live -> "LIVE"
                is StreamState.Connecting -> "Connecting"
                is StreamState.Reconnecting -> "Reconnecting"
                is StreamState.Previewing -> "Preview"
                is StreamState.Error -> "Error"
                is StreamState.Stopped -> "Stopped"
                else -> "Idle"
            }
        }
    val matchCode =
        currentMatch?.displayCode
            ?: currentMatch?.code
            ?: currentMatch?.id?.takeLast(6)
            ?: ""
    val competitionLabel = listOfNotNull(
        currentMatch?.tournamentName?.takeIf { it.isNotBlank() },
        currentMatch?.phaseText?.takeIf { it.isNotBlank() },
        currentMatch?.roundLabel?.takeIf { it.isNotBlank() },
        currentMatch?.courtName?.takeIf { it.isNotBlank() },
    ).joinToString(" • ")
    val courtInfoLabel = listOfNotNull(
        currentMatch?.courtClusterName?.takeIf { it.isNotBlank() }?.let { "Cụm: $it" },
        (currentMatch?.courtStationName?.takeIf { it.isNotBlank() }
            ?: currentMatch?.courtName?.takeIf { it.isNotBlank() })?.let { "Sân: $it" },
    ).joinToString(" • ")
    val storageRunway = recordingStorageStatus.estimatedRunwayMinutes?.let { "$it phút" } ?: "-"
    val storageTargetLabel =
        recordingUiState.activeStorageTargetId
            ?.takeIf { it.isNotBlank() }
            ?.let { targetId ->
                val bucketSuffix =
                    recordingUiState.activeStorageBucketName
                        ?.takeIf { it.isNotBlank() }
                        ?.let { " • $it" }
                        .orEmpty()
                "R2 hiện tại: $targetId$bucketSuffix"
            }
    val latestFailoverLabel = formatStorageFailoverDetail(recordingUiState.latestStorageFailover)

    val recordingErrorLabel =
        recordingUiState.errorMessage?.takeIf { it.isNotBlank() }?.let { message ->
            if (waitingForActivation && !recordingUiState.isRecording && recordingUiState.pendingUploads > 0) {
                "Upload nền: $message"
            } else {
                message
            }
        }
    val recordingStatusLabel =
        when {
            waitingForNextMatch && !recordingUiState.isRecording -> "Đang chờ trận kế tiếp"
            waitingForMatchLive && !recordingUiState.isRecording && streamMode == com.pkt.live.data.model.StreamMode.RECORD_ONLY && recordOnlyArmed -> "Đang chờ trận LIVE để tự ghi"
            waitingForMatchLive && !recordingUiState.isRecording -> "Đang chờ trận LIVE"
            waitingForCourt && !recordingUiState.isRecording -> "Đang chờ sân có trận"
            else -> recordingUiState.status
        }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Cài đặt", fontWeight = FontWeight.Bold) },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 440.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(
                        "Thông tin live hiện tại",
                        color = LiveColors.TextSecondary,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(
                        text = "Stream: $streamStatusLabel",
                        color = Color.White,
                        fontSize = 12.sp
                    )
                    if (waitingForActivation) {
                        Text(
                            text =
                                when {
                                    waitingForNextMatch -> "Phiên live cũ đã dọn xong. App đang giữ preview để chờ trận kế tiếp."
                                    waitingForMatchLive -> "RTMP chưa được tạo. App chỉ đang giữ sân và chờ trận hiện tại chuyển sang LIVE."
                                    else -> "RTMP chưa được tạo. App đang giữ preview và chờ sân này có trận."
                                },
                            color = LiveColors.TextSecondary,
                            fontSize = 11.sp
                        )
                    }
                    Text(
                        text = "Chất lượng: ${currentQuality.label}",
                        color = Color.White,
                        fontSize = 12.sp
                    )
                    if (currentMatch != null) {
                        if (matchCode.isNotBlank()) {
                            Text(
                                text = "Mã trận: $matchCode",
                                color = Color.White,
                                fontSize = 12.sp
                            )
                        }
                        Text(
                            text = "${currentMatch.teamAName} vs ${currentMatch.teamBName}",
                            color = Color.White,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                        Text(
                            text = "Tỉ số: ${currentMatch.scoreA} - ${currentMatch.scoreB} • Trạng thái: ${currentMatch.status.ifBlank { "-" }}",
                            color = LiveColors.TextSecondary,
                            fontSize = 11.sp
                        )
                        if (competitionLabel.isNotBlank()) {
                            Text(
                                text = competitionLabel,
                                color = LiveColors.TextSecondary,
                                fontSize = 11.sp
                            )
                        }
                        if (courtInfoLabel.isNotBlank()) {
                            Text(
                                text = courtInfoLabel,
                                color = LiveColors.AccentGreen,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                    } else {
                        Text(
                            text = "Chưa tải đủ thông tin trận hiện tại.",
                            color = LiveColors.TextSecondary,
                            fontSize = 11.sp
                        )
                    }
                }

                Divider(color = Color.White.copy(alpha = 0.08f))

                Column(
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(
                        "Recording",
                        color = LiveColors.TextSecondary,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(
                        text = "Mode: ${streamMode?.label ?: "Chưa chọn"}",
                        color = Color.White,
                        fontSize = 12.sp
                    )
                    if (streamMode == com.pkt.live.data.model.StreamMode.RECORD_ONLY) {
                        Text(
                            text = "Record only: ${if (recordOnlyArmed) "Đang tự động theo dõi các trận trên sân này" else "Chưa kích hoạt"}",
                            color = Color.White,
                            fontSize = 12.sp
                        )
                    }
                    Text(
                        text = "Trạng thái: $recordingStatusLabel",
                        color = Color.White,
                        fontSize = 12.sp
                    )
                    storageTargetLabel?.let { target ->
                        Text(
                            text = target,
                            color = Color.White,
                            fontSize = 12.sp
                        )
                    }
                    latestFailoverLabel?.let { label ->
                        Text(
                            text = "Failover gần nhất: $label",
                            color = LiveColors.Warning,
                            fontSize = 11.sp
                        )
                    }
                    Text(
                        text = "Đang ghi: ${if (recordingUiState.isRecording) "Có" else "Không"}",
                        color = Color.White,
                        fontSize = 12.sp
                    )
                    Text(
                        text = "Đang chờ tải: ${recordingUiState.pendingUploads} đoạn",
                        color = LiveColors.TextSecondary,
                        fontSize = 11.sp
                    )
                    Text(
                        text = "Dung lượng trống: ${formatBytes(recordingStorageStatus.availableBytes)}",
                        color = LiveColors.TextSecondary,
                        fontSize = 11.sp
                    )
                    Text(
                        text = "Queue local: ${formatBytes(recordingStorageStatus.pendingQueueBytes)}",
                        color = LiveColors.TextSecondary,
                        fontSize = 11.sp
                    )
                    Text(
                        text = "Runway ước tính: $storageRunway",
                        color = LiveColors.TextSecondary,
                        fontSize = 11.sp
                    )
                    recordingStorageStatus.message?.takeIf { it.isNotBlank() }?.let { message ->
                        Text(
                            text = message,
                            color = LiveColors.Warning,
                            fontSize = 11.sp
                        )
                    }
                    recordingErrorLabel?.let { message ->
                        Text(
                            text = message,
                            color = LiveColors.Warning,
                            fontSize = 11.sp
                        )
                    }
                }

                Divider(color = Color.White.copy(alpha = 0.08f))

                Text(
                    "Màu nền camera (Fallback)",
                    color = LiveColors.TextSecondary,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    val colors = listOf(
                        null to "Tắt",
                        0xFF22C55E.toInt() to "Xanh",
                        0xFF3B82F6.toInt() to "Xanh dương",
                        0xFFEF4444.toInt() to "Đỏ",
                        0xFF000000.toInt() to "Đen"
                    )

                    colors.forEach { (argb, label) ->
                        val selected = currentFallbackColorArgb == argb
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            modifier = Modifier.clickable { onSetFallbackColorArgb(argb) }
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(36.dp)
                                    .clip(CircleShape)
                                    .background(argb?.let { Color(it) } ?: Color.Transparent)
                                    .border(
                                        width = if (selected) 2.dp else 1.dp,
                                        color = if (selected) LiveColors.AccentGreen else Color.White.copy(alpha = 0.3f),
                                        shape = CircleShape
                                    ),
                                contentAlignment = Alignment.Center
                            ) {
                                if (argb == null) {
                                    Icon(
                                        Icons.Default.Block,
                                        contentDescription = null,
                                        modifier = Modifier.size(20.dp),
                                        tint = Color.White.copy(alpha = 0.5f)
                                    )
                                }
                            }
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                label,
                                fontSize = 10.sp,
                                color = if (selected) LiveColors.AccentGreen else Color.White
                            )
                        }
                    }
                }

                Text(
                    "Sử dụng khi camera bị lỗi hoặc không thể kết nối.",
                    color = LiveColors.TextSecondary,
                    fontSize = 11.sp
                )
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("Xong", color = LiveColors.AccentGreen)
            }
        },
        containerColor = LiveColors.SurfaceDark,
    )
}

@Composable
private fun RecordingRequestDetailsDialog(
    currentMatch: MatchData?,
    currentQuality: Quality,
    streamState: StreamState,
    streamMode: com.pkt.live.data.model.StreamMode?,
    recordOnlyArmed: Boolean,
    waitingForCourt: Boolean,
    waitingForMatchLive: Boolean,
    waitingForNextMatch: Boolean,
    requestingStream: Boolean,
    rtmpReady: Boolean,
    recordingUiState: com.pkt.live.data.model.RecordingUiState,
    recordingStorageStatus: com.pkt.live.data.model.RecordingStorageStatus,
    onDismiss: () -> Unit,
) {
    val statusLabel =
        when {
            waitingForNextMatch -> "Đang chờ trận kế tiếp"
            waitingForCourt -> "Đang chờ sân có trận"
            waitingForMatchLive && streamMode == com.pkt.live.data.model.StreamMode.RECORD_ONLY && recordOnlyArmed -> "Đang chờ trận LIVE để tự ghi"
            waitingForMatchLive -> "Đang chờ trận LIVE"
            requestingStream -> "Đang xin RTMP/live session"
            else -> recordingUiState.status.ifBlank { streamState.javaClass.simpleName }
        }
    val requestModeLabel =
        when {
            recordingUiState.activeRecordingId != null -> "Recording session đang hoạt động"
            recordingUiState.pendingUploads > 0 -> "Upload nền / finalize"
            else -> "Chưa có request recording hoạt động"
        }
    val storageTargetLabel =
        recordingUiState.activeStorageTargetId
            ?.takeIf { it.isNotBlank() }
            ?.let { targetId ->
                val bucketSuffix =
                    recordingUiState.activeStorageBucketName
                        ?.takeIf { it.isNotBlank() }
                        ?.let { " • $it" }
                        .orEmpty()
                "$targetId$bucketSuffix"
            }
    val latestFailoverLabel = formatStorageFailoverDetail(recordingUiState.latestStorageFailover)

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Chi tiết request recording", fontWeight = FontWeight.Bold) },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 480.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                RequestDetailRow("Mode", streamMode?.label ?: "Chưa chọn")
                RequestDetailRow("Luồng hiện tại", statusLabel)
                RequestDetailRow("Request phase", requestModeLabel)
                RequestDetailRow("RTMP", if (rtmpReady) "Đã có URL" else "Chưa có URL")
                RequestDetailRow("Quality", currentQuality.label)
                RequestDetailRow("Match ID", recordingUiState.activeMatchId ?: currentMatch?.id.orEmpty().ifBlank { "-" })
                RequestDetailRow("Mã trận", currentMatch?.displayCode ?: currentMatch?.code ?: "-")
                RequestDetailRow("Recording ID", recordingUiState.activeRecordingId ?: "-")
                RequestDetailRow("Recording session", recordingUiState.activeRecordingSessionId ?: "-")
                storageTargetLabel?.let {
                    RequestDetailRow("R2 hiện tại", it)
                }
                latestFailoverLabel?.let {
                    RequestDetailRow("Failover gần nhất", it)
                }
                RequestDetailRow("Tên cặp đấu", currentMatch?.let { "${it.teamAName} vs ${it.teamBName}" } ?: "-")
                RequestDetailRow("Đang ghi", if (recordingUiState.isRecording) "Có" else "Không")
                RequestDetailRow("Đang chờ tải", "${recordingUiState.pendingUploads} đoạn")
                RequestDetailRow("Segment mode", if (recordingStorageStatus.lowStorageOptimized) "Tự tối ưu ${recordingStorageStatus.segmentDurationSeconds}s" else "Chuẩn ${recordingStorageStatus.segmentDurationSeconds}s")
                RequestDetailRow("Queue local", formatBytes(recordingStorageStatus.pendingQueueBytes))
                RequestDetailRow("Dung lượng trống", formatBytes(recordingStorageStatus.availableBytes))
                RequestDetailRow("Ngưỡng tối thiểu", formatBytes(recordingStorageStatus.minimumRequiredBytes))
                RequestDetailRow("Khuyến nghị", formatBytes(recordingStorageStatus.recommendedBytes))
                recordingStorageStatus.message?.takeIf { it.isNotBlank() }?.let {
                    RequestDetailRow("Cảnh báo bộ nhớ", it)
                }
                recordingUiState.errorMessage?.takeIf { it.isNotBlank() }?.let {
                    RequestDetailRow("Lỗi gần nhất", it)
                }
                recordingUiState.playbackUrl?.takeIf { it.isNotBlank() }?.let {
                    RequestDetailRow("Playback URL", it)
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("Xong", color = LiveColors.AccentGreen)
            }
        },
        containerColor = LiveColors.SurfaceDark,
    )
}

@Composable
private fun RequestDetailRow(
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

private fun formatStorageFailoverDetail(
    entry: com.pkt.live.data.model.RecordingStorageFailoverEntry?,
): String? {
    val nextEntry = entry ?: return null
    val fromTarget = nextEntry.fromTargetId?.takeIf { it.isNotBlank() } ?: "?"
    val toTarget = nextEntry.toTargetId?.takeIf { it.isNotBlank() } ?: "?"
    val routeLabel =
        when {
            fromTarget == "?" && toTarget == "?" -> null
            fromTarget == toTarget -> "đang giữ $toTarget"
            else -> "$fromTarget -> $toTarget"
        } ?: return null
    val checkedAt = nextEntry.checkedAt?.takeIf { it.isNotBlank() }?.let { " @ $it" }.orEmpty()
    val detail = nextEntry.detail?.takeIf { it.isNotBlank() }?.let { " • $it" }.orEmpty()
    return routeLabel + checkedAt + detail
}

private fun formatBytes(bytes: Long): String {
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
fun QualityPickerDialog(
    currentQuality: Quality,
    onSelect: (Quality) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Chọn chất lượng", fontWeight = FontWeight.Bold) },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 440.dp)
                    .verticalScroll(rememberScrollState()),
            ) {
                Quality.entries.forEach { q ->
                    val selected = q == currentQuality
                    TextButton(
                        onClick = { onSelect(q) },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = q.label,
                                color = if (selected) LiveColors.AccentGreen else Color.White,
                                fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                            )
                            if (selected) {
                                Icon(
                                    imageVector = Icons.Default.Check,
                                    contentDescription = "Selected",
                                    tint = LiveColors.AccentGreen,
                                    modifier = Modifier.size(18.dp),
                                )
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Đóng")
            }
        },
        containerColor = LiveColors.SurfaceDark,
    )
}
