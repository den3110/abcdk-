package com.pkt.live.streaming

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.util.Log
import com.google.firebase.crashlytics.FirebaseCrashlytics
import android.view.SurfaceHolder
import androidx.core.content.ContextCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import android.content.res.Configuration
import com.pedro.common.ConnectChecker
import com.pedro.encoder.input.video.CameraHelper
import com.pedro.encoder.input.gl.render.filters.`object`.ImageObjectFilterRender
import com.pedro.library.rtmp.RtmpCamera2
import com.pedro.library.view.GlInterface
import com.pedro.library.view.OpenGlView
import com.pedro.encoder.utils.gl.TranslateTo
import java.io.File
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.atomic.AtomicBoolean

/**
 * RTMP Streaming Manager — crash-proof design.
 *
 * Key anti-crash features:
 * 1. All camera ops on main thread only via scope.launch(Dispatchers.Main)
 * 2. State machine prevents invalid transitions
 * 3. Mutex-based surface lock before every camera op
 * 4. Surface validity check (isValid) before operations
 * 5. Auto-reconnect with exponential backoff
 * 6. LifecycleObserver integration
 * 7. Memory pressure handling (onTrimMemory)
 * 8. Auto-quality reduction on poor network
 */
class RtmpStreamManager(
    private val context: Context,
    private val runtimeRegistry: StreamRuntimeRegistry,
) : ConnectChecker, DefaultLifecycleObserver {

    private enum class OverlayAttachResult {
        READY,
        FILTER_ARMED,
        FAILED,
    }

    companion object {
        private const val TAG = "RtmpStream"
        private const val MAX_RECONNECT_ATTEMPTS = 3
        private const val AUTO_QUALITY_COOLDOWN_MS = 75_000L
        private const val AUTO_QUALITY_LIVE_GRACE_MS = 35_000L
        private const val EMULATOR_AUTO_QUALITY_COOLDOWN_MS = 120_000L
        private const val EMULATOR_AUTO_QUALITY_LIVE_GRACE_MS = 60_000L
        private const val AUTO_QUALITY_CONSECUTIVE_LOW_READINGS = 7
        private const val EMULATOR_AUTO_QUALITY_CONSECUTIVE_LOW_READINGS = 10
        private const val ORIENTATION_RECONFIGURE_DELAY_MS = 500L  // Fix #2: increased from 300ms for slow devices
        private const val OVERLAY_ATTACH_RETRY_COUNT = 6
        private const val OVERLAY_ATTACH_RETRY_DELAY_MS = 120L
        private const val OVERLAY_HEALTHCHECK_INTERVAL_MS = 1_000L
        private const val OVERLAY_RECOVERY_BURST_COOLDOWN_MS = 1_500L
        private const val LIVE_BITRATE_STALL_RESTART_MS = 50_000L
        private const val EMULATOR_LIVE_BITRATE_STALL_RESTART_MS = 75_000L
        private const val BITMAP_SAFE_RECYCLE_DELAY_MS = 2_500L
        private const val DEFAULT_RECORDING_SEGMENT_DURATION_MS = 6_000L
        private const val MIN_RECORDING_SEGMENT_DURATION_MS = 6_000L
        private const val OVERLAY_ATTACHED_STABLE_COOLDOWN_MS = 1_200L
        private const val WAKE_LOCK_TIMEOUT_MS = 10 * 60_000L
        private const val WAKE_LOCK_RENEW_BEFORE_MS = 60_000L
        private const val RECOVERY_BUDGET_WINDOW_MS = 15 * 60_000L
        private const val RECOVERY_RESET_AFTER_STABLE_MS = 3 * 60_000L
        private const val MAX_RECOVERY_ATTEMPTS_IN_WINDOW = 8
        private const val FAIL_SOFT_IMMINENT_THRESHOLD = 2
    }

    private var rtmpCamera: RtmpCamera2? = null
    private var surfaceView: OpenGlView? = null
    private var surfaceCallback: SurfaceHolder.Callback? = null
    private var currentUrl: String? = null
    private var currentQuality: Quality = Quality.DEFAULT
    private var currentFacing: CameraHelper.Facing = CameraHelper.Facing.BACK
    private val isReconnecting = AtomicBoolean(false)
    private val desiredStreaming = AtomicBoolean(false)
    private val pendingNetworkReconnect = AtomicBoolean(false)
    @Volatile
    private var isLifecycleForeground = false
    @Volatile
    private var teardownInProgress = false
    @Volatile
    private var autoPreviewAllowed = true
    private var reconnectAttempt = 0
    @Volatile
    private var isReleased = false
    @Volatile
    private var networkAvailable = true
    @Volatile
    private var lastBitrateUpdateAtMs: Long = 0L
    @Volatile
    private var connectingAtMs: Long = 0L
    @Volatile
    private var reconnectingAtMs: Long = 0L
    @Volatile
    private var lastHardRestartAtMs: Long = 0L
    @Volatile
    private var lastThermalDowngradeAtMs: Long = 0L

    private val appContext: Context = context.applicationContext
    private val powerManager: PowerManager =
        appContext.getSystemService(Context.POWER_SERVICE) as PowerManager
    private var wakeLock: PowerManager.WakeLock? = null
    @Volatile
    private var wakeLockExpiresAtMs: Long = 0L

    private var powerSaveReceiverRegistered = false
    private val powerSaveReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            val enabled = try { powerManager.isPowerSaveMode } catch (_: Exception) { false }
            _powerSaveMode.value = enabled
            if (enabled && desiredStreaming.get()) {
                maybeDowngradeForStability("power_saver")
            }
        }
    }

    private var batteryReceiverRegistered = false
    private val batteryReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            val rawTemp = intent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, -1)
            val tempC = if (rawTemp > 0) rawTemp / 10f else null
            _batteryTempC.value = tempC

            val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, BatteryManager.BATTERY_STATUS_UNKNOWN)
            val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
            _isCharging.value = charging

            val now = System.currentTimeMillis()
            if (tempC != null && tempC >= 45f && desiredStreaming.get() && now - lastThermalDowngradeAtMs >= 5 * 60_000L) {
                lastThermalDowngradeAtMs = now
                _lastThermalEvent.value = ThermalEvent(tempC = tempC, atMs = now)
                maybeDowngradeForStability("thermal")
                if (_torchOn.value) {
                    scope.launch { toggleTorch() }
                }
            }
        }
    }

    private var healthJob: Job? = null
    private var orientationReconfigureJob: Job? = null
    private var overlayAttachJob: Job? = null
    private var overlayPostTransitionJob: Job? = null
    private var overlayRecoveryBurstJob: Job? = null
    private var recordingRotateJob: Job? = null
    private var hardRestartWindowStartMs: Long = 0L
    private var hardRestartCountInWindow: Int = 0

    private val pendingSurfaceStart = AtomicBoolean(false)
    private var activeRecordingMatchId: String? = null
    private var activeRecordingId: String? = null
    private var activeRecordingSessionId: String? = null
    private var recordingPath: String? = null
    private var recordingSegmentIndex: Int = 0
    private var recordingSegmentStartedAtMs: Long = 0L
    private var recordingSegmentDurationMs: Long = DEFAULT_RECORDING_SEGMENT_DURATION_MS
    private var pendingRecordingResume: PendingRecordingResume? = null

    // Mutex to prevent concurrent camera operations (anti-crash #3)
    private val cameraMutex = Mutex()
    // Surface validity flag (anti-crash #4)
    @Volatile
    private var isSurfaceValid = false

    private var overlayFilter: ImageObjectFilterRender? = null
    private var overlayFilterOwner: RtmpCamera2? = null
    private var overlayBitmap: android.graphics.Bitmap? = null
    private var webLogoFilter: ImageObjectFilterRender? = null
    private var sponsorFilter: ImageObjectFilterRender? = null
    private var webLogoBitmap: android.graphics.Bitmap? = null
    private var sponsorBitmap: android.graphics.Bitmap? = null
    private var brandingJob: Job? = null
    private var encoderWidth: Int = 0
    private var encoderHeight: Int = 0
    @Volatile
    private var lastAutoQualityChangeAtMs: Long = 0L
    @Volatile
    private var lastLiveBecameStableAtMs: Long = 0L
    @Volatile
    private var lastPreparedOrientation: Int = Configuration.ORIENTATION_UNDEFINED
    @Volatile
    private var lastOverlayEnsureAtMs: Long = 0L
    @Volatile
    private var lastOverlayAttachedAtMs: Long = 0L
    @Volatile
    private var lastOverlayPayloadNudgeAtMs: Long = 0L
    @Volatile
    private var lastOverlayRecoveryBurstAtMs: Long = 0L
    @Volatile
    private var recoveryBudgetWindowStartMs: Long = 0L
    @Volatile
    private var recoveryAttemptsInWindow: Int = 0
    private val isProbablyEmulator: Boolean =
        Build.FINGERPRINT.contains("generic", ignoreCase = true) ||
            Build.FINGERPRINT.contains("emulator", ignoreCase = true) ||
            Build.MODEL.contains("Emulator", ignoreCase = true) ||
            Build.MODEL.contains("sdk", ignoreCase = true) ||
            Build.HARDWARE.contains("goldfish", ignoreCase = true) ||
            Build.HARDWARE.contains("ranchu", ignoreCase = true)

    private val coroutineExceptionHandler = CoroutineExceptionHandler { _, throwable ->
        Log.e(TAG, "Unhandled coroutine exception", throwable)
        isReconnecting.set(false)
        _state.value = StreamState.Error("Lỗi nội bộ: ${throwable.message}", recoverable = true)
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate + coroutineExceptionHandler)

    private val _state = MutableStateFlow<StreamState>(StreamState.Idle)
    val state: StateFlow<StreamState> = _state.asStateFlow()

    // Stream stats
    private val _stats = MutableStateFlow(StreamStats())
    val stats: StateFlow<StreamStats> = _stats.asStateFlow()

    private val _encoderSize = MutableStateFlow(EncoderSurfaceSize())
    val encoderSize: StateFlow<EncoderSurfaceSize> = _encoderSize.asStateFlow()

    private val _bitrateUpdatedAtMs = MutableStateFlow(0L)
    val bitrateUpdatedAtMs: StateFlow<Long> = _bitrateUpdatedAtMs.asStateFlow()

    private val _rtmpLastMessage = MutableStateFlow<String?>(null)
    val rtmpLastMessage: StateFlow<String?> = _rtmpLastMessage.asStateFlow()

    private val _lastMemoryPressure = MutableStateFlow<MemoryPressureEvent?>(null)
    val lastMemoryPressure: StateFlow<MemoryPressureEvent?> = _lastMemoryPressure.asStateFlow()

    private val _lastRecovery = MutableStateFlow<RecoveryEvent?>(null)
    val lastRecovery: StateFlow<RecoveryEvent?> = _lastRecovery.asStateFlow()
    private val _recoveryState = MutableStateFlow(StreamRecoveryState())
    val recoveryState: StateFlow<StreamRecoveryState> = _recoveryState.asStateFlow()
    private val _overlayHealth = MutableStateFlow(OverlayHealth())
    val overlayHealth: StateFlow<OverlayHealth> = _overlayHealth.asStateFlow()

    private val _powerSaveMode = MutableStateFlow(false)
    val powerSaveMode: StateFlow<Boolean> = _powerSaveMode.asStateFlow()

    private val _batteryTempC = MutableStateFlow<Float?>(null)
    val batteryTempC: StateFlow<Float?> = _batteryTempC.asStateFlow()

    private val _isCharging = MutableStateFlow(false)
    val isCharging: StateFlow<Boolean> = _isCharging.asStateFlow()

    private val _lastThermalEvent = MutableStateFlow<ThermalEvent?>(null)
    val lastThermalEvent: StateFlow<ThermalEvent?> = _lastThermalEvent.asStateFlow()

    // Camera state
    private val _torchOn = MutableStateFlow(false)
    val torchOn: StateFlow<Boolean> = _torchOn.asStateFlow()

    private val _micMuted = MutableStateFlow(false)
    val micMuted: StateFlow<Boolean> = _micMuted.asStateFlow()

    private val _previewReady = MutableStateFlow(false)
    val previewReady: StateFlow<Boolean> = _previewReady.asStateFlow()
    private val _recordingState = MutableStateFlow(RecordingEngineState())
    val recordingState: StateFlow<RecordingEngineState> = _recordingState.asStateFlow()

    private val _isFrontCamera = MutableStateFlow(false)
    val isFrontCamera: StateFlow<Boolean> = _isFrontCamera.asStateFlow()

    private val _zoomLevel = MutableStateFlow(1f)
    val zoomLevel: StateFlow<Float> = _zoomLevel.asStateFlow()

    fun wantsToKeepStreaming(): Boolean = desiredStreaming.get()
    var onRecordingSegmentClosed: ((RecordingSegmentClosed) -> Unit)? = null
    var onRecordingError: ((String) -> Unit)? = null

    private data class PendingRecordingResume(
        val matchId: String,
        val recordingId: String,
        val recordingSessionId: String,
        val nextSegmentIndex: Int,
        val boundaryReason: String? = null,
    )

    // ==================== Lifecycle Observer ====================

    init {
        runtimeRegistry.register(streamManager = this)
        startHealthLoop()
        startDeviceMonitoring()
    }

    override fun onResume(owner: LifecycleOwner) {
        Log.d(TAG, "Lifecycle: onResume")
        isLifecycleForeground = true
    }

    override fun onPause(owner: LifecycleOwner) {
        Log.d(TAG, "Lifecycle: onPause")
        isLifecycleForeground = false
        releaseWakeLock()
    }

    override fun onDestroy(owner: LifecycleOwner) {
        Log.d(TAG, "Lifecycle: onDestroy")
        release()
    }

    /**
     * Attach to a SurfaceView and prepare camera.
     * Call this in Activity.onCreate.
     */
    fun attachSurface(surface: OpenGlView) {
        surfaceCallback?.let { existing ->
            runCatching { surfaceView?.holder?.removeCallback(existing) }
        }
        surfaceView = surface
        val callback = object : SurfaceHolder.Callback {
            override fun surfaceCreated(holder: SurfaceHolder) {
                Log.d(TAG, "Surface created")
                isSurfaceValid = true
                if (teardownInProgress || isReleased) {
                    Log.d(TAG, "Surface created while teardown/release is in progress; skip auto start")
                    return
                }
                initCamera(surface)
                if (autoPreviewAllowed && hasCameraAndMicPermission()) {
                    startPreview()
                }
                val shouldStart = pendingSurfaceStart.getAndSet(false)
                val url = currentUrl
                if (shouldStart && desiredStreaming.get() && !url.isNullOrBlank()) {
                    startStream(url)
                }
            }

            override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
                Log.d(TAG, "Surface changed: ${width}x${height}")
            }

            override fun surfaceDestroyed(holder: SurfaceHolder) {
                Log.d(TAG, "Surface destroyed")
                isSurfaceValid = false
                scope.launch {
                    cameraMutex.withLock {
                        try {
                            teardownCameraLocked(
                                reason = "surface_destroyed",
                                stopPreview = true,
                                clearDesiredState = false,
                                finalState = StreamState.Idle,
                                restartOnSurface = true,
                            )
                        } catch (e: Exception) {
                            Log.e(TAG, "Surface destroy cleanup error (non-fatal)", e)
                        }
                    }
                }
            }
        }
        surfaceCallback = callback
        surface.holder.addCallback(callback)
    }

    private fun initCamera(surface: OpenGlView) {
        scope.launch {
            cameraMutex.withLock {
                try {
                    if (rtmpCamera != null) {
                        Log.d(TAG, "Camera already initialized")
                        return@withLock
                    }
                    rtmpCamera = RtmpCamera2(surface, this@RtmpStreamManager)
                    Log.d(TAG, "Camera initialized")
                } catch (e: Exception) {
                    Log.e(TAG, "Camera init failed", e)
                    _state.value = StreamState.Error("Camera init failed: ${e.message}", recoverable = true)
                }
            }
        }
    }

    private fun ensureCameraInitialized(): RtmpCamera2? {
        if (rtmpCamera != null) return rtmpCamera
        val surface = surfaceView ?: return null
        if (!isSurfaceValid) return null
        return try {
            rtmpCamera = RtmpCamera2(surface, this@RtmpStreamManager)
            rtmpCamera
        } catch (e: Exception) {
            Log.e(TAG, "ensureCameraInitialized failed", e)
            null
        }
    }

    /**
     * Start camera preview. Call from Activity.onResume.
     */
    fun startPreview(quality: Quality = currentQuality) {
        scope.launch {
            cameraMutex.withLock {
                try {
                    if (isReleased) return@withLock
                    if (teardownInProgress) {
                        Log.d(TAG, "startPreview ignored because teardown is in progress")
                        return@withLock
                    }
                    if (!isSurfaceValid) {
                        Log.w(TAG, "startPreview: surface not valid")
                        return@withLock
                    }
                    autoPreviewAllowed = true
                    val cam = ensureCameraInitialized() ?: run {
                        Log.w(TAG, "startPreview: camera not ready")
                        return@withLock
                    }
                    if (cam.isOnPreview) {
                        Log.d(TAG, "Preview already running")
                        _previewReady.value = true
                        _state.value = StreamState.Previewing
                        maybeResumeRecordingAfterBoundaryLocked("preview_already_running")
                        return@withLock
                    }

                    currentQuality = quality
                    val audioPrepared = runCatching { cam.prepareAudio(128_000, 44100, true) }.isSuccess
                    val videoPrepared = prepareVideo(cam, quality)
                    if (!audioPrepared || !videoPrepared) {
                        maybeDowngradeForStability("prepare_failed_preview")
                        _state.value = StreamState.Error("Không thể chuẩn bị encoder", recoverable = true)
                        return@withLock
                    }
                    cam.startPreview(currentFacing)
                    setupOverlayFilterIfPossible(forceRecreate = true, reason = "start_preview")
                    scheduleOverlayRebindAfterPreview(quality, reason = "start_preview")
                    _previewReady.value = true
                    _state.value = StreamState.Previewing
                    maybeResumeRecordingAfterBoundaryLocked("start_preview")
                    Log.d(TAG, "Preview started: ${quality.label}")
                } catch (e: Exception) {
                    Log.e(TAG, "Start preview failed", e)
                    _previewReady.value = false
                    _state.value = StreamState.Error("Preview failed: ${e.message}")
                }
            }
        }
    }

    /**
     * Stop preview. Call from Activity.onPause.
     */
    fun stopPreview() {
        scope.launch {
            cameraMutex.withLock {
                try {
                    teardownCameraLocked(
                        reason = "stop_preview",
                        stopPreview = true,
                        clearDesiredState = true,
                        finalState = StreamState.Idle,
                    )
                    Log.d(TAG, "Preview stopped")
                } catch (e: Exception) {
                    Log.e(TAG, "Stop preview error (non-fatal)", e)
                    _previewReady.value = false
                    _state.value = StreamState.Idle
                }
            }
        }
    }

    /**
     * Start RTMP stream to given URL.
     */
    fun startStream(rtmpUrl: String) {
        scope.launch {
            cameraMutex.withLock {
                try {
                    if (isReleased) return@withLock
                    if (teardownInProgress) {
                        Log.d(TAG, "startStream ignored because teardown is in progress")
                        return@withLock
                    }
                    if (rtmpUrl.isBlank()) {
                        _state.value = StreamState.Error("RTMP URL không hợp lệ", recoverable = true)
                        desiredStreaming.set(false)
                        pendingNetworkReconnect.set(false)
                        releaseWakeLock()
                        return@withLock
                    }

                    val s = _state.value
                    if (s is StreamState.Connecting || s is StreamState.Reconnecting || s is StreamState.Live) {
                        currentUrl = rtmpUrl
                        desiredStreaming.set(true)
                        return@withLock
                    }

                    desiredStreaming.set(true)
                    autoPreviewAllowed = true
                    pendingNetworkReconnect.set(false)
                    currentUrl = rtmpUrl
                    _lastRecovery.value = null

                    if (!hasCameraAndMicPermission()) {
                        _state.value = StreamState.Error("Thiếu quyền camera/micro", recoverable = true)
                        desiredStreaming.set(false)
                        pendingNetworkReconnect.set(false)
                        releaseWakeLock()
                        return@withLock
                    }

                    if (!networkAvailable) {
                        releaseWakeLock()
                        _state.value = StreamState.Error("Mất kết nối mạng", recoverable = true)
                        pendingNetworkReconnect.set(true)
                        markOverlayIssue("Mất mạng khi đang live, overlay sẽ quay lại sau khi stream nối lại.")
                        return@withLock
                    }
                    if (!isSurfaceValid) {
                        Log.w(TAG, "startStream: surface not valid")
                        pendingSurfaceStart.set(true)
                        releaseWakeLock()
                        _state.value = StreamState.Error("Chưa sẵn sàng để live (Surface)", recoverable = true)
                        return@withLock
                    }
                    val cam = ensureCameraInitialized() ?: run {
                        _state.value = StreamState.Error("Camera not ready")
                        pendingSurfaceStart.set(true)
                        releaseWakeLock()
                        return@withLock
                    }
                    if (cam.isStreaming) {
                        Log.w(TAG, "Already streaming")
                        return@withLock
                    }

                    val reusingPreview = cam.isOnPreview
                    val prepared = prepareStreamPipelineLocked(
                        cam = cam,
                        quality = currentQuality,
                        reason = if (reusingPreview) "start_stream_reuse_preview" else "start_stream_preview",
                    )
                    if (!prepared) {
                        maybeDowngradeForStability("prepare_failed_stream")
                        _state.value = StreamState.Error("Không thể chuẩn bị encoder", recoverable = true)
                        releaseWakeLock()
                        return@withLock
                    }
                    if (!reusingPreview) {
                        delay(500)
                    }

                    if (!cam.isOnPreview && false) {
                        val audioPrepared = runCatching { cam.prepareAudio(128_000, 44100, true) }.isSuccess
                        val videoPrepared = prepareVideo(cam, currentQuality)
                        if (!audioPrepared || !videoPrepared) {
                            maybeDowngradeForStability("prepare_failed_stream")
                            _state.value = StreamState.Error("Không thể chuẩn bị encoder", recoverable = true)
                            releaseWakeLock()
                            return@withLock
                        }
                        cam.startPreview(currentFacing)
                        setupOverlayFilterIfPossible(forceRecreate = true, reason = "start_stream_preview")
                        scheduleOverlayRebindAfterPreview(currentQuality, reason = "start_stream_preview")
                        _previewReady.value = true
                        delay(500) // wait for preview to stabilize
                    }

                    reconnectAttempt = 0
                    connectingAtMs = System.currentTimeMillis()
                    _state.value = StreamState.Connecting(rtmpUrl)

                    acquireWakeLock()
                    // Fix #3: Crashlytics breadcrumb before native RTMP call
                    FirebaseCrashlytics.getInstance().log("startStream: url=${rtmpUrl.take(60)}, quality=${currentQuality.label}")
                    runCatching { cam.startStream(rtmpUrl) }
                        .recoverCatching { error ->
                            val message = error.message.orEmpty()
                            if (!message.contains("not prepared", ignoreCase = true)) throw error
                            Log.w(TAG, "Encoder was not prepared on startStream, retrying once")
                            val retryPrepared = prepareStreamPipelineLocked(
                                cam = cam,
                                quality = currentQuality,
                                reason = "start_stream_retry",
                            )
                            if (!retryPrepared) throw error
                            cam.startStream(rtmpUrl)
                        }
                        .getOrThrow()
                    Log.d(TAG, "Stream connecting to: ${maskUrl(rtmpUrl)}")
                } catch (e: Exception) {
                    Log.e(TAG, "Start stream failed", e)
                    _state.value = StreamState.Error("Stream start failed: ${e.message}")
                    releaseWakeLock()
                }
            }
        }
    }

    /**
     * Stop RTMP stream gracefully.
     */
    fun stopStream() {
        desiredStreaming.set(false)
        pendingNetworkReconnect.set(false)
        pendingSurfaceStart.set(false)
        releaseWakeLock()
        stopStreamSafe()
    }

    private fun stopStreamSafe() {
        scope.launch {
            cameraMutex.withLock {
                try {
                    isReconnecting.set(false)
                    reconnectAttempt = 0
                    pendingNetworkReconnect.set(false)
                    rtmpCamera?.let { cam ->
                        if (cam.isStreaming) {
                            cam.stopStream()
                        }
                    }
                    _state.value = if (rtmpCamera?.isOnPreview == true) StreamState.Previewing else StreamState.Stopped
                    Log.d(TAG, "Stream stopped")
                } catch (e: Exception) {
                    Log.e(TAG, "Stop stream error (non-fatal)", e)
                    _state.value = StreamState.Stopped
                }
            }
        }
    }

    suspend fun startMatchRecording(
        matchId: String,
        recordingId: String,
        recordingSessionId: String,
    ): Result<Unit> = withContext(Dispatchers.Main.immediate) {
        cameraMutex.withLock {
            try {
                if (isReleased) return@withLock Result.failure(IllegalStateException("Stream manager đã release"))
                if (teardownInProgress) {
                    return@withLock Result.failure(IllegalStateException("Camera đang dọn phiên cũ, chưa thể bắt đầu ghi hình"))
                }
                val normalizedMatchId = matchId.trim()
                val normalizedRecordingId = recordingId.trim()
                val normalizedSessionId = recordingSessionId.trim()
                if (normalizedMatchId.isBlank() || normalizedRecordingId.isBlank() || normalizedSessionId.isBlank()) {
                    return@withLock Result.failure(IllegalArgumentException("Thiếu matchId hoặc recordingId"))
                }

                val cam = ensureCameraInitialized()
                    ?: return@withLock Result.failure(IllegalStateException("Camera chưa sẵn sàng"))

                if (_recordingState.value.isRecording) {
                    if (activeRecordingMatchId == normalizedMatchId && activeRecordingId == normalizedRecordingId) {
                        return@withLock Result.success(Unit)
                    }
                    stopCurrentRecordingLocked(isFinal = true, reason = "start_new_recording", resumeAfter = false)
                }

                if (!cam.isOnPreview) {
                    autoPreviewAllowed = true
                    val prepared = prepareStreamPipelineLocked(
                        cam = cam,
                        quality = currentQuality,
                        reason = "start_recording_preview",
                    )
                    if (!prepared) {
                        return@withLock Result.failure(IllegalStateException("Không chuẩn bị được preview để ghi hình"))
                    }
                    if (!cam.isStreaming) {
                        _state.value = StreamState.Previewing
                    }
                }

                val outputPath = buildRecordingSegmentPath(normalizedMatchId, normalizedRecordingId, 0)
                    ?: return@withLock Result.failure(IllegalStateException("Không tạo được file ghi hình"))

                runCatching { cam.startRecord(outputPath) }.getOrElse { error ->
                    markRecordingError("Không bắt đầu được ghi hình: ${error.message}")
                    return@withLock Result.failure(error)
                }

                activeRecordingMatchId = normalizedMatchId
                activeRecordingId = normalizedRecordingId
                activeRecordingSessionId = normalizedSessionId
                recordingPath = outputPath
                recordingSegmentIndex = 0
                recordingSegmentStartedAtMs = System.currentTimeMillis()
                pendingRecordingResume = null
                _recordingState.value =
                    RecordingEngineState(
                        isRecording = true,
                        matchId = normalizedMatchId,
                        recordingId = normalizedRecordingId,
                        recordingSessionId = normalizedSessionId,
                        segmentIndex = 0,
                        segmentStartedAtMs = recordingSegmentStartedAtMs,
                    )
                scheduleRecordingRotationLocked()
                Result.success(Unit)
            } catch (e: Exception) {
                markRecordingError("Lỗi ghi hình: ${e.message}")
                Result.failure(e)
            }
        }
    }

    suspend fun stopMatchRecording(
        finalize: Boolean = true,
        reason: String = "stop_recording",
    ): Result<Unit> = withContext(Dispatchers.Main.immediate) {
        cameraMutex.withLock {
            try {
                if (!_recordingState.value.isRecording) return@withLock Result.success(Unit)
                stopCurrentRecordingLocked(
                    isFinal = finalize,
                    reason = reason,
                    resumeAfter = false,
                )
                Result.success(Unit)
            } catch (e: Exception) {
                markRecordingError("Không kết thúc được ghi hình: ${e.message}")
                Result.failure(e)
            }
        }
    }

    suspend fun setRecordingSegmentDurationMs(durationMs: Long): Result<Unit> = withContext(Dispatchers.Main.immediate) {
        cameraMutex.withLock {
            val normalizedDurationMs =
                durationMs.coerceIn(
                    MIN_RECORDING_SEGMENT_DURATION_MS,
                    DEFAULT_RECORDING_SEGMENT_DURATION_MS,
                )
            if (recordingSegmentDurationMs == normalizedDurationMs) {
                return@withLock Result.success(Unit)
            }
            recordingSegmentDurationMs = normalizedDurationMs
            if (_recordingState.value.isRecording) {
                scheduleRecordingRotationLocked()
            }
            Result.success(Unit)
        }
    }

    private fun buildRecordingDir(): File? {
        return runCatching {
            val dir = appContext.getExternalFilesDir(null)?.let { File(it, "recordings-v2") }
                ?: File(appContext.filesDir, "recordings-v2")
            if (!dir.exists()) dir.mkdirs()
            dir
        }.getOrNull()
    }

    private fun buildRecordingSegmentPath(
        matchId: String,
        recordingId: String,
        segmentIndex: Int,
    ): String? {
        val dir = buildRecordingDir() ?: return null
        val safeMatch = matchId.replace(Regex("[^A-Za-z0-9_-]"), "_")
        val safeRecording = recordingId.replace(Regex("[^A-Za-z0-9_-]"), "_")
        val fileName =
            "match_${safeMatch}_rec_${safeRecording}_segment_${segmentIndex.toString().padStart(5, '0')}.mp4"
        return File(dir, fileName).absolutePath
    }

    private fun scheduleRecordingRotationLocked() {
        recordingRotateJob?.cancel()
        recordingRotateJob = scope.launch {
            while (isActive) {
                val delayMs =
                    ((recordingSegmentDurationMs.coerceAtLeast(MIN_RECORDING_SEGMENT_DURATION_MS)) -
                        (System.currentTimeMillis() - recordingSegmentStartedAtMs).coerceAtLeast(0L))
                        .coerceAtLeast(1_000L)
                delay(delayMs)
                cameraMutex.withLock {
                    if (!_recordingState.value.isRecording) return@withLock
                    stopCurrentRecordingLocked(
                        isFinal = false,
                        reason = "segment_rotate",
                        resumeAfter = true,
                    )
                    maybeResumeRecordingAfterBoundaryLocked("segment_rotate")
                }
            }
        }
    }

    private fun markRecordingError(message: String) {
        Log.e(TAG, message)
        _recordingState.value = _recordingState.value.copy(
            errorMessage = message,
            pendingResume = false,
        )
        onRecordingError?.invoke(message)
    }

    private fun emitRecordingSegmentClosed(segment: RecordingSegmentClosed) {
        scope.launch(Dispatchers.IO) {
            runCatching {
                onRecordingSegmentClosed?.invoke(segment)
            }.onFailure {
                Log.e(TAG, "emitRecordingSegmentClosed failed", it)
            }
        }
    }

    private fun clearRecordingStateLocked(errorMessage: String? = null) {
        recordingRotateJob?.cancel()
        recordingRotateJob = null
        activeRecordingMatchId = null
        activeRecordingId = null
        activeRecordingSessionId = null
        recordingPath = null
        recordingSegmentIndex = 0
        recordingSegmentStartedAtMs = 0L
        recordingSegmentDurationMs = DEFAULT_RECORDING_SEGMENT_DURATION_MS
        pendingRecordingResume = null
        _recordingState.value =
            RecordingEngineState(
                isRecording = false,
                errorMessage = errorMessage,
            )
    }

    private fun finalizeRecordingForTeardownLocked(reason: String) {
        when {
            _recordingState.value.isRecording -> {
                stopCurrentRecordingLocked(
                    isFinal = true,
                    reason = reason,
                    resumeAfter = false,
                )
            }
            pendingRecordingResume != null -> {
                clearRecordingStateLocked("Ghi hình đã dừng do $reason.")
            }
        }
    }

    private fun teardownCameraLocked(
        reason: String,
        stopPreview: Boolean,
        clearDesiredState: Boolean,
        finalState: StreamState,
        clearCurrentUrl: Boolean = false,
        restartOnSurface: Boolean = false,
    ) {
        overlayAttachJob?.cancel()
        overlayAttachJob = null
        overlayPostTransitionJob?.cancel()
        overlayPostTransitionJob = null
        overlayRecoveryBurstJob?.cancel()
        overlayRecoveryBurstJob = null

        if (clearDesiredState) {
            desiredStreaming.set(false)
            pendingNetworkReconnect.set(false)
            pendingSurfaceStart.set(false)
            autoPreviewAllowed = false
            if (clearCurrentUrl) {
                currentUrl = null
            }
        } else {
            pendingNetworkReconnect.set(false)
            pendingSurfaceStart.set(restartOnSurface && desiredStreaming.get() && !currentUrl.isNullOrBlank())
        }

        isReconnecting.set(false)
        reconnectAttempt = 0
        connectingAtMs = 0L
        reconnectingAtMs = 0L
        consecutiveLowBitrate = 0
        releaseWakeLock()
        finalizeRecordingForTeardownLocked(reason)

        rtmpCamera?.let { cam ->
            if (cam.isStreaming) {
                // Fix #3: Crashlytics breadcrumb before native stop
                FirebaseCrashlytics.getInstance().log("teardown:stopStream reason=$reason")
                cam.stopStream()
            }
            if (stopPreview && cam.isOnPreview) {
                // Fix #3: Crashlytics breadcrumb before native stop
                FirebaseCrashlytics.getInstance().log("teardown:stopPreview reason=$reason")
                cam.stopPreview()
            }
        }
        if (stopPreview) {
            resetOverlayFiltersLocked(clearGlFilters = true)
            rtmpCamera = null
        }

        val previewActive = !stopPreview && rtmpCamera?.isOnPreview == true
        _previewReady.value = previewActive
        _state.value = if (previewActive) StreamState.Previewing else finalState
    }

    private fun stopCurrentRecordingLocked(
        isFinal: Boolean,
        reason: String,
        resumeAfter: Boolean,
    ) {
        if (!_recordingState.value.isRecording) return
        val cam = rtmpCamera ?: run {
            clearRecordingStateLocked("Camera không còn sẵn khi dừng ghi hình.")
            return
        }

        val matchId = activeRecordingMatchId ?: ""
        val recordingId = activeRecordingId ?: ""
        val recordingSessionId = activeRecordingSessionId ?: ""
        val path = recordingPath
        val index = recordingSegmentIndex
        val startedAt = recordingSegmentStartedAtMs
        val now = System.currentTimeMillis()

        // Fix #3: Crashlytics breadcrumb before native stop record
        FirebaseCrashlytics.getInstance().log("stopRecord: reason=$reason isFinal=$isFinal")
        runCatching { cam.stopRecord() }.onFailure {
            Log.e(TAG, "stopRecord failed", it)
        }

        if (!path.isNullOrBlank() && matchId.isNotBlank() && recordingId.isNotBlank() && recordingSessionId.isNotBlank()) {
            val file = File(path)
            emitRecordingSegmentClosed(
                RecordingSegmentClosed(
                    matchId = matchId,
                    recordingId = recordingId,
                    recordingSessionId = recordingSessionId,
                    path = path,
                    segmentIndex = index,
                    durationSeconds = ((now - startedAt).coerceAtLeast(0L) / 1000.0),
                    sizeBytes = file.takeIf { it.exists() }?.length() ?: 0L,
                    isFinal = isFinal,
                    boundaryReason = reason,
                )
            )
        }

        if (resumeAfter && matchId.isNotBlank() && recordingId.isNotBlank() && recordingSessionId.isNotBlank()) {
            pendingRecordingResume =
                PendingRecordingResume(
                    matchId = matchId,
                    recordingId = recordingId,
                    recordingSessionId = recordingSessionId,
                    nextSegmentIndex = index + 1,
                    boundaryReason = reason,
                )
            _recordingState.value =
                _recordingState.value.copy(
                    isRecording = false,
                    pendingResume = true,
                    boundaryReason = reason,
                )
            activeRecordingMatchId = null
            activeRecordingId = null
            activeRecordingSessionId = null
            recordingPath = null
            recordingSegmentIndex = 0
            recordingSegmentStartedAtMs = 0L
        } else {
            clearRecordingStateLocked()
        }
    }

    private fun maybeResumeRecordingAfterBoundaryLocked(reason: String) {
        val pending = pendingRecordingResume ?: return
        val cam = rtmpCamera ?: return
        if (!cam.isOnPreview) return

        val nextPath =
            buildRecordingSegmentPath(
                matchId = pending.matchId,
                recordingId = pending.recordingId,
                segmentIndex = pending.nextSegmentIndex,
            ) ?: run {
                markRecordingError("Không tạo được segment mới sau khi đồng bộ lại encoder.")
                pendingRecordingResume = null
                return
            }

        runCatching { cam.startRecord(nextPath) }.onFailure {
            markRecordingError("Không resume được ghi hình sau khi đồng bộ encoder: ${it.message}")
            pendingRecordingResume = null
        }.onSuccess {
            activeRecordingMatchId = pending.matchId
            activeRecordingId = pending.recordingId
            activeRecordingSessionId = pending.recordingSessionId
            recordingPath = nextPath
            recordingSegmentIndex = pending.nextSegmentIndex
            recordingSegmentStartedAtMs = System.currentTimeMillis()
            pendingRecordingResume = null
            _recordingState.value =
                RecordingEngineState(
                    isRecording = true,
                    matchId = activeRecordingMatchId,
                    recordingId = activeRecordingId,
                    recordingSessionId = activeRecordingSessionId,
                    segmentIndex = recordingSegmentIndex,
                    segmentStartedAtMs = recordingSegmentStartedAtMs,
                    pendingResume = false,
                    boundaryReason = reason,
                )
            scheduleRecordingRotationLocked()
        }
    }

    private fun pauseRecordingForBoundaryLocked(reason: String) {
        if (!_recordingState.value.isRecording) return
        stopCurrentRecordingLocked(
            isFinal = false,
            reason = reason,
            resumeAfter = true,
        )
    }

    suspend fun handleBackgroundExit(clearCurrentUrl: Boolean = true) = withContext(Dispatchers.Main.immediate) {
        teardownInProgress = true
        cameraMutex.withLock {
            try {
                isLifecycleForeground = false
                teardownCameraLocked(
                    reason = "background_exit",
                    stopPreview = true,
                    clearDesiredState = true,
                    clearCurrentUrl = clearCurrentUrl,
                    finalState = StreamState.Idle,
                )
            } catch (e: Exception) {
                Log.e(TAG, "Background exit cleanup error (non-fatal)", e)
                isLifecycleForeground = false
                desiredStreaming.set(false)
                pendingNetworkReconnect.set(false)
                pendingSurfaceStart.set(false)
                autoPreviewAllowed = false
                if (clearCurrentUrl) {
                    currentUrl = null
                }
                _previewReady.value = false
                _state.value = StreamState.Idle
            } finally {
                teardownInProgress = false
            }
        }
    }

    // ==================== Camera Controls ====================

    fun updateOverlayBitmap(bitmap: android.graphics.Bitmap) {
        if (isReleased) return
        if (bitmap.isRecycled) return
        val copy = normalizeBitmapForGl(bitmap) ?: return

        scope.launch {
            cameraMutex.withLock {
                if (isReleased) {
                    recycleBitmapNow(copy)
                    return@withLock
                }

                val previous = overlayBitmap
                overlayBitmap = copy
                scheduleBitmapRecycle(previous)

                val filter = overlayFilter
                val cam = rtmpCamera
                val canApplyDirectly = canApplyOverlayBitmapLocked(cam)
                if (filter != null && cam != null && overlayFilterOwner === cam && canApplyDirectly) {
                    if (applyOverlayBitmapToFilterLocked(filter, copy)) {
                        markOverlayAttached("bitmap_refresh")
                    } else {
                        markOverlayIssue("Không cập nhật được bitmap overlay vào encoder.")
                        resetOverlayFiltersLocked(clearGlFilters = false)
                        setupOverlayFilterIfPossible(forceRecreate = false, reason = "bitmap_refresh_retry")
                    }
                } else if (cam != null && (cam.isOnPreview || cam.isStreaming)) {
                    markOverlayIssue("Overlay bitmap đã có nhưng filter GL chưa sẵn.")
                    setupOverlayFilterIfPossible(forceRecreate = false, reason = "bitmap_update")
                }
            }
        }
    }

    fun nudgeOverlayFromFreshData(reason: String = "payload_refresh") {
        if (isReleased) return
        val now = System.currentTimeMillis()
        if (now - lastOverlayPayloadNudgeAtMs < 5_000L) return
        lastOverlayPayloadNudgeAtMs = now

        scope.launch {
            val decision =
                cameraMutex.withLock {
                    if (isReleased || !isSurfaceValid) return@withLock null
                    val cam = rtmpCamera ?: return@withLock null
                    val active = cam.isOnPreview || cam.isStreaming
                    val hasBitmap = overlayBitmap?.isRecycled == false
                    if (!active || !hasBitmap) return@withLock null
                    if (overlayAttachJob?.isActive == true) return@withLock Pair(false, false)

                    val health = _overlayHealth.value
                    val hasFilterForCamera = overlayFilter != null && overlayFilterOwner === cam

                    // Fix: If overlay is attached and healthy, skip entirely to prevent flicker.
                    // Only intervene when the filter is actually missing or detached.
                    if (hasFilterForCamera && health.attached && !health.reattaching) {
                        return@withLock null
                    }

                    val forceRecreate = !hasFilterForCamera
                    val shouldEnsure =
                        forceRecreate ||
                            !health.attached ||
                            health.reattaching
                    shouldEnsure to forceRecreate
                } ?: return@launch

            val shouldEnsure = decision.first
            val forceRecreate = decision.second
            if (!shouldEnsure) return@launch
            if (forceRecreate) {
                logOverlayForceRebind(reason, now)
            }
            setupOverlayFilterIfPossible(
                forceRecreate = forceRecreate,
                reason = reason,
            )
        }
    }

    private fun overlayLastIssueAgeMs(now: Long, health: OverlayHealth = _overlayHealth.value): Long =
        if (health.lastIssueAtMs > 0L) {
            (now - health.lastIssueAtMs).coerceAtLeast(0L)
        } else {
            -1L
        }

    private fun wasOverlayAttachedRecently(now: Long): Boolean =
        lastOverlayAttachedAtMs > 0L && now - lastOverlayAttachedAtMs <= OVERLAY_ATTACHED_STABLE_COOLDOWN_MS

    private fun logOverlayAttachStarted(
        reason: String,
        forceRecreate: Boolean,
        now: Long,
        health: OverlayHealth = _overlayHealth.value,
    ) {
        Log.d(
            TAG,
            "overlay_attach_started reason=$reason forceRecreate=$forceRecreate " +
                "attached=${health.attached} reattaching=${health.reattaching} " +
                "lastIssueAgeMs=${overlayLastIssueAgeMs(now, health)}",
        )
    }

    private fun logOverlayForceRebind(
        reason: String,
        now: Long,
        health: OverlayHealth = _overlayHealth.value,
    ) {
        Log.d(
            TAG,
            "overlay_force_rebind reason=$reason attached=${health.attached} " +
                "reattaching=${health.reattaching} lastIssueAgeMs=${overlayLastIssueAgeMs(now, health)}",
        )
    }

    private fun logOverlayRebindSkippedStable(
        reason: String,
        now: Long,
        attachInFlight: Boolean,
        health: OverlayHealth = _overlayHealth.value,
    ) {
        Log.d(
            TAG,
            "overlay_rebind_skipped_stable reason=$reason attachInFlight=$attachInFlight " +
                "attached=${health.attached} reattaching=${health.reattaching} " +
                "lastIssueAgeMs=${overlayLastIssueAgeMs(now, health)}",
        )
    }

    private fun setupOverlayFilterIfPossible(
        forceRecreate: Boolean = false,
        reason: String = "unknown",
    ) {
        if (isReleased) return
        val now = System.currentTimeMillis()
        val attachInFlight = overlayAttachJob?.isActive == true
        if (attachInFlight && !forceRecreate) {
            logOverlayRebindSkippedStable(reason, now, attachInFlight = true)
            return
        }
        lastOverlayEnsureAtMs = now
        logOverlayAttachStarted(reason, forceRecreate, now)
        overlayAttachJob?.cancel()
        overlayAttachJob = scope.launch {
            val shouldMarkReattaching = cameraMutex.withLock {
                forceRecreate || overlayFilter == null || !_overlayHealth.value.attached
            }
            if (shouldMarkReattaching) {
                markOverlayReattaching(reason)
            }
            repeat(OVERLAY_ATTACH_RETRY_COUNT) { attempt ->
                val attachResult = cameraMutex.withLock {
                    tryAttachOverlayFilterLocked(forceRecreate = forceRecreate || attempt > 0)
                }
                when (attachResult) {
                    OverlayAttachResult.READY -> {
                        Log.d(TAG, "Overlay filter ready: $reason (attempt ${attempt + 1})")
                        markOverlayAttached(reason)
                        return@launch
                    }
                    OverlayAttachResult.FILTER_ARMED -> {
                        Log.d(TAG, "Overlay filter armed, waiting for bitmap: $reason")
                        return@launch
                    }
                    OverlayAttachResult.FAILED -> Unit
                }
                delay(OVERLAY_ATTACH_RETRY_DELAY_MS)
            }
            Log.w(TAG, "Overlay filter not ready after retries: $reason")
            markOverlayIssue("Overlay bị rơi khỏi encoder trong lúc `$reason`.")
        }
    }

    private fun scheduleOverlayRecoveryBurst(reason: String) {
        if (isReleased) return
        val now = System.currentTimeMillis()
        if (now - lastOverlayRecoveryBurstAtMs < OVERLAY_RECOVERY_BURST_COOLDOWN_MS) return
        lastOverlayRecoveryBurstAtMs = now

        overlayRecoveryBurstJob?.cancel()
        overlayRecoveryBurstJob = scope.launch {
            listOf(180L, 420L, 900L).forEachIndexed { index, delayMs ->
                delay(delayMs)
                val reasonWithAttempt = "${reason}_burst_${index + 1}"
                val decision = cameraMutex.withLock {
                    if (isReleased || !isSurfaceValid) return@withLock "stop"
                    val cam = rtmpCamera ?: return@withLock "stop"
                    val active = cam.isOnPreview || cam.isStreaming
                    val hasBitmap = overlayBitmap?.isRecycled == false
                    val health = _overlayHealth.value
                    val nowMs = System.currentTimeMillis()
                    when {
                        !active || !hasBitmap -> "stop"
                        health.attached || wasOverlayAttachedRecently(nowMs) -> "stable"
                        overlayAttachJob?.isActive == true -> "in_flight"
                        else -> "attempt"
                    }
                }
                when (decision) {
                    "attempt" -> Unit
                    "in_flight" -> {
                        logOverlayRebindSkippedStable(
                            reasonWithAttempt,
                            System.currentTimeMillis(),
                            attachInFlight = true,
                        )
                        return@forEachIndexed
                    }
                    else -> {
                        logOverlayRebindSkippedStable(
                            reasonWithAttempt,
                            System.currentTimeMillis(),
                            attachInFlight = false,
                        )
                        return@launch
                    }
                }
                setupOverlayFilterIfPossible(
                    forceRecreate = true,
                    reason = reasonWithAttempt,
                )
            }
        }
    }

    private fun tryAttachOverlayFilterLocked(forceRecreate: Boolean): OverlayAttachResult {
        if (isReleased) return OverlayAttachResult.FAILED
        val cam = rtmpCamera ?: return OverlayAttachResult.FAILED
        if (!cam.isOnPreview && !cam.isStreaming) return OverlayAttachResult.FAILED
        val gl = runCatching { cam.glInterface }.getOrNull() ?: return OverlayAttachResult.FAILED
        if (!gl.isRunning()) return OverlayAttachResult.FAILED

        if (forceRecreate) {
            resetOverlayFiltersLocked(clearGlFilters = false)
        }

        if (overlayFilter == null || overlayFilterOwner !== cam) {
            val f = ImageObjectFilterRender()
            val attached = runCatching {
                // Hardening: double-check GL is still running right before native call
                // to minimize SIGSEGV risk if GL thread died between checks
                if (!gl.isRunning()) {
                    Log.w(TAG, "GL stopped between check and setFilter — aborting")
                    return OverlayAttachResult.FAILED
                }
                FirebaseCrashlytics.getInstance().log("setFilter: cam=${cam.hashCode()} gl_running=true")
                gl.setFilter(f)
                true
            }.getOrElse {
                Log.e(TAG, "Failed to attach overlay filter (non-fatal)", it)
                runCatching { FirebaseCrashlytics.getInstance().recordException(it) }
                false
            }
            if (!attached) return OverlayAttachResult.FAILED
            overlayFilter = f
            overlayFilterOwner = cam
            Log.d(TAG, "Overlay filter attached")
        }

        val filter = overlayFilter ?: return OverlayAttachResult.FAILED
        runCatching {
            filter.setPosition(TranslateTo.TOP_LEFT)
            filter.setScale(100f, 100f)
            filter.setPosition(0f, 0f)
            filter.setAlpha(1f)
            val bmp = overlayBitmap
            if (bmp != null && !bmp.isRecycled) {
                filter.setImage(bmp)
                return OverlayAttachResult.READY
            }
        }.onFailure {
            Log.e(TAG, "Overlay filter refresh failed (non-fatal)", it)
            markOverlayIssue("Không làm mới được filter overlay trên encoder.")
            return OverlayAttachResult.FAILED
        }
        return OverlayAttachResult.FILTER_ARMED
    }

    private fun applyOverlayBitmapToFilterLocked(
        filter: ImageObjectFilterRender,
        bitmap: Bitmap,
    ): Boolean {
        // Fix #6: Double-check bitmap isn't recycled right before GL access
        if (bitmap.isRecycled) {
            Log.w(TAG, "applyOverlayBitmapToFilterLocked: bitmap already recycled, skip")
            runCatching {
                FirebaseCrashlytics.getInstance().log("GL bitmap was recycled before setImage")
            }
            return false
        }
        return runCatching {
            filter.setImage(bitmap)
            filter.setScale(100f, 100f)
            filter.setPosition(0f, 0f)
            filter.setAlpha(1f)
            true
        }.getOrElse {
            Log.e(TAG, "Overlay bitmap apply failed (non-fatal)", it)
            // Fix #3: Log to Crashlytics for tracking
            runCatching {
                FirebaseCrashlytics.getInstance().recordException(it)
            }
            false
        }
    }

    private fun resetOverlayFiltersLocked(clearGlFilters: Boolean = false) {
        val gl = runCatching { (overlayFilterOwner ?: rtmpCamera)?.glInterface }.getOrNull()
        if (clearGlFilters && gl != null && runCatching { gl.isRunning() }.getOrDefault(false)) {
            runCatching { gl.clearFilters() }
                .onFailure { Log.w(TAG, "clear overlay filters failed", it) }
        }
        overlayFilter = null
        overlayFilterOwner = null
        webLogoFilter = null
        sponsorFilter = null
    }

    private fun scheduleOverlayRebindAfterPreview(
        quality: Quality,
        reason: String,
    ) {
        overlayPostTransitionJob?.cancel()
        overlayPostTransitionJob = scope.launch {
            val delays = if (quality.fps >= 30) listOf(450L) else listOf(450L, 1100L)
            delays.forEachIndexed { index, delayMs ->
                delay(delayMs)
                if (isReleased) return@launch
                val nextAction = cameraMutex.withLock {
                    val cam = rtmpCamera
                    val hasOverlayBitmap = overlayBitmap?.isRecycled == false
                    val active = cam != null && (cam.isOnPreview || cam.isStreaming) && hasOverlayBitmap
                    if (!active) return@withLock null
                    val hasFilterForCamera = overlayFilter != null && overlayFilterOwner === cam
                    val forceRecreate = !hasFilterForCamera
                    forceRecreate
                } ?: return@forEachIndexed
                Log.d(TAG, "Post-transition overlay sync for ${quality.label}: $reason (#${index + 1})")
                setupOverlayFilterIfPossible(
                    forceRecreate = nextAction,
                    reason = if (nextAction) "${reason}_stabilize" else "${reason}_refresh",
                )
            }
        }
    }

    private fun markOverlayAttached(reason: String) {
        val now = System.currentTimeMillis()
        lastOverlayAttachedAtMs = now
        overlayRecoveryBurstJob?.cancel()
        _overlayHealth.value = _overlayHealth.value.copy(
            attached = true,
            reattaching = false,
            lastAttachedAtMs = now,
            lastIssue = null,
            lastIssueAtMs = 0L,
            lastEvent = reason,
        )
        Log.d(TAG, "overlay_attach_succeeded reason=$reason")
        if (_recoveryState.value.stage == RecoveryStage.OVERLAY_REBUILD) {
            clearRecoveryState()
        }
    }

    private fun markOverlayReattaching(reason: String) {
        Log.d(TAG, "overlay_attach_started reason=$reason phase=reattach")
        _overlayHealth.value = _overlayHealth.value.copy(
            attached = false,
            reattaching = true,
            lastEvent = reason,
        )
        updateRecoveryState(
            stage = RecoveryStage.OVERLAY_REBUILD,
            severity = RecoverySeverity.INFO,
            summary = "Overlay đang được gắn lại vào encoder.",
            detail = "App đang dựng lại filter overlay để scoreboard/logo quay lại mà không phải cắt phiên live.",
            activeMitigations = listOf(
                "Gắn lại overlay filter",
                "Giữ RTMP đang chạy",
                "Giữ match hiện tại",
            ),
            lastFatalReason = reason,
        )
    }

    private fun markOverlayIssue(reason: String) {
        val now = System.currentTimeMillis()
        _overlayHealth.value = _overlayHealth.value.copy(
            attached = false,
            reattaching = false,
            lastIssue = reason,
            lastIssueAtMs = now,
            lastEvent = reason,
        )
        updateRecoveryState(
            stage = RecoveryStage.OVERLAY_REBUILD,
            severity = RecoverySeverity.WARNING,
            summary = "Overlay vừa rơi khỏi encoder, app đang tự gắn lại.",
            detail = "Luồng live vẫn được giữ. App sẽ burst nhiều nhịp rebind để kéo scoreboard/logo trở lại.",
            activeMitigations = listOf(
                "Burst rebind overlay",
                "Giữ RTMP đang chạy",
                "Giữ camera/encoder",
            ),
            lastFatalReason = reason,
        )
        scheduleOverlayRecoveryBurst(reason)
    }

    private fun normalizeBitmapForGl(source: Bitmap): Bitmap? {
        if (source.isRecycled || source.width <= 0 || source.height <= 0) return null
        return try {
            // Hardening: cap bitmap dimensions to encoder size to prevent OOM
            // from unexpectedly large bitmaps (e.g. if OverlayBitmapRenderer
            // produces an oversized frame due to a stale outputSize).
            val maxW = (encoderWidth.takeIf { it > 0 } ?: 1920).coerceAtMost(1920)
            val maxH = (encoderHeight.takeIf { it > 0 } ?: 1080).coerceAtMost(1080)
            val srcW = source.width
            val srcH = source.height
            val needsDownscale = srcW > maxW || srcH > maxH
            val (targetW, targetH) = if (needsDownscale) {
                val scale = minOf(maxW.toFloat() / srcW, maxH.toFloat() / srcH)
                ((srcW * scale).toInt().coerceAtLeast(1)) to ((srcH * scale).toInt().coerceAtLeast(1))
            } else {
                srcW to srcH
            }

            val output = Bitmap.createBitmap(targetW, targetH, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(output)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                isFilterBitmap = true
                isDither = true
            }
            if (needsDownscale) {
                val matrix = android.graphics.Matrix().apply {
                    setScale(targetW.toFloat() / srcW, targetH.toFloat() / srcH)
                }
                canvas.drawBitmap(source, matrix, paint)
            } else {
                canvas.drawBitmap(source, 0f, 0f, paint)
            }
            output
        } catch (oom: OutOfMemoryError) {
            Log.e(TAG, "Overlay bitmap normalize OOM ${source.width}x${source.height}", oom)
            runCatching {
                FirebaseCrashlytics.getInstance().apply {
                    setCustomKey("oom_context", "normalizeBitmapForGl")
                    setCustomKey("bitmap_size", "${source.width}x${source.height}")
                    recordException(oom)
                }
            }
            null
        } catch (e: Exception) {
            Log.e(TAG, "Overlay bitmap normalize failed (non-fatal)", e)
            null
        }
    }

    private fun scheduleBitmapRecycle(bitmap: Bitmap?) {
        if (bitmap == null) return
        scope.launch(Dispatchers.Default) {
            delay(BITMAP_SAFE_RECYCLE_DELAY_MS)
            cameraMutex.withLock {
                if (bitmap === overlayBitmap) {
                    return@withLock
                }
            }
            recycleBitmapNow(bitmap)
        }
    }

    private fun recycleBitmapNow(bitmap: Bitmap?) {
        if (bitmap == null || bitmap.isRecycled) return
        runCatching { bitmap.recycle() }
    }

    private fun prepareVideo(cam: RtmpCamera2, quality: Quality): Boolean {
        val portrait = isPortrait()
        val w = if (portrait) quality.height else quality.width
        val h = if (portrait) quality.width else quality.height
        val rotation = if (portrait) 90 else 0

        lastPreparedOrientation = if (portrait) Configuration.ORIENTATION_PORTRAIT else Configuration.ORIENTATION_LANDSCAPE
        encoderWidth = w
        encoderHeight = h
        _encoderSize.value = EncoderSurfaceSize(width = w, height = h)

        resetOverlayFiltersLocked(clearGlFilters = false)
        runCatching { cam.glInterface.setEncoderSize(w, h) }

        return runCatching { cam.prepareVideo(w, h, quality.fps, quality.bitrate, 2, rotation) }.getOrDefault(false)
    }

    private fun prepareStreamPipelineLocked(
        cam: RtmpCamera2,
        quality: Quality,
        reason: String,
    ): Boolean {
        if (!canRunForegroundCameraWorkLocked()) return false
        if (!isSurfaceValid || surfaceView == null) return false

        val audioPrepared = runCatching { cam.prepareAudio(128_000, 44100, true) }.getOrDefault(false)
        val videoPrepared = prepareVideo(cam, quality)
        if (!audioPrepared || !videoPrepared) return false

        if (!cam.isOnPreview) {
            cam.startPreview(currentFacing)
            _previewReady.value = true
        }

        setupOverlayFilterIfPossible(forceRecreate = true, reason = reason)
        scheduleOverlayRebindAfterPreview(quality, reason = reason)
        return true
    }

    private fun canRunForegroundCameraWorkLocked(): Boolean {
        return !isReleased && !teardownInProgress && isLifecycleForeground
    }

    private fun canResumeStreamingLocked(expectedUrl: String? = null): Boolean {
        if (!canRunForegroundCameraWorkLocked()) return false
        if (!desiredStreaming.get() || !networkAvailable || !isSurfaceValid) return false
        val activeUrl = currentUrl?.takeIf { it.isNotBlank() } ?: return false
        return expectedUrl.isNullOrBlank() || activeUrl == expectedUrl
    }

    private fun canApplyOverlayBitmapLocked(cam: RtmpCamera2?): Boolean {
        if (isReleased || cam == null) return false
        val state = _state.value
        if (state is StreamState.Connecting || state is StreamState.Reconnecting) return false
        val gl = runCatching { cam.glInterface }.getOrNull() ?: return false
        return gl.isRunning() && (cam.isOnPreview || cam.isStreaming)
    }

    private fun isPortrait(): Boolean {
        val surface = surfaceView ?: return true
        return surface.resources.configuration.orientation == Configuration.ORIENTATION_PORTRAIT
    }

    fun toggleTorch() {
        if (isReleased) return
        scope.launch {
            cameraMutex.withLock {
                if (isReleased) return@withLock
                try {
                    val s = _state.value
                    if (s is StreamState.Connecting || s is StreamState.Reconnecting) return@withLock
                    if (_isFrontCamera.value) return@withLock
                    val cam = rtmpCamera ?: return@withLock
                    if (!cam.isOnPreview) return@withLock
                    if (cam.isLanternEnabled) {
                        cam.disableLantern()
                        _torchOn.value = false
                    } else {
                        cam.enableLantern()
                        _torchOn.value = true
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Torch toggle error", e)
                }
            }
        }
    }

    fun toggleMic() {
        if (isReleased) return
        scope.launch {
            cameraMutex.withLock {
                if (isReleased) return@withLock
                try {
                    val s = _state.value
                    if (s is StreamState.Connecting || s is StreamState.Reconnecting) return@withLock
                    val cam = rtmpCamera ?: return@withLock
                    if (!cam.isOnPreview) return@withLock
                    if (!hasCameraAndMicPermission()) return@withLock
                    if (_micMuted.value) {
                        cam.enableAudio()
                        _micMuted.value = false
                    } else {
                        cam.disableAudio()
                        _micMuted.value = true
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Mic toggle error", e)
                }
            }
        }
    }

    fun switchCamera() {
        if (isReleased) return
        scope.launch {
            cameraMutex.withLock {
                if (isReleased) return@withLock
                try {
                    val s = _state.value
                    if (s is StreamState.Connecting || s is StreamState.Reconnecting) return@withLock
                    val cam = rtmpCamera ?: return@withLock
                    if (!cam.isOnPreview) return@withLock
                    if (cam.isStreaming) return@withLock
                    cam.switchCamera()
                    _isFrontCamera.value = !_isFrontCamera.value
                    currentFacing = if (_isFrontCamera.value) CameraHelper.Facing.FRONT else CameraHelper.Facing.BACK
                    _torchOn.value = false
                    Log.d(TAG, "Camera switched to ${if (_isFrontCamera.value) "front" else "back"}")
                } catch (e: Exception) {
                    Log.e(TAG, "Switch camera error", e)
                }
            }
        }
    }

    fun setZoom(level: Float) {
        if (isReleased) return
        val clamped = level.coerceIn(0.1f, 10f)
        scope.launch {
            cameraMutex.withLock {
                if (isReleased) return@withLock
                try {
                    val cam = rtmpCamera
                    if (cam?.isOnPreview == true) {
                        cam.setZoom(clamped)
                    }
                    _zoomLevel.value = clamped
                } catch (e: Exception) {
                    Log.e(TAG, "Set zoom error", e)
                }
            }
        }
    }

    fun clearRtmpDiagnostics() {
        if (isReleased) return
        scope.launch {
            cameraMutex.withLock {
                if (isReleased) return@withLock
                _rtmpLastMessage.value = null
                if (!desiredStreaming.get() && rtmpCamera?.isStreaming != true) {
                    pendingNetworkReconnect.set(false)
                    isReconnecting.set(false)
                    reconnectAttempt = 0
                    connectingAtMs = 0L
                    reconnectingAtMs = 0L
                    when (_state.value) {
                        is StreamState.Connecting,
                        is StreamState.Reconnecting,
                        is StreamState.Error,
                        -> {
                            _state.value =
                                if (rtmpCamera?.isOnPreview == true) {
                                    StreamState.Previewing
                                } else {
                                    StreamState.Stopped
                                }
                            clearRecoveryState()
                        }

                        else -> Unit
                    }
                }
            }
        }
    }

    fun changeQuality(quality: Quality) {
        currentQuality = quality
        scope.launch {
            cameraMutex.withLock {
                try {
                    if (!canRunForegroundCameraWorkLocked()) return@withLock
                    val shouldResumeStream = desiredStreaming.get()
                    val resumeUrl = currentUrl?.takeIf { it.isNotBlank() }
                    val s = _state.value
                    if (s is StreamState.Connecting || s is StreamState.Reconnecting) return@withLock
                    if (!networkAvailable && shouldResumeStream) {
                        pendingNetworkReconnect.set(true)
                        _state.value = StreamState.Error("Mất kết nối mạng", recoverable = true)
                        return@withLock
                    }
                    if (!isSurfaceValid) {
                        Log.w(TAG, "changeQuality: surface not valid")
                        return@withLock
                    }
                    if (_recordingState.value.isRecording || pendingRecordingResume != null) {
                        pauseRecordingForBoundaryLocked("change_quality")
                    }
                    rtmpCamera?.let { cam ->
                        if (cam.isStreaming) cam.stopStream()
                        if (cam.isOnPreview) cam.stopPreview()
                    }
                    _previewReady.value = false

                    delay(300) // Wait for cleanup

                    if (!canRunForegroundCameraWorkLocked()) {
                        releaseWakeLock()
                        return@withLock
                    }

                    val cam = ensureCameraInitialized() ?: run {
                        _state.value = StreamState.Error("Camera not ready", recoverable = true)
                        releaseWakeLock()
                        return@withLock
                    }

                    val audioPrepared = runCatching { cam.prepareAudio(128_000, 44100, true) }.getOrDefault(false)
                    val videoPrepared = prepareVideo(cam, quality)
                    if (!audioPrepared || !videoPrepared) {
                        _state.value = StreamState.Error("Không thể chuẩn bị encoder", recoverable = true)
                        releaseWakeLock()
                        return@withLock
                    }

                    if (!canRunForegroundCameraWorkLocked()) {
                        releaseWakeLock()
                        return@withLock
                    }

                    cam.startPreview(currentFacing)
                    setupOverlayFilterIfPossible(forceRecreate = true, reason = "change_quality")
                    scheduleOverlayRebindAfterPreview(quality, reason = "change_quality")
                    _previewReady.value = true
                    _state.value = StreamState.Previewing
                    maybeResumeRecordingAfterBoundaryLocked("change_quality")

                    if (shouldResumeStream && canResumeStreamingLocked(resumeUrl)) {
                        val streamUrl = resumeUrl ?: return@withLock
                        delay(500)
                        if (!canResumeStreamingLocked(resumeUrl)) {
                            releaseWakeLock()
                            return@withLock
                        }
                        acquireWakeLock()
                        runCatching { cam.startStream(streamUrl) }.onFailure {
                            releaseWakeLock()
                            _state.value = StreamState.Error("Không thể bắt đầu stream", recoverable = true)
                        }
                    }

                    if (!shouldResumeStream && (
                            _recoveryState.value.stage == RecoveryStage.DEGRADED ||
                                _recoveryState.value.stage == RecoveryStage.CAMERA_REBUILD
                            )
                    ) {
                        clearRecoveryState()
                    }
                    Log.d(TAG, "Quality changed to ${quality.label}")
                } catch (e: Exception) {
                    Log.e(TAG, "Quality change error", e)
                    releaseWakeLock()
                }
            }
        }
    }

    fun onDeviceOrientationChanged(orientation: Int) {
        if (isReleased) return
        if (!isLifecycleForeground) return
        if (orientation != Configuration.ORIENTATION_PORTRAIT && orientation != Configuration.ORIENTATION_LANDSCAPE) return
        if (orientation == lastPreparedOrientation) return

        orientationReconfigureJob?.cancel()
        orientationReconfigureJob = scope.launch {
            delay(ORIENTATION_RECONFIGURE_DELAY_MS)

            val shouldReconfigure = cameraMutex.withLock {
                if (isReleased || !isSurfaceValid) return@withLock false
                if (orientation == lastPreparedOrientation) return@withLock false
                val state = _state.value
                if (state is StreamState.Connecting || state is StreamState.Reconnecting) return@withLock false
                val cam = rtmpCamera ?: return@withLock false
                cam.isOnPreview || desiredStreaming.get()
            }

            if (shouldReconfigure) {
                Log.d(TAG, "Orientation changed -> reconfiguring preview/stream")
                changeQuality(currentQuality)
            }
        }
    }

    // ==================== Memory Pressure ====================

    /**
     * Called from App.onTrimMemory() when system is under memory pressure.
     * Reduces quality to free memory and prevent OOM crash.
     */
    fun onMemoryPressure(level: Int) {
        Log.w(TAG, "Memory pressure level: $level")
        if (!isLifecycleForeground) return
        if (level >= android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) {
            _lastMemoryPressure.value = MemoryPressureEvent(level = level, atMs = System.currentTimeMillis())
            val shouldReconfigureNow =
                desiredStreaming.get() ||
                    _recordingState.value.isRecording ||
                    pendingRecordingResume != null
            if (!shouldReconfigureNow) {
                Log.w(TAG, "Ignoring preview-only memory pressure downgrade to avoid camera teardown race")
                return
            }
            Log.w(TAG, "Applying recovery degrade due to memory pressure")
            degradeForRecovery(
                reason = "memory_pressure_level_$level",
                preferLowest = true,
                consumeBudget = false,
            )
        }
    }

    // ==================== Auto Network Quality ====================

    private var consecutiveLowBitrate = 0

    private fun autoQualityGraceMs(): Long =
        if (isProbablyEmulator) EMULATOR_AUTO_QUALITY_LIVE_GRACE_MS else AUTO_QUALITY_LIVE_GRACE_MS

    private fun autoQualityCooldownMs(): Long =
        if (isProbablyEmulator) EMULATOR_AUTO_QUALITY_COOLDOWN_MS else AUTO_QUALITY_COOLDOWN_MS

    private fun lowBitrateReadingsRequired(): Int =
        if (isProbablyEmulator) EMULATOR_AUTO_QUALITY_CONSECUTIVE_LOW_READINGS else AUTO_QUALITY_CONSECUTIVE_LOW_READINGS

    private fun lowBitrateThreshold(targetBitrate: Long): Long =
        if (isProbablyEmulator) {
            (targetBitrate / 3).coerceAtLeast(450_000L)
        } else {
            ((targetBitrate * 2) / 5).coerceAtLeast(600_000L)
        }

    private fun liveBitrateStallRestartMs(): Long =
        if (isProbablyEmulator) EMULATOR_LIVE_BITRATE_STALL_RESTART_MS else LIVE_BITRATE_STALL_RESTART_MS

    private fun resetRecoveryBudgetIfNeeded(now: Long = System.currentTimeMillis()) {
        val windowExpired =
            recoveryBudgetWindowStartMs > 0L &&
                now - recoveryBudgetWindowStartMs > RECOVERY_BUDGET_WINDOW_MS
        val stableLongEnough =
            lastLiveBecameStableAtMs > 0L &&
                now - lastLiveBecameStableAtMs >= RECOVERY_RESET_AFTER_STABLE_MS
        if (windowExpired || stableLongEnough) {
            recoveryBudgetWindowStartMs = 0L
            recoveryAttemptsInWindow = 0
        }
    }

    private fun currentRecoveryAttempt(now: Long = System.currentTimeMillis()): Int {
        resetRecoveryBudgetIfNeeded(now)
        return recoveryAttemptsInWindow
    }

    private fun currentRecoveryBudgetRemaining(now: Long = System.currentTimeMillis()): Int {
        resetRecoveryBudgetIfNeeded(now)
        return (MAX_RECOVERY_ATTEMPTS_IN_WINDOW - recoveryAttemptsInWindow).coerceAtLeast(0)
    }

    private fun consumeRecoveryBudget(now: Long = System.currentTimeMillis()): Pair<Int, Int> {
        resetRecoveryBudgetIfNeeded(now)
        if (recoveryBudgetWindowStartMs == 0L) {
            recoveryBudgetWindowStartMs = now
        }
        recoveryAttemptsInWindow = (recoveryAttemptsInWindow + 1).coerceAtMost(MAX_RECOVERY_ATTEMPTS_IN_WINDOW)
        return recoveryAttemptsInWindow to currentRecoveryBudgetRemaining(now)
    }

    private fun updateRecoveryState(
        stage: RecoveryStage,
        severity: RecoverySeverity,
        summary: String,
        detail: String? = null,
        consumeBudget: Boolean = false,
        activeMitigations: List<String> = emptyList(),
        lastFatalReason: String? = null,
    ) {
        val now = System.currentTimeMillis()
        if (stage == RecoveryStage.IDLE) {
            _recoveryState.value = StreamRecoveryState()
            return
        }
        val current = _recoveryState.value
        if (
            current.stage == stage &&
            current.summary == summary &&
            !consumeBudget &&
            now - current.atMs < 1_500L
        ) {
            return
        }

        val (attempt, budgetRemaining) =
            if (consumeBudget) {
                consumeRecoveryBudget(now)
            } else {
                currentRecoveryAttempt(now) to currentRecoveryBudgetRemaining(now)
            }
        _recoveryState.value =
            StreamRecoveryState(
                stage = stage,
                severity = severity,
                summary = summary,
                detail = detail,
                attempt = attempt,
                budgetRemaining = budgetRemaining,
                activeMitigations = activeMitigations,
                lastFatalReason = lastFatalReason,
                isFailSoftImminent = budgetRemaining <= FAIL_SOFT_IMMINENT_THRESHOLD,
                atMs = now,
            )
        _lastRecovery.value = RecoveryEvent(reason = summary, atMs = now)
    }

    private fun clearRecoveryState() {
        if (_recoveryState.value.stage != RecoveryStage.IDLE) {
            _recoveryState.value = StreamRecoveryState()
        }
    }

    private fun nextLowerQuality(): Quality? =
        Quality.entries
            .filter { it.bitrate < currentQuality.bitrate }
            .maxByOrNull { it.bitrate }

    private fun trimHeavyBranding(reason: String) {
        scope.launch {
            cameraMutex.withLock {
                recycleBitmapNow(webLogoBitmap)
                recycleBitmapNow(sponsorBitmap)
                webLogoBitmap = null
                sponsorBitmap = null
                webLogoFilter = null
                sponsorFilter = null
                markOverlayIssue("Tạm tắt branding nặng để giữ stream ổn định ($reason).")
            }
        }
    }

    private fun degradeForRecovery(
        reason: String,
        preferLowest: Boolean = false,
        consumeBudget: Boolean = false,
    ) {
        val targetQuality =
            if (preferLowest) {
                Quality.entries.minByOrNull { it.bitrate } ?: currentQuality
            } else {
                nextLowerQuality() ?: (Quality.entries.minByOrNull { it.bitrate } ?: currentQuality)
            }

        if (targetQuality == currentQuality) {
            trimHeavyBranding(reason)
            updateRecoveryState(
                stage = RecoveryStage.DEGRADED,
                severity = RecoverySeverity.WARNING,
                summary = "Đã ở mức chất lượng thấp nhất, tiếp tục giảm tải phần phụ.",
                detail = "App giữ RTMP/encoder, tạm tắt branding nặng và giảm tải nền để tránh rơi live.",
                consumeBudget = consumeBudget,
                activeMitigations = listOf(
                    "Giữ RTMP đang chạy",
                    "Tắt branding nặng",
                    "Giảm tải upload nền",
                ),
                lastFatalReason = reason,
            )
            return
        }

        updateRecoveryState(
            stage = RecoveryStage.DEGRADED,
            severity = RecoverySeverity.WARNING,
            summary = "Đang hạ chất lượng để giữ live ổn định.",
            detail = "App chuyển xuống ${targetQuality.label} để giảm tải CPU, encoder và mạng trong lúc tự hồi phục.",
            consumeBudget = consumeBudget,
            activeMitigations = listOf(
                "Hạ xuống ${targetQuality.label}",
                "Giữ RTMP/encoder đang chạy",
                "Giảm tải upload nền",
            ),
            lastFatalReason = reason,
        )
        changeQuality(targetQuality)
    }

    fun requestEmergencyRecoveryDegrade() {
        if (isReleased) return
        degradeForRecovery(
            reason = "operator_manual_degrade",
            preferLowest = false,
            consumeBudget = true,
        )
    }

    fun requestCameraPipelineRebuild() {
        if (isReleased) return
        updateRecoveryState(
            stage = RecoveryStage.CAMERA_REBUILD,
            severity = RecoverySeverity.WARNING,
            summary = "Đang dựng lại camera/pipeline theo yêu cầu operator.",
            detail = "App sẽ giữ intent live, dựng lại camera/encoder rồi nối lại RTMP nếu phiên live vẫn còn hợp lệ.",
            activeMitigations = listOf(
                "Dựng lại camera",
                "Dựng lại encoder",
                "Giữ match và RTMP URL hiện tại",
            ),
            lastFatalReason = "operator_manual_rebuild",
        )
        if (desiredStreaming.get()) {
            hardRestartStream("operator_camera_rebuild")
        } else {
            changeQuality(currentQuality)
        }
    }

    /**
     * Auto-reduce quality when network is poor.
     * Called from onNewBitrate — if measured bitrate is consistently low, downgrade.
     */
    private fun checkAutoQuality(measuredBitrate: Long) {
        val now = System.currentTimeMillis()
        if (!isLifecycleForeground) return
        if (_state.value !is StreamState.Live || isReconnecting.get()) return
        if (lastLiveBecameStableAtMs > 0L && now - lastLiveBecameStableAtMs < autoQualityGraceMs()) {
            consecutiveLowBitrate = 0
            return
        }
        val targetBitrate = currentQuality.bitrate.toLong()
        val threshold = lowBitrateThreshold(targetBitrate)
        if (measuredBitrate < threshold) {
            consecutiveLowBitrate++
            if (consecutiveLowBitrate >= lowBitrateReadingsRequired()) {
                consecutiveLowBitrate = 0
                if (now - lastAutoQualityChangeAtMs < autoQualityCooldownMs()) return
                val nextDown = Quality.entries
                    .filter { it.bitrate < currentQuality.bitrate }
                    .maxByOrNull { it.bitrate }
                if (nextDown != null) {
                    lastAutoQualityChangeAtMs = now
                    Log.w(TAG, "Auto-reducing quality: ${currentQuality.label} → ${nextDown.label} (network poor)")
                    degradeForRecovery(
                        reason = "poor_network_auto_quality",
                        preferLowest = false,
                        consumeBudget = false,
                    )
                }
            }
        } else {
            consecutiveLowBitrate = 0
        }
    }

    fun handleFatalTransportException(
        throwable: Throwable,
        threadName: String?,
    ) {
        if (isReleased) return
        val reason = throwable.message?.takeIf { it.isNotBlank() } ?: "Broken pipe"
        Log.e(TAG, "Soft-handled transport crash from ${threadName ?: "unknown"}", throwable)
        scope.launch {
            runCatching {
                FirebaseCrashlytics.getInstance().log(
                    "transport_soft_crash thread=${threadName ?: "unknown"} reason=${reason.take(160)}"
                )
            }
            if (desiredStreaming.get()) {
                onConnectionFailed(reason)
            } else {
                _rtmpLastMessage.value = reason
                _state.value = if (rtmpCamera?.isOnPreview == true) StreamState.Previewing else StreamState.Stopped
            }
        }
    }

    // ==================== ConnectChecker callbacks ====================

    override fun onConnectionStarted(url: String) {
        if (isReleased) return
        Log.d(TAG, "Connection started: ${maskUrl(url)}")
        _rtmpLastMessage.value = "Connecting"
    }

    override fun onConnectionSuccess() {
        if (isReleased) return
        Log.d(TAG, "Connection success — LIVE!")
        reconnectAttempt = 0
        isReconnecting.set(false)
        acquireWakeLock()
        val now = System.currentTimeMillis()
        connectingAtMs = 0L
        reconnectingAtMs = 0L
        lastLiveBecameStableAtMs = now
        lastBitrateUpdateAtMs = now
        _bitrateUpdatedAtMs.value = now
        _state.value = StreamState.Live(startedAt = now)
        _rtmpLastMessage.value = "Connected"
        clearRecoveryState()
        if (overlayBitmap?.isRecycled == false) {
            setupOverlayFilterIfPossible(forceRecreate = false, reason = "connection_success")
        } else {
            markOverlayIssue("Stream đã LIVE nhưng overlay bitmap chưa sẵn sàng.")
        }
    }

    override fun onConnectionFailed(reason: String) {
        if (isReleased) return
        Log.e(TAG, "Connection failed: $reason")
        _rtmpLastMessage.value = reason.takeIf { it.isNotBlank() } ?: "Connection failed"
        markOverlayIssue("RTMP lỗi: ${reason.takeIf { it.isNotBlank() } ?: "không rõ nguyên nhân"}")

        if (!desiredStreaming.get() || !networkAvailable) {
            isReconnecting.set(false)
            pendingNetworkReconnect.set(!networkAvailable && desiredStreaming.get())
            updateRecoveryState(
                stage = RecoveryStage.SOCKET_SELF_HEAL,
                severity = RecoverySeverity.WARNING,
                summary = if (networkAvailable) "RTMP lỗi, app đang giữ intent live để tự cứu." else "Mất mạng, app giữ intent live và chờ tự nối lại.",
                detail = if (networkAvailable) "App giữ match/RTMP URL hiện tại và chờ lớp reconnect hoặc refresh session tiếp theo." else "Phiên live không bị bỏ. Khi mạng quay lại, app sẽ tiếp tục reconnect bằng RTMP URL hiện tại.",
                activeMitigations = listOf(
                    "Giữ match hiện tại",
                    "Giữ RTMP URL",
                    "Chờ reconnect hoặc refresh session",
                ),
                lastFatalReason = reason,
            )
            _state.value = StreamState.Error(
                if (networkAvailable) "Connection failed: $reason" else "Mất kết nối mạng",
                recoverable = true,
            )
            return
        }

        val now = System.currentTimeMillis()
        if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
            val url = currentUrl
            if (!url.isNullOrBlank() && now - lastHardRestartAtMs >= 60_000L) {
                lastHardRestartAtMs = now
                isReconnecting.set(true)
                hardRestartStream("max_reconnect_attempts")
            } else {
                isReconnecting.set(false)
                updateRecoveryState(
                    stage = RecoveryStage.FAIL_SOFT_GUARD,
                    severity = RecoverySeverity.CRITICAL,
                    summary = "RTMP lỗi lặp lại nhiều lần, app đang giữ live và chờ bước cứu tiếp theo.",
                    detail = "Để tránh loop restart vô hạn làm nóng máy hơn, app dừng reconnect tự động tạm thời và chờ operator can thiệp.",
                    activeMitigations = listOf(
                        "Dừng loop reconnect vô hạn",
                        "Giữ match và RTMP URL",
                        "Chờ operator rebuild hoặc hạ chất lượng",
                    ),
                    lastFatalReason = reason,
                )
                _state.value = StreamState.Error("Connection failed: $reason")
            }
            return
        }
        if (isReconnecting.get()) return

        // Auto-reconnect with exponential backoff
        reconnectAttempt++
        isReconnecting.set(true)
        reconnectingAtMs = now
        updateRecoveryState(
            stage = RecoveryStage.SOCKET_SELF_HEAL,
            severity = RecoverySeverity.WARNING,
            summary = "RTMP lỗi, app đang tự nối lại.",
            detail = "Lần thử ${reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS}. Nếu vẫn lỗi, app sẽ dựng lại pipeline nhưng vẫn giữ intent live.",
            activeMitigations = listOf(
                "Reconnect RTMP",
                "Giữ match và RTMP URL hiện tại",
                "Giảm tải nền nếu cần",
            ),
            lastFatalReason = reason,
        )
        _state.value = StreamState.Reconnecting(reconnectAttempt, MAX_RECONNECT_ATTEMPTS)

        scope.launch {
            val delayMs = (1000L * (1 shl (reconnectAttempt - 1))).coerceAtMost(8000L)
            Log.d(TAG, "Reconnecting in ${delayMs}ms (attempt $reconnectAttempt/$MAX_RECONNECT_ATTEMPTS)")
            delay(delayMs)

            cameraMutex.withLock {
                if (!isReconnecting.get()) return@withLock
                if (isReleased || teardownInProgress || !isLifecycleForeground || !isSurfaceValid) {
                    isReconnecting.set(false)
                    return@withLock
                }
                if (!desiredStreaming.get() || !networkAvailable) {
                    isReconnecting.set(false)
                    return@withLock
                }

                val url = currentUrl ?: run {
                    isReconnecting.set(false)
                    return@withLock
                }

                val cam = ensureCameraInitialized() ?: run {
                    isReconnecting.set(false)
                    return@withLock
                }

                try {
                    if (!cam.isOnPreview) {
                        val audioPrepared = runCatching { cam.prepareAudio(128_000, 44100, true) }.getOrDefault(false)
                        val videoPrepared = prepareVideo(cam, currentQuality)
                        if (!audioPrepared || !videoPrepared) {
                            _state.value = StreamState.Error("Không thể chuẩn bị encoder", recoverable = true)
                            isReconnecting.set(false)
                            releaseWakeLock()
                            return@withLock
                        }
                        cam.startPreview(currentFacing)
                        setupOverlayFilterIfPossible(forceRecreate = true, reason = "reconnect")
                        scheduleOverlayRebindAfterPreview(currentQuality, reason = "reconnect")
                        _previewReady.value = true
                        maybeResumeRecordingAfterBoundaryLocked("reconnect")
                        delay(500)
                    }
                    if (!cam.isStreaming) {
                        acquireWakeLock()
                        cam.startStream(url)
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Reconnect attempt failed", e)
                    _state.value = StreamState.Error("Reconnect failed: ${e.message}")
                    isReconnecting.set(false)
                    releaseWakeLock()
                }
            }
        }
    }

    override fun onDisconnect() {
        if (isReleased) return
        Log.d(TAG, "Disconnected")
        if (desiredStreaming.get() && !isReleased) {
            if (!isReconnecting.get()) {
                isReconnecting.set(true)
                if (reconnectAttempt <= 0) reconnectAttempt = 1
                reconnectingAtMs = System.currentTimeMillis()
                updateRecoveryState(
                    stage = RecoveryStage.SOCKET_SELF_HEAL,
                    severity = RecoverySeverity.WARNING,
                    summary = "RTMP vừa ngắt, app đang giữ live và tự nối lại.",
                    detail = "Camera/overlay vẫn được giữ để tránh reset toàn bộ phiên nếu reconnect ngắn.",
                    activeMitigations = listOf(
                        "Giữ camera/overlay",
                        "Reconnect RTMP",
                        "Không cắt intent live",
                    ),
                    lastFatalReason = "disconnect",
                )
                _state.value = StreamState.Reconnecting(reconnectAttempt, MAX_RECONNECT_ATTEMPTS)
            }
            return
        }

        _rtmpLastMessage.value = "Disconnected"
        _state.value = if (rtmpCamera?.isOnPreview == true) StreamState.Previewing else StreamState.Stopped
        if (_state.value is StreamState.Previewing && overlayBitmap?.isRecycled == false) {
            setupOverlayFilterIfPossible(forceRecreate = false, reason = "disconnect_preview")
        } else if (_state.value is StreamState.Previewing) {
            markOverlayIssue("RTMP đã ngắt và overlay bitmap chưa sẵn để gắn lại.")
        }
    }

    override fun onAuthError() {
        if (isReleased) return
        Log.e(TAG, "Auth error")
        _rtmpLastMessage.value = "Auth error"
        updateRecoveryState(
            stage = RecoveryStage.SOCKET_SELF_HEAL,
            severity = RecoverySeverity.CRITICAL,
            summary = "RTMP auth lỗi, app đang xin lại session live.",
            detail = "Phiên live chưa bị bỏ. App sẽ thử refresh live session và giữ match hiện tại trước khi tính đến bước cực hạn.",
            activeMitigations = listOf(
                "Xin lại live session",
                "Giữ match hiện tại",
                "Không tự cắt live sớm",
            ),
            lastFatalReason = "auth_error",
        )
        _state.value = StreamState.Error("Authentication failed", recoverable = true)
    }

    override fun onAuthSuccess() {
        if (isReleased) return
        Log.d(TAG, "Auth success")
        _rtmpLastMessage.value = "Auth success"
    }

    override fun onNewBitrate(bitrate: Long) {
        if (isReleased) return
        val now = System.currentTimeMillis()
        lastBitrateUpdateAtMs = now
        _bitrateUpdatedAtMs.value = now
        _stats.value = _stats.value.copy(currentBitrate = bitrate)
        // Auto-quality: reduce if network is consistently poor
        checkAutoQuality(bitrate)
    }

    // ==================== Cleanup ====================

    fun release() {
        if (isReleased) return // Guard against double-release
        isReleased = true
        runtimeRegistry.unregister(streamManager = this)
        teardownInProgress = true
        isLifecycleForeground = false
        // Fix #10: Cancel scope FIRST to kill all in-flight zombie coroutines
        // (reconnect, overlay attach, health loop, recording rotation)
        // before they can access freed camera/GL resources.
        // Previous code called scope.cancel() INSIDE scope.launch{} — a race
        // condition where the scope's own teardown coroutine could be cancelled
        // before it reached scope.cancel(), leaving zombies alive.
        scope.cancel()
        healthJob = null
        orientationReconfigureJob = null
        overlayAttachJob = null
        overlayPostTransitionJob = null
        brandingJob = null
        recordingRotateJob = null
        connectingAtMs = 0L
        reconnectingAtMs = 0L
        lastPreparedOrientation = Configuration.ORIENTATION_UNDEFINED
        releaseWakeLock()
        if (cameraMutex.tryLock()) {
            try {
                resetOverlayFiltersLocked(clearGlFilters = true)
            } finally {
                cameraMutex.unlock()
            }
        }
        overlayFilter = null
        overlayFilterOwner = null
        webLogoFilter = null
        sponsorFilter = null
        overlayBitmap?.let { b ->
            if (!b.isRecycled) runCatching { b.recycle() }
        }
        overlayBitmap = null
        webLogoBitmap?.let { b ->
            if (!b.isRecycled) runCatching { b.recycle() }
        }
        webLogoBitmap = null
        sponsorBitmap?.let { b ->
            if (!b.isRecycled) runCatching { b.recycle() }
        }
        sponsorBitmap = null
        // Synchronous camera teardown since scope is already cancelled
        try {
            rtmpCamera?.let { cam ->
                FirebaseCrashlytics.getInstance().log("release: stopping camera")
                if (cam.isStreaming) cam.stopStream()
                if (cam.isOnPreview) cam.stopPreview()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Release camera stop error (non-fatal)", e)
        } finally {
            rtmpCamera = null
            surfaceCallback?.let { callback ->
                runCatching { surfaceView?.holder?.removeCallback(callback) }
            }
            surfaceCallback = null
            surfaceView = null
            isSurfaceValid = false
            _previewReady.value = false
            _state.value = StreamState.Idle
        }
        unregisterDeviceMonitoring()
        _overlayHealth.value = OverlayHealth()
        clearRecoveryState()
        Log.d(TAG, "Resources released")
    }

    fun onNetworkAvailabilityChanged(isConnected: Boolean) {
        if (isReleased) return
        scope.launch {
            var restartUrl: String? = null
            cameraMutex.withLock {
                networkAvailable = isConnected
                if (!isConnected) {
                    if (desiredStreaming.get()) {
                        pendingNetworkReconnect.set(true)
                        isReconnecting.set(false)
                        reconnectAttempt = 0
                        updateRecoveryState(
                            stage = RecoveryStage.SOCKET_SELF_HEAL,
                            severity = RecoverySeverity.WARNING,
                            summary = "Mất mạng, app giữ live và chờ tự nối lại.",
                            detail = "Camera và trạng thái trận vẫn được giữ. Khi mạng quay lại, app sẽ dùng lại RTMP URL hiện tại để nối tiếp.",
                            activeMitigations = listOf(
                                "Giữ camera/overlay",
                                "Giữ match và RTMP URL",
                                "Chờ mạng quay lại",
                            ),
                            lastFatalReason = "network_lost",
                        )
                        markOverlayIssue("Mất mạng nên stream tạm dừng, overlay sẽ quay lại sau khi kết nối lại.")
                        try {
                            rtmpCamera?.let { cam ->
                                if (cam.isStreaming) cam.stopStream()
                            }
                        } catch (e: Exception) {
                            Log.e(TAG, "Network lost cleanup error (non-fatal)", e)
                        }
                        _state.value = StreamState.Error("Mất kết nối mạng", recoverable = true)
                    }
                    return@withLock
                }

                if (
                    !teardownInProgress &&
                    isLifecycleForeground &&
                    desiredStreaming.get() &&
                    pendingNetworkReconnect.getAndSet(false)
                ) {
                    val url = currentUrl
                    if (!url.isNullOrBlank() && isSurfaceValid && rtmpCamera != null && rtmpCamera?.isStreaming != true) {
                        restartUrl = url
                    }
                }
            }

            restartUrl?.let { url ->
                delay(300)
                val shouldRestart =
                    cameraMutex.withLock {
                        canResumeStreamingLocked(url) && rtmpCamera != null && rtmpCamera?.isStreaming != true
                    }
                if (shouldRestart) {
                    updateRecoveryState(
                        stage = RecoveryStage.SOCKET_SELF_HEAL,
                        severity = RecoverySeverity.INFO,
                        summary = "Mạng đã quay lại, app đang nối lại live.",
                        detail = "RTMP sẽ dùng lại phiên hiện tại nếu server còn chấp nhận.",
                        activeMitigations = listOf(
                            "Reconnect RTMP",
                            "Giữ match hiện tại",
                            "Không dựng lại toàn bộ phiên nếu chưa cần",
                        ),
                        lastFatalReason = "network_restored",
                    )
                    startStream(url)
                } else {
                    Log.d(TAG, "Skip network reconnect restart because session is no longer eligible")
                }
            }
        }
    }

    private fun startHealthLoop() {
        if (healthJob != null) return
        healthJob = scope.launch {
            while (isActive) {
                try {
                    delay(OVERLAY_HEALTHCHECK_INTERVAL_MS)
                    if (!isLifecycleForeground) continue
                    maintainWakeLockIfNeeded()
                    val now = System.currentTimeMillis()
                    val desired = desiredStreaming.get()
                    val url = currentUrl

                    val overlayDecision = cameraMutex.withLock {
                        if (isReleased || !isSurfaceValid) {
                            Triple(false, false, false)
                        } else {
                            val cam = rtmpCamera
                            val active = cam != null && (cam.isOnPreview || cam.isStreaming)
                            val hasBitmap = overlayBitmap?.isRecycled == false
                            val health = _overlayHealth.value
                            val attachInFlight = overlayAttachJob?.isActive == true
                            val attachedRecently = wasOverlayAttachedRecently(now)
                            if (!active || !hasBitmap) {
                                Triple(false, false, false)
                            } else if (attachInFlight || attachedRecently) {
                                Triple(false, false, true)
                            } else {
                                val hasFilterForCamera = overlayFilter != null && overlayFilterOwner === cam
                                val forceRebind = !hasFilterForCamera
                                Triple(true, forceRebind, false)
                            }
                        }
                    }
                    val shouldEnsureOverlay = overlayDecision.first
                    val shouldForceRebindOverlay = overlayDecision.second
                    val shouldLogStableSkip = overlayDecision.third
                    if (shouldLogStableSkip) {
                        logOverlayRebindSkippedStable(
                            reason = "health_overlay",
                            now = now,
                            attachInFlight = overlayAttachJob?.isActive == true,
                        )
                    }
                    if (shouldEnsureOverlay && now - lastOverlayEnsureAtMs >= OVERLAY_HEALTHCHECK_INTERVAL_MS) {
                        if (shouldForceRebindOverlay) {
                            logOverlayForceRebind("health_rebind", now)
                        }
                        setupOverlayFilterIfPossible(
                            forceRecreate = shouldForceRebindOverlay,
                            reason = if (shouldForceRebindOverlay) "health_rebind" else "health_overlay",
                        )
                    }

                    if (!desired || url.isNullOrBlank()) continue

                    val shouldRestart = cameraMutex.withLock {
                        if (isReleased) return@withLock false
                        if (!networkAvailable || !isSurfaceValid) return@withLock false

                        val state = _state.value
                        val bitrateAge = if (lastBitrateUpdateAtMs == 0L) Long.MAX_VALUE else now - lastBitrateUpdateAtMs

                        if (state is StreamState.Connecting && connectingAtMs > 0L && now - connectingAtMs > 40_000L) {
                            return@withLock now - lastHardRestartAtMs > 60_000L
                        }
                        if (state is StreamState.Reconnecting && reconnectingAtMs > 0L && now - reconnectingAtMs > 50_000L) {
                            return@withLock now - lastHardRestartAtMs > 60_000L
                        }
                        if (state is StreamState.Live && now - state.startedAt >= autoQualityGraceMs() && bitrateAge > liveBitrateStallRestartMs()) {
                            return@withLock now - lastHardRestartAtMs > 60_000L
                        }
                        false
                    }

                    if (shouldRestart) {
                        lastHardRestartAtMs = now
                        hardRestartStream("healthcheck")
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.e(TAG, "Health loop error (non-fatal)", e)
                }
            }
        }
    }

    private fun hardRestartStream(reason: String) {
        if (isReleased) return
        scope.launch {
            cameraMutex.withLock {
                if (isReleased || teardownInProgress) return@withLock
                if (!isLifecycleForeground) return@withLock
                if (!desiredStreaming.get()) return@withLock
                val url = currentUrl ?: return@withLock
                if (url.isBlank()) return@withLock
                if (!networkAvailable || !isSurfaceValid) return@withLock

                val now = System.currentTimeMillis()
                if (hardRestartWindowStartMs == 0L || now - hardRestartWindowStartMs > 10 * 60_000L) {
                    hardRestartWindowStartMs = now
                    hardRestartCountInWindow = 0
                }
                hardRestartCountInWindow++
                val restartStage =
                    if (reason.contains("camera", ignoreCase = true)) {
                        RecoveryStage.CAMERA_REBUILD
                    } else {
                        RecoveryStage.PIPELINE_REBUILD
                    }
                updateRecoveryState(
                    stage = restartStage,
                    severity = if (currentRecoveryBudgetRemaining(now) <= FAIL_SOFT_IMMINENT_THRESHOLD) {
                        RecoverySeverity.CRITICAL
                    } else {
                        RecoverySeverity.WARNING
                    },
                    summary =
                        if (restartStage == RecoveryStage.CAMERA_REBUILD) {
                            "Đang dựng lại camera để giữ live tiếp tục."
                        } else {
                            "Đang dựng lại pipeline live để giữ phiên hiện tại."
                        },
                    detail = "Lần recovery cứng thứ ${hardRestartCountInWindow} trong cửa sổ hiện tại. Match và RTMP URL vẫn được giữ nguyên.",
                    consumeBudget = true,
                    activeMitigations = listOf(
                        "Dựng lại encoder",
                        "Dựng lại preview/camera",
                        "Giữ RTMP URL và match hiện tại",
                    ),
                    lastFatalReason = reason,
                )

                if (hardRestartCountInWindow >= 3) {
                    val lowQuality = Quality.entries.minByOrNull { it.bitrate } ?: Quality.Q_480P_24
                    currentQuality = lowQuality
                }

                isReconnecting.set(false)
                reconnectAttempt = 0
                connectingAtMs = now
                reconnectingAtMs = 0L
                lastLiveBecameStableAtMs = 0L
                lastBitrateUpdateAtMs = now
                markOverlayIssue("Stream đang tự khôi phục `$reason`, overlay sẽ được gắn lại sau khi encoder dựng xong.")

                try {
                    if (_recordingState.value.isRecording || pendingRecordingResume != null) {
                        pauseRecordingForBoundaryLocked("hard_restart_$reason")
                    }
                    // Fix #11: Reset GL filter refs BEFORE stopping old camera
                    // Stale overlayFilter/overlayFilterOwner -> native GL crash
                    resetOverlayFiltersLocked(clearGlFilters = true)
                    rtmpCamera?.let { cam ->
                        FirebaseCrashlytics.getInstance().log("hardRestart:stop reason=$reason")
                        if (cam.isStreaming) cam.stopStream()
                        if (cam.isOnPreview) cam.stopPreview()
                    }
                    // Fix #12: Null out old camera before creating new one
                    // to avoid native Camera2 device conflict
                    rtmpCamera = null
                    _previewReady.value = false
                } catch (e: Exception) {
                    Log.e(TAG, "Hard restart cleanup error (non-fatal)", e)
                    rtmpCamera = null
                }

                // Hardening: give Camera2 HAL time to fully release the device.
                // Some Samsung/Xiaomi devices throw CameraAccessException if
                // the new CameraDevice.open() arrives before the old one finishes
                // its internal teardown. 200ms is enough for most HAL implementations.
                delay(200)

                try {
                    val surface = surfaceView ?: return@withLock
                    rtmpCamera = RtmpCamera2(surface, this@RtmpStreamManager)
                    val cam = rtmpCamera ?: return@withLock
                    val audioPrepared = runCatching { cam.prepareAudio(128_000, 44100, true) }.isSuccess
                    val videoPrepared = prepareVideo(cam, currentQuality)
                    if (!audioPrepared || !videoPrepared) {
                        maybeDowngradeForStability("prepare_failed_restart")
                        _state.value = StreamState.Error("Không thể chuẩn bị encoder", recoverable = true)
                        return@withLock
                    }
                    cam.startPreview(currentFacing)
                    setupOverlayFilterIfPossible(forceRecreate = true, reason = "hard_restart")
                    scheduleOverlayRebindAfterPreview(currentQuality, reason = "hard_restart")
                    _previewReady.value = true
                    maybeResumeRecordingAfterBoundaryLocked("hard_restart_$reason")
                    delay(500)
                    _state.value = StreamState.Connecting(url)
                    cam.startStream(url)
                    Log.w(TAG, "Hard restart: $reason")
                } catch (e: Exception) {
                    Log.e(TAG, "Hard restart failed", e)
                    _state.value = StreamState.Error("Restart failed: ${e.message}")
                }
            }
        }
    }

    private fun startDeviceMonitoring() {
        _powerSaveMode.value = try { powerManager.isPowerSaveMode } catch (_: Exception) { false }
        if (!powerSaveReceiverRegistered) {
            try {
                appContext.registerReceiver(powerSaveReceiver, IntentFilter(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED))
                powerSaveReceiverRegistered = true
            } catch (_: Exception) {}
        }
        if (!batteryReceiverRegistered) {
            try {
                appContext.registerReceiver(batteryReceiver, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
                batteryReceiverRegistered = true
            } catch (_: Exception) {}
        }
    }

    private fun unregisterDeviceMonitoring() {
        if (powerSaveReceiverRegistered) {
            try {
                appContext.unregisterReceiver(powerSaveReceiver)
            } catch (_: Exception) {}
            powerSaveReceiverRegistered = false
        }
        if (batteryReceiverRegistered) {
            try {
                appContext.unregisterReceiver(batteryReceiver)
            } catch (_: Exception) {}
            batteryReceiverRegistered = false
        }
    }

    private fun maybeDowngradeForStability(reason: String) {
        degradeForRecovery(
            reason = reason,
            preferLowest = true,
            consumeBudget = false,
        )
    }

    private fun maintainWakeLockIfNeeded() {
        if (!desiredStreaming.get() || !isLifecycleForeground || isReleased) {
            releaseWakeLock()
            return
        }
        acquireWakeLock()
    }

    private fun acquireWakeLock(forceRenew: Boolean = false) {
        try {
            val now = System.currentTimeMillis()
            val wl = wakeLock ?: powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PickletourLive:stream").also {
                it.setReferenceCounted(false)
                wakeLock = it
            }
            val shouldRenew =
                !wl.isHeld ||
                    forceRenew ||
                    wakeLockExpiresAtMs <= 0L ||
                    now >= (wakeLockExpiresAtMs - WAKE_LOCK_RENEW_BEFORE_MS)
            if (!shouldRenew) return
            if (wl.isHeld) {
                runCatching { wl.release() }
            }
            wl.acquire(WAKE_LOCK_TIMEOUT_MS)
            wakeLockExpiresAtMs = now + WAKE_LOCK_TIMEOUT_MS
        } catch (_: Exception) {}
    }

    private fun releaseWakeLock() {
        try {
            wakeLock?.let { if (it.isHeld) it.release() }
        } catch (_: Exception) {
        } finally {
            wakeLockExpiresAtMs = 0L
        }
    }

    private fun maskUrl(url: String): String {
        return try {
            val idx = url.lastIndexOf('/')
            if (idx < 0) url
            else "${url.substring(0, idx + 1)}****${url.takeLast(6)}"
        } catch (_: Exception) { url }
    }

    private fun hasCameraAndMicPermission(): Boolean {
        val cameraGranted =
            ContextCompat.checkSelfPermission(appContext, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        val micGranted =
            ContextCompat.checkSelfPermission(appContext, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        return cameraGranted && micGranted
    }
}

data class StreamStats(
    val currentBitrate: Long = 0,
    val fps: Int = 0,
    val droppedFrames: Int = 0,
)

data class MemoryPressureEvent(
    val level: Int,
    val atMs: Long,
)

data class RecoveryEvent(
    val reason: String,
    val atMs: Long,
)

data class OverlayHealth(
    val attached: Boolean = false,
    val reattaching: Boolean = false,
    val lastAttachedAtMs: Long = 0L,
    val lastIssue: String? = null,
    val lastIssueAtMs: Long = 0L,
    val lastEvent: String? = null,
)

data class ThermalEvent(
    val tempC: Float,
    val atMs: Long,
)
