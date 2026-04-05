package com.pkt.live.data.model

import com.google.gson.JsonElement
import com.google.gson.annotations.SerializedName

/* ===================== Match ===================== */

data class MatchData(
    @SerializedName("_id") val id: String = "",
    val code: String? = null,
    val displayCode: String? = null,
    val displayNameMode: String = "nickname",
    val liveVersion: Long? = null,
    val teamAName: String = "Team A",
    val teamBName: String = "Team B",
    val scoreA: Int = 0,
    val scoreB: Int = 0,
    val serveSide: String = "A",
    val serveCount: Int = 1,
    val status: String = "",
    val tournamentName: String = "",
    val courtName: String = "",
    val tournamentLogoUrl: String? = null,
    val stageName: String = "",
    val phaseText: String = "",
    val roundLabel: String = "",
    val seedA: Int? = null,
    val seedB: Int? = null,
    val isBreak: JsonElement? = null,
    val breakNote: String = "",
    val sets: JsonElement? = null,
    val gameScores: List<SetScore>? = null,
    val video: String? = null,
    val courtStationId: String? = null,
    val courtStationName: String? = null,
    val courtClusterId: String? = null,
    val courtClusterName: String? = null,
    // tournament info nested
    val tournament: TournamentInfo? = null,
    val court: CourtInfo? = null,
)

data class SetScore(
    val index: Int = 0,
    val a: Int? = null,
    val b: Int? = null,
    val winner: String = "",
    val current: Boolean = false,
)

data class TournamentInfo(
    @SerializedName("_id") val id: String = "",
    val name: String = "",
    val displayNameMode: String = "nickname",
    val logoUrl: String? = null,
    val imageUrl: String? = null,
)

data class CourtInfo(
    @SerializedName("_id") val id: String = "",
    val name: String = "",
    val label: String? = null,
    val number: Int? = null,
)

data class CourtData(
    @SerializedName("_id") val id: String = "",
    val name: String? = null,
    val label: String? = null,
    val number: Int? = null,
    val currentMatch: JsonElement? = null,
    val nextMatch: JsonElement? = null,
)

data class RuntimePresenceHints(
    val occupied: Boolean = false,
    val screenState: String? = null,
    val heartbeatIntervalMs: Long? = null,
)

data class RuntimeLeaseHints(
    val heartbeatIntervalMs: Long? = null,
    val leaseTimeoutMs: Long? = null,
)

data class LiveAppCourtRuntimeResponse(
    val ok: Boolean = false,
    val courtId: String = "",
    val courtStationId: String? = null,
    val courtClusterId: String? = null,
    val courtClusterName: String? = null,
    val tournamentId: String? = null,
    val bracketId: String? = null,
    val name: String? = null,
    val status: String? = null,
    val isActive: Boolean = true,
    val currentMatchId: String? = null,
    val nextMatchId: String? = null,
    val assignmentMode: String? = null,
    val queueCount: Int = 0,
    val listEnabled: Boolean = false,
    val remainingManualCount: Int = 0,
    val recommendedPollIntervalMs: Long? = null,
    val cacheTtlMs: Long? = null,
    val presence: CourtLiveScreenPresence? = null,
    val presenceHints: RuntimePresenceHints? = null,
    val leaseHints: RuntimeLeaseHints? = null,
)

/* ===================== Tournament / Admin ===================== */

data class TournamentData(
    @SerializedName("_id") val id: String = "",
    val name: String? = null,
    val title: String? = null,
    val sportType: String? = null,
    val status: String? = null,
    val logo: String? = null,
    val logoUrl: String? = null,
) {
    fun displayName(): String {
        val n = listOfNotNull(name, title).firstOrNull { it.isNotBlank() }
        return n ?: "Giải đấu"
    }
}

data class AssignedTournamentData(
    @SerializedName("_id") val id: String = "",
    val name: String? = null,
    val image: String? = null,
    val status: String? = null,
    val eventType: String? = null,
    val nameDisplayMode: String? = null,
) {
    fun displayName(): String {
        val text = name?.trim().orEmpty()
        return text.ifBlank { "Giải đấu" }
    }
}

