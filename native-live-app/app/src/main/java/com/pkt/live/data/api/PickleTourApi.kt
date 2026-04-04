package com.pkt.live.data.api

import com.pkt.live.data.model.CreateLiveRequest
import com.pkt.live.data.model.AdminCourtData
import com.pkt.live.data.model.AdminCourtListResponse
import com.pkt.live.data.model.CourtClusterData
import com.pkt.live.data.model.CourtClusterListResponse
import com.pkt.live.data.model.CourtPresenceRequest
import com.pkt.live.data.model.CourtPresenceResponse
import com.pkt.live.data.model.LiveSession
import com.pkt.live.data.model.LiveAppBootstrapResponse
import com.pkt.live.data.model.LoginRequest
import com.pkt.live.data.model.LoginResponse
import com.pkt.live.data.model.MatchData
import com.pkt.live.data.model.NextCourtMatchResponse
import com.pkt.live.data.model.OverlayConfig
import com.pkt.live.data.model.FinalizeMatchRecordingRequest
import com.pkt.live.data.model.LiveAppCourtRuntimeResponse
import com.pkt.live.data.model.MatchRecordingResponse
import com.pkt.live.data.model.RecordingMultipartAbortRequest
import com.pkt.live.data.model.RecordingMultipartCompleteRequest
import com.pkt.live.data.model.RecordingMultipartPartUrlRequest
import com.pkt.live.data.model.RecordingMultipartPartUrlResponse
import com.pkt.live.data.model.RecordingMultipartProgressRequest
import com.pkt.live.data.model.RecordingMultipartStartRequest
import com.pkt.live.data.model.RecordingMultipartStartResponse
import com.pkt.live.data.model.RecordingLiveManifestPresignRequest
import com.pkt.live.data.model.RecordingLiveManifestPresignResponse
import com.pkt.live.data.model.RecordingSegmentPresignBatchRequest
import com.pkt.live.data.model.RecordingSegmentPresignBatchResponse
import com.pkt.live.data.model.RecordingSegmentCompleteRequest
import com.pkt.live.data.model.RecordingSegmentPresignRequest
import com.pkt.live.data.model.RecordingSegmentPresignResponse
import com.pkt.live.data.model.StartMatchRecordingRequest
import com.pkt.live.data.model.StreamNotifyRequest
import com.pkt.live.data.model.StreamNotifyResponse
import com.pkt.live.data.model.UserMe
import com.google.gson.JsonElement
import retrofit2.Response
import retrofit2.http.*

/**
 * All API endpoints for PickleTour backend.
 * Every call uses real data — no mocks.
 */
interface PickleTourApi {

    // ==================== Auth / User ====================

    @GET("api/users/me")
    suspend fun getMe(): Response<UserMe>

    @POST("api/users/auth")
    suspend fun login(
        @Body body: LoginRequest,
    ): Response<LoginResponse>

    @GET("api/live-app/courts/{courtId}/runtime")
    suspend fun getCourtRuntime(
        @Path("courtId") courtId: String,
    ): Response<LiveAppCourtRuntimeResponse>

    @GET("api/overlay/courts/{courtId}/next")
    suspend fun getNextMatchByCourt(
        @Path("courtId") courtId: String,
        @Query("after") afterMatchId: String? = null,
    ): Response<NextCourtMatchResponse>

    @GET("api/live-app/bootstrap")
    suspend fun getLiveAppBootstrap(): Response<LiveAppBootstrapResponse>

    @GET("api/live-app/clusters")
    suspend fun listLiveAppCourtClusters(): Response<CourtClusterListResponse>

    @GET("api/live-app/clusters/{clusterId}/courts")
    suspend fun listLiveAppCourtStations(
        @Path("clusterId") clusterId: String,
    ): Response<AdminCourtListResponse>

    @GET("api/live-app/tournaments/{tournamentId}/courts")
    suspend fun adminListCourts(
        @Path("tournamentId") tournamentId: String,
    ): Response<JsonElement>

    // ==================== Match Info ====================

    @GET("api/matches/{matchId}")
    suspend fun getMatchInfo(
        @Path("matchId") matchId: String,
    ): Response<MatchData>

    @GET("api/live-app/matches/{matchId}/runtime")
    suspend fun getMatchRuntime(
        @Path("matchId") matchId: String,
    ): Response<MatchData>

    // ==================== Live Session ====================

    @POST("api/live-app/matches/{matchId}/live/create")
    suspend fun createLiveSession(
        @Path("matchId") matchId: String,
        @Query("force") force: Int? = null,
        @Body body: CreateLiveRequest = CreateLiveRequest(),
    ): Response<LiveSession>

