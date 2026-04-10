package com.pkt.live.data.model

import com.google.gson.annotations.SerializedName
import com.pkt.live.streaming.StreamRecoveryState

data class ObserverIngestResponse(
    val ok: Boolean = false,
    val source: String? = null,
    val deviceId: String? = null,
    val id: String? = null,
)

data class LiveDeviceHeartbeatRequest(
    val source: String,
    val deviceId: String,
    val capturedAt: String,
    val heartbeatIntervalMs: Int,
    val status: LiveDeviceTelemetryStatus,
)

data class LiveDeviceEventRequest(
    val source: String,
    val deviceId: String,
    val capturedAt: String,
    val event: LiveDeviceTelemetryEvent,
    val status: LiveDeviceTelemetryStatus? = null,
)

data class LiveDeviceTelemetryEvent(
    val type: String,
    val level: String,
    val reasonCode: String,
    val reasonText: String,
    val stage: String? = null,
    val severity: String? = null,
    val occurredAt: String,
    val courtId: String? = null,
    val courtName: String? = null,
    val matchId: String? = null,
    val matchCode: String? = null,
    val operatorUserId: String? = null,
    val operatorName: String? = null,
    val payload: LiveDeviceTelemetryEventPayload? = null,
)

data class LiveDeviceTelemetryEventPayload(
    val summary: String? = null,
    val detail: String? = null,
    val overlayIssue: String? = null,
    val thermalState: String? = null,
    val memoryPressure: String? = null,
    val diagnostics: List<String> = emptyList(),
)

data class LiveDeviceTelemetryStatus(
    val platform: String,
    val clientSessionId: String,
    val deviceId: String,
    val screenState: String,
    val routeLabel: String,
    val app: LiveDeviceTelemetryAppInfo,
    val device: LiveDeviceTelemetryDeviceInfo,
    @SerializedName("operator") val operatorInfo: LiveDeviceTelemetryOperatorInfo,
    val route: LiveDeviceTelemetryRouteInfo,
    val court: LiveDeviceTelemetryCourtInfo,
    val match: LiveDeviceTelemetryMatchInfo,
    val stream: LiveDeviceTelemetryStreamInfo,
    val recording: LiveDeviceTelemetryRecordingInfo,
    val overlay: LiveDeviceTelemetryOverlayInfo,
    val presence: CourtPresenceResponse? = null,
    val network: LiveDeviceTelemetryNetworkInfo,
    val battery: LiveDeviceTelemetryBatteryInfo,
    val thermal: LiveDeviceTelemetryThermalInfo,
    val recovery: StreamRecoveryState,
    val warnings: List<String> = emptyList(),
    val diagnostics: List<String> = emptyList(),
)

data class LiveDeviceTelemetryAppInfo(
    val bundleId: String? = null,
    val appVersion: String? = null,
    val buildNumber: String? = null,
    val liveMode: String,
    val quality: String,
)

data class LiveDeviceTelemetryDeviceInfo(
    val name: String,
    val model: String,
    val systemName: String,
    val systemVersion: String,
)

data class LiveDeviceTelemetryOperatorInfo(
    val userId: String? = null,
    val displayName: String? = null,
    val role: String? = null,
)

data class LiveDeviceTelemetryRouteInfo(
    val label: String,
    val waitingForCourt: Boolean = false,
    val waitingForMatchLive: Boolean = false,
    val waitingForNextMatch: Boolean = false,
    val freshEntryRequired: Boolean = false,
    val appIsActive: Boolean = true,
)

data class LiveDeviceTelemetryCourtInfo(
    val id: String? = null,
    val name: String? = null,
    val clusterId: String? = null,
    val clusterName: String? = null,
)

data class LiveDeviceTelemetryMatchInfo(
    val id: String? = null,
    val code: String? = null,
    val status: String? = null,
    val tournamentName: String? = null,
)

data class LiveDeviceTelemetryStreamInfo(
    val state: String,
    val bitrate: Int = 0,
    val quality: String,
    val socketConnected: Boolean = false,
    val runtimeSocketConnected: Boolean = false,
    val presenceSocketConnected: Boolean = false,
    val activeSocketMatchId: String? = null,
    val socketPayloadStale: Boolean = false,
    val liveStartedAt: String? = null,
    val rtmpMessage: String? = null,
)

data class LiveDeviceTelemetryRecordingInfo(
    val stateText: String,
    val pendingUploads: Int = 0,
    val pendingQueueBytes: Long = 0L,
    val pendingFinalizations: Int = 0,
    val segmentCount: Int = 0,
    val uploadMode: String? = null,
    val playbackUrl: String? = null,
    val storageFreeBytes: Long = 0L,
    val storageTotalBytes: Long = 0L,
    val warning: Boolean = false,
    val redWarning: Boolean = false,
    val hardBlock: Boolean = false,
)

data class LiveDeviceTelemetryOverlayInfo(
    val attached: Boolean = false,
    val healthy: Boolean = false,
    val reattaching: Boolean = false,
    val snapshotFresh: Boolean = false,
    val roomMismatch: Boolean = false,
    val issue: String? = null,
    val issueAtMs: Long = 0L,
    val lastEvent: String? = null,
)

data class LiveDeviceTelemetryNetworkInfo(
    val connected: Boolean = false,
    val wifi: Boolean = false,
    val lowPowerModeEnabled: Boolean = false,
)

data class LiveDeviceTelemetryBatteryInfo(
    val levelPercent: Int? = null,
    val state: String,
    val lowWarning: Boolean = false,
)

data class LiveDeviceTelemetryThermalInfo(
    val state: String,
    val stateRawValue: Int = 0,
    val warning: Boolean = false,
    val critical: Boolean = false,
    val lastEventAtMs: Long? = null,
    val lastEventSummary: String? = null,
    val memoryPressureSummary: String? = null,
    val tempC: Float? = null,
)
