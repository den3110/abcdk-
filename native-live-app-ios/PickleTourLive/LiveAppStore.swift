import AVFoundation
import ActivityKit
import Combine
import Foundation
import UIKit

@MainActor
final class LiveAppStore: ObservableObject {
    @Published var route: AppRoute = .login
    @Published var isWorking = false
    @Published var errorMessage: String?
    @Published var bannerMessage: String?

    @Published private(set) var session: AuthSession?
    @Published private(set) var user: UserMe?
    @Published private(set) var bootstrap: LiveAppBootstrapResponse?

    @Published private(set) var clusters: [CourtClusterData] = []
    @Published private(set) var selectedCluster: CourtClusterData?
    @Published private(set) var courts: [AdminCourtData] = []
    @Published private(set) var selectedCourt: AdminCourtData?
    @Published private(set) var courtRuntime: LiveAppCourtRuntimeResponse?
    @Published private(set) var courtPresence: CourtLiveScreenPresence?
    @Published private(set) var activeMatch: MatchData?
    @Published private(set) var liveSession: LiveSession?
    @Published private(set) var overlayConfig: OverlayConfig?
    @Published private(set) var overlaySnapshot: LiveOverlaySnapshot?
    @Published private(set) var recordingStateText = "Chưa ghi hình"
    @Published private(set) var recordingPendingUploads = 0

    @Published private(set) var waitingForCourt = false
    @Published private(set) var waitingForMatchLive = false
    @Published private(set) var waitingForNextMatch = false
    @Published private(set) var goLiveCountdownSeconds: Int?
    @Published private(set) var stopLiveCountdownSeconds: Int?
    @Published private(set) var endingLive = false
    @Published private(set) var liveStartedAt: Date?
    @Published private(set) var preflightIssues: [LivePreflightIssue] = []
    @Published private(set) var recordOnlyArmed = false
    @Published private(set) var goLiveArmed = false
    @Published var batterySaverEnabled = false
    @Published var orientationMode: DeviceOrientationMode = .auto

    @Published var launchTarget = LiveLaunchTarget()
    @Published var liveMode: LiveStreamMode = .streamAndRecord
    @Published var selectedQuality: LiveQualityPreset = .balanced1080

    @Published private(set) var socketConnected = false
    @Published private(set) var runtimeSocketConnected = false
    @Published private(set) var presenceSocketConnected = false
    @Published private(set) var networkConnected = true
    @Published private(set) var networkIsWiFi = false
    @Published private(set) var appIsActive = true
    @Published private(set) var availableStorageBytes: Int64 = 0
    @Published private(set) var totalStorageBytes: Int64 = 0
    @Published private(set) var activeSocketMatchId: String?
    @Published private(set) var lastSocketPayloadAt: Date?
    @Published private(set) var streamState: StreamConnectionState = .idle

    let streamingService = LiveStreamingService()

    private let environment = LiveAppEnvironment.shared
    private var cancellables = Set<AnyCancellable>()
    private var heartbeatTask: Task<Void, Never>?
    private var runtimePollTask: Task<Void, Never>?
    private var goLiveCountdownTask: Task<Void, Never>?
    private var stopLiveCountdownTask: Task<Void, Never>?
    private var pendingLaunchTarget: LiveLaunchTarget?
    private var activeRecording: MatchRecording?
    private var recordingFinalizeRequested = false
    private var recordingUploadTasks: [UUID: Task<Void, Never>] = [:]
    private var watchedClusterId: String?
    private var watchedCourtId: String?
    private var watchedTournamentId: String?
    private var queuedCourtMatchId: String?
    private var isSwitchingMatch = false

    init() {
        session = environment.sessionStore.session
        bind()
        configureSockets()
    }

    func bootstrapIfPossible() async {
        guard session?.accessToken.trimmedNilIfBlank != nil else {
            route = .login
            return
        }
        await refreshBootstrap()
    }