    @POST("api/matches/{matchId}/live/start")
    suspend fun notifyStreamStarted(
        @Path("matchId") matchId: String,
        @Body body: StreamNotifyRequest,
    ): Response<StreamNotifyResponse>

    @POST("api/matches/{matchId}/live/heartbeat")
    suspend fun notifyStreamHeartbeat(
        @Path("matchId") matchId: String,
        @Body body: StreamNotifyRequest,
    ): Response<StreamNotifyResponse>

    @POST("api/matches/{matchId}/live/end")
    suspend fun notifyStreamEnded(
        @Path("matchId") matchId: String,
        @Body body: StreamNotifyRequest,
    ): Response<StreamNotifyResponse>

    @POST("api/live-app/courts/{courtId}/presence/start")
    suspend fun startCourtPresence(
        @Path("courtId") courtId: String,
        @Body body: CourtPresenceRequest,
    ): Response<CourtPresenceResponse>

    @POST("api/live-app/courts/{courtId}/presence/heartbeat")
    suspend fun heartbeatCourtPresence(
        @Path("courtId") courtId: String,
        @Body body: CourtPresenceRequest,
    ): Response<CourtPresenceResponse>

    @POST("api/live-app/courts/{courtId}/presence/end")
    suspend fun endCourtPresence(
        @Path("courtId") courtId: String,
        @Body body: CourtPresenceRequest,
    ): Response<CourtPresenceResponse>

    @POST("api/live-app/courts/{courtId}/presence/extend-preview")
    suspend fun extendCourtPresencePreview(
        @Path("courtId") courtId: String,
        @Body body: CourtPresenceRequest,
    ): Response<CourtPresenceResponse>

    @POST("api/live/recordings/v2/start")
    suspend fun startMatchRecording(
        @Body body: StartMatchRecordingRequest,
    ): Response<MatchRecordingResponse>

    @POST("api/live/recordings/v2/segments/presign")
    suspend fun presignRecordingSegment(
        @Body body: RecordingSegmentPresignRequest,
    ): Response<RecordingSegmentPresignResponse>

    @POST("api/live/recordings/v2/segments/presign-batch")
    suspend fun presignRecordingSegmentBatch(
        @Body body: RecordingSegmentPresignBatchRequest,
    ): Response<RecordingSegmentPresignBatchResponse>

    @POST("api/live/recordings/v2/live-manifest/presign")
    suspend fun presignRecordingLiveManifest(
        @Body body: RecordingLiveManifestPresignRequest,
    ): Response<RecordingLiveManifestPresignResponse>

    @POST("api/live/recordings/v2/segments/multipart/start")
    suspend fun startMultipartRecordingSegment(
        @Body body: RecordingMultipartStartRequest,
    ): Response<RecordingMultipartStartResponse>

    @POST("api/live/recordings/v2/segments/multipart/part-url")
    suspend fun presignMultipartRecordingSegmentPart(
        @Body body: RecordingMultipartPartUrlRequest,
    ): Response<RecordingMultipartPartUrlResponse>

    @POST("api/live/recordings/v2/segments/multipart/progress")
    suspend fun reportMultipartRecordingSegmentProgress(
        @Body body: RecordingMultipartProgressRequest,
    ): Response<MatchRecordingResponse>

    @POST("api/live/recordings/v2/segments/multipart/complete")
    suspend fun completeMultipartRecordingSegment(
        @Body body: RecordingMultipartCompleteRequest,
    ): Response<MatchRecordingResponse>

    @POST("api/live/recordings/v2/segments/multipart/abort")
    suspend fun abortMultipartRecordingSegment(
        @Body body: RecordingMultipartAbortRequest,
    ): Response<MatchRecordingResponse>

    @POST("api/live/recordings/v2/segments/complete")
    suspend fun completeRecordingSegment(
        @Body body: RecordingSegmentCompleteRequest,
    ): Response<MatchRecordingResponse>

    @POST("api/live/recordings/v2/finalize")
    suspend fun finalizeRecording(
        @Body body: FinalizeMatchRecordingRequest,
    ): Response<MatchRecordingResponse>

    @GET("api/live/recordings/v2/by-match/{matchId}")
    suspend fun getRecordingByMatch(
        @Path("matchId") matchId: String,
    ): Response<MatchRecordingResponse>

    // ==================== Overlay ====================

    @GET("api/overlay/match/{matchId}")
    suspend fun getOverlaySnapshot(
        @Path("matchId") matchId: String,
    ): Response<JsonElement>

    @GET("api/public/overlay/config")
    suspend fun getOverlayConfig(
        @Query("tournamentId") tournamentId: String? = null,
        @Query("limit") limit: Int = 12,
        @Query("featured") featured: Int = 1,
    ): Response<OverlayConfig>
}