data class CourtClusterData(
    @SerializedName("_id") val id: String = "",
    val name: String? = null,
    val slug: String? = null,
    val venueName: String? = null,
    val description: String? = null,
    val color: String? = null,
    val order: Int? = null,
    val isActive: Boolean = true,
    val stationsCount: Int? = null,
    val liveCount: Int? = null,
    val assignedTournamentCount: Int? = null,
    val assignedTournaments: List<AssignedTournamentData> = emptyList(),
) {
    fun displayName(): String {
        val n = listOfNotNull(name, venueName).firstOrNull { it.isNotBlank() }
        return n ?: "Cụm sân"
    }
}

data class CourtClusterListResponse(
    val items: List<CourtClusterData> = emptyList(),
)

data class AdminCourtData(
    @SerializedName("_id") val id: String = "",
    val name: String? = null,
    val label: String? = null,
    val number: Int? = null,
    val code: String? = null,
    val status: String? = null,
    val clusterId: String? = null,
    val clusterName: String? = null,
    val assignmentMode: String? = null,
    val queueCount: Int = 0,
    val nextQueuedMatch: JsonElement? = null,
    val queueItems: List<CourtQueueItem> = emptyList(),
    val currentMatchId: String? = null,
    val currentTournamentId: String? = null,
    val currentMatch: JsonElement? = null,
    @SerializedName("presence") val presence: CourtLiveScreenPresence? = null,
    val liveScreenPresence: CourtLiveScreenPresence? = null,
) {
    fun displayName(): String {
        val n = listOfNotNull(label, name, code).firstOrNull { it.isNotBlank() }
        return n ?: (number?.let { "Sân $it" } ?: "Sân")
    }
}

data class CourtQueueItem(
    val matchId: String? = null,
    val order: Int = 0,
    val queuedAt: String? = null,
    val queuedBy: String? = null,
    val match: JsonElement? = null,
)

data class AdminCourtListResponse(
    val items: List<AdminCourtData> = emptyList(),
)

data class CourtClusterRuntimeResponse(
    val cluster: CourtClusterData? = null,
    val stations: List<AdminCourtData> = emptyList(),
)

data class CourtStationRuntimeResponse(
    val cluster: CourtClusterData? = null,
    val station: AdminCourtData? = null,
    val currentMatch: MatchData? = null,
)

data class CourtLiveScreenPresence(
    val occupied: Boolean = false,
    val status: String? = null,
    val screenState: String? = null,
    val matchId: String? = null,
    val startedAt: String? = null,
    val lastHeartbeatAt: String? = null,
    val expiresAt: String? = null,
    val previewModeSince: String? = null,
    val previewReleaseAt: String? = null,
    val warningAt: String? = null,
)

data class CourtLiveWatchItem(
    val courtId: String = "",
    val liveScreenPresence: CourtLiveScreenPresence? = null,
)

data class CourtLiveWatchSnapshot(
    val tournamentId: String = "",
    val ts: String? = null,
    val courts: List<CourtLiveWatchItem> = emptyList(),
)

data class LiveAppBootstrapResponse(
    val ok: Boolean = false,
    val authenticated: Boolean = false,
    val canUseLiveApp: Boolean = false,
    val roleSummary: String? = null,
    val reason: String? = null,
    val message: String? = null,
    val user: UserMe? = null,
    val manageableTournaments: List<TournamentData> = emptyList(),
    val manageableCourtClusters: List<CourtClusterData> = emptyList(),
)

/* ===================== Live Session ===================== */

data class LiveSession(
    val facebook: FacebookLive? = null,
)

data class FacebookLive(
    @SerializedName("secure_stream_url") val secureStreamUrl: String? = null,
    @SerializedName("server_url") val serverUrl: String? = null,
    @SerializedName("stream_key") val streamKey: String? = null,
    @SerializedName("watch_url") val watchUrl: String? = null,
    @SerializedName("permalink_url") val permalinkUrl: String? = null,
    val pageName: String? = null,
    val pageId: String? = null,
) {
    /** Build RTMP URL from either secure_stream_url or server_url + stream_key */
    fun buildRtmpUrl(): String? {
        if (!secureStreamUrl.isNullOrBlank()) return secureStreamUrl
        if (!serverUrl.isNullOrBlank() && !streamKey.isNullOrBlank()) {
            val base = serverUrl.trimEnd('/')
            return "$base/$streamKey"
        }
        return null
    }
}

