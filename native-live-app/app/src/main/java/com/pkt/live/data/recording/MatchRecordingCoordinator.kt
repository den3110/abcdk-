package com.pkt.live.data.recording

import android.content.Context
import android.os.StatFs
import android.util.Log
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.pkt.live.data.model.MatchRecording
import com.pkt.live.data.model.RecordingStorageFailoverEntry
import com.pkt.live.data.model.RecordingPresignedUpload
import com.pkt.live.data.model.RecordingStorageStatus
import com.pkt.live.data.model.RecordingUiState
import com.pkt.live.data.model.StreamMode
import com.pkt.live.data.repository.LiveRepository
import com.pkt.live.streaming.Quality
import com.pkt.live.streaming.RecordingSegmentClosed
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
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
    val durationSeconds: Double,
    val sizeBytes: Long,
    val isFinal: Boolean,
    val uploadMode: String? = null,
    val uploadId: String? = null,
    val objectKey: String? = null,
    val partSizeBytes: Long? = null,
    val completedParts: List<PendingRecordingPart>? = null,
    val nextByteOffset: Long? = null,
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
        private const val DEFAULT_SEGMENT_DURATION_SECONDS = 6.0
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
    private var activeSession: ActiveRecordingSession? = null
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

    fun hasActiveRecording(): Boolean = activeSession != null || recordingUiState.value.isRecording

    fun currentMode(): StreamMode? = _selectedMode.value

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
                updateUiState(status = "error", errorMessage = error.message)
                return Result.failure(error)
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
        updateUiState(
            status = if (manifest.pendingSegments.isNotEmpty()) "uploading" else "idle",
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

    private fun resolveLatestStorageFailover(
        recording: MatchRecording?,
    ): RecordingStorageFailoverEntry? {
        val latest =
            recording?.latestStorageFailover
                ?: recording?.storageFailoverHistory?.lastOrNull()
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
        val quality = currentSession?.quality
        val uploadMode =
            if (segment.sizeBytes >= 0L && segment.sizeBytes < MIN_MULTIPART_OBJECT_SIZE_BYTES) {
                "legacy_single_put"
            } else {
                "multipart"
            }
        val segmentEntry =
            PendingRecordingSegment(
                recordingId = segment.recordingId,
                recordingSessionId = segment.recordingSessionId,
                matchId = segment.matchId,
                courtId = currentSession?.courtId,
                mode = currentSession?.mode?.name ?: (_selectedMode.value?.name ?: StreamMode.STREAM_AND_RECORD.name),
                qualityLabel = quality?.label ?: "",
                localPath = segment.path,
                segmentIndex = segment.segmentIndex,
                durationSeconds = segment.durationSeconds,
                sizeBytes = segment.sizeBytes,
                isFinal = segment.isFinal,
                uploadMode = uploadMode,
            )

        manifestMutex.withLock {
            val deduped = manifest.pendingSegments.filterNot {
                it.recordingId == segmentEntry.recordingId && it.segmentIndex == segmentEntry.segmentIndex
            } + segmentEntry
            val finalizations =
                if (segment.isFinal) {
                    (manifest.pendingFinalizations + PendingFinalizeRecording(segment.recordingId, segment.matchId))
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

        if (segment.isFinal && activeSession?.recordingId == segment.recordingId) {
            activeSession = null
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

    private fun ensureUploadLoop() {
        if (uploadJob?.isActive == true) return
        val currentJob =
            scope.launch {
                while (true) {
                    val nextSegment = manifestMutex.withLock {
                        manifest.pendingSegments
                            .filter { it.nextRetryAtMs <= System.currentTimeMillis() }
                            .minWithOrNull(compareBy<PendingRecordingSegment> { it.retryCount }.thenBy { it.segmentIndex })
                    }

                    if (nextSegment == null) {
                        val finalized = manifestMutex.withLock { manifest.pendingFinalizations.toList() }
                        if (finalized.isEmpty()) break
                        val progressed = finalizeIfReady(finalized)
                        if (!progressed) delay(2_000L)
                        continue
                    }

                    if (shouldYieldForLiveCriticalPath()) {
                        delay(1_500L)
                    }

                    val success = uploadPendingSegment(nextSegment)
                    if (!success) {
                        delay(2_000L)
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
        val response = okHttpClient.newCall(requestBuilder.build()).execute()
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
            val response = okHttpClient.newCall(requestBuilder.build()).execute()
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
        publishLiveManifestIfPossible(completeResponse.recording)

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
        updateUiState(
            pendingUploads = manifest.pendingSegments.size,
            status = if (manifest.pendingSegments.isNotEmpty()) "uploading" else _recordingUiState.value.status,
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

        val response = okHttpClient.newCall(requestBuilder.build()).execute()
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
                    isFinal = segment.isFinal,
                ).getOrThrow()
            syncRecordingRuntimeState(completeResponse.recording)
            publishLiveManifestIfPossible(completeResponse.recording)
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
        updateUiState(
            pendingUploads = manifest.pendingSegments.size,
            status = if (manifest.pendingSegments.isNotEmpty()) "uploading" else _recordingUiState.value.status,
        )
        refreshStorageStatus(activeSession?.quality)
        return true
    }

    private suspend fun uploadPendingSegment(segment: PendingRecordingSegment): Boolean {
        val file = File(segment.localPath)
        if (!file.exists()) {
            if (!segment.uploadId.isNullOrBlank()) {
                repository.abortMultipartRecordingSegment(
                    recordingId = segment.recordingId,
                    segmentIndex = segment.segmentIndex,
                )
            }
            manifestMutex.withLock {
                manifest = manifest.copy(
                    pendingSegments = manifest.pendingSegments.filterNot {
                        it.recordingId == segment.recordingId && it.segmentIndex == segment.segmentIndex
                    },
                    pendingFinalizations = manifest.pendingFinalizations.filterNot {
                        it.recordingId == segment.recordingId
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
        if (segment.uploadMode.equals("legacy_single_put", ignoreCase = true)) {
            return try {
                uploadPendingSegmentSinglePut(segment, file)
            } catch (error: Exception) {
                Log.e(TAG, "uploadPendingSegmentSinglePut failed", error)
                clearSinglePutPresignCache(segment.recordingId)
                manifestMutex.withLock {
                    val delayMs = computeRetryDelayMs(segment.retryCount + 1)
                    manifest = manifest.copy(
                        pendingSegments =
                            manifest.pendingSegments.map {
                                if (it.recordingId == segment.recordingId && it.segmentIndex == segment.segmentIndex) {
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
                updateUiState(errorMessage = error.message, status = "uploading")
                false
            }
        }

        return try {
            uploadPendingSegmentMultipart(segment, file)
        } catch (error: Exception) {
            Log.e(TAG, "uploadPendingSegment failed", error)
            val delayMs = computeRetryDelayMs(segment.retryCount + 1)
            val nextRetryAtMs = System.currentTimeMillis() + delayMs
            if (shouldResetMultipartSessionAfterFailure(error)) {
                runCatching {
                    if (!segment.uploadId.isNullOrBlank()) {
                        repository.abortMultipartRecordingSegment(
                            recordingId = segment.recordingId,
                            segmentIndex = segment.segmentIndex,
                        )
                    }
                }
                resetPendingSegmentForMultipartRetry(segment, nextRetryAtMs)
            } else {
                manifestMutex.withLock {
                    manifest = manifest.copy(
                        pendingSegments =
                            manifest.pendingSegments.map {
                                if (it.recordingId == segment.recordingId && it.segmentIndex == segment.segmentIndex) {
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
            updateUiState(errorMessage = error.message, status = "uploading")
            false
        }
    }

    private suspend fun finalizeIfReady(finalizations: List<PendingFinalizeRecording>): Boolean {
        var progressed = false
        for (finalize in finalizations) {
            val hasPendingSegments =
                manifestMutex.withLock {
                    manifest.pendingSegments.any { it.recordingId == finalize.recordingId }
                }
            if (hasPendingSegments) continue

            progressed = true
            val result = repository.finalizeRecording(finalize.recordingId)
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
            }.onFailure {
                Log.e(TAG, "finalizeIfReady failed", it)
                updateUiState(status = "error", errorMessage = it.message)
            }

            manifestMutex.withLock {
                manifest = manifest.copy(
                    pendingFinalizations = manifest.pendingFinalizations.filterNot {
                        it.recordingId == finalize.recordingId
                    }
                )
                persistManifestLocked()
            }
        }
        return progressed
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
        val capped = minOf(30 * 60_000L, base * (1L shl retryCount.coerceAtMost(6)))
        val jitter = (retryCount * 731L) % 2_500L
        return capped + jitter
    }

    private fun loadManifest(): RecordingQueueManifest {
        return try {
            if (!manifestFile.exists()) return RecordingQueueManifest()
            val text = manifestFile.readText()
            gson.fromJson(text, object : TypeToken<RecordingQueueManifest>() {}.type)
                ?: RecordingQueueManifest()
        } catch (error: Exception) {
            Log.e(TAG, "loadManifest failed", error)
            RecordingQueueManifest()
        }
    }

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