    func signInWithWeb() async {
        errorMessage = nil
        isWorking = true
        defer { isWorking = false }

        do {
            let nextSession = try await environment.authCoordinator.signIn()
            environment.sessionStore.replace(nextSession)
            bannerMessage = "Đăng nhập thành công."
            await refreshBootstrap()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func requestPickleTourHandoff() {
        guard let handoffURL = buildPickleTourHandoffURL() else {
            errorMessage = "Không tạo được liên kết handoff với PickleTour."
            return
        }

        UIApplication.shared.open(handoffURL) { [weak self] opened in
            guard let self else { return }
            Task { @MainActor in
                if !opened {
                    self.bannerMessage = "Không mở được app PickleTour, chuyển sang đăng nhập web."
                    await self.signInWithWeb()
                }
            }
        }
    }

    func signOut() {
        stopBackgroundLoops()
        cancelRecordingUploads()
        environment.matchSocket.disconnect()
        environment.courtRuntimeSocket.disconnect()
        environment.courtPresenceSocket.disconnect()
        watchedClusterId = nil
        watchedCourtId = nil
        watchedTournamentId = nil

        Task { @MainActor in
            await self.streamingService.stopRecording()
            self.streamingService.stopPublishing()
            self.streamingService.stopPreview()
        }

        environment.sessionStore.replace(nil)
        session = nil
        user = nil
        bootstrap = nil
        clusters = []
        selectedCluster = nil
        courts = []
        selectedCourt = nil
        courtRuntime = nil
        courtPresence = nil
        activeMatch = nil
        liveSession = nil
        overlayConfig = nil
        overlaySnapshot = nil
        launchTarget = LiveLaunchTarget()
        pendingLaunchTarget = nil
        activeRecording = nil
        queuedCourtMatchId = nil
        recordingFinalizeRequested = false
        recordingStateText = "Chưa ghi hình"
        recordingPendingUploads = 0
        waitingForCourt = false
        waitingForMatchLive = false
        waitingForNextMatch = false
        goLiveCountdownSeconds = nil
        stopLiveCountdownSeconds = nil
        endingLive = false
        liveStartedAt = nil
        preflightIssues = []
        recordOnlyArmed = false
        goLiveArmed = false
        batterySaverEnabled = false
        orientationMode = .auto
        bannerMessage = nil
        errorMessage = nil
        route = .login
    }

    func selectCluster(_ cluster: CourtClusterData) async {
        selectedCluster = cluster
        errorMessage = nil
        await loadCourts(clusterId: cluster.id)
    }

    func showManualSetup() {
        route = .courtSetup
    }

    func goBackToAdminHome() {
        errorMessage = nil
        route = .adminHome
    }

    func openCourt(_ court: AdminCourtData) async {
        selectedCourt = court
        launchTarget = LiveLaunchTarget(
            courtId: court.id,
            matchId: court.currentMatchId?.trimmedNilIfBlank,
            pageId: launchTarget.pageId
        )
        route = .courtSetup
        await refreshCourtRuntime(courtId: court.id)
        await startRuntimePolling(for: court.id)
    }

    func updateLaunchTarget(courtId: String?, matchId: String?, pageId: String?) {
        launchTarget = LiveLaunchTarget(
            courtId: courtId?.trimmedNilIfBlank,
            matchId: matchId?.trimmedNilIfBlank,
            pageId: pageId?.trimmedNilIfBlank
        )
    }

    func continueFromSetup() async {
        errorMessage = nil
        isWorking = true
        defer { isWorking = false }

        do {
            let resolvedTarget = try await resolveLaunchTarget(launchTarget)
            launchTarget = resolvedTarget
            try await prepareLiveScreen(using: resolvedTarget)
            route = .liveStream
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func refreshBootstrap() async {
        errorMessage = nil
        isWorking = true
        defer { isWorking = false }

        do {
            let bootstrap = try await environment.apiClient.getBootstrap()
            guard bootstrap.canUseLiveApp else {
                throw LiveAPIError.server(
                    statusCode: 403,
                    message: bootstrap.message ?? bootstrap.reason ?? "Tài khoản chưa có quyền dùng PickleTour Live."
                )
            }

            self.bootstrap = bootstrap
            user = bootstrap.user
            clusters = bootstrap.manageableCourtClusters.sorted { ($0.order ?? 0) < ($1.order ?? 0) }

            let launchInFlight =
                pendingLaunchTarget != nil ||
                launchTarget.courtId?.trimmedNilIfBlank != nil ||
                launchTarget.matchId?.trimmedNilIfBlank != nil ||
                route == .courtSetup ||
                route == .liveStream

            if !launchInFlight || route == .login {
                route = .adminHome
            }

            if let tournamentId = bootstrap.manageableTournaments.first?.id.trimmedNilIfBlank {
                watchTournament(tournamentId)
            }

            if let selectedCluster, clusters.contains(where: { $0.id == selectedCluster.id }) {
                await loadCourts(clusterId: selectedCluster.id)
            } else if let firstCluster = clusters.first {
                await selectCluster(firstCluster)
            }

            if let pendingLaunchTarget {
                self.pendingLaunchTarget = nil
                await applyLaunchTarget(pendingLaunchTarget)
            }
        } catch {
            errorMessage = error.localizedDescription
            if case LiveAPIError.unauthorized = error {
                signOut()
            }
        }
    }

    func refreshOverlay() async {
        guard let matchId = activeMatch?.id.trimmedNilIfBlank else { return }

        async let snapshotTask = try? environment.apiClient.getOverlaySnapshot(matchId: matchId)
        async let configTask = try? environment.apiClient.getOverlayConfig(tournamentId: activeMatch?.tournament?.id)

        let snapshot = await snapshotTask
        let config = await configTask

        if let config {
            overlayConfig = config
        }
        if let enrichedSnapshot = enrichOverlaySnapshot(snapshot, config: config, match: activeMatch) {
            overlaySnapshot = enrichedSnapshot
            streamingService.overlaySnapshot = enrichedSnapshot
        }
    }

    func extendPreviewLease() async {
        guard let courtId = currentCourtId else { return }
        do {
            let response = try await environment.apiClient.extendPreview(
                courtId: courtId,
                clientSessionId: streamingService.clientSessionId
            )
            applyPresenceResponse(response, matchId: activeMatch?.id)
            bannerMessage = "Đã gia hạn giữ sân ở chế độ preview."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func startLive() async {
        guard let activeMatch else {
            errorMessage = "Chưa có trận để phát live."
            return
        }

        refreshStorageMetrics()

        if !cameraPermissionGranted || !microphonePermissionGranted {
            errorMessage = "Thiếu quyền camera hoặc micro để bắt đầu phiên."
            return
        }

        if liveMode.includesLivestream, !networkConnected {
            errorMessage = "Thiết bị đang offline nên chưa thể tạo livestream."
            return
        }

        if liveMode.includesRecording, recordingStorageHardBlock {
            errorMessage = "Bộ nhớ còn trống quá thấp cho recording ở quality hiện tại."
            return
        }

        isWorking = true
        errorMessage = nil
        preflightIssues = []
        waitingForCourt = false
        waitingForMatchLive = false
        waitingForNextMatch = false
        goLiveArmed = false
        recordOnlyArmed = false
        defer { isWorking = false }

        do {
            recordingFinalizeRequested = false
            queuedCourtMatchId = nil
            streamingService.applyQuality(selectedQuality)
            try await streamingService.preparePreview(quality: selectedQuality)

            if liveMode.includesRecording {
                let recordingResponse = try await environment.apiClient.startRecording(
                    StartMatchRecordingRequest(
                        matchId: activeMatch.id,
                        courtId: currentCourtId,
                        tournamentId: activeMatch.tournament?.id,
                        streamSessionId: streamingService.clientSessionId,
                        mode: liveMode.rawValue
                    )
                )

                activeRecording = recordingResponse.recording
                recordingStateText = recordingResponse.recording?.status ?? "Đã mở phiên recording"

                if let recordingId = recordingResponse.recording?.id?.trimmedNilIfBlank {
                    try await streamingService.startRecording(recordingId: recordingId, matchId: activeMatch.id)
                } else {
                    throw LiveAPIError.server(statusCode: 0, message: "Server không trả recordingId hợp lệ.")
                }
            } else {
                activeRecording = nil
                recordingStateText = "Không ghi hình"
            }

            if liveMode == .recordOnly {
                startHeartbeats()
                liveStartedAt = Date()
                bannerMessage = "Đã bắt đầu ghi hình."
                return
            }

            let liveSession = try await environment.apiClient.createLiveSession(
                matchId: activeMatch.id,
                pageId: launchTarget.pageId,
                force: false
            )
            self.liveSession = liveSession

            guard
                let rawURL = liveSession.facebook?.resolvedRTMPURL,
                let destination = RTMPDestination.parse(from: rawURL)
            else {
                throw LiveAPIError.server(statusCode: 0, message: "Không nhận được RTMP URL hợp lệ.")
            }

            try await streamingService.startPublishing(to: destination)
            _ = try await environment.apiClient.notifyStreamStarted(
                matchId: activeMatch.id,
                clientSessionId: streamingService.clientSessionId
            )
            startHeartbeats()
            liveStartedAt = Date()
            bannerMessage = liveMode.includesRecording ? "Đã bắt đầu live và recording." : "Đã bắt đầu live."
        } catch {
            if streamingService.isRecordingLocally {
                await streamingService.stopRecording()
            }
            recordingFinalizeRequested = activeRecording != nil
            if activeRecording != nil {
                recordingStateText = recordingPendingUploads > 0 ? "Đang tải segment cuối" : "Đang chốt recording"
            } else {
                recordingStateText = "Chưa ghi hình"
            }
            errorMessage = error.localizedDescription
            liveStartedAt = nil
            if activeRecording != nil {
                await maybeFinalizeRecordingIfReady()
            }
        }
    }

    func stopLive() async {
        stopBackgroundLoops()
        goLiveCountdownTask?.cancel()
        goLiveCountdownTask = nil
        goLiveCountdownSeconds = nil
        stopLiveCountdownTask?.cancel()
        stopLiveCountdownTask = nil
        stopLiveCountdownSeconds = nil
        isWorking = true
        defer { isWorking = false }

        let liveMatchId = activeMatch?.id.trimmedNilIfBlank
        let shouldNotifyLiveEnd = matchesLiveSessionState
        let shouldStopRecording = liveMode.includesRecording || streamingService.isRecordingLocally || activeRecording != nil

        if shouldNotifyLiveEnd, let liveMatchId {
            _ = try? await environment.apiClient.notifyStreamEnded(
                matchId: liveMatchId,
                clientSessionId: streamingService.clientSessionId
            )
        }

        streamingService.stopPublishing()

        if shouldStopRecording {
            await streamingService.stopRecording()
            recordingFinalizeRequested = true
            recordingStateText = recordingPendingUploads > 0 ? "Đang tải segment cuối" : "Đang chốt recording"
        }

        if let courtId = currentCourtId {
            _ = try? await environment.apiClient.endCourtPresence(
                courtId: courtId,
                clientSessionId: streamingService.clientSessionId
            )
            courtPresence = nil
        }

        liveSession = nil
        liveStartedAt = nil
        endingLive = false
        goLiveArmed = false
        recordOnlyArmed = false
        waitingForCourt = false
        waitingForMatchLive = false
        waitingForNextMatch = false
        await maybeFinalizeRecordingIfReady()

        bannerMessage = liveMode == .recordOnly ? "Đã dừng ghi hình." : "Đã dừng live."

        if let queuedCourtMatchId, queuedCourtMatchId != activeMatch?.id {
            cancelWaitingStates()
            waitingForNextMatch = false
            self.queuedCourtMatchId = nil
            await switchMatchContext(to: queuedCourtMatchId, announcement: "Đã chuyển sang match kế tiếp.")
        }
    }

    func leaveLiveScreen() async {
        if matchesLiveSessionState || streamingService.isRecordingLocally {
            await stopLive()
        } else if let courtId = currentCourtId {
            stopBackgroundLoops()
            _ = try? await environment.apiClient.endCourtPresence(
                courtId: courtId,
                clientSessionId: streamingService.clientSessionId
            )
            courtPresence = nil
        } else {
            stopBackgroundLoops()
        }

        environment.matchSocket.unwatch()
        unwatchCurrentCourt()
        streamingService.stopPublishing()
        await streamingService.stopRecording()
        streamingService.stopPreview()
        liveSession = nil
        liveStartedAt = nil
        cancelWaitingStates()
        cancelGoLiveCountdown()
        cancelStopLiveCountdown()
        queuedCourtMatchId = nil
        route = .adminHome
    }

    func toggleCamera() async {
        do {
            try await streamingService.toggleCamera()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func toggleTorch() {
        do {
            try streamingService.setTorchEnabled(!streamingService.stats.torchEnabled)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func toggleMicrophone() {
        streamingService.setMicrophoneEnabled(!streamingService.stats.micEnabled)
    }

    func setZoom(_ zoom: CGFloat) {
        do {
            try streamingService.setZoomFactor(zoom)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func applyQuality(_ quality: LiveQualityPreset) {
        selectedQuality = quality
        streamingService.applyQuality(quality)
    }

    var recordingSnapshot: MatchRecording? {
        activeRecording
    }

    var recordingPlaybackURLString: String? {
        activeRecording?.playbackURLString
    }

    var recordingSegmentCount: Int {
        activeRecording?.segmentCount ?? 0
    }

    var hasPrimarySessionIntent: Bool {
        liveStartedAt != nil || matchesLiveSessionState || streamingService.isRecordingLocally || isWaitingForActivation
    }

    var pendingNextMatchId: String? {
        queuedCourtMatchId?.trimmedNilIfBlank
    }

    var currentCourtIdentifier: String? {
        currentCourtId?.trimmedNilIfBlank
    }

    var cameraPermissionGranted: Bool {
        LiveStreamingService.cameraPermissionGranted
    }

    var microphonePermissionGranted: Bool {
        LiveStreamingService.microphonePermissionGranted
    }

    var previewReady: Bool {
        streamingService.isPreviewReady
    }

    var socketPayloadAgeSeconds: Int? {
        guard let lastSocketPayloadAt else { return nil }
        return max(0, Int(Date().timeIntervalSince(lastSocketPayloadAt)))
    }

    var socketPayloadStale: Bool {
        guard socketConnected else { return false }
        guard let socketPayloadAgeSeconds else { return false }
        return socketPayloadAgeSeconds >= 20
    }

    var previewLeaseRemainingSeconds: Int? {
        guard let raw = courtPresence?.previewReleaseAt?.trimmedNilIfBlank else { return nil }
        guard let date = ISO8601DateFormatter.liveApp.date(from: raw) else { return nil }
        return max(0, Int(date.timeIntervalSinceNow.rounded(.down)))
    }

    var previewLeaseWarning: Bool {
        guard let remaining = previewLeaseRemainingSeconds else { return false }
        let warningThresholdMs = max(courtPresence?.previewWarningMs ?? 300_000, 60_000)
        return remaining > 0 && remaining * 1_000 <= warningThresholdMs
    }

    var overlayDataReady: Bool {
        overlaySnapshot != nil
    }

    var minimumRecordingStorageBytes: Int64 {
        guard liveMode.includesRecording else { return 0 }
        let bitrateFloor = Int64(selectedQuality.videoBitrate + 128_000) / 8
        return max(bitrateFloor * 120, 900_000_000)
    }

    var recommendedRecordingStorageBytes: Int64 {
        guard liveMode.includesRecording else { return 0 }
        let bitrateFloor = Int64(selectedQuality.videoBitrate + 128_000) / 8
        return max(bitrateFloor * 600, 2_500_000_000)
    }

    var recordingStorageHardBlock: Bool {
        liveMode.includesRecording && availableStorageBytes > 0 && availableStorageBytes < minimumRecordingStorageBytes
    }

    var recordingStorageWarning: Bool {
        liveMode.includesRecording && availableStorageBytes > 0 && availableStorageBytes < recommendedRecordingStorageBytes
    }

    var brandingReady: Bool {
        let hasTournamentLogo = overlaySnapshot?.tournamentLogoURL?.trimmedNilIfBlank != nil
        let hasWebLogo = overlayConfig?.webLogoURL?.trimmedNilIfBlank != nil
        let hasSponsor = overlayConfig?.sponsors.isEmpty == false
        return hasTournamentLogo || hasWebLogo || hasSponsor
    }

    var isWaitingForActivation: Bool {
        waitingForCourt || waitingForMatchLive || waitingForNextMatch
    }

    var recoverySummary: LiveRecoverySummary? {
        switch streamState {
        case let .reconnecting(message):
            return LiveRecoverySummary(
                title: "RTMP đang tự kết nối lại",
                detail: message,
                canRetryPreview: false,
                canRetrySession: true
            )
        case let .failed(message):
            return LiveRecoverySummary(
                title: "Phiên live đang lỗi",
                detail: message,
                canRetryPreview: true,
                canRetrySession: true
            )
        default:
            return nil
        }
    }

    func handlePrimaryAction() {
        refreshStorageMetrics()
        let issues = computePreflightIssues()
        let hasBlocker = issues.contains { $0.severity == .blocker }
        let hasWarning = issues.contains { $0.severity == .warning }

        if hasBlocker || hasWarning {
            preflightIssues = issues
            return
        }

        Task {
            await beginPrimarySessionFlow()
        }
    }

    func dismissPreflight() {
        preflightIssues = []
    }

    func proceedPreflight() {
        preflightIssues = []
        Task {
            await beginPrimarySessionFlow()
        }
    }

    func requestStopPrimarySession() {
        if stopLiveCountdownSeconds != nil {
            cancelStopLiveCountdown()
            return
        }

        if matchesLiveSessionState || streamingService.isRecordingLocally || liveStartedAt != nil {
            beginStopLiveCountdown()
            return
        }

        cancelWaitingStates()
    }

    func cancelGoLiveCountdown() {
        goLiveCountdownTask?.cancel()
        goLiveCountdownTask = nil
        goLiveCountdownSeconds = nil
        goLiveArmed = false
        if liveMode == .recordOnly {
            recordOnlyArmed = false
        }
        waitingForMatchLive = false
        waitingForNextMatch = false
    }

    func cancelStopLiveCountdown() {
        stopLiveCountdownTask?.cancel()
        stopLiveCountdownTask = nil
        stopLiveCountdownSeconds = nil
        endingLive = false
    }

    func toggleBatterySaver() {
        batterySaverEnabled.toggle()
    }

    func cycleOrientationMode() {
        orientationMode = orientationMode.next()
        LiveAppOrientationController.apply(orientationMode)
    }

    func retryPreviewPipeline() {
        Task {
            await rebuildPreviewPipeline()
        }
    }

    func retryActiveSession() {
        Task {
            await retryPrimarySession()
        }
    }

    func refreshCurrentContext() async {
        errorMessage = nil
        isWorking = true
        defer { isWorking = false }

        if let courtId = currentCourtId?.trimmedNilIfBlank {
            await refreshCourtRuntime(courtId: courtId)
        }

        if let activeMatchId = activeMatch?.id.trimmedNilIfBlank {
            do {
                let refreshedMatch = try await environment.apiClient.getMatchRuntime(matchId: activeMatchId)
                activeMatch = refreshedMatch
                overlaySnapshot = enrichOverlaySnapshot(overlaySnapshot, match: refreshedMatch)
                streamingService.overlaySnapshot = overlaySnapshot
            } catch {
                errorMessage = error.localizedDescription
            }
            await refreshOverlay()
        } else if route == .courtSetup {
            let setupMatchId =
                launchTarget.matchId?.trimmedNilIfBlank
                ?? courtRuntime?.currentMatchId?.trimmedNilIfBlank
                ?? courtRuntime?.nextMatchId?.trimmedNilIfBlank
            if let setupMatchId {
                do {
                    activeMatch = try await environment.apiClient.getMatchRuntime(matchId: setupMatchId)
                } catch {
                    errorMessage = error.localizedDescription
                }
            }
        }

        if errorMessage == nil {
            bannerMessage = "Đã làm mới court runtime và match context."
        }
    }

    func clearDiagnostics() {
        streamingService.clearDiagnostics()
        bannerMessage = "Đã xoá diagnostics nội bộ."
    }

    func handleIncomingURL(_ url: URL) {
        if environment.authCoordinator.handleOpenURL(url) {
            return
        }

        guard url.scheme == "pickletour-live" else { return }

        switch url.host {
        case "auth-init":
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            let token = components?
                .queryItems?
                .first(where: { $0.name == "osAuthToken" })?
                .value
            let targetURLString = components?
                .queryItems?
                .first(where: { $0.name == "targetUrl" })?
                .value
            let continueURLString = components?
                .queryItems?
                .first(where: { $0.name == "continueUrl" })?
                .value

            if
                let targetURL = URL(string: targetURLString ?? continueURLString ?? ""),
                targetURL.scheme == "pickletour-live",
                targetURL.host == "stream"
            {
                pendingLaunchTarget = parseLaunchTarget(from: targetURL)
            }

            Task {
                await continueWithOsAuthToken(token)
            }
        case "auth":
            break
        case "stream":
            let target = parseLaunchTarget(from: url)
            Task {
                if session?.accessToken.trimmedNilIfBlank == nil {
                    pendingLaunchTarget = target
                    route = .login
                    requestPickleTourHandoff()
                } else {
                    await applyLaunchTarget(target)
                }
            }
        default:
            break
        }
    }

    private var currentCourtId: String? {
        launchTarget.courtId?.trimmedNilIfBlank
            ?? selectedCourt?.id.trimmedNilIfBlank
            ?? courtRuntime?.courtId.trimmedNilIfBlank
    }

    private var matchesLiveSessionState: Bool {
        switch streamState {
        case .live, .connecting, .reconnecting(_):
            return true
        default:
            return false
        }
    }

    private func computePreflightIssues() -> [LivePreflightIssue] {
        var issues: [LivePreflightIssue] = []

        if currentCourtId?.trimmedNilIfBlank == nil, launchTarget.matchId?.trimmedNilIfBlank == nil, activeMatch?.id.trimmedNilIfBlank == nil {
            issues.append(
                LivePreflightIssue(
                    id: "missing_target",
                    severity: .blocker,
                    title: "Thiếu court hoặc match",
                    detail: "Cần chọn ít nhất một sân hoặc một trận trước khi bắt đầu."
                )
            )
        }

        if !cameraPermissionGranted || !microphonePermissionGranted {
            issues.append(
                LivePreflightIssue(
                    id: "capture_permissions",
                    severity: .blocker,
                    title: "Thiếu quyền camera hoặc micro",
                    detail: "Cần cấp đủ quyền camera và micro cho PickleTour Live trước khi preview hoặc vào phiên."
                )
            )
        }

        if !networkConnected {
            issues.append(
                LivePreflightIssue(
                    id: "network_offline",
                    severity: liveMode.includesLivestream ? .blocker : .warning,
                    title: "Thiết bị đang offline",
                    detail: liveMode.includesLivestream
                        ? "Livestream cần mạng để xin RTMP session, heartbeat và đồng bộ overlay."
                        : "Record only vẫn có thể ghi cục bộ, nhưng upload recording và heartbeat presence sẽ bị chậm."
                )
            )
        }

        if recordingStorageHardBlock {
            issues.append(
                LivePreflightIssue(
                    id: "storage_hard_block",
                    severity: .blocker,
                    title: "Bộ nhớ quá thấp để ghi hình",
                    detail: "Dung lượng còn trống thấp hơn ngưỡng tối thiểu cho recording ở quality hiện tại."
                )
            )
        } else if recordingStorageWarning {
            issues.append(
                LivePreflightIssue(
                    id: "storage_warning",
                    severity: .warning,
                    title: "Bộ nhớ còn thấp cho recording",
                    detail: "Vẫn có thể ghi hình, nhưng nên giải phóng thêm dung lượng để tránh hỏng phiên dài."
                )
            )
        }

        if activeMatch == nil, currentCourtId?.trimmedNilIfBlank != nil {
            issues.append(
                LivePreflightIssue(
                    id: "waiting_for_court",
                    severity: .info,
                    title: "Sân chưa có trận hiện tại",
                    detail: "App sẽ giữ preview và tự chờ trận xuất hiện trên sân này."
                )
            )
        }

        if !socketConnected {
            issues.append(
                LivePreflightIssue(
                    id: "socket_offline",
                    severity: .warning,
                    title: "Socket overlay chưa nối",
                    detail: "Có thể vẫn phát được, nhưng overlay và match runtime sẽ cập nhật chậm hơn."
                )
            )
        }

        if socketPayloadStale {
            issues.append(
                LivePreflightIssue(
                    id: "socket_stale",
                    severity: .warning,
                    title: "Payload overlay đang stale",
                    detail: "Socket đã nối nhưng chưa nhận payload mới trong \(socketPayloadAgeSeconds ?? 0) giây."
                )
            )
        }

        if currentCourtId?.trimmedNilIfBlank != nil, !presenceSocketConnected {
            issues.append(
                LivePreflightIssue(
                    id: "presence_socket_offline",
                    severity: .info,
                    title: "Socket presence chưa nối",
                    detail: "Lease sân vẫn dùng REST heartbeat, nhưng cảnh báo chiếm sân sẽ kém realtime hơn."
                )
            )
        }

        if previewLeaseWarning {
            issues.append(
                LivePreflightIssue(
                    id: "preview_lease_warning",
                    severity: .warning,
                    title: "Preview lease sắp hết",
                    detail: "Lease preview còn khoảng \(previewLeaseRemainingSeconds ?? 0) giây. Nên gia hạn trước khi vào phiên."
                )
            )
        }

        if activeMatch != nil, overlaySnapshot == nil {
            issues.append(
                LivePreflightIssue(
                    id: "overlay_missing",
                    severity: .warning,
                    title: "Overlay chưa sẵn sàng",
                    detail: "Có thể vào phiên ngay, nhưng bảng điểm burn-in chưa có dữ liệu mới nhất."
                )
            )
        }

        if activeMatch != nil, !brandingReady {
            issues.append(
                LivePreflightIssue(
                    id: "branding_missing",
                    severity: .info,
                    title: "Branding chưa đầy đủ",
                    detail: "Overlay config chưa có đủ logo giải, web logo hoặc sponsor để burn-in trông giống bản Android."
                )
            )
        }

        if case let .failed(message) = streamState {
            issues.append(
                LivePreflightIssue(
                    id: "stream_failed",
                    severity: .warning,
                    title: "Pipeline vừa lỗi",
                    detail: message
                )
            )
        }

        if liveMode.includesRecording, recordingPendingUploads > 0 {
            issues.append(
                LivePreflightIssue(
                    id: "pending_uploads",
                    severity: .info,
                    title: "Vẫn còn segment đang tải",
                    detail: "Có \(recordingPendingUploads) segment nền chưa tải xong từ phiên trước."
                )
            )
        }

        return issues
    }

    private func beginPrimarySessionFlow() async {
        guard goLiveCountdownTask == nil else { return }
        errorMessage = nil
        bannerMessage = nil

        goLiveCountdownTask = Task { [weak self] in
            guard let self else { return }
            defer {
                self.goLiveCountdownTask = nil
                self.goLiveCountdownSeconds = nil
            }

            for value in stride(from: 3, through: 1, by: -1) {
                if Task.isCancelled { return }
                self.goLiveCountdownSeconds = value
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }

            if Task.isCancelled { return }

            self.goLiveArmed = self.liveMode.includesLivestream
            self.recordOnlyArmed = self.liveMode == .recordOnly

            if self.activeMatch == nil {
                self.waitingForCourt = self.currentCourtId?.trimmedNilIfBlank != nil
                self.waitingForMatchLive = false
                self.waitingForNextMatch = false
                self.bannerMessage = self.liveMode == .recordOnly
                    ? "Đã armed chế độ ghi hình. App sẽ chờ trận trên sân."
                    : "Đã armed phiên live. App sẽ chờ trận trên sân."
                return
            }

            if self.shouldWaitForMatchToBeLive(self.activeMatch) {
                self.waitingForCourt = false
                self.waitingForMatchLive = true
                self.waitingForNextMatch = false
                self.bannerMessage = self.liveMode == .recordOnly
                    ? "Đã armed ghi hình. App sẽ tự bắt đầu khi trận chuyển LIVE."
                    : "Đã armed phiên live. App sẽ tự bắt đầu khi trận chuyển LIVE."
                return
            }

            self.waitingForCourt = false
            self.waitingForMatchLive = false
            self.waitingForNextMatch = false
            self.goLiveArmed = false
            self.recordOnlyArmed = false
            await self.startLive()
        }
    }

    private func beginStopLiveCountdown() {
        guard stopLiveCountdownTask == nil else { return }
        endingLive = false

        stopLiveCountdownTask = Task { [weak self] in
            guard let self else { return }
            defer {
                self.stopLiveCountdownTask = nil
                self.stopLiveCountdownSeconds = nil
            }

            for value in stride(from: 5, through: 1, by: -1) {
                if Task.isCancelled { return }
                self.stopLiveCountdownSeconds = value
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }

            if Task.isCancelled { return }
            self.endingLive = true
            await self.stopLive()
            self.endingLive = false
        }
    }

    private func cancelWaitingStates() {
        goLiveArmed = false
        recordOnlyArmed = false
        waitingForCourt = false
        waitingForMatchLive = false
        waitingForNextMatch = false
        bannerMessage = nil
    }

    private func shouldWaitForMatchToBeLive(_ match: MatchData?) -> Bool {
        guard currentCourtId?.trimmedNilIfBlank != nil else { return false }
        guard let status = match?.status?.trimmedNilIfBlank?.lowercased() else { return false }
        return status != "live"
    }

    private func currentPresenceScreenState() -> String {
        if endingLive {
            return "ending_live"
        }
        if stopLiveCountdownSeconds != nil {
            return "stopping_countdown"
        }
        if goLiveCountdownSeconds != nil {
            return "starting_countdown"
        }
        if waitingForNextMatch {
            return "waiting_for_next_match"
        }
        if waitingForCourt || waitingForMatchLive {
            return "waiting_for_match"
        }
        switch streamState {
        case .live:
            return "live"
        case .connecting:
            return "connecting"
        case .reconnecting:
            return "reconnecting"
        case .previewReady, .preparingPreview:
            return "preview"
        case .failed:
            return "failed"
        case .idle, .stopped:
            return "idle"
        }
    }

    private func maybeAutoStartArmedSession() {
        guard !isWorking else { return }
        guard goLiveCountdownTask == nil else { return }
        guard stopLiveCountdownTask == nil else { return }
        guard !matchesLiveSessionState else { return }
        guard !streamingService.isRecordingLocally else { return }
        guard goLiveArmed || recordOnlyArmed || isWaitingForActivation else { return }

        if activeMatch == nil {
            waitingForCourt = currentCourtId?.trimmedNilIfBlank != nil
            return
        }

        waitingForCourt = false
        waitingForNextMatch = false

        if shouldWaitForMatchToBeLive(activeMatch) {
            waitingForMatchLive = true
            return
        }

        waitingForMatchLive = false
        goLiveArmed = false
        recordOnlyArmed = false

        Task {
            await startLive()
        }
    }

    private func enrichOverlaySnapshot(
        _ snapshot: LiveOverlaySnapshot?,
        config: OverlayConfig? = nil,
        match: MatchData? = nil
    ) -> LiveOverlaySnapshot? {
        var next = snapshot ?? match.map(LiveOverlaySnapshot.init)
        guard next != nil else { return nil }

        let resolvedConfig = config ?? overlayConfig
        let resolvedMatch = match ?? activeMatch

        if next?.tournamentName?.trimmedNilIfBlank == nil {
            next?.tournamentName = resolvedMatch?.tournamentDisplayName
        }
        if next?.courtName?.trimmedNilIfBlank == nil {
            next?.courtName = resolvedMatch?.courtDisplayName
        }
        if next?.teamAName?.trimmedNilIfBlank == nil {
            next?.teamAName = resolvedMatch?.teamADisplayName
        }
        if next?.teamBName?.trimmedNilIfBlank == nil {
            next?.teamBName = resolvedMatch?.teamBDisplayName
        }
        if next?.tournamentLogoURL?.trimmedNilIfBlank == nil {
            next?.tournamentLogoURL = resolvedMatch?.tournament?.logoURL?.trimmedNilIfBlank
                ?? resolvedMatch?.tournamentLogoURL?.trimmedNilIfBlank
                ?? resolvedConfig?.tournamentImageURL?.trimmedNilIfBlank
        }
        if next?.webLogoURL?.trimmedNilIfBlank == nil {
            next?.webLogoURL = resolvedConfig?.webLogoURL?.trimmedNilIfBlank
        }
        if next?.sponsorLogoURLs?.isEmpty != false {
            next?.sponsorLogoURLs = resolvedConfig?.sponsors.compactMap { $0.logoURL?.trimmedNilIfBlank }
        }
        if next?.phaseText?.trimmedNilIfBlank == nil {
            next?.phaseText = resolvedMatch?.phaseText?.trimmedNilIfBlank
        }
        if next?.roundLabel?.trimmedNilIfBlank == nil {
            next?.roundLabel = resolvedMatch?.roundLabel?.trimmedNilIfBlank
        }
        if next?.stageName?.trimmedNilIfBlank == nil {
            next?.stageName = resolvedMatch?.stageName?.trimmedNilIfBlank
        }
        if next?.serveSide?.trimmedNilIfBlank == nil {
            next?.serveSide = resolvedMatch?.serveSide?.trimmedNilIfBlank
        }
        if next?.serveCount == nil {
            next?.serveCount = resolvedMatch?.serveCount
        }
        if next?.sets?.isEmpty != false {
            next?.sets = resolvedMatch?.gameScores
        }

        return next
    }

    private func refreshStorageMetrics() {
        let homePath = NSHomeDirectory()
        guard let attributes = try? FileManager.default.attributesOfFileSystem(forPath: homePath) else { return }
        totalStorageBytes = (attributes[.systemSize] as? NSNumber)?.int64Value ?? totalStorageBytes
        availableStorageBytes = (attributes[.systemFreeSize] as? NSNumber)?.int64Value ?? availableStorageBytes
    }

    private func rebuildPreviewPipeline() async {
        do {
            streamingService.stopPublishing()
            await streamingService.stopRecording()
            streamingService.stopPreview()
            try await streamingService.preparePreview(quality: selectedQuality)
            bannerMessage = "Đã dựng lại preview pipeline."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func retryPrimarySession() async {
        errorMessage = nil
        if matchesLiveSessionState || streamingService.isRecordingLocally {
            await stopLive()
        } else {
            streamingService.stopPublishing()
            await streamingService.stopRecording()
        }
        await rebuildPreviewPipeline()
        if activeMatch != nil || currentCourtId?.trimmedNilIfBlank != nil {
            goLiveArmed = liveMode.includesLivestream
            recordOnlyArmed = liveMode == .recordOnly
            maybeAutoStartArmedSession()
        }
    }

    private func bind() {
        environment.sessionStore.$session
            .receive(on: DispatchQueue.main)
            .sink { [weak self] session in
                self?.session = session
            }
            .store(in: &cancellables)

        environment.networkMonitor.$isConnected
            .receive(on: DispatchQueue.main)
            .sink { [weak self] connected in
                self?.networkConnected = connected
            }
            .store(in: &cancellables)

        environment.networkMonitor.$isWiFi
            .receive(on: DispatchQueue.main)
            .sink { [weak self] isWiFi in
                self?.networkIsWiFi = isWiFi
            }
            .store(in: &cancellables)

        refreshStorageMetrics()

        NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                guard let self else { return }
                self.appIsActive = true
                self.refreshStorageMetrics()
                Task { @MainActor in
                    if let courtId = self.currentCourtId?.trimmedNilIfBlank {
                        await self.refreshCourtRuntime(courtId: courtId)
                    }
                    if self.activeMatch != nil {
                        await self.refreshOverlay()
                    }
                    self.environment.courtRuntimeSocket.connectIfNeeded()
                    self.environment.courtPresenceSocket.connectIfNeeded()
                    if let matchId = self.activeMatch?.id.trimmedNilIfBlank {
                        self.environment.matchSocket.watch(matchId: matchId)
                    }
                }
            }
            .store(in: &cancellables)

        NotificationCenter.default.publisher(for: UIApplication.willResignActiveNotification)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.appIsActive = false
            }
            .store(in: &cancellables)

        streamingService.$connectionState
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                self?.streamState = state
                if case .live = state {
                    if self?.liveStartedAt == nil {
                        self?.liveStartedAt = Date()
                    }
                    self?.endingLive = false
                }
            }
            .store(in: &cancellables)

        streamingService.$overlaySnapshot
            .receive(on: DispatchQueue.main)
            .sink { [weak self] snapshot in
                guard let snapshot else { return }
                self?.overlaySnapshot = snapshot
            }
            .store(in: &cancellables)

        Publishers.CombineLatest4($route, $activeMatch, $overlaySnapshot, $streamState)
            .receive(on: DispatchQueue.main)
            .sink { route, activeMatch, overlaySnapshot, streamState in
                if #available(iOS 16.1, *) {
                    Task {
                        await LiveMatchActivityCoordinator.shared.sync(
                            route: route,
                            match: activeMatch,
                            snapshot: overlaySnapshot,
                            streamState: streamState
                        )
                    }
                }
            }
            .store(in: &cancellables)

        streamingService.$localRecordingState
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                self?.applyRecordingState(state)
            }
            .store(in: &cancellables)

        streamingService.onRecordingSegmentReady = { [weak self] segment in
            Task { @MainActor in
                await self?.enqueueRecordingUpload(segment)
            }
        }

        streamingService.onRecordingFailure = { [weak self] message in
            Task { @MainActor in
                self?.recordingStateText = "Ghi hình lỗi"
                self?.errorMessage = message
            }
        }
    }

    private func configureSockets() {
        environment.matchSocket.onOverlaySnapshot = { [weak self] snapshot in
            Task { @MainActor in
                guard let self else { return }
                let enrichedSnapshot = self.enrichOverlaySnapshot(snapshot, match: self.activeMatch) ?? snapshot
                self.overlaySnapshot = enrichedSnapshot
                self.streamingService.overlaySnapshot = enrichedSnapshot
            }
        }

        environment.matchSocket.onConnectionChange = { [weak self] connected in
            Task { @MainActor in
                self?.socketConnected = connected
            }
        }

        environment.matchSocket.onStatusChange = { [weak self] status in
            Task { @MainActor in
                guard let self else { return }
                guard let normalizedStatus = status?.trimmedNilIfBlank else { return }
                guard var activeMatch = self.activeMatch else { return }
                activeMatch.status = normalizedStatus
                self.activeMatch = activeMatch
                self.maybeAutoStartArmedSession()
            }
        }

        environment.matchSocket.onActiveMatchChange = { [weak self] matchId in
            Task { @MainActor in
                self?.activeSocketMatchId = matchId
            }
        }

        environment.matchSocket.onPayloadTimestamp = { [weak self] date in
            Task { @MainActor in
                self?.lastSocketPayloadAt = date
            }
        }

        environment.matchSocket.onLog = { [weak self] line in
            Task { @MainActor in
                self?.bannerMessage = line
            }
        }

        environment.courtRuntimeSocket.onConnectionChange = { [weak self] connected in
            Task { @MainActor in
                self?.runtimeSocketConnected = connected
            }
        }

        environment.courtRuntimeSocket.onStationUpdate = { [weak self] payload in
            Task { @MainActor in
                guard let self else { return }
                if let station = payload.station {
                    if station.id == self.selectedCourt?.id {
                        self.selectedCourt = station
                    }
                    self.courts = self.courts.map { court in
                        court.id == station.id ? station : court
                    }
                }

                if let currentMatch = payload.currentMatch, currentMatch.id == self.activeMatch?.id {
                    self.activeMatch = currentMatch
                    self.maybeAutoStartArmedSession()
                }

                if
                    let station = payload.station,
                    let currentCourtId = self.currentCourtId,
                    station.id == currentCourtId
                {
                    self.handleRuntimeMatchCandidate(
                        currentMatchId: payload.currentMatch?.id ?? station.currentMatchId,
                        announcement: "Runtime sân vừa đổi sang match mới."
                    )
                }
            }
        }

        environment.courtRuntimeSocket.onLog = { [weak self] line in
            Task { @MainActor in
                self?.bannerMessage = line
            }
        }

        environment.courtPresenceSocket.onConnectionChange = { [weak self] connected in
            Task { @MainActor in
                self?.presenceSocketConnected = connected
            }
        }

        environment.courtPresenceSocket.onSnapshot = { [weak self] snapshot in
            Task { @MainActor in
                guard let self else { return }

                self.courts = self.courts.map { court in
                    guard let presence = snapshot.courts.first(where: { $0.courtId == court.id })?.liveScreenPresence else {
                        return court
                    }

                    var nextCourt = court
                    nextCourt.liveScreenPresence = presence
                    return nextCourt
                }

                if
                    let selectedCourtId = self.selectedCourt?.id,
                    let presence = snapshot.courts.first(where: { $0.courtId == selectedCourtId })?.liveScreenPresence
                {
                    self.courtPresence = presence
                    if var selectedCourt = self.selectedCourt {
                        selectedCourt.liveScreenPresence = presence
                        self.selectedCourt = selectedCourt
                    }
                }
            }
        }
    }

    private func applyRecordingState(_ state: LocalRecordingState) {
        switch state {
        case .idle:
            if recordingPendingUploads > 0 {
                recordingStateText = "Đang tải \(recordingPendingUploads) segment"
            } else if recordingFinalizeRequested {
                recordingStateText = "Đang chốt recording"
            } else if activeRecording != nil {
                recordingStateText = "Đã dừng ghi hình"
            } else {
                recordingStateText = liveMode.includesRecording ? "Chưa ghi hình" : "Không ghi hình"
            }
        case let .recording(_, segmentIndex):
            recordingStateText = "Đang ghi segment \(segmentIndex + 1)"
        case .finalizing:
            recordingStateText = recordingPendingUploads > 0 ? "Đang tải segment cuối" : "Đang chốt recording"
        case let .failed(message):
            recordingStateText = "Ghi hình lỗi"
            errorMessage = message
        }
    }

    private func continueWithOsAuthToken(_ token: String?) async {
        errorMessage = nil
        isWorking = true
        defer { isWorking = false }

        do {
            let nextSession = try await environment.authCoordinator.signIn(osAuthToken: token)
            environment.sessionStore.replace(nextSession)
            bannerMessage = "Đã nhận phiên từ PickleTour."
            await refreshBootstrap()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadCourts(clusterId: String) async {
        isWorking = true
        defer { isWorking = false }

        do {
            let loaded = try await environment.apiClient.listCourts(clusterId: clusterId)
            courts = loaded
            if let currentSelected = selectedCourt, let refreshed = loaded.first(where: { $0.id == currentSelected.id }) {
                selectedCourt = refreshed
            } else {
                selectedCourt = loaded.first
            }
            watchCluster(clusterId)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func refreshCourtRuntime(courtId: String) async {
        do {
            let runtime = try await environment.apiClient.getCourtRuntime(courtId: courtId)
            courtRuntime = runtime
            courtPresence = runtime.presence
            handleRuntimeMatchCandidate(currentMatchId: runtime.currentMatchId ?? runtime.nextMatchId, announcement: nil)
            if runtime.currentMatchId?.trimmedNilIfBlank == nil, runtime.nextMatchId?.trimmedNilIfBlank == nil, route == .liveStream {
                waitingForCourt = activeMatch == nil
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func startRuntimePolling(for courtId: String) async {
        runtimePollTask?.cancel()
        runtimePollTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                await self.refreshCourtRuntime(courtId: courtId)
                let intervalMs = UInt64(max(self.courtRuntime?.recommendedPollIntervalMs ?? 5_000, 2_000))
                try? await Task.sleep(nanoseconds: intervalMs * 1_000_000)
            }
        }
    }

    private func resolveLaunchTarget(_ target: LiveLaunchTarget) async throws -> LiveLaunchTarget {
        var resolved = target

        if let courtId = target.courtId?.trimmedNilIfBlank {
            let runtime = try await environment.apiClient.getCourtRuntime(courtId: courtId)
            courtRuntime = runtime
            courtPresence = runtime.presence
            resolved.matchId = target.matchId?.trimmedNilIfBlank
                ?? runtime.currentMatchId?.trimmedNilIfBlank
                ?? runtime.nextMatchId?.trimmedNilIfBlank
                ?? (try await environment.apiClient.getNextMatchByCourt(courtId: courtId))
        }

        guard resolved.matchId?.trimmedNilIfBlank != nil || resolved.courtId?.trimmedNilIfBlank != nil else {
            throw LiveAPIError.server(statusCode: 0, message: "Chưa xác định được matchId để mở live.")
        }

        return resolved
    }

    private func prepareLiveScreen(using target: LiveLaunchTarget) async throws {
        stopBackgroundLoops()
        cancelRecordingUploads()
        environment.matchSocket.unwatch()
        unwatchCurrentCourt()
        queuedCourtMatchId = nil

        streamingService.stopPublishing()
        await streamingService.stopRecording()

        let matchId = target.matchId?.trimmedNilIfBlank
        if let matchId {
            let match = try await environment.apiClient.getMatchRuntime(matchId: matchId)
            activeMatch = match
            overlaySnapshot = enrichOverlaySnapshot(LiveOverlaySnapshot(match: match), match: match)
            streamingService.overlaySnapshot = overlaySnapshot

            if let tournamentId = match.tournament?.id.trimmedNilIfBlank {
                overlayConfig = try? await environment.apiClient.getOverlayConfig(tournamentId: tournamentId)
                watchTournament(tournamentId)
                overlaySnapshot = enrichOverlaySnapshot(overlaySnapshot, match: match)
                streamingService.overlaySnapshot = overlaySnapshot
            }
        } else {
            activeMatch = nil
            overlaySnapshot = nil
            streamingService.overlaySnapshot = nil
            overlayConfig = nil
            waitingForCourt = target.courtId?.trimmedNilIfBlank != nil
        }
        if matchId != nil {
            waitingForCourt = false
        }
        liveSession = nil
        liveStartedAt = nil
        activeRecording = nil
        recordingFinalizeRequested = false
        recordingPendingUploads = 0
        goLiveCountdownSeconds = nil
        stopLiveCountdownSeconds = nil
        endingLive = false
        waitingForMatchLive = false
        waitingForNextMatch = false
        preflightIssues = []
        goLiveArmed = false
        recordOnlyArmed = false
        recordingStateText = "Chưa ghi hình"

        if let courtId = target.courtId?.trimmedNilIfBlank {
            let runtime = try await environment.apiClient.getCourtRuntime(courtId: courtId)
            courtRuntime = runtime
            courtPresence = runtime.presence
            let response = try? await environment.apiClient.startCourtPresence(
                courtId: courtId,
                clientSessionId: streamingService.clientSessionId,
                screenState: currentPresenceScreenState(),
                matchId: matchId
            )
            applyPresenceResponse(response, matchId: matchId)
            watchCourt(courtId)
            await startRuntimePolling(for: courtId)
        }

        if let matchId {
            environment.matchSocket.watch(matchId: matchId)
        }
        environment.courtRuntimeSocket.connectIfNeeded()
        try await streamingService.preparePreview(quality: selectedQuality)
        if matchId != nil {
            await refreshOverlay()
        }
        maybeAutoStartArmedSession()
    }

    private func startHeartbeats() {
        heartbeatTask?.cancel()
        heartbeatTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                if
                    let matchId = self.activeMatch?.id.trimmedNilIfBlank,
                    self.streamState == .live
                {
                    _ = try? await self.environment.apiClient.notifyStreamHeartbeat(
                        matchId: matchId,
                        clientSessionId: self.streamingService.clientSessionId
                    )
                }

                if let courtId = self.currentCourtId {
                    let presence = try? await self.environment.apiClient.heartbeatCourtPresence(
                        courtId: courtId,
                        clientSessionId: self.streamingService.clientSessionId,
                        screenState: self.currentPresenceScreenState(),
                        matchId: self.activeMatch?.id
                    )
                    self.applyPresenceResponse(presence, matchId: self.activeMatch?.id)
                }

                try? await Task.sleep(nanoseconds: 10_000_000_000)
            }
        }
    }

    private func applyPresenceResponse(_ response: CourtPresenceResponse?, matchId: String?) {
        courtPresence = CourtLiveScreenPresence(
            occupied: response?.occupied,
            status: nil,
            screenState: response?.screenState,
            matchId: matchId,
            startedAt: nil,
            lastHeartbeatAt: Date().iso8601UTCString,
            expiresAt: response?.expiresAt,
            previewModeSince: nil,
            previewReleaseAt: response?.previewReleaseAt,
            warningAt: nil,
            previewWarningMs: nil
        )
    }

    private func handleRuntimeMatchCandidate(currentMatchId: String?, announcement: String?) {
        guard let nextMatchId = currentMatchId?.trimmedNilIfBlank else { return }

        if route == .courtSetup {
            if launchTarget.matchId?.trimmedNilIfBlank == nil || launchTarget.matchId == activeMatch?.id {
                launchTarget.matchId = nextMatchId
            }
            return
        }

        guard route == .liveStream else { return }
        guard nextMatchId != activeMatch?.id else { return }

        if matchesLiveSessionState || streamingService.isRecordingLocally {
            queuedCourtMatchId = nextMatchId
            waitingForNextMatch = true
            if announcement != nil {
                bannerMessage = "Sân đã chuyển sang match mới. App sẽ nạp lại sau khi dừng phiên hiện tại."
            }
            return
        }

        Task {
            await switchMatchContext(to: nextMatchId, announcement: announcement)
        }
    }

    private func switchMatchContext(to matchId: String, announcement: String?) async {
        guard !isSwitchingMatch else { return }
        guard matchId.trimmedNilIfBlank != nil else { return }
        guard matchId != activeMatch?.id else { return }

        isSwitchingMatch = true
        defer { isSwitchingMatch = false }

        do {
            let match = try await environment.apiClient.getMatchRuntime(matchId: matchId)
            activeMatch = match
            launchTarget.matchId = match.id
            queuedCourtMatchId = nil
            waitingForCourt = false
            waitingForMatchLive = false
            waitingForNextMatch = false
            overlaySnapshot = enrichOverlaySnapshot(LiveOverlaySnapshot(match: match), match: match)
            streamingService.overlaySnapshot = overlaySnapshot
            environment.matchSocket.watch(matchId: match.id)

            if let tournamentId = match.tournament?.id.trimmedNilIfBlank {
                watchTournament(tournamentId)
                overlayConfig = try? await environment.apiClient.getOverlayConfig(tournamentId: tournamentId)
                overlaySnapshot = enrichOverlaySnapshot(overlaySnapshot, match: match)
                streamingService.overlaySnapshot = overlaySnapshot
            }

            if let courtId = currentCourtId {
                let presence = try? await environment.apiClient.heartbeatCourtPresence(
                    courtId: courtId,
                    clientSessionId: streamingService.clientSessionId,
                    screenState: currentPresenceScreenState(),
                    matchId: match.id
                )
                applyPresenceResponse(presence, matchId: match.id)
            }

            await refreshOverlay()

            if let announcement {
                bannerMessage = announcement
            }
            maybeAutoStartArmedSession()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func enqueueRecordingUpload(_ segment: LocalRecordingSegment) async {
        let recordingId = activeRecording?.id?.trimmedNilIfBlank ?? segment.recordingId
        recordingPendingUploads += 1
        if segment.isFinal {
            recordingFinalizeRequested = true
        }
        recordingStateText = "Đang tải \(recordingPendingUploads) segment"

        let taskId = UUID()
        let coordinator = environment.recordingCoordinator

        let task = Task.detached(priority: .utility) { [weak self] in
            do {
                let response = try await coordinator.uploadSegment(recordingId: recordingId, fileURL: segment.fileURL)
                await MainActor.run {
                    if let recording = response.recording {
                        self?.activeRecording = recording
                    }
                }
            } catch {
                await MainActor.run {
                    self?.errorMessage = error.localizedDescription
                    self?.recordingStateText = "Upload recording lỗi"
                }
            }

            await MainActor.run {
                guard let self else { return }
                self.recordingUploadTasks.removeValue(forKey: taskId)
                self.recordingPendingUploads = max(0, self.recordingPendingUploads - 1)

                if self.recordingPendingUploads > 0 {
                    self.recordingStateText = "Đang tải \(self.recordingPendingUploads) segment"
                } else if self.recordingFinalizeRequested {
                    self.recordingStateText = "Đang chốt recording"
                }
            }

            await MainActor.run {
                Task { [weak self] in
                    await self?.maybeFinalizeRecordingIfReady()
                }
            }
        }

        recordingUploadTasks[taskId] = task
    }

    private func maybeFinalizeRecordingIfReady() async {
        guard recordingFinalizeRequested else { return }
        guard recordingPendingUploads == 0 else { return }
        guard let recordingId = activeRecording?.id?.trimmedNilIfBlank else { return }

        recordingFinalizeRequested = false

        do {
            let response = try await environment.apiClient.finalizeRecording(recordingId: recordingId)
            if let recording = response.recording {
                activeRecording = recording
            }
            recordingStateText = response.recording?.status ?? "Đã chốt recording"
        } catch {
            recordingFinalizeRequested = true
            recordingStateText = "Chốt recording lỗi"
            errorMessage = error.localizedDescription
        }
    }

    private func parseLaunchTarget(from url: URL) -> LiveLaunchTarget {
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let items = components?.queryItems ?? []
        return LiveLaunchTarget(
            courtId: items.first(where: { $0.name == "courtId" })?.value?.trimmedNilIfBlank,
            matchId: items.first(where: { $0.name == "matchId" })?.value?.trimmedNilIfBlank,
            pageId: items.first(where: { $0.name == "pageId" })?.value?.trimmedNilIfBlank
        )
    }

    private func applyLaunchTarget(_ target: LiveLaunchTarget) async {
        launchTarget = target

        if let courtId = target.courtId?.trimmedNilIfBlank, let located = await findCourt(by: courtId) {
            selectedCluster = located.cluster
            courts = located.courts
            selectedCourt = located.court
        }

        route = .courtSetup
        await continueFromSetup()
    }

    private func findCourt(by courtId: String) async -> (cluster: CourtClusterData, courts: [AdminCourtData], court: AdminCourtData)? {
        for cluster in clusters {
            guard let loaded = try? await environment.apiClient.listCourts(clusterId: cluster.id) else {
                continue
            }
            if let court = loaded.first(where: { $0.id == courtId }) {
                return (cluster, loaded, court)
            }
        }
        return nil
    }

    private func buildPickleTourHandoffURL() -> URL? {
        var continueComponents = URLComponents(url: LiveAppConfig.authorizationEndpoint, resolvingAgainstBaseURL: false)
        continueComponents?.queryItems = [
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "client_id", value: LiveAppConfig.oauthClientId),
            URLQueryItem(name: "redirect_uri", value: LiveAppConfig.oauthRedirectURI.absoluteString),
            URLQueryItem(name: "scope", value: LiveAppConfig.oauthScope)
        ]

        guard let continueURL = continueComponents?.url else {
            return nil
        }

        var handoff = URLComponents()
        handoff.scheme = "pickletourapp"
        handoff.host = "live-auth"
        var queryItems = [
            URLQueryItem(name: "continueUrl", value: continueURL.absoluteString),
            URLQueryItem(name: "callbackUri", value: "pickletour-live://auth-init")
        ]
        let preferredTarget =
            pendingLaunchTarget ??
            ((launchTarget.courtId?.trimmedNilIfBlank != nil || launchTarget.matchId?.trimmedNilIfBlank != nil)
                ? launchTarget
                : nil)
        if let preferredTarget, let targetURL = buildNativeStreamURL(for: preferredTarget) {
            queryItems.append(URLQueryItem(name: "targetUrl", value: targetURL.absoluteString))
        }
        handoff.queryItems = queryItems
        return handoff.url
    }

    private func buildNativeStreamURL(for target: LiveLaunchTarget) -> URL? {
        var components = URLComponents()
        components.scheme = "pickletour-live"
        components.host = "stream"

        let queryItems = [
            URLQueryItem(name: "courtId", value: target.courtId?.trimmedNilIfBlank),
            URLQueryItem(name: "matchId", value: target.matchId?.trimmedNilIfBlank),
            URLQueryItem(name: "pageId", value: target.pageId?.trimmedNilIfBlank)
        ]
        .compactMap { item in
            guard let value = item.value else { return nil }
            return URLQueryItem(name: item.name, value: value)
        }

        components.queryItems = queryItems.isEmpty ? nil : queryItems
        return components.url
    }

    private func watchCluster(_ clusterId: String) {
        let clusterId = clusterId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clusterId.isEmpty else { return }
        if watchedClusterId == clusterId { return }
        if let watchedClusterId {
            environment.courtRuntimeSocket.unwatchCluster(watchedClusterId)
        }
        watchedClusterId = clusterId
        environment.courtRuntimeSocket.watchCluster(clusterId)
    }

    private func watchCourt(_ courtId: String) {
        let courtId = courtId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !courtId.isEmpty else { return }
        if watchedCourtId == courtId { return }
        if let watchedCourtId {
            environment.courtRuntimeSocket.unwatchStation(watchedCourtId)
        }
        watchedCourtId = courtId
        environment.courtRuntimeSocket.watchStation(courtId)
    }

    private func unwatchCurrentCourt() {
        if let watchedCourtId {
            environment.courtRuntimeSocket.unwatchStation(watchedCourtId)
        }
        watchedCourtId = nil
    }

    private func watchTournament(_ tournamentId: String) {
        let tournamentId = tournamentId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !tournamentId.isEmpty else { return }
        if watchedTournamentId == tournamentId { return }
        if watchedTournamentId != nil {
            environment.courtPresenceSocket.unwatchTournament()
        }
        watchedTournamentId = tournamentId
        environment.courtPresenceSocket.watchTournament(tournamentId)
    }

    private func stopBackgroundLoops() {
        heartbeatTask?.cancel()
        heartbeatTask = nil
        runtimePollTask?.cancel()
        runtimePollTask = nil
        goLiveCountdownTask?.cancel()
        goLiveCountdownTask = nil
        stopLiveCountdownTask?.cancel()
        stopLiveCountdownTask = nil
    }

    private func cancelRecordingUploads() {
        recordingUploadTasks.values.forEach { $0.cancel() }
        recordingUploadTasks.removeAll()
    }
}

@available(iOS 16.1, *)
actor LiveMatchActivityCoordinator {
    static let shared = LiveMatchActivityCoordinator()

    private var currentActivity: Activity<PickleTourMatchActivityAttributes>?
    private var lastState: PickleTourMatchActivityAttributes.ContentState?

    func sync(
        route: AppRoute,
        match: MatchData?,
        snapshot: LiveOverlaySnapshot?,
        streamState: StreamConnectionState
    ) async {
        guard route == .liveStream, let match else {
            await endCurrent()
            return
        }

        let matchId = match.id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !matchId.isEmpty else {
            await endCurrent()
            return
        }

        let nextState = makeState(match: match, snapshot: snapshot, streamState: streamState)

        if let currentActivity, currentActivity.attributes.matchId == matchId {
            guard nextState != lastState else { return }
            await currentActivity.update(using: nextState)
            lastState = nextState
            return
        }

        await endCurrent()

        let attributes = PickleTourMatchActivityAttributes(matchId: matchId)
        do {
            let activity = try Activity.request(
                attributes: attributes,
                contentState: nextState,
                pushType: nil
            )
            currentActivity = activity
            lastState = nextState
        } catch {
            currentActivity = nil
            lastState = nil
        }
    }

    private func endCurrent() async {
        if let currentActivity {
            await currentActivity.end(
                using: lastState ?? fallbackState(),
                dismissalPolicy: .immediate
            )
        }
        currentActivity = nil
        lastState = nil
    }

    private func makeState(
        match: MatchData,
        snapshot: LiveOverlaySnapshot?,
        streamState: StreamConnectionState
    ) -> PickleTourMatchActivityAttributes.ContentState {
        let tournamentName =
            snapshot?.tournamentName?.trimmedNilIfBlank ??
            match.tournamentDisplayName
        let courtName =
            snapshot?.courtName?.trimmedNilIfBlank ??
            match.courtDisplayName
        let matchCode =
            match.displayCode?.trimmedNilIfBlank ??
            match.code?.trimmedNilIfBlank ??
            match.id
        let teamAName =
            snapshot?.teamAName?.trimmedNilIfBlank ??
            match.teamADisplayName
        let teamBName =
            snapshot?.teamBName?.trimmedNilIfBlank ??
            match.teamBDisplayName
        let scoreA = snapshot?.scoreA ?? match.scoreA ?? 0
        let scoreB = snapshot?.scoreB ?? match.scoreB ?? 0

        let roundBits = [
            snapshot?.stageName?.trimmedNilIfBlank,
            snapshot?.roundLabel?.trimmedNilIfBlank,
            snapshot?.phaseText?.trimmedNilIfBlank
        ].compactMap { $0 }
        let serveText: String? = {
            guard let serveSide = snapshot?.serveSide?.trimmedNilIfBlank else {
                return nil
            }
            let serveCount = snapshot?.serveCount ?? match.serveCount ?? 1
            return "Giao \(serveSide) · \(serveCount)"
        }()
        let detailText = [roundBits.joined(separator: " · ").trimmedNilIfBlank, serveText]
            .compactMap { $0 }
            .joined(separator: " • ")

        return PickleTourMatchActivityAttributes.ContentState(
            tournamentName: tournamentName,
            courtName: courtName,
            matchCode: matchCode,
            teamAName: teamAName,
            teamBName: teamBName,
            scoreA: scoreA,
            scoreB: scoreB,
            statusText: statusText(streamState: streamState, matchStatus: match.status),
            detailText: detailText.trimmedNilIfBlank ?? "Đang cập nhật tỉ số",
            updatedAt: Date()
        )
    }

    private func statusText(
        streamState: StreamConnectionState,
        matchStatus: String?
    ) -> String {
        switch streamState {
        case .live:
            return "Đang live"
        case .connecting:
            return "Đang kết nối"
        case .preparingPreview:
            return "Đang chuẩn bị"
        case .previewReady:
            return "Preview sẵn sàng"
        case let .reconnecting(reason):
            return reason.trimmedNilIfBlank ?? "Đang nối lại"
        case let .failed(message):
            return message.trimmedNilIfBlank ?? "Live lỗi"
        case .stopped:
            return "Đã dừng"
        case .idle:
            break
        }

        switch matchStatus?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "live":
            return "Trận đang diễn ra"
        case "finished":
            return "Trận đã kết thúc"
        case "assigned":
            return "Đã gán sân"
        case "scheduled":
            return "Chờ bắt đầu"
        default:
            return "Đang theo dõi"
        }
    }

    private func fallbackState() -> PickleTourMatchActivityAttributes.ContentState {
        PickleTourMatchActivityAttributes.ContentState(
            tournamentName: "PickleTour",
            courtName: "Court",
            matchCode: "—",
            teamAName: "Đội A",
            teamBName: "Đội B",
            scoreA: 0,
            scoreB: 0,
            statusText: "Đã dừng",
            detailText: "Phiên live đã kết thúc",
            updatedAt: Date()
        )
    }
}
