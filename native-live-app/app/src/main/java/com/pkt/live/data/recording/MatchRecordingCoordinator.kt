package com.pkt.live.data.recording

import android.content.Context
import android.media.MediaMetadataRetriever
import android.os.StatFs
import android.util.Log
import com.google.gson.Gson
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.pkt.live.data.model.MatchRecording
import com.pkt.live.data.model.RecordingStorageFailoverEntry
import com.pkt.live.data.model.RecordingPresignedUpload
import com.pkt.live.data.model.RecordingStorageStatus
import com.pkt.live.data.model.RecordingUiState
import com.pkt.live.data.model.StreamMode
import com.pkt.live.data.repository.LiveRepository
import com.pkt.live.data.repository.RetryableRecordingSegmentCompleteException
import com.pkt.live.streaming.Quality
import com.pkt.live.streaming.RecordingSegmentClosed
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.RandomAccessFile
import java.time.Instant
import java.util.Collections
import java.util.Locale
import java.util.UUID
import kotlin.math.max
import kotlin.math.roundToInt

private data class ActiveRecordingSession(
    val recordingId: String,
    val recordingSessionId: String,
    val matchId: String,
    val courtId: String?,
    val mode: StreamMode,
    val quality: Quality,
    val playbackUrl: String? = null,
    val storageTargetId: String? = null,
    val storageBucketName: String? = null,
    val latestStorageFailover: RecordingStorageFailoverEntry? = null,
    val isProvisional: Boolean = false,
)

private data class PendingRecordingSegment(
    val recordingId: String,
    val recordingSessionId: String,
    val matchId: String,
    val courtId: String? = null,
    val mode: String,
    val qualityLabel: String,
    val localPath: String,
    val segmentIndex: Int,
    val startedAt: String? = null,
    val durationSeconds: Double,
    val sizeBytes: Long,
    val isFinal: Boolean,
    val uploadMode: String? = null,
    val uploadId: String? = null,
    val objectKey: String? = null,
    val partSizeBytes: Long? = null,
    val completedParts: List<PendingRecordingPart>? = null,
    val nextByteOffset: Long? = null,
    val isProvisional: Boolean = false,
    val retryCount: Int = 0,
    val nextRetryAtMs: Long = 0L,
)

private data class PendingRecordingPart(
    val partNumber: Int,
    val etag: String,
    val sizeBytes: Long,
)

private data class PendingFinalizeRecording(
    val recordingId: String,
    val matchId: String,
    val recordingSessionId: String? = null,
    val courtId: String? = null,
    val mode: String? = null,
    val qualityLabel: String? = null,
    val retryCount: Int = 0,
    val nextRetryAtMs: Long = 0L,
)

private data class CachedSinglePutPresign(
    val objectKey: String,
    val upload: RecordingPresignedUpload,
)

private data class CachedLiveManifestPresign(
    val manifestObjectKey: String,
    val manifestUrl: String,
    val hlsManifestObjectKey: String,
    val hlsManifestUrl: String,
    val publicBaseUrl: String,
    val targetPublicBaseUrls: Map<String, String>,
    val delaySeconds: Int,
    val upload: RecordingPresignedUpload,
    val hlsUpload: RecordingPresignedUpload,
)

private data class RecordingQueueManifest(
    val pendingSegments: List<PendingRecordingSegment> = emptyList(),
    val pendingFinalizations: List<PendingFinalizeRecording> = emptyList(),
)

private class MultipartUploadPartHttpException(
    val statusCode: Int,
    val responseBodySnippet: String? = null,
) : IllegalStateException(
        buildString {
            append("Upload part thất bại (")
            append(statusCode)
            append(")")
            if (!responseBodySnippet.isNullOrBlank()) {
                append(": ")
                append(responseBodySnippet)
            }
        }
    )