/* ===================== Overlay Config ===================== */

data class OverlayConfig(
    val sponsors: List<SponsorItem> = emptyList(),
    val tournamentImageUrl: String? = null,
    val webLogoUrl: String? = null,
)

data class SponsorItem(
    @SerializedName("_id") val id: String = "",
    val logoUrl: String? = null,
    val name: String = "",
    val tier: String? = null,
)

/* ===================== Overlay Data (UI State) ===================== */

data class OverlayData(
    // Theme
    val theme: String = "dark",
    val size: String = "md",
    val accentA: String = "#25C2A0",
    val accentB: String = "#4F46E5",
    val rounded: Int = 18,
    val shadow: Boolean = true,
    val nameScale: Float = 1f,
    val scoreScale: Float = 1f,

    // Match info
    val tournamentName: String = "",
    val courtName: String = "",
    val tournamentLogoUrl: String? = null,
    val stageName: String = "",
    val phaseText: String = "",
    val roundLabel: String = "",

    // Teams
    val teamAName: String = "Team A",
    val teamBName: String = "Team B",
    val scoreA: Int = 0,
    val scoreB: Int = 0,
    val seedA: Int? = null,
    val seedB: Int? = null,

    // Serve
    val serveSide: String = "A",
    val serveCount: Int = 1,

    // Break
    val isBreak: Boolean = false,
    val breakNote: String = "",

    // Sets
    val sets: List<SetScore> = emptyList(),

    // Overlay config
    val overlayVersion: Int = 2,
    val overlayEnabled: Boolean = true,
    val showSets: Boolean = true,
    val showClock: Boolean = false,
    val scaleScore: Float = 0.5f,

    // Branding
    val webLogoUrl: String? = null,
    val sponsorLogos: List<String> = emptyList(),
)

/* ===================== API Request/Response wrappers ===================== */

data class CreateLiveRequest(
    val pageId: String? = null,
)

data class NextCourtMatchResponse(
    val matchId: String? = null,
)

data class StreamNotifyRequest(
    val platform: String = "facebook",
    val timestamp: String = "",
    val clientSessionId: String? = null,
)

data class StreamNotifyResponse(
    val ok: Boolean = false,
    val matchId: String? = null,
    val platform: String? = null,
    val status: String? = null,
    val leaseStatus: String? = null,
    val leaseId: String? = null,
    val clientSessionId: String? = null,
    val expiresAt: String? = null,
    val heartbeatIntervalMs: Long? = null,
    val leaseTimeoutMs: Long? = null,
)

data class CourtPresenceRequest(
    val clientSessionId: String? = null,
    val screenState: String? = null,
    val matchId: String? = null,
    val timestamp: String = "",
)

data class CourtPresenceResponse(
    val ok: Boolean = false,
    val status: String? = null,
    val reason: String? = null,
    val clientSessionId: String? = null,
    val heartbeatIntervalMs: Long? = null,
    val presenceTimeoutMs: Long? = null,
    val previewStaleTimeoutMs: Long? = null,
    val previewWarningMs: Long? = null,
    val previewReleaseAt: String? = null,
    val warningAt: String? = null,
    val occupied: CourtLiveScreenPresence? = null,
)

/* ===================== Recording v2 ===================== */

enum class StreamMode(
    val label: String,
    val description: String,
    val includesLivestream: Boolean,
    val includesRecording: Boolean,
) {
    STREAM_AND_RECORD(
        label = "Livestream + Record",
        description = "Phát trực tiếp và ghi hình từng trận cùng lúc.",
        includesLivestream = true,
        includesRecording = true,
    ),
    RECORD_ONLY(
        label = "Record only",
        description = "Tự ghi hình từng trận trên sân này, không phát trực tiếp.",
        includesLivestream = false,
        includesRecording = true,
    ),
    STREAM_ONLY(
        label = "Livestream only",
        description = "Chỉ livestream, không ghi hình.",
        includesLivestream = true,
        includesRecording = false,
    ),
}

data class RecordingStorageRemote(
    val r2Configured: Boolean = false,
)

