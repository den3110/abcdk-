package com.pkt.live.streaming

data class RecordingEngineState(
    val isRecording: Boolean = false,
    val matchId: String? = null,
    val recordingId: String? = null,
    val recordingSessionId: String? = null,
    val segmentIndex: Int = 0,
    val segmentStartedAtMs: Long = 0L,
    val pendingResume: Boolean = false,
    val boundaryReason: String? = null,
    val errorMessage: String? = null,
)

data class RecordingSegmentClosed(
    val matchId: String,
    val recordingId: String,
    val recordingSessionId: String,
    val path: String,
    val segmentIndex: Int,
    val durationSeconds: Double,
    val sizeBytes: Long,
    val isFinal: Boolean,
    val boundaryReason: String? = null,
)