class MatchRecordingCoordinator(
    private val appContext: Context,
    private val repository: LiveRepository,
    private val okHttpClient: OkHttpClient,
    private val gson: Gson,
) {

    companion object {
        private const val TAG = "RecordingCoordinator"
        // Segment chuẩn 10s (trước 6s) để giảm số lần finalize mp4 → giảm xác suất
        // dính segment không finalize được trên máy/encoder khó tính. Phải <=
        // DEFAULT_RECORDING_SEGMENT_DURATION_MS (trần clamp = 10s). Low-storage giữ 6s.
        private const val DEFAULT_SEGMENT_DURATION_SECONDS = 10.0
        private const val LOW_STORAGE_SEGMENT_DURATION_SECONDS = 6.0
        private const val MIN_MULTIPART_OBJECT_SIZE_BYTES = 5L * 1024L * 1024L
        private const val DEFAULT_MULTIPART_PART_SIZE_BYTES = 8L * 1024L * 1024L
        private const val SINGLE_PUT_PRESIGN_BATCH_SIZE = 10
        private const val RECOMMENDED_SEGMENT_BACKLOG = 15L
        private const val STORAGE_HEADROOM_BYTES = 256L * 1024L * 1024L
        private const val STANDARD_START_SEGMENT_BACKLOG = 8L
        private const val LOW_STORAGE_SEGMENT_BACKLOG = 4L
        private const val LOW_STORAGE_HEADROOM_BYTES = 160L * 1024L * 1024L
        private const val MIN_STANDARD_START_BYTES = 768L * 1024L * 1024L
        private const val MIN_HARD_BLOCK_BYTES = 512L * 1024L * 1024L
        private const val LIVE_MANIFEST_MAX_SEGMENTS = 180
        private const val RECORDING_HEARTBEAT_INTERVAL_MS = 30_000L
        private const val OFFLINE_UPLOAD_RECHECK_DELAY_MS = 5_000L
        private const val RECONNECT_UPLOAD_COOLDOWN_MS = 8_000L
        private const val UPLOAD_SEGMENT_SPACING_MS = 2_500L
        private const val UPLOAD_DRAIN_FAST_SPACING_MS = 350L
        private const val UPLOAD_DRAIN_HIGH_BACKLOG_THRESHOLD = 15
        private const val UPLOAD_DRAIN_LIVESTREAM_CONCURRENCY = 1
        private const val UPLOAD_DRAIN_RECORD_ONLY_CONCURRENCY = 2
        private const val UPLOAD_DRAIN_IDLE_CONCURRENCY = 4
        private const val MP4_READY_CHECK_TIMEOUT_MS = 8_000L
        private const val MP4_READY_CHECK_INTERVAL_MS = 250L
        private const val MP4_NOT_READY_RETRY_MS = 2_000L
        private const val MP4_HEAD_SCAN_BYTES = 1024 * 1024
        // "Luôn có record": nếu 1 segment không thể upload/finalize sau RẤT nhiều lần
        // (vd encoder máy không đóng được mp4) thì bỏ qua nó để recording vẫn finalize
        // được từ các segment đã có. Cap rất rộng → máy khoẻ upload trong vài giây nên
        // KHÔNG bao giờ chạm tới (an toàn, không bỏ nhầm footage tốt).
        private const val MAX_SEGMENT_UPLOAD_RETRIES = 25
        // Sau khi đã bỏ segment kẹt, finalize sẽ retry vì backend vẫn báo 409 (segment
        // còn pending phía server). Sau ngần này lần finalize lỗi → gửi cờ
        // abandonFailedSegments để backend finalize với segment đã upload. Force này là
        // no-op nếu backend thực ra đã đủ segment → an toàn cả khi lỗi do mạng thoáng qua.
        private const val MAX_FINALIZE_RETRIES_BEFORE_FORCE = 3
        private const val LOCAL_RECORDING_ID_PREFIX = "local_"
        private val MP4_FTYP_ATOM =
            byteArrayOf('f'.code.toByte(), 't'.code.toByte(), 'y'.code.toByte(), 'p'.code.toByte())
        private val MP4_MDAT_ATOM =
            byteArrayOf('m'.code.toByte(), 'd'.code.toByte(), 'a'.code.toByte(), 't'.code.toByte())
        private val MP4_MOOV_ATOM =
            byteArrayOf('m'.code.toByte(), 'o'.code.toByte(), 'o'.code.toByte(), 'v'.code.toByte())
    }

    private val coordinatorExceptionHandler =
        CoroutineExceptionHandler { _, throwable ->
            if (throwable is CancellationException) return@CoroutineExceptionHandler
            Log.e(TAG, "Unhandled recording coordinator exception", throwable)
            uploadJob = null
            updateUiState(
                status = if (manifest.pendingSegments.isNotEmpty()) "uploading" else _recordingUiState.value.status,
                errorMessage = throwable.message ?: "Đã chặn lỗi nền của ghi hình để tránh crash app.",
            )
            restartUploadLoopIfNeeded()
        }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO + coordinatorExceptionHandler)
    private val manifestMutex = Mutex()
    private val presignCacheMutex = Mutex()
    private val recordingDir = File(appContext.filesDir, "recordings-v2")
    private val manifestFile = File(recordingDir, "queue-manifest.json")
    private var manifest = RecordingQueueManifest()
    private val singlePutPresignCache = linkedMapOf<String, MutableMap<Int, CachedSinglePutPresign>>()
    private val liveManifestPresignCache = linkedMapOf<String, CachedLiveManifestPresign>()
    private var uploadJob: Job? = null
    private var recordingHeartbeatJob: Job? = null
    private var activeSession: ActiveRecordingSession? = null
    private val activeUploadCalls = Collections.synchronizedSet(mutableSetOf<okhttp3.Call>())
    @Volatile
    private var networkAvailableForUploads: Boolean = true
    @Volatile
    private var nextUploadAllowedAtMs: Long = 0L
    @Volatile
    private var liveCriticalPathBusy: Boolean = false
    @Volatile
    private var recoveryBusy: Boolean = false

    var onStorageExhausted: ((RecordingStorageStatus) -> Unit)? = null

    private val _selectedMode = MutableStateFlow<StreamMode?>(null)
    val selectedMode: StateFlow<StreamMode?> = _selectedMode.asStateFlow()

    private val _recordingUiState = MutableStateFlow(RecordingUiState())
    val recordingUiState: StateFlow<RecordingUiState> = _recordingUiState.asStateFlow()

    private val _storageStatus = MutableStateFlow(RecordingStorageStatus())
    val storageStatus: StateFlow<RecordingStorageStatus> = _storageStatus.asStateFlow()

    init {
        if (!recordingDir.exists()) recordingDir.mkdirs()
        manifest = loadManifest()
        updateUiState(pendingUploads = manifest.pendingSegments.size)
        refreshStorageStatusAsync(null)
        ensureUploadLoop()
    }

    fun selectMode(mode: StreamMode) {
        _selectedMode.value = mode
        updateUiState(
            selectedMode = mode,
            errorMessage = null,
            status = if (mode.includesRecording) "idle" else "stream_only",
        )
        refreshStorageStatusAsync(activeSession?.quality)
    }

    fun clearModeSelection() {
        _selectedMode.value = null
        updateUiState(
            selectedMode = null,
            errorMessage = null,
            status = "idle",
            activeMatchId = null,
            activeRecordingId = null,
            activeRecordingSessionId = null,
            activeStorageTargetId = null,
            activeStorageBucketName = null,
            latestStorageFailover = null,
            isRecording = false,
        )
    }

    fun setLiveCriticalPathBusy(isBusy: Boolean) {
        liveCriticalPathBusy = isBusy
    }

    fun setRecoveryBusy(isBusy: Boolean) {
        recoveryBusy = isBusy
    }

    private fun shouldYieldForLiveCriticalPath(): Boolean = liveCriticalPathBusy || recoveryBusy

    private fun isLivestreamRecordingActive(): Boolean {
        val mode = activeSession?.mode ?: _selectedMode.value
        return _recordingUiState.value.isRecording && mode?.includesLivestream == true
    }

    private fun computeUploadDrainConcurrency(pendingUploads: Int): Int {
        if (pendingUploads < UPLOAD_DRAIN_HIGH_BACKLOG_THRESHOLD) return 1
        if (shouldYieldForLiveCriticalPath()) return 1
        if (isLivestreamRecordingActive()) return UPLOAD_DRAIN_LIVESTREAM_CONCURRENCY
        if (_recordingUiState.value.isRecording) return UPLOAD_DRAIN_RECORD_ONLY_CONCURRENCY
        return UPLOAD_DRAIN_IDLE_CONCURRENCY
    }

    private fun computeUploadSpacingMs(pendingUploads: Int): Long {
        if (
            pendingUploads >= UPLOAD_DRAIN_HIGH_BACKLOG_THRESHOLD &&
            !shouldYieldForLiveCriticalPath() &&
            !isLivestreamRecordingActive()
        ) {
            return UPLOAD_DRAIN_FAST_SPACING_MS
        }
        return UPLOAD_SEGMENT_SPACING_MS
    }

    private fun PendingRecordingSegment.requiresSerialUpload(): Boolean {
        return isProvisional || isProvisionalRecordingId(recordingId)
    }

    fun hasActiveRecording(): Boolean = activeSession != null || recordingUiState.value.isRecording

    fun currentMode(): StreamMode? = _selectedMode.value

    private fun newLocalRecordingId(): String =
        "$LOCAL_RECORDING_ID_PREFIX${UUID.randomUUID().toString().replace("-", "")}"

    private fun isProvisionalRecordingId(recordingId: String?): Boolean =
        recordingId?.startsWith(LOCAL_RECORDING_ID_PREFIX) == true

    private fun modeFromName(value: String?): StreamMode {
        val normalized = value?.trim().orEmpty()
        return StreamMode.values().firstOrNull {
            it.name.equals(normalized, ignoreCase = true) ||
                it.label.equals(normalized, ignoreCase = true)
        } ?: _selectedMode.value ?: StreamMode.STREAM_AND_RECORD
    }

    private fun qualityFromLabel(value: String?): Quality {
        val normalized = value?.trim().orEmpty()
        return Quality.values().firstOrNull {
            it.label.equals(normalized, ignoreCase = true) ||
                it.name.equals(normalized, ignoreCase = true)
        } ?: Quality.DEFAULT
    }

    private fun shouldStartLocalRecordingAfterPrepareFailure(error: Throwable): Boolean {
        val message = error.message?.lowercase(Locale.US).orEmpty()
        val terminalClientErrors =
            listOf(
                " 400",
                ": 400",
                " 401",
                ": 401",
                " 403",
                ": 403",
                " 404",
                ": 404",
                "match not found",
                "matchid is required",
                "mode is invalid",
            )
        return terminalClientErrors.none { message.contains(it) }
    }

    suspend fun prepareForMatchRecording(
        matchId: String,
        courtId: String?,
        quality: Quality,
    ): Result<MatchRecording> {
        val mode = _selectedMode.value
            ?: return Result.failure(IllegalStateException("Chưa chọn chế độ ghi hình."))
        if (!mode.includesRecording) {
            return Result.failure(IllegalStateException("Chế độ hiện tại không ghi hình."))
        }

        val storage = refreshStorageStatus(quality)
        if (storage.hardBlock) {
            return Result.failure(
                IllegalStateException(
                    storage.message ?: "Không đủ bộ nhớ để bắt đầu ghi hình."
                )
            )
        }

        val recordingSessionId = UUID.randomUUID().toString()
        updateUiState(status = "preparing", errorMessage = null)

        val response =
            repository.startMatchRecordingSession(
                matchId = matchId,
                courtId = courtId,
                mode = mode,
                quality = quality,
                recordingSessionId = recordingSessionId,
            ).getOrElse { error ->
                if (!shouldStartLocalRecordingAfterPrepareFailure(error)) {
                    updateUiState(status = "error", errorMessage = error.message)
                    return Result.failure(error)
                }
                val localRecordingId = newLocalRecordingId()
                activeSession =
                    ActiveRecordingSession(
                        recordingId = localRecordingId,
                        recordingSessionId = recordingSessionId,
                        matchId = matchId,
                        courtId = courtId,
                        mode = mode,
                        quality = quality,
                        isProvisional = true,
                    )
                updateUiState(
                    status = "preparing",
                    activeMatchId = matchId,
                    activeRecordingId = localRecordingId,
                    activeRecordingSessionId = recordingSessionId,
                    activeStorageTargetId = null,
                    activeStorageBucketName = null,
                    latestStorageFailover = null,
                    errorMessage = null,
                )
                return Result.success(
                    MatchRecording(
                        id = localRecordingId,
                        matchId = matchId,
                        courtId = courtId,
                        mode = mode.name,
                        quality = quality.label,
                        status = "local_pending",
                        recordingSessionId = recordingSessionId,
                    )
                )
            }

        val recording = response.recording
            ?: return Result.failure(IllegalStateException("Server không trả recording session."))

        activeSession =
            ActiveRecordingSession(
                recordingId = recording.id,
                recordingSessionId = recording.recordingSessionId.ifBlank { recordingSessionId },
                matchId = recording.matchId.ifBlank { matchId },
                courtId = recording.courtId ?: courtId,
                mode = mode,
                quality = quality,
                playbackUrl = recording.playbackUrl,
                storageTargetId = recording.r2TargetId,
                storageBucketName = recording.r2BucketName,
                latestStorageFailover = resolveLatestStorageFailover(recording),
                isProvisional = false,
            )
        clearSinglePutPresignCache(recording.id)
        clearLiveManifestPresignCache(recording.id)

        updateUiState(
            status = "preparing",
            activeMatchId = activeSession?.matchId,
            activeRecordingId = activeSession?.recordingId,
            activeRecordingSessionId = activeSession?.recordingSessionId,
            playbackUrl = activeSession?.playbackUrl,
            activeStorageTargetId = activeSession?.storageTargetId,
            activeStorageBucketName = activeSession?.storageBucketName,
            latestStorageFailover = activeSession?.latestStorageFailover,
            errorMessage = null,
        )
        return Result.success(recording)
    }

    fun markRecordingStarted() {
        val session = activeSession ?: return
        if (!session.isProvisional) {
            startRecordingHeartbeatLoop()
        }
        updateUiState(
            status = "recording",
            isRecording = true,
            activeMatchId = session.matchId,
            activeRecordingId = session.recordingId,
            activeRecordingSessionId = session.recordingSessionId,
            playbackUrl = session.playbackUrl,
            activeStorageTargetId = session.storageTargetId,
            activeStorageBucketName = session.storageBucketName,
            latestStorageFailover = session.latestStorageFailover,
            errorMessage = null,
        )
    }

    fun markRecordingStoppedSoft(reason: String? = null) {
        if (activeSession == null) {
            stopRecordingHeartbeatLoop()
        }
        updateUiState(
            status =
                if (manifest.pendingSegments.isNotEmpty() || manifest.pendingFinalizations.isNotEmpty()) {
                    "uploading"
                } else {
                    "idle"
                },
            isRecording = false,
            errorMessage = reason,
        )
    }

    fun noteSoftError(message: String?) {
        if (message.isNullOrBlank()) return
        updateUiState(errorMessage = message)
    }

    fun clearSoftError() {
        updateUiState(errorMessage = null)
    }

    private fun snapshotActiveUploadCalls(): List<okhttp3.Call> =
        synchronized(activeUploadCalls) {
            activeUploadCalls.toList()
        }

    private fun cancelActiveUploadCalls(reason: String) {
        snapshotActiveUploadCalls().forEach { call ->
            if (!call.isCanceled()) {
                Log.i(TAG, "Cancel active recording upload call: $reason")
                call.cancel()
            }
        }
    }

    fun onNetworkLost(reason: String = "network_lost") {
        networkAvailableForUploads = false
        nextUploadAllowedAtMs = 0L
        cancelActiveUploadCalls(reason)
        scope.launch {
            val pendingUploads = manifestMutex.withLock { manifest.pendingSegments.size }
            if (pendingUploads > 0) {
                updateUiState(
                    status = "uploading",
                    pendingUploads = pendingUploads,
                    errorMessage = null,
                )
            }
        }
    }

    fun onNetworkAvailable(reason: String = "network_connected") {
        networkAvailableForUploads = true
        nextUploadAllowedAtMs = maxOf(
            nextUploadAllowedAtMs,
            System.currentTimeMillis() + RECONNECT_UPLOAD_COOLDOWN_MS,
        )
        retryPendingWorkNow(reason, forceRestartActiveUpload = true)
    }

    fun retryPendingWorkNow(
        reason: String = "manual",
        forceRestartActiveUpload: Boolean = false,
    ) {
        scope.launch {
            if (forceRestartActiveUpload) {
                cancelActiveUploadCalls("retry:$reason")
                clearSinglePutPresignCache()
                clearLiveManifestPresignCache()
                uploadJob?.takeIf { it.isActive }?.let { job ->
                    Log.i(TAG, "Restart recording upload loop: $reason")
                    job.cancel(CancellationException("Restart recording upload loop: $reason"))
                    uploadJob = null
                }
            }
            var changed = false
            var pendingUploads = 0
            manifestMutex.withLock {
                val nextSegments =
                    manifest.pendingSegments.map { segment ->
                        if (segment.nextRetryAtMs > 0L) {
                            changed = true
                            segment.copy(nextRetryAtMs = 0L)
                        } else {
                            segment
                        }
                    }
                val nextFinalizations =
                    manifest.pendingFinalizations.map { finalize ->
                        if (finalize.nextRetryAtMs > 0L) {
                            changed = true
                            finalize.copy(nextRetryAtMs = 0L)
                        } else {
                            finalize
                        }
                    }
                pendingUploads = nextSegments.size
                if (changed) {
                    Log.i(TAG, "Wake pending recording queue: $reason")
                    manifest =
                        manifest.copy(
                            pendingSegments = nextSegments,
                            pendingFinalizations = nextFinalizations,
                        )
                    persistManifestLocked()
                }
            }
            if (pendingUploads > 0) {
                updateUiState(
                    status = "uploading",
                    pendingUploads = pendingUploads,
                    errorMessage = null,
                )
            }
            restartUploadLoopIfNeeded()
            sendRecordingHeartbeatOnce("retry_$reason")
        }
    }

    private fun resolveLatestStorageFailover(
        recording: MatchRecording?,
    ): RecordingStorageFailoverEntry? {
        val latest =
            runCatching { recording?.latestStorageFailover }.getOrNull()
                ?: runCatching { recording?.storageFailoverHistory?.lastOrNull() }.getOrNull()
                ?: return null
        val hasSignal =
            !latest.fromTargetId.isNullOrBlank() ||
                !latest.toTargetId.isNullOrBlank() ||
                !latest.reason.isNullOrBlank() ||
                !latest.checkedAt.isNullOrBlank() ||
                !latest.detail.isNullOrBlank()
        return if (hasSignal) latest else null
    }

    private fun syncActiveSessionFromRecording(recording: MatchRecording?) {
        val currentSession = activeSession ?: return
        val nextRecording = recording ?: return
        if (currentSession.recordingId != nextRecording.id) return
        activeSession =
            currentSession.copy(
                playbackUrl = nextRecording.playbackUrl ?: currentSession.playbackUrl,
                storageTargetId = nextRecording.r2TargetId ?: currentSession.storageTargetId,
                storageBucketName = nextRecording.r2BucketName ?: currentSession.storageBucketName,
                latestStorageFailover =
                    resolveLatestStorageFailover(nextRecording) ?: currentSession.latestStorageFailover,
            )
    }

    private fun syncRecordingRuntimeState(
        recording: MatchRecording?,
        status: String = _recordingUiState.value.status,
        exporting: Boolean = _recordingUiState.value.exporting,
        errorMessage: String? = _recordingUiState.value.errorMessage,
    ) {
        val nextRecording = recording ?: return
        syncActiveSessionFromRecording(nextRecording)
        updateUiState(
            status = status,
            exporting = exporting,
            playbackUrl = nextRecording.playbackUrl ?: _recordingUiState.value.playbackUrl,
            activeStorageTargetId =
                nextRecording.r2TargetId ?: _recordingUiState.value.activeStorageTargetId,
            activeStorageBucketName =
                nextRecording.r2BucketName ?: _recordingUiState.value.activeStorageBucketName,
            latestStorageFailover =
                resolveLatestStorageFailover(nextRecording)
                    ?: _recordingUiState.value.latestStorageFailover,
            errorMessage = errorMessage,
        )
    }

    fun onSegmentCompleted(segment: RecordingSegmentClosed) {
        scope.launch {
            runCatching {
                handleSegmentCompleted(segment)
            }.onFailure { error ->
                if (error is CancellationException) throw error
                Log.e(TAG, "handleSegmentCompleted failed", error)
                updateUiState(
                    status = if (manifest.pendingSegments.isNotEmpty()) "uploading" else _recordingUiState.value.status,
                    errorMessage = error.message ?: "Không xử lý được segment ghi hình mới.",
                )
                restartUploadLoopIfNeeded()
            }
        }
    }

    suspend fun checkStorageBeforeMatchRecording(quality: Quality): RecordingStorageStatus {
        return refreshStorageStatus(quality)
    }

    fun refreshStorageStatusAsync(quality: Quality? = null) {
        scope.launch {
            runCatching {
                refreshStorageStatus(quality)
            }.onFailure { error ->
                if (error is CancellationException) throw error
                Log.e(TAG, "refreshStorageStatusAsync failed", error)
                updateUiState(errorMessage = error.message ?: "Không cập nhật được trạng thái bộ nhớ ghi hình.")
            }
        }
    }

    private suspend fun handleSegmentCompleted(segment: RecordingSegmentClosed) {
        val currentSession = activeSession
        val sessionMatchesCurrent =
            currentSession != null &&
                currentSession.recordingSessionId.isNotBlank() &&
                currentSession.recordingSessionId == segment.recordingSessionId
        val effectiveRecordingId =
            if (sessionMatchesCurrent && currentSession?.isProvisional == false) {
                currentSession.recordingId
            } else {
                segment.recordingId
            }
        val effectiveCourtId = if (sessionMatchesCurrent) currentSession?.courtId else null
        val effectiveMode = if (sessionMatchesCurrent) currentSession?.mode else _selectedMode.value
        val quality = if (sessionMatchesCurrent) currentSession?.quality else null
        val segmentIsProvisional =
            (sessionMatchesCurrent && currentSession?.isProvisional == true) ||
                isProvisionalRecordingId(effectiveRecordingId)
        fun pendingFinalize(): PendingFinalizeRecording =
            PendingFinalizeRecording(
                recordingId = effectiveRecordingId,
                matchId = segment.matchId,
                recordingSessionId = segment.recordingSessionId,
                courtId = effectiveCourtId,
                mode = effectiveMode?.name,
                qualityLabel = quality?.label,
            )

        val segmentFile = File(segment.path)
        val actualSizeBytes =
            segmentFile.takeIf { it.exists() }?.length()?.coerceAtLeast(0L)
                ?: segment.sizeBytes.coerceAtLeast(0L)
        if (actualSizeBytes <= 0L) {
            Log.w(
                TAG,
                "Dropping empty recording segment recordingId=${segment.recordingId} segmentIndex=${segment.segmentIndex} isFinal=${segment.isFinal}",
            )
            runCatching { if (segmentFile.exists()) segmentFile.delete() }
            if (segment.isFinal) {
                manifestMutex.withLock {
                    manifest =
                        manifest.copy(
                            pendingFinalizations =
                                (manifest.pendingFinalizations + pendingFinalize())
                                    .distinctBy { it.recordingId },
                        )
                    persistManifestLocked()
                }
            }
            if (segment.isFinal && (sessionMatchesCurrent || activeSession?.recordingId == effectiveRecordingId)) {
                activeSession = null
                stopRecordingHeartbeatLoop()
                updateUiState(
                    status = "uploading",
                    isRecording = false,
                    pendingUploads = manifest.pendingSegments.size,
                )
            } else {
                updateUiState(pendingUploads = manifest.pendingSegments.size)
            }
            ensureUploadLoop()
            return
        }
        val startedAt =
            segment.startedAtMs
                .takeIf { it > 0L }
                ?.let { Instant.ofEpochMilli(it).toString() }
        val uploadMode =
            if (actualSizeBytes > 0L && actualSizeBytes < MIN_MULTIPART_OBJECT_SIZE_BYTES) {
                "legacy_single_put"
            } else {
                "multipart"
            }
        val segmentEntry =
            PendingRecordingSegment(
                recordingId = effectiveRecordingId,
                recordingSessionId = segment.recordingSessionId,
                matchId = segment.matchId,
                courtId = effectiveCourtId,
                mode = effectiveMode?.name ?: StreamMode.STREAM_AND_RECORD.name,
                qualityLabel = quality?.label ?: "",
                localPath = segment.path,
                segmentIndex = segment.segmentIndex,
                startedAt = startedAt,
                durationSeconds = segment.durationSeconds,
                sizeBytes = actualSizeBytes,
                isFinal = segment.isFinal,
                uploadMode = uploadMode,
                isProvisional = segmentIsProvisional,
            )

        manifestMutex.withLock {
            val deduped = manifest.pendingSegments.filterNot {
                it.recordingId == segmentEntry.recordingId && it.segmentIndex == segmentEntry.segmentIndex
            } + segmentEntry
            val finalizations =
                if (segment.isFinal) {
                    (manifest.pendingFinalizations + pendingFinalize())
                        .distinctBy { it.recordingId }
                } else {
                    manifest.pendingFinalizations
                }
            manifest = manifest.copy(
                pendingSegments = deduped.sortedWith(compareBy({ it.recordingId }, { it.segmentIndex })),
                pendingFinalizations = finalizations,
            )
            persistManifestLocked()
        }

        if (segment.isFinal && (sessionMatchesCurrent || activeSession?.recordingId == effectiveRecordingId)) {
            activeSession = null
            stopRecordingHeartbeatLoop()
            updateUiState(
                status = "uploading",
                isRecording = false,
                pendingUploads = manifest.pendingSegments.size,
            )
        } else {
            updateUiState(pendingUploads = manifest.pendingSegments.size)
        }

        val storage = refreshStorageStatus(quality)
        if (storage.hardBlock && activeSession?.recordingId == segment.recordingId) {
            onStorageExhausted?.invoke(storage)
        }

        ensureUploadLoop()
    }

    private fun startRecordingHeartbeatLoop() {
        if (recordingHeartbeatJob?.isActive == true) return
        recordingHeartbeatJob =
            scope.launch {
                while (true) {
                    activeSession ?: break
                    sendRecordingHeartbeatOnce("periodic")
                    delay(RECORDING_HEARTBEAT_INTERVAL_MS)
                }
            }
    }

    private fun stopRecordingHeartbeatLoop() {
        recordingHeartbeatJob?.cancel()
        recordingHeartbeatJob = null
    }

    private suspend fun sendRecordingHeartbeatOnce(reason: String) {
        val session = activeSession ?: return
        if (session.isProvisional) return
        val pendingSegments =
            manifestMutex.withLock {
                manifest.pendingSegments.filter { it.recordingId == session.recordingId }
            }
        repository.heartbeatRecording(
            recordingId = session.recordingId,
            recordingSessionId = session.recordingSessionId,
            matchId = session.matchId,
            isRecording = _recordingUiState.value.isRecording,
            pendingUploads = pendingSegments.size,
            segmentIndex = pendingSegments.maxOfOrNull { it.segmentIndex },
            clientStatus = _recordingUiState.value.status,
            reason = reason,
        ).onSuccess { payload ->
            syncRecordingRuntimeState(payload.recording)
        }.onFailure { error ->
            Log.w(TAG, "recording heartbeat failed softly: ${error.message}")
        }
    }

    private suspend fun selectNextUploadBatch(now: Long): List<PendingRecordingSegment> {
        return manifestMutex.withLock {
            // Give up on segments stuck after too many retries (encoder/device can't
            // produce a finalized mp4). Drop them so the recording can still finalize
            // from the segments that DID upload ("luôn có record"). The cap is generous
            // → healthy uploads finish in a few tries and never reach it, so good
            // footage is never dropped on working devices.
            val abandoned = manifest.pendingSegments.filter {
                it.retryCount >= MAX_SEGMENT_UPLOAD_RETRIES
            }
            if (abandoned.isNotEmpty()) {
                val abandonedKeys =
                    abandoned.map { it.recordingId to it.segmentIndex }.toSet()
                manifest = manifest.copy(
                    pendingSegments = manifest.pendingSegments.filterNot {
                        (it.recordingId to it.segmentIndex) in abandonedKeys
                    }
                )
                persistManifestLocked()
                abandoned.forEach {
                    Log.w(
                        TAG,
                        "Abandoning stuck segment recordingId=${it.recordingId} " +
                            "index=${it.segmentIndex} after ${it.retryCount} retries; " +
                            "recording will finalize without it.",
                    )
                }
            }
            val readySegments =
                manifest.pendingSegments
                    .filter { it.nextRetryAtMs <= now }
                    .sortedWith(
                        compareBy<PendingRecordingSegment> { it.retryCount }
                            .thenBy { it.segmentIndex }
                    )
            if (readySegments.isEmpty()) {
                return@withLock emptyList()
            }

            val concurrency = computeUploadDrainConcurrency(manifest.pendingSegments.size)
            val firstSegment = readySegments.first()
            if (concurrency <= 1 || firstSegment.requiresSerialUpload()) {
                return@withLock listOf(firstSegment)
            }

            val selected = mutableListOf<PendingRecordingSegment>()
            val selectedRecordingIds = mutableSetOf<String>()
            for (segment in readySegments) {
                if (segment.requiresSerialUpload()) continue
                if (!selectedRecordingIds.add(segment.recordingId)) continue
                selected += segment
                if (selected.size >= concurrency) break
            }

            selected.takeIf { it.isNotEmpty() } ?: listOf(firstSegment)
        }
    }

    private suspend fun uploadPendingSegmentBatch(
        segments: List<PendingRecordingSegment>,
    ): List<Boolean> {
        if (segments.size <= 1) {
            return listOf(uploadPendingSegment(segments.first()))
        }

        return coroutineScope {
            segments
                .map { segment ->
                    async {
                        try {
                            uploadPendingSegment(segment)
                        } catch (error: CancellationException) {
                            throw error
                        } catch (error: Exception) {
                            Log.e(
                                TAG,
                                "uploadPendingSegment batch worker failed recordingId=${segment.recordingId} segmentIndex=${segment.segmentIndex}",
                                error,
                            )
                            false
                        }
                    }
                }.awaitAll()
        }
    }

    private fun ensureUploadLoop() {
        if (uploadJob?.isActive == true) return
        val currentJob =
            scope.launch {
                while (true) {
                    if (!networkAvailableForUploads) {
                        val queueState =
                            manifestMutex.withLock {
                                Pair(
                                    manifest.pendingSegments.size,
                                    manifest.pendingSegments.isNotEmpty() || manifest.pendingFinalizations.isNotEmpty(),
                                )
                            }
                        val pendingUploads = queueState.first
                        val hasPendingWork = queueState.second
                        if (!hasPendingWork) break
                        if (pendingUploads > 0) {
                            updateUiState(
                                status = "uploading",
                                pendingUploads = pendingUploads,
                            )
                        }
                        delay(OFFLINE_UPLOAD_RECHECK_DELAY_MS)
                        continue
                    }

                    val now = System.currentTimeMillis()
                    val uploadWaitMs = nextUploadAllowedAtMs - now
                    if (uploadWaitMs > 0L) {
                        delay(uploadWaitMs.coerceIn(500L, OFFLINE_UPLOAD_RECHECK_DELAY_MS))
                        continue
                    }

                    val nextSegments = selectNextUploadBatch(now)

                    if (nextSegments.isEmpty()) {
                        val queueState =
                            manifestMutex.withLock {
                                val readyFinalizations =
                                    manifest.pendingFinalizations.filter { it.nextRetryAtMs <= now }
                                val nextRetryAt =
                                    (manifest.pendingSegments.map { it.nextRetryAtMs } +
                                        manifest.pendingFinalizations.map { it.nextRetryAtMs })
                                        .filter { it > now }
                                        .minOrNull()
                                Triple(
                                    readyFinalizations,
                                    manifest.pendingSegments.isNotEmpty() || manifest.pendingFinalizations.isNotEmpty(),
                                    nextRetryAt,
                                )
                            }
                        val readyFinalizations = queueState.first
                        val hasPendingWork = queueState.second
                        val nextRetryAt = queueState.third
                        if (!hasPendingWork) break

                        if (readyFinalizations.isNotEmpty()) {
                            val attempted = finalizeIfReady(readyFinalizations)
                            if (!attempted) delay(2_000L)
                            continue
                        }

                        val delayMs =
                            nextRetryAt
                                ?.let { (it - System.currentTimeMillis()).coerceIn(2_000L, 5_000L) }
                                ?: 5_000L
                        delay(delayMs)
                        continue
                    }

                    if (shouldYieldForLiveCriticalPath()) {
                        delay(1_500L)
                    }
                    if (!networkAvailableForUploads) {
                        continue
                    }

                    val results = uploadPendingSegmentBatch(nextSegments)
                    val successCount = results.count { it }
                    if (successCount == 0) {
                        delay(2_000L)
                    } else {
                        val pendingUploads =
                            manifestMutex.withLock {
                                manifest.pendingSegments.size
                            }
                        nextUploadAllowedAtMs = maxOf(
                            nextUploadAllowedAtMs,
                            System.currentTimeMillis() + computeUploadSpacingMs(pendingUploads),
                        )
                    }
                }
            }
        uploadJob = currentJob
        currentJob.invokeOnCompletion { error ->
            if (uploadJob === currentJob) {
                uploadJob = null
            }
            if (error != null && error !is CancellationException) {
                Log.e(TAG, "Upload loop crashed", error)
                updateUiState(
                    status = if (manifest.pendingSegments.isNotEmpty()) "uploading" else _recordingUiState.value.status,
                    errorMessage = error.message ?: "Đã chặn lỗi upload nền để tránh crash app.",
                )
            }
            restartUploadLoopIfNeeded()
        }
    }

    private fun restartUploadLoopIfNeeded() {
        if (uploadJob?.isActive == true) return
        scope.launch {
            val hasPendingWork =
                manifestMutex.withLock {
                    manifest.pendingSegments.isNotEmpty() || manifest.pendingFinalizations.isNotEmpty()
                }
            if (hasPendingWork) {
                ensureUploadLoop()
            }
        }
    }

    private fun PendingRecordingSegment.normalizedCompletedParts(): List<PendingRecordingPart> {
        return (completedParts ?: emptyList())
            .filter { it.partNumber > 0 && it.etag.isNotBlank() }
            .sortedBy { it.partNumber }
    }

    private fun PendingRecordingSegment.normalizedPartSizeBytes(): Long {
        return (partSizeBytes ?: DEFAULT_MULTIPART_PART_SIZE_BYTES)
            .coerceAtLeast(DEFAULT_MULTIPART_PART_SIZE_BYTES)
    }

    private fun PendingRecordingSegment.normalizedNextByteOffset(): Long {
        val persisted = (nextByteOffset ?: 0L).coerceAtLeast(0L)
        val computed = normalizedCompletedParts().sumOf { max(0L, it.sizeBytes) }
        return max(persisted, computed)
    }

    private fun abbreviateErrorBody(raw: String?): String? {
        val normalized = raw?.replace(Regex("\\s+"), " ")?.trim().orEmpty()
        if (normalized.isBlank()) return null
        return normalized.take(220)
    }

    private fun shouldResetMultipartSessionAfterFailure(error: Throwable): Boolean {
        if (error is CancellationException) return false
        if (error is RetryableRecordingSegmentCompleteException) return false
        if (error is MultipartUploadPartHttpException) return true
        val normalized = error.message?.lowercase().orEmpty()
        return (
            normalized.contains("multipart") ||
                normalized.contains("upload part") ||
                normalized.contains("connection") ||
                normalized.contains("timeout") ||
                normalized.contains("failed")
            )
    }

    private suspend fun resetPendingSegmentForMultipartRetry(
        segment: PendingRecordingSegment,
        nextRetryAtMs: Long,
    ) {
        replacePendingSegment(
            segment.copy(
                uploadMode = "multipart",
                uploadId = null,
                objectKey = null,
                partSizeBytes = null,
                completedParts = emptyList(),
                nextByteOffset = 0L,
                retryCount = segment.retryCount + 1,
                nextRetryAtMs = nextRetryAtMs,
            )
        )
    }

    private suspend fun replacePendingSegment(updated: PendingRecordingSegment) {
        manifestMutex.withLock {
            manifest = manifest.copy(
                pendingSegments =
                    manifest.pendingSegments.map {
                        if (it.recordingId == updated.recordingId && it.segmentIndex == updated.segmentIndex) {
                            updated
                        } else {
                            it
                        }
                    }
            )
            persistManifestLocked()
        }
    }

    private suspend fun scheduleProvisionalBindRetry(
        recordingId: String,
        recordingSessionId: String,
        retryCountHint: Int,
        error: Throwable,
    ) {
        val delayMs = computeRetryDelayMs(retryCountHint + 1)
        val nextRetryAtMs = System.currentTimeMillis() + delayMs
        var pendingUploads = 0
        manifestMutex.withLock {
            manifest =
                manifest.copy(
                    pendingSegments =
                        manifest.pendingSegments.map { segment ->
                            if (
                                segment.recordingId == recordingId &&
                                segment.recordingSessionId == recordingSessionId
                            ) {
                                segment.copy(
                                    retryCount = segment.retryCount + 1,
                                    nextRetryAtMs = nextRetryAtMs,
                                )
                            } else {
                                segment
                            }
                        },
                    pendingFinalizations =
                        manifest.pendingFinalizations.map { finalize ->
                            if (
                                finalize.recordingId == recordingId &&
                                finalize.recordingSessionId == recordingSessionId
                            ) {
                                finalize.copy(
                                    retryCount = finalize.retryCount + 1,
                                    nextRetryAtMs = nextRetryAtMs,
                                )
                            } else {
                                finalize
                            }
                        },
                )
            pendingUploads = manifest.pendingSegments.size
            persistManifestLocked()
        }
        Log.w(TAG, "Bind provisional recording failed; will retry recordingId=$recordingId", error)
        updateUiState(
            pendingUploads = pendingUploads,
            status = if (_recordingUiState.value.isRecording) "recording" else "uploading",
            errorMessage = null,
        )
    }

    private suspend fun bindProvisionalRecordingForSegment(
        segment: PendingRecordingSegment,
    ): PendingRecordingSegment? {
        if (!segment.isProvisional && !isProvisionalRecordingId(segment.recordingId)) {
            return segment
        }
        val recordingSessionId = segment.recordingSessionId.trim()
        if (recordingSessionId.isBlank()) {
            scheduleProvisionalBindRetry(
                recordingId = segment.recordingId,
                recordingSessionId = segment.recordingSessionId,
                retryCountHint = segment.retryCount,
                error = IllegalStateException("Missing provisional recordingSessionId"),
            )
            return null
        }

        val mode = modeFromName(segment.mode)
        val quality = qualityFromLabel(segment.qualityLabel)
        val response =
            repository.startMatchRecordingSession(
                matchId = segment.matchId,
                courtId = segment.courtId,
                mode = mode,
                quality = quality,
                recordingSessionId = recordingSessionId,
            ).getOrElse { error ->
                scheduleProvisionalBindRetry(
                    recordingId = segment.recordingId,
                    recordingSessionId = recordingSessionId,
                    retryCountHint = segment.retryCount,
                    error = error,
                )
                return null
            }

        val recording = response.recording
            ?: run {
                scheduleProvisionalBindRetry(
                    recordingId = segment.recordingId,
                    recordingSessionId = recordingSessionId,
                    retryCountHint = segment.retryCount,
                    error = IllegalStateException("Server did not return recording for provisional bind"),
                )
                return null
            }
        val serverRecordingId = recording.id.trim()
        if (serverRecordingId.isBlank() || isProvisionalRecordingId(serverRecordingId)) {
            scheduleProvisionalBindRetry(
                recordingId = segment.recordingId,
                recordingSessionId = recordingSessionId,
                retryCountHint = segment.retryCount,
                error = IllegalStateException("Server returned invalid recording id for provisional bind"),
            )
            return null
        }

        val oldRecordingId = segment.recordingId
        var reboundSegment: PendingRecordingSegment? = null
        var pendingUploads = 0
        manifestMutex.withLock {
            val nextSegments =
                manifest.pendingSegments.map { pending ->
                    if (
                        pending.recordingId == oldRecordingId &&
                        pending.recordingSessionId == recordingSessionId
                    ) {
                        pending.copy(
                            recordingId = serverRecordingId,
                            isProvisional = false,
                            uploadId = null,
                            objectKey = null,
                            partSizeBytes = null,
                            completedParts = null,
                            nextByteOffset = null,
                            retryCount = 0,
                            nextRetryAtMs = 0L,
                        ).also {
                            if (pending.segmentIndex == segment.segmentIndex) {
                                reboundSegment = it
                            }
                        }
                    } else {
                        pending
                    }
                }
            val nextFinalizations =
                manifest.pendingFinalizations.map { finalize ->
                    if (
                        finalize.recordingId == oldRecordingId &&
                        finalize.recordingSessionId == recordingSessionId
                    ) {
                        finalize.copy(
                            recordingId = serverRecordingId,
                            retryCount = 0,
                            nextRetryAtMs = 0L,
                        )
                    } else {
                        finalize
                    }
                }
            manifest =
                manifest.copy(
                    pendingSegments = nextSegments,
                    pendingFinalizations = nextFinalizations,
                )
            pendingUploads = manifest.pendingSegments.size
            persistManifestLocked()
        }

        clearSinglePutPresignCache(oldRecordingId)
        clearLiveManifestPresignCache(oldRecordingId)
        clearSinglePutPresignCache(serverRecordingId)
        clearLiveManifestPresignCache(serverRecordingId)

        val currentSession = activeSession
        if (
            currentSession != null &&
            (
                currentSession.recordingId == oldRecordingId ||
                    currentSession.recordingSessionId == recordingSessionId
                )
        ) {
            activeSession =
                currentSession.copy(
                    recordingId = serverRecordingId,
                    recordingSessionId = recording.recordingSessionId.ifBlank { recordingSessionId },
                    matchId = recording.matchId.ifBlank { currentSession.matchId },
                    courtId = recording.courtId ?: currentSession.courtId,
                    playbackUrl = recording.playbackUrl ?: currentSession.playbackUrl,
                    storageTargetId = recording.r2TargetId ?: currentSession.storageTargetId,
                    storageBucketName = recording.r2BucketName ?: currentSession.storageBucketName,
                    latestStorageFailover =
                        resolveLatestStorageFailover(recording) ?: currentSession.latestStorageFailover,
                    isProvisional = false,
                )
            updateUiState(
                activeMatchId = activeSession?.matchId,
                activeRecordingId = serverRecordingId,
                activeRecordingSessionId = activeSession?.recordingSessionId,
                playbackUrl = activeSession?.playbackUrl,
                activeStorageTargetId = activeSession?.storageTargetId,
                activeStorageBucketName = activeSession?.storageBucketName,
                latestStorageFailover = activeSession?.latestStorageFailover,
                pendingUploads = pendingUploads,
                errorMessage = null,
            )
            if (_recordingUiState.value.isRecording) {
                startRecordingHeartbeatLoop()
            }
        }

        syncRecordingRuntimeState(recording)
        return reboundSegment
            ?: segment.copy(
                recordingId = serverRecordingId,
                isProvisional = false,
                uploadId = null,
                objectKey = null,
                partSizeBytes = null,
                completedParts = null,
                nextByteOffset = null,
                retryCount = 0,
                nextRetryAtMs = 0L,
            )
    }

    private suspend fun bindProvisionalRecordingForFinalize(
        finalize: PendingFinalizeRecording,
    ): PendingFinalizeRecording? {
        if (!isProvisionalRecordingId(finalize.recordingId)) return finalize
        val recordingSessionId = finalize.recordingSessionId?.trim().orEmpty()
        if (recordingSessionId.isBlank()) {
            val delayMs = computeRetryDelayMs(finalize.retryCount + 1)
            manifestMutex.withLock {
                manifest =
                    manifest.copy(
                        pendingFinalizations =
                            manifest.pendingFinalizations.map {
                                if (it.recordingId == finalize.recordingId) {
                                    it.copy(
                                        retryCount = it.retryCount + 1,
                                        nextRetryAtMs = System.currentTimeMillis() + delayMs,
                                    )
                                } else {
                                    it
                                }
                            }
                    )
                persistManifestLocked()
            }
            return null
        }

        val bound =
            bindProvisionalRecordingForSegment(
                PendingRecordingSegment(
                    recordingId = finalize.recordingId,
                    recordingSessionId = recordingSessionId,
                    matchId = finalize.matchId,
                    courtId = finalize.courtId,
                    mode = finalize.mode ?: StreamMode.STREAM_AND_RECORD.name,
                    qualityLabel = finalize.qualityLabel ?: Quality.DEFAULT.label,
                    localPath = "",
                    segmentIndex = -1,
                    durationSeconds = 0.0,
                    sizeBytes = 0L,
                    isFinal = true,
                    isProvisional = true,
                )
            ) ?: return null

        return manifestMutex.withLock {
            manifest.pendingFinalizations.firstOrNull {
                it.recordingId == bound.recordingId &&
                    it.recordingSessionId == recordingSessionId
            } ?: finalize.copy(
                recordingId = bound.recordingId,
                retryCount = 0,
                nextRetryAtMs = 0L,
            )
        }
    }

    private suspend fun cacheSinglePutPresigns(
        recordingId: String,
        entries: List<CachedSinglePutPresignEntry>,
    ) {
        if (entries.isEmpty()) return
        presignCacheMutex.withLock {
            val bucket = singlePutPresignCache.getOrPut(recordingId) { linkedMapOf() }
            entries.forEach { entry ->
                bucket[entry.segmentIndex] =
                    CachedSinglePutPresign(
                        objectKey = entry.objectKey,
                        upload = entry.upload,
                    )
            }
        }
    }

    private suspend fun takeCachedSinglePutPresign(
        recordingId: String,
        segmentIndex: Int,
    ): CachedSinglePutPresign? =
        presignCacheMutex.withLock {
            val bucket = singlePutPresignCache[recordingId] ?: return@withLock null
            val hit = bucket.remove(segmentIndex)
            if (bucket.isEmpty()) {
                singlePutPresignCache.remove(recordingId)
            }
            hit
        }

    private suspend fun clearSinglePutPresignCache(recordingId: String? = null) {
        presignCacheMutex.withLock {
            if (recordingId.isNullOrBlank()) {
                singlePutPresignCache.clear()
            } else {
                singlePutPresignCache.remove(recordingId)
            }
        }
    }

    private suspend fun clearLiveManifestPresignCache(recordingId: String? = null) {
        presignCacheMutex.withLock {
            if (recordingId.isNullOrBlank()) {
                liveManifestPresignCache.clear()
            } else {
                liveManifestPresignCache.remove(recordingId)
            }
        }
    }

    private suspend fun ensureLiveManifestPresign(
        recordingId: String,
    ): CachedLiveManifestPresign {
        presignCacheMutex.withLock {
            liveManifestPresignCache[recordingId]?.let { return it }
        }

        val response = repository.presignRecordingLiveManifest(recordingId).getOrThrow()
        val livePlayback =
            response.livePlayback
                ?: throw IllegalStateException("Server kh?ng tr? livePlayback cho manifest.")
        val upload =
            response.upload
                ?: throw IllegalStateException("Server kh?ng tr? upload URL cho manifest.")
        val hlsUpload =
            response.hlsUpload
                ?: throw IllegalStateException("Server missing HLS manifest upload URL.")
        val manifestObjectKey = livePlayback.manifestObjectKey?.trim().orEmpty()
        val manifestUrl = livePlayback.manifestUrl?.trim().orEmpty()
        val hlsManifestObjectKey = livePlayback.hlsManifestObjectKey?.trim().orEmpty()
        val hlsManifestUrl = livePlayback.hlsManifestUrl?.trim().orEmpty()
        val publicBaseUrl = livePlayback.publicBaseUrl?.trim().orEmpty()
        if (
            manifestObjectKey.isBlank() ||
            manifestUrl.isBlank() ||
            hlsManifestObjectKey.isBlank() ||
            hlsManifestUrl.isBlank() ||
            publicBaseUrl.isBlank()
        ) {
            throw IllegalStateException("Live manifest CDN ch?a ???c c?u h?nh ??y ??.")
        }
        val targetPublicBaseUrls =
            livePlayback.targetPublicBaseUrls
                .mapNotNull { (targetId, baseUrl) ->
                    val normalizedTargetId = targetId.trim()
                    val normalizedBaseUrl = baseUrl.trim().trimEnd('/')
                    if (normalizedTargetId.isBlank() || normalizedBaseUrl.isBlank()) {
                        null
                    } else {
                        normalizedTargetId to normalizedBaseUrl
                    }
                }
                .toMap()

        val cached =
            CachedLiveManifestPresign(
                manifestObjectKey = manifestObjectKey,
                manifestUrl = manifestUrl,
                hlsManifestObjectKey = hlsManifestObjectKey,
                hlsManifestUrl = hlsManifestUrl,
                publicBaseUrl = publicBaseUrl.trimEnd('/'),
                targetPublicBaseUrls = targetPublicBaseUrls,
                delaySeconds = livePlayback.delaySeconds.coerceAtLeast(15),
                upload = upload,
                hlsUpload = hlsUpload,
            )
        presignCacheMutex.withLock {
            liveManifestPresignCache[recordingId] = cached
        }
        return cached
    }

    private fun buildPublicObjectUrl(baseUrl: String, objectKey: String): String {
        val base = baseUrl.trim().trimEnd('/')
        val key = objectKey.trim().trimStart('/')
        return "$base/$key"
    }

    private fun buildSegmentPublicUrl(
        segment: com.pkt.live.data.model.MatchRecordingSegment,
        recording: MatchRecording,
        cachedManifest: CachedLiveManifestPresign,
    ): String {
        val segmentTargetId = segment.storageTargetId?.trim().orEmpty()
        val recordingTargetId = recording.r2TargetId?.trim().orEmpty()
        val baseUrl =
            when {
                segmentTargetId.isNotBlank() ->
                    cachedManifest.targetPublicBaseUrls[segmentTargetId].orEmpty()
                recordingTargetId.isNotBlank() ->
                    cachedManifest.targetPublicBaseUrls[recordingTargetId].orEmpty()
                else -> ""
            }.ifBlank { cachedManifest.publicBaseUrl }
        return buildPublicObjectUrl(baseUrl, segment.objectKey)
    }

    private fun getLiveManifestRefreshSeconds(
        segments: List<com.pkt.live.data.model.MatchRecordingSegment>,
        isFinished: Boolean,
    ): Int {
        if (isFinished) return 0
        val recentDurations =
            segments
                .takeLast(6)
                .map { max(0.0, it.durationSeconds) }
                .filter { it > 0.0 }
        if (recentDurations.isEmpty()) {
            return 4
        }
        val averageDuration = recentDurations.sum() / recentDurations.size.toDouble()
        return averageDuration.roundToInt().coerceIn(2, 6)
    }

    private fun getLiveManifestTargetDurationSeconds(
        segments: List<com.pkt.live.data.model.MatchRecordingSegment>,
    ): Int {
        val maxDuration = segments.maxOfOrNull { max(0.0, it.durationSeconds) } ?: 0.0
        val wholeSeconds = maxDuration.toInt()
        return when {
            maxDuration <= 0.0 -> 1
            maxDuration > wholeSeconds.toDouble() -> wholeSeconds + 1
            else -> wholeSeconds.coerceAtLeast(1)
        }
    }

    private fun getLiveManifestRecommendedStartIndex(
        segments: List<com.pkt.live.data.model.MatchRecordingSegment>,
        isFinished: Boolean,
    ): Int? {
        if (segments.isEmpty()) return null
        if (isFinished) return segments.first().index

        val desiredBufferedSeconds = 12.0
        val totalDurationSeconds = segments.sumOf { max(0.0, it.durationSeconds) }
        val targetOffset = max(0.0, totalDurationSeconds - desiredBufferedSeconds)
        var elapsed = 0.0
        segments.forEach { segment ->
            val duration = max(0.0, segment.durationSeconds)
            if (elapsed + duration > targetOffset) {
                return segment.index
            }
            elapsed += duration
        }
        return segments.first().index
    }

    private fun getUploadedLiveManifestSegments(
        recording: MatchRecording,
    ): List<com.pkt.live.data.model.MatchRecordingSegment> =
        recording.segments
            .filter { it.uploadStatus.equals("uploaded", ignoreCase = true) && it.objectKey.isNotBlank() }
            .sortedBy { it.index }

    private fun isLiveManifestFinished(recording: MatchRecording): Boolean {
        val finalPlaybackUrl = recording.livePlayback?.finalPlaybackUrl?.takeIf { it.isNotBlank() }
        return finalPlaybackUrl != null ||
            recording.status.equals("ready", ignoreCase = true) ||
            recording.status.equals("finished", ignoreCase = true) ||
            recording.status.equals("finalized", ignoreCase = true)
    }

    private fun buildLiveManifestSourceSegments(
        uploadedSegments: List<com.pkt.live.data.model.MatchRecordingSegment>,
        delaySeconds: Int,
        isFinished: Boolean,
    ): List<com.pkt.live.data.model.MatchRecordingSegment> {
        if (uploadedSegments.isEmpty()) return emptyList()
        if (isFinished) return uploadedSegments

        val totalDurationSeconds = uploadedSegments.sumOf { max(0.0, it.durationSeconds) }
        val safeDurationSeconds = max(0.0, totalDurationSeconds - delaySeconds.toDouble())
        var cumulativeDuration = 0.0
        val safeSegments = mutableListOf<com.pkt.live.data.model.MatchRecordingSegment>()
        for (segment in uploadedSegments) {
            cumulativeDuration += max(0.0, segment.durationSeconds)
            if (cumulativeDuration - safeDurationSeconds > 0.0001) {
                break
            }
            safeSegments += segment
        }

        return if (safeSegments.size > LIVE_MANIFEST_MAX_SEGMENTS) {
            safeSegments.takeLast(LIVE_MANIFEST_MAX_SEGMENTS)
        } else {
            safeSegments
        }
    }

    private fun buildLiveManifestPayload(
        recording: MatchRecording,
        cachedManifest: CachedLiveManifestPresign,
    ): Map<String, Any?> {
        val uploadedSegments = getUploadedLiveManifestSegments(recording)
        val totalDurationSeconds = uploadedSegments.sumOf { max(0.0, it.durationSeconds) }
        val finalPlaybackUrl = recording.livePlayback?.finalPlaybackUrl?.takeIf { it.isNotBlank() }
        val isFinished = isLiveManifestFinished(recording)
        val manifestSourceSegments =
            buildLiveManifestSourceSegments(
                uploadedSegments = uploadedSegments,
                delaySeconds = cachedManifest.delaySeconds,
                isFinished = isFinished,
            )

        val manifestSegments =
            manifestSourceSegments.map { segment ->
                mapOf(
                    "index" to segment.index,
                    "durationSeconds" to segment.durationSeconds,
                    "url" to buildSegmentPublicUrl(segment, recording, cachedManifest),
                )
            }
        val refreshSeconds = getLiveManifestRefreshSeconds(uploadedSegments, isFinished)
        val targetDurationSeconds = getLiveManifestTargetDurationSeconds(manifestSourceSegments)
        val recommendedStartIndex =
            getLiveManifestRecommendedStartIndex(
                segments = manifestSourceSegments,
                isFinished = isFinished,
            )

        val status =
            when {
                finalPlaybackUrl != null -> "final"
                recording.status.equals("ready", ignoreCase = true) -> "finished"
                manifestSegments.isNotEmpty() -> "live"
                uploadedSegments.isNotEmpty() -> "preparing"
                else -> "pending"
            }

        return mapOf(
            "version" to 1,
            "matchId" to recording.matchId,
            "recordingId" to recording.id,
            "delaySeconds" to cachedManifest.delaySeconds,
            "refreshSeconds" to refreshSeconds,
            "targetDurationSeconds" to targetDurationSeconds,
            "windowSegmentCount" to manifestSegments.size,
            "recommendedStartIndex" to recommendedStartIndex,
            "usesSafeLiveWindow" to !isFinished,
            "status" to status,
            "updatedAt" to System.currentTimeMillis(),
            "finalPlaybackUrl" to finalPlaybackUrl,
            "segments" to manifestSegments,
        )
    }

    private fun buildLiveHlsManifestPayload(
        recording: MatchRecording,
        cachedManifest: CachedLiveManifestPresign,
    ): String {
        val uploadedSegments = getUploadedLiveManifestSegments(recording)
        val isFinished = isLiveManifestFinished(recording)
        val manifestSourceSegments =
            buildLiveManifestSourceSegments(
                uploadedSegments = uploadedSegments,
                delaySeconds = cachedManifest.delaySeconds,
                isFinished = isFinished,
            )

        if (manifestSourceSegments.isEmpty()) {
            return buildString {
                append("#EXTM3U\n")
                append("#EXT-X-VERSION:3\n")
                append("#EXT-X-TARGETDURATION:6\n")
                append("#EXT-X-MEDIA-SEQUENCE:0\n")
            }
        }

        val targetDurationSeconds =
            getLiveManifestTargetDurationSeconds(manifestSourceSegments).coerceAtLeast(1)
        val mediaSequence = manifestSourceSegments.firstOrNull()?.index ?: 0

        return buildString {
            append("#EXTM3U\n")
            append("#EXT-X-VERSION:3\n")
            append("#EXT-X-INDEPENDENT-SEGMENTS\n")
            append(
                if (isFinished) {
                    "#EXT-X-PLAYLIST-TYPE:VOD\n"
                } else {
                    "#EXT-X-PLAYLIST-TYPE:EVENT\n"
                }
            )
            if (!isFinished) {
                append(
                    "#EXT-X-START:TIME-OFFSET=-${cachedManifest.delaySeconds.coerceAtLeast(12)},PRECISE=NO\n",
                )
            }
            append("#EXT-X-TARGETDURATION:$targetDurationSeconds\n")
            append("#EXT-X-MEDIA-SEQUENCE:$mediaSequence\n")
            append("\n")
            manifestSourceSegments.forEach { segment ->
                val durationSeconds =
                    max(0.0, segment.durationSeconds).takeIf { it > 0.0 } ?: 6.0
                append("#EXTINF:${String.format(Locale.US, "%.3f", durationSeconds)},\n")
                append(buildSegmentPublicUrl(segment, recording, cachedManifest))
                append("\n")
            }
            if (isFinished) {
                append("\n#EXT-X-ENDLIST\n")
            }
        }
    }

    private fun executeTrackedUploadCall(request: Request): okhttp3.Response {
        val call = okHttpClient.newCall(request)
        activeUploadCalls.add(call)
        return try {
            call.execute()
        } finally {
            activeUploadCalls.remove(call)
        }
    }

    private suspend fun uploadLiveManifestBody(
        upload: RecordingPresignedUpload,
        body: RequestBody,
        failureMessage: String,
    ) {
        val requestBuilder =
            Request.Builder()
                .url(upload.uploadUrl)
                .put(body)
        upload.headers?.forEach { (key, value) ->
            requestBuilder.header(key, value)
        }
        val response = executeTrackedUploadCall(requestBuilder.build())
        response.use { resp ->
            if (!resp.isSuccessful) {
                throw IllegalStateException("$failureMessage (${resp.code})")
            }
        }
    }

    private suspend fun publishLiveManifestIfPossible(recording: MatchRecording?) {
        if (recording == null) return
        val livePlayback = recording.livePlayback ?: return
        if (!livePlayback.enabled) return

        var lastError: Throwable? = null
        repeat(2) { attempt ->
            try {
                val cachedManifest = ensureLiveManifestPresign(recording.id)
                val hlsPayload = buildLiveHlsManifestPayload(recording, cachedManifest)
                uploadLiveManifestBody(
                    upload = cachedManifest.hlsUpload,
                    body =
                        hlsPayload.toRequestBody(
                            "application/vnd.apple.mpegurl".toMediaType(),
                        ),
                    failureMessage = "Upload live HLS manifest failed",
                )
                val payload = buildLiveManifestPayload(recording, cachedManifest)
                uploadLiveManifestBody(
                    upload = cachedManifest.upload,
                    body =
                        gson
                            .toJson(payload)
                            .toRequestBody("application/json; charset=utf-8".toMediaType()),
                    failureMessage = "Upload live manifest failed",
                )
                return
            } catch (error: Exception) {
                lastError = error
                clearLiveManifestPresignCache(recording.id)
                if (attempt == 1) {
                    throw error
                }
            }
        }

        throw lastError ?: IllegalStateException("Upload live manifest th?t b?i.")
    }

    private suspend fun ensureSinglePutPresign(
        recordingId: String,
        segmentIndex: Int,
    ): CachedSinglePutPresign {
        takeCachedSinglePutPresign(recordingId, segmentIndex)?.let { return it }

        repository
            .presignRecordingSegmentBatch(
                recordingId = recordingId,
                startSegmentIndex = segmentIndex,
                count = SINGLE_PUT_PRESIGN_BATCH_SIZE,
            ).getOrNull()
            ?.segments
            ?.mapNotNull { segment ->
                val upload = segment.upload ?: return@mapNotNull null
                val objectKey = segment.objectKey?.trim().orEmpty()
                if (objectKey.isBlank()) return@mapNotNull null
                CachedSinglePutPresignEntry(
                    segmentIndex = segment.segmentIndex,
                    objectKey = objectKey,
                    upload = upload,
                )
            }
            ?.takeIf { it.isNotEmpty() }
            ?.let { batchEntries ->
                cacheSinglePutPresigns(recordingId, batchEntries)
                takeCachedSinglePutPresign(recordingId, segmentIndex)?.let { return it }
            }

        val presigned =
            repository.presignRecordingSegment(
                recordingId = recordingId,
                segmentIndex = segmentIndex,
            ).getOrThrow()
        val upload =
            presigned.upload
                ?: throw IllegalStateException("Server không trả upload URL cho segment.")
        val objectKey = upload.objectKey.ifBlank { presigned.objectKey ?: "" }.trim()
        if (objectKey.isBlank()) {
            throw IllegalStateException("Server không trả object key hợp lệ cho segment.")
        }
        return CachedSinglePutPresign(
            objectKey = objectKey,
            upload = upload,
        )
    }

    private data class CachedSinglePutPresignEntry(
        val segmentIndex: Int,
        val objectKey: String,
        val upload: RecordingPresignedUpload,
    )

    private fun readFilePart(
        file: File,
        offset: Long,
        expectedBytes: Int,
    ): ByteArray {
        RandomAccessFile(file, "r").use { raf ->
            raf.seek(offset)
            val buffer = ByteArray(expectedBytes)
            val bytesRead = raf.read(buffer)
            if (bytesRead <= 0) {
                throw IllegalStateException("Không đọc được part từ file segment.")
            }
            return if (bytesRead == expectedBytes) buffer else buffer.copyOf(bytesRead)
        }
    }

    private fun ByteArray.containsSequence(needle: ByteArray): Boolean {
        if (needle.isEmpty() || size < needle.size) return false
        for (index in 0..(size - needle.size)) {
            var matched = true
            for (needleIndex in needle.indices) {
                if (this[index + needleIndex] != needle[needleIndex]) {
                    matched = false
                    break
                }
            }
            if (matched) return true
        }
        return false
    }

    private fun fileHasMp4ContainerHeader(file: File): Boolean =
        runCatching {
            val headBytes = minOf(64L, file.length()).toInt()
            if (headBytes < 12) return@runCatching false
            val head = readFilePart(file, 0L, headBytes)
            head.containsSequence(MP4_FTYP_ATOM) || head.containsSequence(MP4_MOOV_ATOM)
        }.getOrDefault(false)

    private fun fileHasMp4MediaDataAtom(file: File): Boolean =
        runCatching {
            val headBytes = minOf(MP4_HEAD_SCAN_BYTES.toLong(), file.length()).toInt()
            if (headBytes < 12) return@runCatching false
            readFilePart(file, 0L, headBytes).containsSequence(MP4_MDAT_ATOM)
        }.getOrDefault(false)

    private fun fileHasReadableMp4Metadata(file: File): Boolean {
        if (!file.exists() || file.length() < 8L) return false
        if (!fileHasMp4ContainerHeader(file)) return false
        if (!fileHasMp4MediaDataAtom(file)) return false

        return runCatching {
            val retriever = MediaMetadataRetriever()
            try {
                retriever.setDataSource(file.absolutePath)
                val durationMs =
                    retriever
                        .extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                        ?.toLongOrNull()
                        ?: 0L
                durationMs > 0L
            } finally {
                runCatching { retriever.release() }
            }
        }.getOrDefault(false)
    }

    private suspend fun awaitSegmentReadyForUpload(file: File): Long {
        val deadline = System.currentTimeMillis() + MP4_READY_CHECK_TIMEOUT_MS
        var lastSizeBytes = -1L
        var stableReadCount = 0

        while (true) {
            val currentSizeBytes = file.takeIf { it.exists() }?.length()?.coerceAtLeast(0L) ?: 0L
            if (currentSizeBytes > 0L) {
                stableReadCount = if (currentSizeBytes == lastSizeBytes) stableReadCount + 1 else 0
                if (stableReadCount >= 1 && fileHasReadableMp4Metadata(file)) {
                    return currentSizeBytes
                }
            }

            if (System.currentTimeMillis() >= deadline) break
            lastSizeBytes = currentSizeBytes
            delay(MP4_READY_CHECK_INTERVAL_MS)
        }

        val finalSizeBytes = file.takeIf { it.exists() }?.length()?.coerceAtLeast(0L) ?: 0L
        if (finalSizeBytes > 0L && fileHasReadableMp4Metadata(file)) {
            return finalSizeBytes
        }
        throw IllegalStateException("Segment MP4 chưa đóng xong, sẽ thử tải lại.")
    }

    private suspend fun deferPendingSegmentUntilMp4Ready(segment: PendingRecordingSegment) {
        val nextRetryCount = segment.retryCount + 1
        val delayMs =
            if (nextRetryCount <= 3) {
                MP4_NOT_READY_RETRY_MS
            } else {
                computeRetryDelayMs(nextRetryCount)
            }
        val nextRetryAtMs = System.currentTimeMillis() + delayMs
        manifestMutex.withLock {
            manifest =
                manifest.copy(
                    pendingSegments =
                        manifest.pendingSegments.map {
                            if (it.recordingId == segment.recordingId && it.segmentIndex == segment.segmentIndex) {
                                it.copy(
                                    retryCount = nextRetryCount,
                                    nextRetryAtMs = nextRetryAtMs,
                                )
                            } else {
                                it
                            }
                        }
                )
            persistManifestLocked()
        }
        Log.w(
            TAG,
            "Recording segment is not finalized yet; retry later recordingId=${segment.recordingId} segmentIndex=${segment.segmentIndex}",
        )
        updateUiState(
            pendingUploads = manifest.pendingSegments.size,
            status = "uploading",
            errorMessage = null,
        )
    }

    private suspend fun uploadPendingSegmentMultipart(
        segment: PendingRecordingSegment,
        file: File,
    ): Boolean {
        var currentSegment = segment
        if (currentSegment.uploadId.isNullOrBlank() || currentSegment.objectKey.isNullOrBlank()) {
            val startResponse =
                repository.startMultipartRecordingSegment(
                    recordingId = currentSegment.recordingId,
                    segmentIndex = currentSegment.segmentIndex,
                    startedAt = currentSegment.startedAt,
                ).getOrThrow()

            if (startResponse.alreadyUploaded) {
                runCatching { file.delete() }
                manifestMutex.withLock {
                    manifest = manifest.copy(
                        pendingSegments = manifest.pendingSegments.filterNot {
                            it.recordingId == currentSegment.recordingId &&
                                it.segmentIndex == currentSegment.segmentIndex
                        }
                    )
                    persistManifestLocked()
                }
                updateUiState(pendingUploads = manifest.pendingSegments.size)
                refreshStorageStatus(activeSession?.quality)
                return true
            }

            currentSegment =
                currentSegment.copy(
                    uploadMode = "multipart",
                    uploadId = startResponse.uploadId,
                    objectKey = startResponse.objectKey ?: currentSegment.objectKey,
                    partSizeBytes =
                        if (startResponse.partSizeBytes > 0L) startResponse.partSizeBytes
                        else currentSegment.normalizedPartSizeBytes(),
                    completedParts = currentSegment.normalizedCompletedParts(),
                    nextByteOffset = currentSegment.normalizedNextByteOffset(),
                )
            replacePendingSegment(currentSegment)
        }

        val partSizeBytes = currentSegment.normalizedPartSizeBytes()
        var completedParts = currentSegment.normalizedCompletedParts()
        var nextByteOffset = currentSegment.normalizedNextByteOffset()
        val totalSizeBytes = file.length().coerceAtLeast(0L)
        val totalParts = max(1L, (totalSizeBytes + partSizeBytes - 1L) / partSizeBytes).toInt()

        while (completedParts.size < totalParts) {
            if (shouldYieldForLiveCriticalPath()) {
                delay(1_500L)
            }

            val partNumber = completedParts.size + 1
            val remainingBytes = (totalSizeBytes - nextByteOffset).coerceAtLeast(0L)
            if (remainingBytes <= 0L) break

            val payloadSize = minOf(partSizeBytes, remainingBytes).toInt()
            val payload = readFilePart(file, nextByteOffset, payloadSize)
            val partUpload =
                repository.presignMultipartRecordingSegmentPart(
                    recordingId = currentSegment.recordingId,
                    segmentIndex = currentSegment.segmentIndex,
                    partNumber = partNumber,
                ).getOrThrow()
            val upload =
                partUpload.upload
                    ?: throw IllegalStateException("Server không trả upload URL cho part.")

            val requestBuilder =
                Request.Builder()
                    .url(upload.uploadUrl)
                    .put(payload.toRequestBody(null))
            upload.headers?.forEach { (key, value) ->
                requestBuilder.header(key, value)
            }
            val response = executeTrackedUploadCall(requestBuilder.build())
            response.use { resp ->
                if (!resp.isSuccessful) {
                    val responseBodySnippet = abbreviateErrorBody(resp.body?.string())
                    throw MultipartUploadPartHttpException(resp.code, responseBodySnippet)
                }
                val etag =
                    resp.header("ETag")?.trim('"')
                        ?: throw IllegalStateException("Upload part thành công nhưng thiếu ETag.")
                completedParts =
                    (completedParts.filterNot { it.partNumber == partNumber } +
                        PendingRecordingPart(
                            partNumber = partNumber,
                            etag = etag,
                            sizeBytes = payload.size.toLong(),
                        )).sortedBy { it.partNumber }
                nextByteOffset = completedParts.sumOf { it.sizeBytes }
                currentSegment =
                    currentSegment.copy(
                        completedParts = completedParts,
                        nextByteOffset = nextByteOffset,
                        uploadMode = "multipart",
                    )
                replacePendingSegment(currentSegment)
                repository.reportMultipartRecordingSegmentProgress(
                    recordingId = currentSegment.recordingId,
                    segmentIndex = currentSegment.segmentIndex,
                    partNumber = partNumber,
                    etag = etag,
                    sizeBytes = payload.size.toLong(),
                    totalSizeBytes = totalSizeBytes,
                ).onSuccess { progressResponse ->
                    syncRecordingRuntimeState(progressResponse.recording)
                }.onFailure { progressError ->
                    Log.w(TAG, "reportMultipartRecordingSegmentProgress failed", progressError)
                }
            }
        }

        val completeResponse =
            repository.completeMultipartRecordingSegment(
                recordingId = currentSegment.recordingId,
                segmentIndex = currentSegment.segmentIndex,
                sizeBytes = currentSegment.sizeBytes,
                durationSeconds = currentSegment.durationSeconds,
                isFinal = currentSegment.isFinal,
                parts =
                    completedParts.map {
                        com.pkt.live.data.model.RecordingMultipartCompletedPart(
                            partNumber = it.partNumber,
                            etag = it.etag,
                        )
                    },
            ).getOrThrow()
        syncRecordingRuntimeState(completeResponse.recording)
        publishLiveManifestBestEffort(completeResponse.recording)

        runCatching { file.delete() }

        manifestMutex.withLock {
            manifest = manifest.copy(
                pendingSegments = manifest.pendingSegments.filterNot {
                    it.recordingId == currentSegment.recordingId &&
                        it.segmentIndex == currentSegment.segmentIndex
                }
            )
            persistManifestLocked()
        }
        wakePendingWorkForRecording(currentSegment.recordingId)
        updateUiState(
            pendingUploads = manifest.pendingSegments.size,
            status = if (manifest.pendingSegments.isNotEmpty()) "uploading" else _recordingUiState.value.status,
            errorMessage = null,
        )
        refreshStorageStatus(activeSession?.quality)
        return true
    }

    private suspend fun uploadPendingSegmentSinglePut(
        segment: PendingRecordingSegment,
        file: File,
    ): Boolean {
        val presigned =
            ensureSinglePutPresign(
                recordingId = segment.recordingId,
                segmentIndex = segment.segmentIndex,
            )
        val upload = presigned.upload

        val mediaType = "video/mp4".toMediaType()
        val requestBuilder =
            Request.Builder()
                .url(upload.uploadUrl)
                .put(file.asRequestBody(mediaType))
        upload.headers?.forEach { (key, value) ->
            requestBuilder.header(key, value)
        }

        val response = executeTrackedUploadCall(requestBuilder.build())
        response.use { resp ->
            if (!resp.isSuccessful) {
                throw IllegalStateException("Upload segment thất bại (${resp.code})")
            }
            val etag = resp.header("ETag")?.trim('"')
            val completeResponse =
                repository.completeRecordingSegment(
                    recordingId = segment.recordingId,
                    segmentIndex = segment.segmentIndex,
                    objectKey = upload.objectKey.ifBlank { presigned.objectKey },
                    etag = etag,
                    sizeBytes = segment.sizeBytes,
                    durationSeconds = segment.durationSeconds,
                    startedAt = segment.startedAt,
                    isFinal = segment.isFinal,
                ).getOrThrow()
            syncRecordingRuntimeState(completeResponse.recording)
            publishLiveManifestBestEffort(completeResponse.recording)
        }

        runCatching { file.delete() }

        manifestMutex.withLock {
            manifest = manifest.copy(
                pendingSegments = manifest.pendingSegments.filterNot {
                    it.recordingId == segment.recordingId && it.segmentIndex == segment.segmentIndex
                }
            )
            persistManifestLocked()
        }
        wakePendingWorkForRecording(segment.recordingId)
        updateUiState(
            pendingUploads = manifest.pendingSegments.size,
            status = if (manifest.pendingSegments.isNotEmpty()) "uploading" else _recordingUiState.value.status,
            errorMessage = null,
        )
        refreshStorageStatus(activeSession?.quality)
        return true
    }

    private suspend fun uploadPendingSegment(segment: PendingRecordingSegment): Boolean {
        val uploadSegment = bindProvisionalRecordingForSegment(segment) ?: return false
        val file = File(uploadSegment.localPath)
        if (!file.exists()) {
            if (!uploadSegment.uploadId.isNullOrBlank()) {
                repository.abortMultipartRecordingSegment(
                    recordingId = uploadSegment.recordingId,
                    segmentIndex = uploadSegment.segmentIndex,
                )
            }
            manifestMutex.withLock {
                manifest = manifest.copy(
                    pendingSegments = manifest.pendingSegments.filterNot {
                        it.recordingId == uploadSegment.recordingId && it.segmentIndex == uploadSegment.segmentIndex
                    },
                    pendingFinalizations = manifest.pendingFinalizations.filterNot {
                        it.recordingId == uploadSegment.recordingId
                    },
                )
                persistManifestLocked()
            }
            updateUiState(
                pendingUploads = manifest.pendingSegments.size,
                status = "error",
                errorMessage = "Không tìm thấy file segment cục bộ để tiếp tục tải lên.",
            )
            return true
        }
        val actualSizeBytes =
            try {
                awaitSegmentReadyForUpload(file)
            } catch (error: Exception) {
                deferPendingSegmentUntilMp4Ready(uploadSegment)
                return false
            }
        if (actualSizeBytes <= 0L) {
            Log.w(
                TAG,
                "Discarding empty pending recording segment recordingId=${uploadSegment.recordingId} segmentIndex=${uploadSegment.segmentIndex} isFinal=${uploadSegment.isFinal}",
            )
            runCatching { file.delete() }
            manifestMutex.withLock {
                manifest =
                    manifest.copy(
                        pendingSegments = manifest.pendingSegments.filterNot {
                            it.recordingId == uploadSegment.recordingId && it.segmentIndex == uploadSegment.segmentIndex
                        },
                        pendingFinalizations =
                            if (uploadSegment.isFinal) {
                                (manifest.pendingFinalizations +
                                    PendingFinalizeRecording(
                                        recordingId = uploadSegment.recordingId,
                                        matchId = uploadSegment.matchId,
                                        recordingSessionId = uploadSegment.recordingSessionId,
                                        courtId = uploadSegment.courtId,
                                        mode = uploadSegment.mode,
                                        qualityLabel = uploadSegment.qualityLabel,
                                    ))
                                    .distinctBy { it.recordingId }
                            } else {
                                manifest.pendingFinalizations
                            },
                    )
                persistManifestLocked()
            }
            updateUiState(
                pendingUploads = manifest.pendingSegments.size,
                status = if (manifest.pendingSegments.isNotEmpty()) "uploading" else _recordingUiState.value.status,
            )
            refreshStorageStatus(activeSession?.quality)
            return true
        }

        val pendingSegment =
            run {
                val nextUploadMode =
                    if (actualSizeBytes > 0L && actualSizeBytes < MIN_MULTIPART_OBJECT_SIZE_BYTES) {
                        "legacy_single_put"
                    } else {
                        "multipart"
                    }
                if (uploadSegment.sizeBytes != actualSizeBytes || uploadSegment.uploadMode != nextUploadMode) {
                    val updated =
                        uploadSegment.copy(
                            sizeBytes = actualSizeBytes,
                            uploadMode = nextUploadMode,
                        )
                    replacePendingSegment(updated)
                    updated
                } else {
                    uploadSegment
                }
            }

        if (pendingSegment.uploadMode.equals("legacy_single_put", ignoreCase = true)) {
            return try {
                uploadPendingSegmentSinglePut(pendingSegment, file)
            } catch (error: Exception) {
                val retryableComplete = error is RetryableRecordingSegmentCompleteException
                if (retryableComplete) {
                    Log.i(
                        TAG,
                        "Single put segment completion is retryable recordingId=${pendingSegment.recordingId} segmentIndex=${pendingSegment.segmentIndex}: ${error.message}",
                    )
                } else {
                    Log.e(TAG, "uploadPendingSegmentSinglePut failed", error)
                    clearSinglePutPresignCache(pendingSegment.recordingId)
                }
                manifestMutex.withLock {
                    val delayMs = computeRetryDelayMs(pendingSegment.retryCount + 1)
                    manifest = manifest.copy(
                        pendingSegments =
                            manifest.pendingSegments.map {
                                if (it.recordingId == pendingSegment.recordingId && it.segmentIndex == pendingSegment.segmentIndex) {
                                    it.copy(
                                        retryCount = it.retryCount + 1,
                                        nextRetryAtMs = System.currentTimeMillis() + delayMs,
                                    )
                                } else {
                                    it
                                }
                            }
                    )
                    persistManifestLocked()
                }
                updateUiState(
                    errorMessage = if (retryableComplete) null else error.message,
                    status = "uploading",
                )
                false
            }
        }

        return try {
            uploadPendingSegmentMultipart(pendingSegment, file)
        } catch (error: Exception) {
            val retryableComplete = error is RetryableRecordingSegmentCompleteException
            if (retryableComplete) {
                Log.i(
                    TAG,
                    "Multipart segment completion is retryable recordingId=${pendingSegment.recordingId} segmentIndex=${pendingSegment.segmentIndex}: ${error.message}",
                )
            } else {
                Log.e(TAG, "uploadPendingSegment failed", error)
            }
            val delayMs = computeRetryDelayMs(pendingSegment.retryCount + 1)
            val nextRetryAtMs = System.currentTimeMillis() + delayMs
            if (shouldResetMultipartSessionAfterFailure(error)) {
                runCatching {
                    if (!pendingSegment.uploadId.isNullOrBlank()) {
                        repository.abortMultipartRecordingSegment(
                            recordingId = pendingSegment.recordingId,
                            segmentIndex = pendingSegment.segmentIndex,
                        )
                    }
                }
                resetPendingSegmentForMultipartRetry(pendingSegment, nextRetryAtMs)
            } else {
                manifestMutex.withLock {
                    manifest = manifest.copy(
                        pendingSegments =
                            manifest.pendingSegments.map {
                                if (it.recordingId == pendingSegment.recordingId && it.segmentIndex == pendingSegment.segmentIndex) {
                                    it.copy(
                                        retryCount = it.retryCount + 1,
                                        nextRetryAtMs = nextRetryAtMs,
                                    )
                                } else {
                                    it
                                }
                            }
                    )
                    persistManifestLocked()
                }
            }
            updateUiState(
                errorMessage = if (retryableComplete) null else error.message,
                status = "uploading",
            )
            false
        }
    }

    private suspend fun finalizeIfReady(finalizations: List<PendingFinalizeRecording>): Boolean {
        var attempted = false
        for (candidateFinalize in finalizations) {
            val finalize = bindProvisionalRecordingForFinalize(candidateFinalize) ?: continue
            val hasPendingSegments =
                manifestMutex.withLock {
                    manifest.pendingSegments.any { it.recordingId == finalize.recordingId }
                }
            if (hasPendingSegments) continue

            attempted = true
            // Nếu ta đã bỏ 1 segment kẹt, backend vẫn 409 (segment còn pending phía
            // server) nên finalize cứ retry. Sau ngần này lần lỗi → gửi cờ để backend
            // finalize với các segment đã upload. Force là no-op nếu backend thực ra đã
            // đủ segment (vd finalize lỗi do mạng thoáng qua) → an toàn.
            val abandonFailedSegments =
                finalize.retryCount >= MAX_FINALIZE_RETRIES_BEFORE_FORCE
            val result = repository.finalizeRecording(
                finalize.recordingId,
                abandonFailedSegments = abandonFailedSegments,
            )
            result.onSuccess { payload ->
                syncRecordingRuntimeState(
                    payload.recording,
                    status = "exporting",
                    exporting = true,
                    errorMessage = null,
                )
                scope.launch {
                    runCatching {
                        publishLiveManifestIfPossible(payload.recording)
                    }.onFailure { error ->
                        Log.w(TAG, "publishLiveManifest after finalize failed", error)
                    }
                }
                manifestMutex.withLock {
                    manifest = manifest.copy(
                        pendingFinalizations = manifest.pendingFinalizations.filterNot {
                            it.recordingId == finalize.recordingId
                        }
                    )
                    persistManifestLocked()
                }
            }.onFailure { error ->
                Log.e(TAG, "finalizeIfReady failed", error)
                val delayMs = computeRetryDelayMs(finalize.retryCount + 1)
                manifestMutex.withLock {
                    manifest = manifest.copy(
                        pendingFinalizations =
                            manifest.pendingFinalizations.map {
                                if (it.recordingId == finalize.recordingId) {
                                    it.copy(
                                        retryCount = it.retryCount + 1,
                                        nextRetryAtMs = System.currentTimeMillis() + delayMs,
                                    )
                                } else {
                                    it
                                }
                            }
                    )
                    persistManifestLocked()
                }
                updateUiState(status = "uploading", errorMessage = error.message)
            }
        }
        return attempted
    }

    private suspend fun publishLiveManifestBestEffort(recording: MatchRecording?) {
        runCatching {
            publishLiveManifestIfPossible(recording)
        }.onFailure { error ->
            Log.w(TAG, "publishLiveManifest failed; segment upload is kept completed", error)
            updateUiState(errorMessage = error.message)
        }
    }

    private suspend fun wakePendingWorkForRecording(recordingId: String) {
        var changed = false
        manifestMutex.withLock {
            val nextSegments =
                manifest.pendingSegments.map { segment ->
                    if (segment.recordingId == recordingId && segment.nextRetryAtMs > 0L) {
                        changed = true
                        segment.copy(nextRetryAtMs = 0L)
                    } else {
                        segment
                    }
                }
            val nextFinalizations =
                manifest.pendingFinalizations.map { finalize ->
                    if (finalize.recordingId == recordingId && finalize.nextRetryAtMs > 0L) {
                        changed = true
                        finalize.copy(nextRetryAtMs = 0L)
                    } else {
                        finalize
                    }
                }
            if (changed) {
                manifest =
                    manifest.copy(
                        pendingSegments = nextSegments,
                        pendingFinalizations = nextFinalizations,
                    )
                persistManifestLocked()
            }
        }
    }

    private suspend fun refreshStorageStatus(quality: Quality?): RecordingStorageStatus {
        val targetQuality = quality ?: activeSession?.quality ?: Quality.DEFAULT
        val standardSegmentEstimateBytes =
            estimateSegmentBytes(
                quality = targetQuality,
                segmentDurationSeconds = DEFAULT_SEGMENT_DURATION_SECONDS,
            )
        val lowStorageSegmentEstimateBytes =
            estimateSegmentBytes(
                quality = targetQuality,
                segmentDurationSeconds = LOW_STORAGE_SEGMENT_DURATION_SECONDS,
            )
        val pendingBytes =
            manifestMutex.withLock {
                manifest.pendingSegments.sumOf { max(0L, it.sizeBytes) }
            }

        val availableBytes = computeAvailableBytes()
        val warningThreshold =
            pendingBytes + (standardSegmentEstimateBytes * RECOMMENDED_SEGMENT_BACKLOG) + STORAGE_HEADROOM_BYTES
        val standardStartThreshold =
            max(
                MIN_STANDARD_START_BYTES,
                pendingBytes + (standardSegmentEstimateBytes * STANDARD_START_SEGMENT_BACKLOG) + STORAGE_HEADROOM_BYTES
            )
        val hardBlockThreshold =
            max(
                MIN_HARD_BLOCK_BYTES,
                pendingBytes + (lowStorageSegmentEstimateBytes * LOW_STORAGE_SEGMENT_BACKLOG) + LOW_STORAGE_HEADROOM_BYTES
            )

        val runwayBytes = (availableBytes - pendingBytes - STORAGE_HEADROOM_BYTES).coerceAtLeast(0L)
        val bytesPerMinute =
            ((targetQuality.bitrate.toDouble() / 8.0) * 60.0 * 1.25).roundToInt()
                .coerceAtLeast(1)
                .toLong()
        val runwayMinutes =
            if (bytesPerMinute > 0L) (runwayBytes / bytesPerMinute).toInt() else null

        val hardBlock = availableBytes < hardBlockThreshold
        val redWarning = !hardBlock && availableBytes < standardStartThreshold
        val warning = !hardBlock && availableBytes < warningThreshold
        val lowStorageOptimized = redWarning
        val minimumAdditionalBytesNeeded = (hardBlockThreshold - availableBytes).coerceAtLeast(0L)
        val standardModeAdditionalBytesNeeded = (standardStartThreshold - availableBytes).coerceAtLeast(0L)
        val recommendedAdditionalBytesNeeded = (warningThreshold - availableBytes).coerceAtLeast(0L)
        val segmentDurationSeconds =
            if (lowStorageOptimized) LOW_STORAGE_SEGMENT_DURATION_SECONDS.toInt()
            else DEFAULT_SEGMENT_DURATION_SECONDS.toInt()
        val message =
            when {
                hardBlock ->
                    "Bộ nhớ không đủ để bắt đầu ghi hình an toàn. Hãy giải phóng thêm dung lượng rồi thử lại."
                redWarning ->
                    "Bộ nhớ đang thấp. App sẽ tự tối ưu ghi hình bằng cách chia segment ${segmentDurationSeconds}s để cố giữ record. Nên giải phóng thêm dung lượng sớm."
                warning ->
                    "Bộ nhớ đang thấp. Vẫn có thể ghi hình, nhưng nên giải phóng thêm dung lượng để chạy ổn định. Còn khoảng ${runwayMinutes ?: 0} phút theo chất lượng hiện tại."
                else -> null
            }

        val status =
            RecordingStorageStatus(
                availableBytes = availableBytes,
                pendingQueueBytes = pendingBytes,
                minimumRequiredBytes = hardBlockThreshold,
                standardModeBytes = standardStartThreshold,
                recommendedBytes = warningThreshold,
                minimumAdditionalBytesNeeded = minimumAdditionalBytesNeeded,
                standardModeAdditionalBytesNeeded = standardModeAdditionalBytesNeeded,
                recommendedAdditionalBytesNeeded = recommendedAdditionalBytesNeeded,
                warning = warning,
                redWarning = redWarning,
                hardBlock = hardBlock,
                lowStorageOptimized = lowStorageOptimized,
                segmentDurationSeconds = segmentDurationSeconds,
                estimatedRunwayMinutes = runwayMinutes,
                message = message,
            )
        _storageStatus.value = status
        return status
    }


    private fun computeAvailableBytes(): Long {
        return runCatching {
            val statFs = StatFs(recordingDir.absolutePath)
            statFs.availableBytes
        }.getOrElse {
            Log.e(TAG, "computeAvailableBytes failed", it)
            0L
        }
    }

    private fun estimateSegmentBytes(
        quality: Quality,
        segmentDurationSeconds: Double,
    ): Long {
        return ((quality.bitrate.toLong() / 8L) * segmentDurationSeconds * 1.25).toLong()
    }

    private fun computeRetryDelayMs(retryCount: Int): Long {
        val base = 10_000L
        val capped = minOf(2 * 60_000L, base * (1L shl retryCount.coerceAtMost(5)))
        val jitter = (retryCount * 731L) % 2_500L
        return capped + jitter
    }

    private fun loadManifest(): RecordingQueueManifest {
        return try {
            if (!manifestFile.exists()) return RecordingQueueManifest()
            val text = manifestFile.readText()
            parseManifestJson(text)
        } catch (error: Exception) {
            Log.e(TAG, "loadManifest failed", error)
            RecordingQueueManifest()
        }
    }

    private fun parseManifestJson(text: String): RecordingQueueManifest {
        val root =
            runCatching { gson.fromJson(text, JsonObject::class.java) }
                .getOrNull()
                ?: return RecordingQueueManifest()
        val pendingSegments =
            root.getArrayElements("pendingSegments")
                .mapNotNull(::parsePendingRecordingSegment)
        val pendingFinalizations =
            root.getArrayElements("pendingFinalizations")
                .mapNotNull(::parsePendingFinalizeRecording)
        return RecordingQueueManifest(
            pendingSegments = pendingSegments,
            pendingFinalizations = pendingFinalizations,
        )
    }

    private fun parsePendingRecordingSegment(el: JsonElement): PendingRecordingSegment? {
        val obj = el.asObjectOrNull() ?: return null
        val recordingId = obj.getStringOrNull("recordingId") ?: return null
        val recordingSessionId = obj.getStringOrNull("recordingSessionId") ?: return null
        val matchId = obj.getStringOrNull("matchId") ?: return null
        val localPath = obj.getStringOrNull("localPath") ?: return null
        return PendingRecordingSegment(
            recordingId = recordingId,
            recordingSessionId = recordingSessionId,
            matchId = matchId,
            courtId = obj.getStringOrNull("courtId"),
            mode = obj.getStringOrNull("mode") ?: StreamMode.STREAM_AND_RECORD.name,
            qualityLabel = obj.getStringOrNull("qualityLabel").orEmpty(),
            localPath = localPath,
            segmentIndex = obj.getIntOrNull("segmentIndex") ?: 0,
            startedAt = obj.getStringOrNull("startedAt"),
            durationSeconds = obj.getDoubleOrNull("durationSeconds") ?: 0.0,
            sizeBytes = obj.getLongOrNull("sizeBytes") ?: 0L,
            isFinal = obj.getBoolOrNull("isFinal") ?: false,
            uploadMode = obj.getStringOrNull("uploadMode"),
            uploadId = obj.getStringOrNull("uploadId"),
            objectKey = obj.getStringOrNull("objectKey"),
            partSizeBytes = obj.getLongOrNull("partSizeBytes"),
            completedParts =
                obj.getArrayElements("completedParts")
                    .mapNotNull(::parsePendingRecordingPart)
                    .takeIf { it.isNotEmpty() },
            nextByteOffset = obj.getLongOrNull("nextByteOffset"),
            isProvisional = obj.getBoolOrNull("isProvisional") ?: false,
            retryCount = obj.getIntOrNull("retryCount") ?: 0,
            nextRetryAtMs = obj.getLongOrNull("nextRetryAtMs") ?: 0L,
        )
    }

    private fun parsePendingRecordingPart(el: JsonElement): PendingRecordingPart? {
        val obj = el.asObjectOrNull() ?: return null
        val etag = obj.getStringOrNull("etag") ?: return null
        return PendingRecordingPart(
            partNumber = obj.getIntOrNull("partNumber") ?: return null,
            etag = etag,
            sizeBytes = obj.getLongOrNull("sizeBytes") ?: 0L,
        )
    }

    private fun parsePendingFinalizeRecording(el: JsonElement): PendingFinalizeRecording? {
        val obj = el.asObjectOrNull() ?: return null
        val recordingId = obj.getStringOrNull("recordingId") ?: return null
        val matchId = obj.getStringOrNull("matchId") ?: return null
        return PendingFinalizeRecording(
            recordingId = recordingId,
            matchId = matchId,
            recordingSessionId = obj.getStringOrNull("recordingSessionId"),
            courtId = obj.getStringOrNull("courtId"),
            mode = obj.getStringOrNull("mode"),
            qualityLabel = obj.getStringOrNull("qualityLabel"),
            retryCount = obj.getIntOrNull("retryCount") ?: 0,
            nextRetryAtMs = obj.getLongOrNull("nextRetryAtMs") ?: 0L,
        )
    }

    private fun JsonObject.getArrayElements(key: String): List<JsonElement> {
        val value = get(key) ?: return emptyList()
        return if (!value.isJsonNull && value.isJsonArray) value.asJsonArray.toList() else emptyList()
    }

    private fun JsonElement.asObjectOrNull(): JsonObject? =
        if (!isJsonNull && isJsonObject) asJsonObject else null

    private fun JsonObject.getStringOrNull(key: String): String? =
        get(key)
            ?.takeIf { !it.isJsonNull }
            ?.let { runCatching { it.asString.trim().takeIf(String::isNotBlank) }.getOrNull() }

    private fun JsonObject.getIntOrNull(key: String): Int? =
        get(key)?.takeIf { !it.isJsonNull }?.let { runCatching { it.asInt }.getOrNull() }

    private fun JsonObject.getLongOrNull(key: String): Long? =
        get(key)?.takeIf { !it.isJsonNull }?.let { runCatching { it.asLong }.getOrNull() }

    private fun JsonObject.getDoubleOrNull(key: String): Double? =
        get(key)?.takeIf { !it.isJsonNull }?.let { runCatching { it.asDouble }.getOrNull() }

    private fun JsonObject.getBoolOrNull(key: String): Boolean? =
        get(key)?.takeIf { !it.isJsonNull }?.let { runCatching { it.asBoolean }.getOrNull() }

    private fun persistManifestLocked() {
        try {
            manifestFile.writeText(gson.toJson(manifest))
        } catch (error: Exception) {
            Log.e(TAG, "persistManifest failed", error)
        }
    }

    private fun updateUiState(
        selectedMode: StreamMode? = _recordingUiState.value.selectedMode,
        status: String = _recordingUiState.value.status,
        activeMatchId: String? = _recordingUiState.value.activeMatchId,
        activeRecordingId: String? = _recordingUiState.value.activeRecordingId,
        activeRecordingSessionId: String? = _recordingUiState.value.activeRecordingSessionId,
        activeStorageTargetId: String? = _recordingUiState.value.activeStorageTargetId,
        activeStorageBucketName: String? = _recordingUiState.value.activeStorageBucketName,
        latestStorageFailover: RecordingStorageFailoverEntry? = _recordingUiState.value.latestStorageFailover,
        isRecording: Boolean = _recordingUiState.value.isRecording,
        pendingUploads: Int = _recordingUiState.value.pendingUploads,
        exporting: Boolean = _recordingUiState.value.exporting,
        playbackUrl: String? = _recordingUiState.value.playbackUrl,
        errorMessage: String? = _recordingUiState.value.errorMessage,
    ) {
        _recordingUiState.value =
            RecordingUiState(
                selectedMode = selectedMode,
                status = status,
                activeMatchId = activeMatchId,
                activeRecordingId = activeRecordingId,
                activeRecordingSessionId = activeRecordingSessionId,
                activeStorageTargetId = activeStorageTargetId,
                activeStorageBucketName = activeStorageBucketName,
                latestStorageFailover = latestStorageFailover,
                isRecording = isRecording,
                pendingUploads = pendingUploads,
                exporting = exporting,
                playbackUrl = playbackUrl,
                errorMessage = errorMessage,
            )
    }
}