data class MatchRecordingResponse(
    val ok: Boolean = false,
    val storage: RecordingStorageRemote? = null,
    val recording: MatchRecording? = null,
)

data class MatchRecording(
    val id: String = "",
    val matchId: String = "",
    val courtId: String? = null,
    val mode: String = "",
    val quality: String = "",
    val status: String = "",
    val recordingSessionId: String = "",
    val durationSeconds: Double = 0.0,
    val sizeBytes: Long = 0L,
    val r2TargetId: String? = null,
    val r2BucketName: String? = null,
    val latestStorageFailover: RecordingStorageFailoverEntry? = null,
    val storageFailoverHistory: List<RecordingStorageFailoverEntry> = emptyList(),
    val driveFileId: String? = null,
    val driveRawUrl: String? = null,
    val drivePreviewUrl: String? = null,
    val playbackUrl: String? = null,
    val exportAttempts: Int = 0,
    val error: String? = null,
    val finalizedAt: String? = null,
    val readyAt: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val livePlayback: RecordingLivePlayback? = null,
    val segments: List<MatchRecordingSegment> = emptyList(),
)

data class RecordingStorageFailoverEntry(
    val fromTargetId: String? = null,
    val toTargetId: String? = null,
    val reason: String? = null,
    val checkedAt: String? = null,
    val detail: String? = null,
)

data class RecordingLivePlayback(
    val enabled: Boolean = false,
    val key: String = "server2",
    val providerLabel: String? = null,
    val manifestObjectKey: String? = null,
    val manifestUrl: String? = null,
    val hlsManifestObjectKey: String? = null,
    val hlsManifestUrl: String? = null,
    val publicBaseUrl: String? = null,
    val targetPublicBaseUrls: Map<String, String> = emptyMap(),
    val finalPlaybackUrl: String? = null,
    val delaySeconds: Int = 60,
    val uploadedDurationSeconds: Double = 0.0,
    val uploadedSegmentCount: Int = 0,
    val ready: Boolean = false,
    val status: String = "pending",
    val disabledReason: String? = null,
)

data class MatchRecordingSegment(
    val index: Int = 0,
    val objectKey: String = "",
    val storageTargetId: String? = null,
    val bucketName: String? = null,
    val uploadStatus: String = "",
    val sizeBytes: Long = 0L,
    val durationSeconds: Double = 0.0,
    val isFinal: Boolean = false,
    val uploadedAt: String? = null,
)

data class StartMatchRecordingRequest(
    val matchId: String,
    val courtId: String? = null,
    val mode: String,
    val quality: String,
    val recordingSessionId: String,
)

data class RecordingSegmentPresignRequest(
    val recordingId: String,
    val segmentIndex: Int,
    val contentType: String = "video/mp4",
)

data class RecordingSegmentPresignBatchRequest(
    val recordingId: String,
    val startSegmentIndex: Int,
    val count: Int = 10,
    val contentType: String = "video/mp4",
)

data class RecordingLiveManifestPresignRequest(
    val recordingId: String,
)

data class RecordingLiveManifestPresignResponse(
    val ok: Boolean = false,
    val recordingId: String? = null,
    val livePlayback: RecordingLivePlayback? = null,
    val upload: RecordingPresignedUpload? = null,
    val hlsUpload: RecordingPresignedUpload? = null,
)

data class RecordingMultipartStartRequest(
    val recordingId: String,
    val segmentIndex: Int,
    val startedAt: String? = null,
    val contentType: String = "video/mp4",
)

data class RecordingMultipartStartResponse(
    val ok: Boolean = false,
    val recordingId: String? = null,
    val segmentIndex: Int = 0,
    val objectKey: String? = null,
    val uploadId: String? = null,
    val partSizeBytes: Long = 0L,
    val alreadyUploaded: Boolean = false,
)

data class RecordingMultipartPartUrlRequest(
    val recordingId: String,
    val segmentIndex: Int,
    val partNumber: Int,
)

data class RecordingMultipartProgressRequest(
    val recordingId: String,
    val segmentIndex: Int,
    val partNumber: Int,
    val etag: String,
    val sizeBytes: Long,
    val totalSizeBytes: Long,
)

data class RecordingPresignedUpload(
    val uploadUrl: String = "",
    val objectKey: String = "",
    val expiresInSeconds: Int? = null,
    val method: String? = "PUT",
    val headers: Map<String, String>? = emptyMap(),
)

data class RecordingSegmentPresignResponse(
    val ok: Boolean = false,
    val recordingId: String? = null,
    val segmentIndex: Int = 0,
    val objectKey: String? = null,
    val upload: RecordingPresignedUpload? = null,
)

data class RecordingSegmentPresignBatchItem(
    val segmentIndex: Int = 0,
    val objectKey: String? = null,
    val upload: RecordingPresignedUpload? = null,
)

data class RecordingSegmentPresignBatchResponse(
    val ok: Boolean = false,
    val recordingId: String? = null,
    val count: Int = 0,
    val segments: List<RecordingSegmentPresignBatchItem> = emptyList(),
)

data class RecordingMultipartPartUrlResponse(
    val ok: Boolean = false,
    val recordingId: String? = null,
    val segmentIndex: Int = 0,
    val partNumber: Int = 0,
    val objectKey: String? = null,
    val uploadId: String? = null,
    val upload: RecordingPresignedUpload? = null,
)

data class RecordingMultipartCompletedPart(
    val partNumber: Int,
    val etag: String,
)

data class RecordingMultipartCompleteRequest(
    val recordingId: String,
    val segmentIndex: Int,
    val sizeBytes: Long,
    val durationSeconds: Double,
    val isFinal: Boolean = false,
    val parts: List<RecordingMultipartCompletedPart>,
)

data class RecordingMultipartAbortRequest(
    val recordingId: String,
    val segmentIndex: Int,
)

data class RecordingSegmentCompleteRequest(
    val recordingId: String,
    val segmentIndex: Int,
    val objectKey: String,
    val etag: String? = null,
    val sizeBytes: Long,
    val durationSeconds: Double,
    val startedAt: String? = null,
    val isFinal: Boolean = false,
)

data class FinalizeMatchRecordingRequest(
    val recordingId: String,
)

data class RecordingStorageStatus(
    val availableBytes: Long = 0L,
    val pendingQueueBytes: Long = 0L,
    val minimumRequiredBytes: Long = 0L,
    val standardModeBytes: Long = 0L,
    val recommendedBytes: Long = 0L,
    val minimumAdditionalBytesNeeded: Long = 0L,
    val standardModeAdditionalBytesNeeded: Long = 0L,
    val recommendedAdditionalBytesNeeded: Long = 0L,
    val warning: Boolean = false,
    val redWarning: Boolean = false,
    val hardBlock: Boolean = false,
    val lowStorageOptimized: Boolean = false,
    val segmentDurationSeconds: Int = 6,
    val estimatedRunwayMinutes: Int? = null,
    val message: String? = null,
)

data class RecordingUiState(
    val selectedMode: StreamMode? = null,
    val status: String = "idle",
    val activeMatchId: String? = null,
    val activeRecordingId: String? = null,
    val activeRecordingSessionId: String? = null,
    val activeStorageTargetId: String? = null,
    val activeStorageBucketName: String? = null,
    val latestStorageFailover: RecordingStorageFailoverEntry? = null,
    val isRecording: Boolean = false,
    val pendingUploads: Int = 0,
    val exporting: Boolean = false,
    val playbackUrl: String? = null,
    val errorMessage: String? = null,
)

/* ===================== User ===================== */

data class UserMe(
    @SerializedName("_id") val id: String = "",
    val name: String? = null,
    val fullName: String? = null,
    val nickname: String? = null,
    val email: String? = null,
    val phone: String? = null,
    val avatar: String? = null,
    val avatarUrl: String? = null,
) {
    fun displayName(): String {
        val n = listOfNotNull(fullName, name, nickname).firstOrNull { it.isNotBlank() }
        return n ?: "PickleTour"
    }
}

/* ===================== Auth ===================== */

data class LoginRequest(
    val email: String? = null,
    val phone: String? = null,
    val nickname: String? = null,
    val password: String,
)

data class LoginResponse(
    val token: String? = null,
    val user: UserMe? = null,
)
