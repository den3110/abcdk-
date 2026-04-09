import AVFoundation
import Combine
import Foundation
import UIKit

#if canImport(ActivityKit)
import ActivityKit
#endif

@MainActor
final class LiveAppStore: ObservableObject {
    @Published var route: AppRoute = .login
    @Published var isWorking = false
    @Published var errorMessage: String?
    @Published var bannerMessage: String?
    @Published private(set) var startupResolved = false

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
    @Published private(set) var recordingPendingQueueBytes: Int64 = 0
    @Published private(set) var recordingPendingFinalizations = 0
    @Published private(set) var recoveryState = StreamRecoveryState()
    @Published private(set) var overlayHealth = OverlayHealth()
    @Published private(set) var lastRecovery: RecoveryEvent?
    @Published private(set) var operatorRecoveryDialog: OperatorRecoveryDialogState?

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
    @Published private(set) var batteryLevel = UIDevice.current.batteryLevel
    @Published private(set) var batteryState: UIDevice.BatteryState = UIDevice.current.batteryState
    @Published private(set) var systemLowPowerModeEnabled = ProcessInfo.processInfo.isLowPowerModeEnabled
    @Published private(set) var thermalState = ProcessInfo.processInfo.thermalState
    @Published private(set) var lastThermalEvent: ThermalEvent?
    @Published private(set) var thermalEvents: [ThermalEvent] = []
    @Published private(set) var lastMemoryPressure: MemoryPressureEvent?
    @Published private(set) var memoryPressureEvents: [MemoryPressureEvent] = []
    @Published private(set) var appIsActive = true
    @Published private(set) var availableStorageBytes: Int64 = 0
    @Published private(set) var totalStorageBytes: Int64 = 0
    @Published private(set) var activeSocketMatchId: String?
    @Published private(set) var lastSocketPayloadAt: Date?
    @Published private(set) var streamState: StreamConnectionState = .idle
    @Published private(set) var leaseId: String?
    @Published private(set) var leaseHeartbeatIntervalMs = 10_000
    @Published private(set) var freshEntryRequired = false
    @Published private(set) var safetyDegradeReason: String?
    @Published private(set) var authDebugHandoffURL: String?
    @Published private(set) var authDebugContinueURL: String?
    @Published private(set) var authDebugTargetURL: String?
    @Published private(set) var authDebugIncomingURL: String?

    let streamingService = LiveStreamingService()

    private let environment = LiveAppEnvironment.shared
    private var cancellables = Set<AnyCancellable>()
    private var heartbeatTask: Task<Void, Never>?
    private var runtimePollTask: Task<Void, Never>?
    private var goLiveCountdownTask: Task<Void, Never>?
    private var stopLiveCountdownTask: Task<Void, Never>?
    private var backgroundExitTask: Task<Void, Never>?
    private var pendingLaunchTarget: LiveLaunchTarget?
    private var activeRecording: MatchRecording?
    private var recordingFinalizeRequested = false
    private var watchedClusterId: String?
    private var watchedCourtId: String?
    private var watchedTournamentId: String?
    private var queuedCourtMatchId: String?
    private var isSwitchingMatch = false
    private var isRefreshingOverlay = false
    private var isResumingRecordingQueue = false
    private var lastOverlayRefreshAttemptAt: Date?
    private var lastSocketSelfHealAt: Date?
    private var lastRecordingQueueResumeAt: Date?
    private var lastHandledIncomingURL: String?
    private var lastHandledIncomingURLAt: Date?
    private var lastHandledTerminalMatchId: String?
    private var streamLeaseId: String?
    private var streamHeartbeatIntervalMs = 15_000
    private var lastStreamLeaseRecoveryAt: Date?
    private var isRecoveringStreamLease = false

    init() {
        session = environment.sessionStore.session
        startupResolved = session?.accessToken.trimmedNilIfBlank == nil
        streamingService.updateOrientationMode(orientationMode)
        bind()
        configureSockets()
        syncStreamingSafetyProfile()
        Task {
            await restoreRecordingQueue()
        }

        Task { [weak self] in
            guard let self else { return }
            await self.environment.recordingCoordinator.setCallbacks(
                onQueueSnapshotChange: { [weak self] snapshot in
                    guard let self, self.session?.accessToken.trimmedNilIfBlank != nil else { return }
                    self.applyRecordingQueueSnapshot(snapshot)
                },
                onRecordingUpdate: { [weak self] recording in
                    guard let self, self.session?.accessToken.trimmedNilIfBlank != nil else { return }
                    self.activeRecording = recording
                },
                onError: { [weak self] message in
                    guard let self, self.session?.accessToken.trimmedNilIfBlank != nil else { return }
                    self.errorMessage = message
                }
            )
        }
    }

    deinit {
        heartbeatTask?.cancel()
        heartbeatTask = nil
        runtimePollTask?.cancel()
        runtimePollTask = nil
        goLiveCountdownTask?.cancel()
        goLiveCountdownTask = nil
        stopLiveCountdownTask?.cancel()
        stopLiveCountdownTask = nil
        backgroundExitTask?.cancel()
        backgroundExitTask = nil
        environment.runtimeRegistry.clear()

        environment.matchSocket.onOverlaySnapshot = nil
        environment.matchSocket.onConnectionChange = nil
        environment.matchSocket.onStatusChange = nil
        environment.matchSocket.onActiveMatchChange = nil
        environment.matchSocket.onLog = nil
        environment.matchSocket.onPayloadTimestamp = nil
        environment.matchSocket.disconnect()

        environment.courtRuntimeSocket.onClusterUpdate = nil
        environment.courtRuntimeSocket.onStationUpdate = nil
        environment.courtRuntimeSocket.onConnectionChange = nil
        environment.courtRuntimeSocket.onLog = nil
        environment.courtRuntimeSocket.disconnect()

        environment.courtPresenceSocket.onSnapshot = nil
        environment.courtPresenceSocket.onConnectionChange = nil
        environment.courtPresenceSocket.onLog = nil
        environment.courtPresenceSocket.disconnect()
    }

    func bootstrapIfPossible() async {
        defer {
            startupResolved = true
        }

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
            authDebugContinueURL = environment.authCoordinator.prepareAuthorizationRequestURL().absoluteString
            let nextSession = try await environment.authCoordinator.signIn()
            environment.sessionStore.replace(nextSession)
            bannerMessage = "Đăng nhập thành công."
            if let target = currentLaunchTarget, target.isUserMatchLaunch {
                await applyLaunchTarget(target)
            } else {
                await refreshBootstrap()
            }
        } catch {
            if shouldIgnoreProgrammaticAuthCancellation(error) {
                return
            }
            errorMessage = error.localizedDescription
        }
    }

    func signInWithPassword(loginId: String, password: String) async {
        let normalizedId = loginId.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedPassword = password.trimmingCharacters(in: .whitespacesAndNewlines)

        guard normalizedId.isEmpty == false, normalizedPassword.isEmpty == false else {
            errorMessage = "Thiếu thông tin."
            return
        }

        errorMessage = nil
        isWorking = true
        var storedProvisionalSession = false
        defer { isWorking = false }

        do {
            let response = try await environment.apiClient.loginWithPassword(
                buildPasswordLoginRequest(loginId: normalizedId, password: normalizedPassword)
            )
            guard let accessToken = response.token?.trimmedNilIfBlank else {
                throw LiveAPIError.missingToken
            }

            let provisionalSession = AuthSession(
                accessToken: accessToken,
                refreshToken: nil,
                idToken: nil,
                userId: response.user?.id,
                displayName: response.user?.displayName
            )

            environment.sessionStore.replace(provisionalSession)
            storedProvisionalSession = true

            if let target = currentLaunchTarget, target.isUserMatchLaunch {
                await applyLaunchTarget(target)
                bannerMessage = "Đăng nhập thành công."
                return
            }

            let bootstrap = try await environment.apiClient.getBootstrap()
            try await applyBootstrap(bootstrap)

            let validatedSession = AuthSession(
                accessToken: accessToken,
                refreshToken: nil,
                idToken: nil,
                userId: bootstrap.user?.id ?? provisionalSession.userId,
                displayName: bootstrap.user?.displayName ?? provisionalSession.displayName
            )

            environment.sessionStore.replace(validatedSession)
            bannerMessage = "Đăng nhập thành công."
        } catch {
            if storedProvisionalSession {
                clearAuthenticatedStateAfterLoginFailure()
            }
            errorMessage = error.localizedDescription
        }
    }

    func requestPickleTourHandoff() {
        environment.authCoordinator.cancelInteractiveAuthorizationFlow()

        guard let handoffURL = buildPickleTourHandoffURL() else {
            errorMessage = "Không tạo được liên kết handoff với PickleTour."
            return
        }

        errorMessage = nil

        guard UIApplication.shared.canOpenURL(handoffURL) else {
            Task {
                await signInWithWeb()
            }
            return
        }

        UIApplication.shared.open(handoffURL) { [weak self] opened in
            guard let self else { return }
            Task { @MainActor in
                if !opened {
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
        environment.runtimeRegistry.clear()
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
        recordingPendingQueueBytes = 0
        recordingPendingFinalizations = 0
        recoveryState = StreamRecoveryState()
        overlayHealth = OverlayHealth()
        lastRecovery = nil
        operatorRecoveryDialog = nil
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
        streamingService.updateOrientationMode(orientationMode)
        leaseId = nil
        leaseHeartbeatIntervalMs = 10_000
        resetStreamLeaseState()
        freshEntryRequired = false
        safetyDegradeReason = nil
        socketConnected = false
        runtimeSocketConnected = false
        presenceSocketConnected = false
        activeSocketMatchId = nil
        lastSocketPayloadAt = nil
        streamState = .idle
        isRefreshingOverlay = false
        isResumingRecordingQueue = false
        lastOverlayRefreshAttemptAt = nil
        lastSocketSelfHealAt = nil
        lastRecordingQueueResumeAt = nil
        LiveAppOrientationController.apply(.auto)
        bannerMessage = nil
        errorMessage = nil
        route = .login
    }

    func selectCluster(_ cluster: CourtClusterData) async {
        selectedCluster = cluster
        errorMessage = nil
        await loadCourts(clusterId: cluster.id)
    }

    func clearClusterSelection() {
        errorMessage = nil
        selectedCluster = nil
        courts = []
        selectedCourt = nil
        courtRuntime = nil
        courtPresence = nil
        activeMatch = nil
        runtimePollTask?.cancel()
        runtimePollTask = nil
        unwatchCurrentCourt()
        if let watchedClusterId {
            environment.courtRuntimeSocket.unwatchCluster(watchedClusterId)
            self.watchedClusterId = nil
        }
        route = bootstrap == nil ? .login : .adminHome
    }

    func goBackToAdminHome() {
        errorMessage = nil
        route = bootstrap == nil ? .login : .adminHome
    }

    func openCourt(_ court: AdminCourtData) async {
        selectedCourt = court
        launchTarget = LiveLaunchTarget(
            courtId: court.id,
            matchId: court.currentMatchId?.trimmedNilIfBlank,
            pageId: launchTarget.pageId,
            launchMode: .tournamentCourt
        )
        route = .courtSetup
        await refreshCourtRuntime(courtId: court.id)
        await startRuntimePolling(for: court.id)
    }

    func updateLaunchTarget(
        courtId: String?,
        matchId: String?,
        pageId: String?,
        launchMode: LiveLaunchMode? = nil
    ) {
        launchTarget = LiveLaunchTarget(
            courtId: courtId?.trimmedNilIfBlank,
            matchId: matchId?.trimmedNilIfBlank,
            pageId: pageId?.trimmedNilIfBlank,
            launchMode: launchMode ?? launchTarget.launchMode
        )
    }

    func continueSavedSessionFromLogin() async {
        errorMessage = nil
        guard session?.accessToken.trimmedNilIfBlank != nil else {
            requestPickleTourHandoff()
            return
        }

        if let target = currentLaunchTarget, target.isUserMatchLaunch {
            await applyLaunchTarget(target)
        } else {
            await refreshBootstrap()
        }
    }

    func continueFromSetup() async {
        errorMessage = nil
        freshEntryRequired = false
        isWorking = true
        defer { isWorking = false }

        do {
            if launchTarget.isUserMatchLaunch {
                liveMode = .streamOnly
            }
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
            try await applyBootstrap(bootstrap)
        } catch {
            errorMessage = error.localizedDescription
            if case LiveAPIError.unauthorized = error {
                signOut()
            }
        }
    }

    func refreshOverlay(force: Bool = true) async {
        guard let matchId = activeMatch?.id.trimmedNilIfBlank else { return }
        if isRefreshingOverlay { return }
        if
            !force,
            let lastOverlayRefreshAttemptAt,
            Date().timeIntervalSince(lastOverlayRefreshAttemptAt) < 8
        {
            return
        }

        isRefreshingOverlay = true
        lastOverlayRefreshAttemptAt = Date()
        defer { isRefreshingOverlay = false }

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
        updateOverlayHealthState()
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

        if !appIsActive {
            errorMessage = "App đang ở background nên chưa thể bắt đầu phiên live hoặc recording."
            return
        }

        if !cameraOperational {
            errorMessage = cameraDeviceAvailable
                ? "Thiếu quyền camera để bắt đầu phiên."
                : "Thiết bị này không có camera để bắt đầu phiên live."
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

        if thermalCritical {
            errorMessage = "Thiết bị đang quá nóng. Hãy hạ nhiệt iPhone trước khi bắt đầu để tránh crash hoặc rớt phiên."
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

            if liveMode.includesLivestream, (overlaySnapshot == nil || socketRoomPending || socketRoomMismatch || socketPayloadStale) {
                await refreshOverlay()
            }

            if liveMode.includesLivestream, let matchId = activeMatch.id.trimmedNilIfBlank, (socketRoomPending || socketRoomMismatch) {
                environment.matchSocket.watch(matchId: matchId)
            }

            if liveMode.includesLivestream, socketRoomPending {
                errorMessage = "Socket đang chờ join vào room của match hiện tại. Hãy thử lại sau vài giây."
                return
            }

            if liveMode.includesLivestream, socketRoomMismatch {
                errorMessage = "Socket vẫn đang đứng sai room match. App sẽ không vào live cho đến khi room khớp lại."
                return
            }

            streamingService.applyQuality(selectedQuality)
            try await streamingService.preparePreview(quality: selectedQuality)

            if liveMode.includesRecording {
                let recordingSessionId = UUID().uuidString
                let recordingResponse = try await environment.apiClient.startRecording(
                    StartMatchRecordingRequest(
                        matchId: activeMatch.id,
                        courtId: currentCourtId,
                        tournamentId: activeMatch.tournament?.id,
                        streamSessionId: streamingService.clientSessionId,
                        quality: selectedQuality.recordingAPIValue,
                        recordingSessionId: recordingSessionId,
                        mode: liveMode.rawValue
                    )
                )

                activeRecording = recordingResponse.recording
                recordingStateText = recordingResponse.recording?.status ?? "Đã mở phiên recording"

                if let recordingId = recordingResponse.recording?.id?.trimmedNilIfBlank {
                    try await streamingService.startRecording(
                        recordingId: recordingId,
                        matchId: activeMatch.id,
                        segmentDuration: TimeInterval(recordingSegmentDurationSeconds)
                    )
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
                force: false,
                userMatch: launchTarget.isUserMatchLaunch
            )
            self.liveSession = liveSession

            guard
                let rawURL = liveSession.facebook?.resolvedRTMPURL,
                let destination = RTMPDestination.parse(from: rawURL)
            else {
                throw LiveAPIError.server(statusCode: 0, message: "Không nhận được RTMP URL hợp lệ.")
            }

            try await streamingService.startPublishing(to: destination)
            let response = try await environment.apiClient.notifyStreamStarted(
                matchId: activeMatch.id,
                clientSessionId: streamingService.clientSessionId,
                userMatch: launchTarget.isUserMatchLaunch
            )
            _ = await handleStreamLeaseResponse(response, matchId: activeMatch.id)
            startHeartbeats()
            liveStartedAt = Date()
            bannerMessage = liveMode.includesRecording ? "Đã bắt đầu live và recording." : "Đã bắt đầu live."
        } catch {
            streamingService.stopPublishing()
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
        let shouldNotifyLiveEnd = hasActiveLivestreamSession
        let shouldStopRecording = liveMode.includesRecording || streamingService.isRecordingLocally || activeRecording != nil

        if shouldNotifyLiveEnd, let liveMatchId {
            _ = try? await environment.apiClient.notifyStreamEnded(
                matchId: liveMatchId,
                clientSessionId: streamingService.clientSessionId,
                userMatch: launchTarget.isUserMatchLaunch
            )
        }

        streamingService.stopPublishing()
        resetStreamLeaseState()

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
        if hasActiveLivestreamSession || streamingService.isRecordingLocally {
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
        streamingService.overlaySnapshot = nil
        activeMatch = nil
        liveSession = nil
        overlayConfig = nil
        overlaySnapshot = nil
        liveStartedAt = nil
        cancelWaitingStates()
        cancelGoLiveCountdown()
        cancelStopLiveCountdown()
        queuedCourtMatchId = nil
        orientationMode = .auto
        streamingService.updateOrientationMode(orientationMode)
        safetyDegradeReason = nil
        activeSocketMatchId = nil
        lastSocketPayloadAt = nil
        streamState = .idle
        recoveryState = StreamRecoveryState()
        overlayHealth = OverlayHealth()
        lastRecovery = nil
        operatorRecoveryDialog = nil
        isRefreshingOverlay = false
        isResumingRecordingQueue = false
        lastOverlayRefreshAttemptAt = nil
        lastSocketSelfHealAt = nil
        lastRecordingQueueResumeAt = nil
        LiveAppOrientationController.apply(.auto)
        route = bootstrap == nil ? .login : .adminHome
    }

    func toggleCamera() async {
        do {
            try await streamingService.toggleCamera()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func toggleTorch() {
        if thermalWarning && !streamingService.stats.torchEnabled {
            bannerMessage = "Thiết bị đang nóng, app sẽ không bật torch để tránh rớt phiên."
            return
        }
        do {
            try streamingService.setTorchEnabled(!streamingService.stats.torchEnabled)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func toggleMicrophone() {
        guard microphoneOperational else {
            streamingService.setMicrophoneEnabled(false)
            errorMessage = microphoneDeviceAvailable
                ? "Chưa có quyền micro trên thiết bị này."
                : "Thiết bị này không có micro để bật."
            return
        }
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
        if safetyDegradeActive && quality != .stable720 {
            selectedQuality = .stable720
            streamingService.applyQuality(.stable720)
            syncStreamingSafetyProfile()
            bannerMessage = "App đang ở safety mode, tạm khoá quality về 720p ổn định."
            return
        }
        selectedQuality = quality
        streamingService.applyQuality(quality)
        syncStreamingSafetyProfile()
    }

    private func engageSafetyDegrade(reason: String) {
        var changed = false

        if selectedQuality != .stable720 {
            selectedQuality = .stable720
            streamingService.applyQuality(.stable720)
            changed = true
        }

        if streamingService.stats.torchEnabled {
            do {
                try streamingService.setTorchEnabled(false)
                changed = true
            } catch {
                errorMessage = error.localizedDescription
            }
        }

        if !batterySaverEnabled {
            batterySaverEnabled = true
            changed = true
        }

        if safetyDegradeReason?.trimmedNilIfBlank != reason.trimmedNilIfBlank {
            safetyDegradeReason = reason
            changed = true
        }

        if changed {
            bannerMessage = "App đã tự hạ tải để giữ phiên ổn định: \(reason)."
        }

        syncStreamingSafetyProfile()
    }

    private func maybeReleaseSafetyDegrade() {
        guard safetyDegradeActive else { return }
        guard !thermalWarning, !recentMemoryPressure else { return }
        safetyDegradeReason = nil
        syncStreamingSafetyProfile()
    }

    var safetyDegradeActive: Bool {
        safetyDegradeReason?.trimmedNilIfBlank != nil
    }

    var recentMemoryPressure: Bool {
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        return lastMemoryPressure.map { nowMs - $0.atMs < 180_000 } ?? false
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

    var runtimeRegistrySummary: String {
        environment.runtimeRegistry.snapshot.summaryLine
    }

    var cameraPermissionGranted: Bool {
        LiveStreamingService.cameraPermissionGranted
    }

    var cameraDeviceAvailable: Bool {
        LiveStreamingService.cameraDeviceAvailable
    }

    var cameraOperational: Bool {
        cameraPermissionGranted && cameraDeviceAvailable
    }

    var batteryPercent: Int? {
        guard batteryLevel >= 0 else { return nil }
        return min(100, max(0, Int((batteryLevel * 100).rounded())))
    }

    var batteryStateLabel: String {
        switch batteryState {
        case .charging:
            return "Đang sạc"
        case .full:
            return "Đầy pin"
        case .unplugged:
            return "Đang dùng pin"
        case .unknown:
            return "Chưa rõ"
        @unknown default:
            return "Chưa rõ"
        }
    }

    var batteryStatusSummary: String {
        if let batteryPercent {
            return "\(batteryPercent)% • \(batteryStateLabel)"
        }
        return batteryStateLabel
    }

    var batteryLowWarning: Bool {
        guard let batteryPercent else { return false }
        guard batteryState != .charging, batteryState != .full else { return false }
        return batteryPercent <= 15
    }

    var thermalStateLabel: String {
        switch thermalState {
        case .nominal:
            return "Ổn định"
        case .fair:
            return "Ấm nhẹ"
        case .serious:
            return "Nóng"
        case .critical:
            return "Rất nóng"
        @unknown default:
            return "Chưa rõ"
        }
    }

    var thermalWarning: Bool {
        thermalState == .serious || thermalState == .critical
    }

    var thermalCritical: Bool {
        thermalState == .critical
    }

    var microphonePermissionGranted: Bool {
        LiveStreamingService.microphonePermissionGranted
    }

    var microphoneDeviceAvailable: Bool {
        LiveStreamingService.microphoneDeviceAvailable
    }

    var microphoneOperational: Bool {
        microphonePermissionGranted && microphoneDeviceAvailable
    }

    var livePreviewPlaceholderMessage: String? {
        if !cameraDeviceAvailable {
            return "Thiết bị này không có camera. App vẫn mở màn live để test flow, nhưng preview sẽ chỉ hiện placeholder."
        }
        if !cameraPermissionGranted {
            return "PickleTour Live chưa có quyền camera, nên chưa thể dựng preview."
        }
        return nil
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

    var socketRoomMismatch: Bool {
        guard let activeMatchId = activeMatch?.id.trimmedNilIfBlank else { return false }
        guard let activeSocketMatchId = activeSocketMatchId?.trimmedNilIfBlank else { return false }
        return activeSocketMatchId != activeMatchId
    }

    var socketRoomPending: Bool {
        guard socketConnected else { return false }
        guard activeMatch?.id.trimmedNilIfBlank != nil else { return false }
        return activeSocketMatchId?.trimmedNilIfBlank == nil
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

    private var autoStartDelayReason: String? {
        guard liveMode.includesLivestream else { return nil }
        guard let activeMatchId = activeMatch?.id.trimmedNilIfBlank else { return nil }

        if overlaySnapshot == nil {
            return "App đang chờ snapshot overlay mới trước khi auto-start."
        }

        if socketConnected {
            guard let roomMatchId = activeSocketMatchId?.trimmedNilIfBlank else {
                return "App đang chờ socket join vào đúng room match trước khi auto-start."
            }
            if roomMatchId != activeMatchId {
                return "App đang chờ socket khớp lại room của match hiện tại trước khi auto-start."
            }
            if socketPayloadStale {
                return "Payload overlay đang stale, app sẽ đợi thêm dữ liệu mới trước khi auto-start."
            }
        }

        return nil
    }

    private var recordingBytesPerSecondBudget: Int64 {
        let rawBytesPerSecond = Double(selectedQuality.videoBitrate + 128_000) / 8.0
        return Int64((rawBytesPerSecond * 1.25).rounded(.up))
    }

    private var recordingDefaultSegmentEstimateBytes: Int64 {
        Int64((Double(recordingBytesPerSecondBudget) * 6.0).rounded(.up))
    }

    private var recordingStorageHeadroomBytes: Int64 {
        256 * 1024 * 1024
    }

    private var recordingLowStorageHeadroomBytes: Int64 {
        160 * 1024 * 1024
    }

    var minimumRecordingStorageBytes: Int64 {
        guard liveMode.includesRecording else { return 0 }
        return max(
            512 * 1024 * 1024,
            recordingPendingQueueBytes + (recordingDefaultSegmentEstimateBytes * 4) + recordingLowStorageHeadroomBytes
        )
    }

    var standardRecordingStorageBytes: Int64 {
        guard liveMode.includesRecording else { return 0 }
        return max(
            768 * 1024 * 1024,
            recordingPendingQueueBytes + (recordingDefaultSegmentEstimateBytes * 8) + recordingStorageHeadroomBytes
        )
    }

    var recommendedRecordingStorageBytes: Int64 {
        guard liveMode.includesRecording else { return 0 }
        return recordingPendingQueueBytes + (recordingDefaultSegmentEstimateBytes * 15) + recordingStorageHeadroomBytes
    }

    var recordingStorageHardBlock: Bool {
        liveMode.includesRecording && availableStorageBytes > 0 && availableStorageBytes < minimumRecordingStorageBytes
    }

    var recordingStorageRedWarning: Bool {
        liveMode.includesRecording
            && availableStorageBytes > 0
            && !recordingStorageHardBlock
            && availableStorageBytes < standardRecordingStorageBytes
    }

    var recordingStorageWarning: Bool {
        liveMode.includesRecording
            && availableStorageBytes > 0
            && !recordingStorageHardBlock
            && availableStorageBytes < recommendedRecordingStorageBytes
    }

    var recordingMinimumAdditionalBytesNeeded: Int64 {
        max(minimumRecordingStorageBytes - availableStorageBytes, 0)
    }

    var recordingStandardAdditionalBytesNeeded: Int64 {
        max(standardRecordingStorageBytes - availableStorageBytes, 0)
    }

    var recordingRecommendedAdditionalBytesNeeded: Int64 {
        max(recommendedRecordingStorageBytes - availableStorageBytes, 0)
    }

    var recordingEstimatedRunwayMinutes: Int? {
        guard liveMode.includesRecording else { return nil }
        let runwayBytes = max(availableStorageBytes - recordingPendingQueueBytes - recordingStorageHeadroomBytes, 0)
        let bytesPerMinute = max(recordingBytesPerSecondBudget * 60, 1)
        return Int(runwayBytes / bytesPerMinute)
    }

    var recordingSegmentDurationSeconds: Int {
        6
    }

    var recordingStorageStrategyLabel: String {
        recordingStorageRedWarning ? "Căng bộ nhớ • segment \(recordingSegmentDurationSeconds)s" : "Chuẩn • segment \(recordingSegmentDurationSeconds)s"
    }

    var recordingStorageStatusMessage: String? {
        if recordingStorageHardBlock {
            return "Bộ nhớ không đủ để bắt đầu ghi hình an toàn. Hãy giải phóng thêm dung lượng rồi thử lại."
        }
        if recordingStorageRedWarning {
            return "Bộ nhớ đang thấp hơn mức chạy chuẩn. App vẫn có thể ghi, nhưng nên giải phóng thêm dung lượng ngay."
        }
        if recordingStorageWarning {
            return "Bộ nhớ đang thấp. Vẫn có thể ghi hình, nhưng nên dọn thêm máy để phiên dài ổn định hơn."
        }
        return nil
    }

    var brandingConfigured: Bool {
        let hasTournamentLogo = overlaySnapshot?.tournamentLogoURL?.trimmedNilIfBlank != nil
        let hasWebLogo = overlayConfig?.webLogoURL?.trimmedNilIfBlank != nil
        let hasSponsor = overlayConfig?.sponsors.contains { $0.logoURL?.trimmedNilIfBlank != nil } == true
        return hasTournamentLogo || hasWebLogo || hasSponsor
    }

    var brandingReady: Bool {
        if !brandingConfigured {
            return true
        }
        if overlayHealth.brandingAssetCount > 0 {
            return overlayHealth.brandingReady
        }
        return false
    }

    var brandingLoading: Bool {
        brandingConfigured && overlayHealth.brandingLoading
    }

    var isWaitingForActivation: Bool {
        waitingForCourt || waitingForMatchLive || waitingForNextMatch
    }

    var recoverySummary: LiveRecoverySummary? {
        if recoveryState.isActive {
            return LiveRecoverySummary(
                title: recoveryState.summary.isEmpty ? recoveryState.stage.label : recoveryState.summary,
                detail: recoveryState.detail ?? recoveryState.summary,
                canRetryPreview: recoveryState.stage == .overlayRebuild || recoveryState.stage == .cameraRebuild || recoveryState.stage == .pipelineRebuild,
                canRetrySession: recoveryState.stage != .idle
            )
        }

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

    var overlayIssueAgeSeconds: Int? {
        guard overlayHealth.lastIssueAtMs > 0 else { return nil }
        let ageMs = Int64(Date().timeIntervalSince1970 * 1000) - overlayHealth.lastIssueAtMs
        return max(Int(ageMs / 1000), 0)
    }

    var latestThermalEventSummary: String? {
        guard let event = lastThermalEvent else { return nil }
        let ageSeconds = max(Int((Int64(Date().timeIntervalSince1970 * 1000) - event.atMs) / 1000), 0)
        return "\(thermalStateLabel) • \(ageSeconds) giây trước"
    }

    var latestMemoryPressureSummary: String? {
        guard let event = lastMemoryPressure else { return nil }
        let ageSeconds = max(Int((Int64(Date().timeIntervalSince1970 * 1000) - event.atMs) / 1000), 0)
        return "\(event.summary) • \(ageSeconds) giây trước"
    }

    func handlePrimaryAction() {
        refreshStorageMetrics()
        freshEntryRequired = false
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
        freshEntryRequired = false
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
        streamingService.updateOrientationMode(orientationMode)
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
            freshEntryRequired = false
            bannerMessage = "Đã làm mới court runtime và match context."
        }
    }

    func clearDiagnostics() {
        streamingService.clearDiagnostics()
        bannerMessage = "Đã xoá diagnostics nội bộ."
    }

    private func syncStreamingSafetyProfile() {
        streamingService.updateStabilityProfile(
            safetyDegradeActive: safetyDegradeActive,
            recentMemoryPressure: recentMemoryPressure,
            thermalWarning: thermalWarning,
            thermalCritical: thermalCritical
        )
    }

    func handleIncomingURL(_ url: URL) {
        authDebugIncomingURL = url.absoluteString

        let urlKey = url.absoluteString
        let now = Date()
        if
            lastHandledIncomingURL == urlKey,
            let lastHandledIncomingURLAt,
            now.timeIntervalSince(lastHandledIncomingURLAt) < 1
        {
            return
        }
        lastHandledIncomingURL = urlKey
        lastHandledIncomingURLAt = now

        guard url.scheme == "pickletour-live" else { return }

        switch url.host {
        case "auth-init":
            environment.authCoordinator.cancelInteractiveAuthorizationFlow()
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

            bannerMessage = "Đang nhận phiên đăng nhập từ PickleTour..."
            Task {
                await continueWithOsAuthToken(token)
            }
        case "auth":
            if environment.authCoordinator.handleOpenURL(url) {
                return
            }
            break
        case "stream":
            let target = parseLaunchTarget(from: url)
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            let accessToken = components?
                .queryItems?
                .first(where: { $0.name == "accessToken" })?
                .value?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            Task {
                if target.isUserMatchLaunch, let accessToken, !accessToken.isEmpty {
                    applyDirectUserMatchSession(accessToken)
                    await applyLaunchTarget(target)
                } else if session?.accessToken.trimmedNilIfBlank == nil {
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

        if !cameraOperational {
            issues.append(
                LivePreflightIssue(
                    id: "camera_required",
                    severity: .blocker,
                    title: cameraDeviceAvailable ? "Thiếu quyền camera" : "Thiết bị không có camera",
                    detail: cameraDeviceAvailable
                        ? "Cần cấp quyền camera cho PickleTour Live trước khi preview hoặc vào phiên."
                        : "Thiết bị này không có camera nên không thể bắt đầu phiên live thật."
                )
            )
        }

        if !microphoneOperational {
            issues.append(
                LivePreflightIssue(
                    id: "microphone_optional",
                    severity: .warning,
                    title: microphoneDeviceAvailable ? "Thiếu quyền micro" : "Thiết bị không có micro",
                    detail: microphoneDeviceAvailable
                        ? "App vẫn có thể vào phiên với video, nhưng sẽ không thu tiếng cho đến khi được cấp quyền micro."
                        : "App vẫn có thể vào phiên với video, nhưng thiết bị này không thu được tiếng."
                )
            )
        }

        if freshEntryRequired {
            issues.append(
                LivePreflightIssue(
                    id: "fresh_entry_required",
                    severity: .warning,
                    title: "Cần xác nhận lại context",
                    detail: "App vừa rời foreground trong lúc đang giữ phiên hoặc đang armed. Hãy xác nhận lại rồi mới auto-start tiếp để tránh vào sai trạng thái."
                )
            )
        }

        if let safetyDegradeReason = safetyDegradeReason?.trimmedNilIfBlank {
            issues.append(
                LivePreflightIssue(
                    id: "safety_degrade_active",
                    severity: .warning,
                    title: "App đang tự hạ tải",
                    detail: "Thiết bị đang ở chế độ an toàn để giữ phiên ổn định: \(safetyDegradeReason)."
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
                    detail: recordingStorageStatusMessage ?? "Dung lượng còn trống thấp hơn ngưỡng tối thiểu cho recording ở quality hiện tại."
                )
            )
        } else if recordingStorageWarning {
            issues.append(
                LivePreflightIssue(
                    id: "storage_warning",
                    severity: .warning,
                    title: recordingStorageRedWarning ? "Bộ nhớ đang thấp hơn mức chạy chuẩn" : "Bộ nhớ còn thấp cho recording",
                    detail: recordingStorageStatusMessage ?? "Vẫn có thể ghi hình, nhưng nên giải phóng thêm dung lượng để tránh hỏng phiên dài."
                )
            )
        }

        if thermalCritical {
            issues.append(
                LivePreflightIssue(
                    id: "thermal_critical",
                    severity: .blocker,
                    title: "Thiết bị đang quá nóng",
                    detail: "iPhone đang ở mức nhiệt độ rất cao. Nên hạ nhiệt máy trước khi bắt đầu để tránh rớt encoder, văng app hoặc dừng camera."
                )
            )
        } else if thermalWarning {
            issues.append(
                LivePreflightIssue(
                    id: "thermal_warning",
                    severity: .warning,
                    title: "Thiết bị đang nóng",
                    detail: "Máy đang ở trạng thái nhiệt độ cao. Có thể vẫn live được nhưng nguy cơ tụt hiệu năng hoặc encoder mất ổn định sẽ cao hơn."
                )
            )
        }

        if batteryLowWarning {
            issues.append(
                LivePreflightIssue(
                    id: "battery_low",
                    severity: .warning,
                    title: "Pin đang thấp",
                    detail: "Thiết bị còn \(batteryPercent ?? 0)% pin và không cắm sạc. Nên cắm nguồn trước khi vào phiên dài để tránh dừng giữa chừng."
                )
            )
        }

        if systemLowPowerModeEnabled {
            issues.append(
                LivePreflightIssue(
                    id: "system_low_power",
                    severity: .info,
                    title: "iOS đang bật Low Power Mode",
                    detail: "Chế độ tiết kiệm pin của hệ thống có thể làm giảm dư địa hiệu năng khi encode hoặc upload recording."
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

        if socketRoomPending {
            issues.append(
                LivePreflightIssue(
                    id: "socket_room_pending",
                    severity: .warning,
                    title: "Socket chưa đứng đúng room match",
                    detail: "Socket đã nối nhưng app vẫn chưa xác nhận được room của match hiện tại."
                )
            )
        } else if socketRoomMismatch {
            issues.append(
                LivePreflightIssue(
                    id: "socket_room_mismatch",
                    severity: .warning,
                    title: "Socket đang đứng sai room",
                    detail: "App đang nối vào room khác với match hiện tại. Nên chờ tự đồng bộ xong rồi mới auto-start."
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
        guard appIsActive else { return }
        guard !freshEntryRequired else { return }
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

        if let autoStartDelayReason {
            waitingForMatchLive = false
            bannerMessage = autoStartDelayReason
            if let matchId = activeMatch?.id.trimmedNilIfBlank, (socketRoomPending || socketRoomMismatch) {
                environment.matchSocket.watch(matchId: matchId)
            }
            if overlaySnapshot == nil || socketPayloadStale {
                Task { [weak self] in
                    await self?.refreshOverlay(force: false)
                }
            }
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

    private func performHealthMaintenanceIfNeeded(force: Bool = false) async {
        guard session?.accessToken.trimmedNilIfBlank != nil else { return }

        if force || !runtimeSocketConnected {
            environment.courtRuntimeSocket.connectIfNeeded()
        }
        if force || !presenceSocketConnected {
            environment.courtPresenceSocket.connectIfNeeded()
        }

        if let matchId = activeMatch?.id.trimmedNilIfBlank {
            let shouldSelfHealSocket =
                force
                || !socketConnected
                || socketRoomPending
                || socketRoomMismatch
                || socketPayloadStale

            if shouldSelfHealSocket {
                let canRunNow =
                    force
                    || lastSocketSelfHealAt == nil
                    || Date().timeIntervalSince(lastSocketSelfHealAt ?? .distantPast) >= 6
                if canRunNow {
                    lastSocketSelfHealAt = Date()
                    environment.matchSocket.connectIfNeeded()
                    environment.matchSocket.watch(matchId: matchId)
                }
            }

            if force || overlaySnapshot == nil || socketPayloadStale || overlayHealth.lastIssue?.trimmedNilIfBlank != nil {
                await refreshOverlay(force: force)
            }
        }

        if networkConnected, (recordingPendingUploads > 0 || recordingPendingFinalizations > 0) {
            await resumeRecordingQueueIfPossible(force: force)
        }
    }

    private func scheduleBackgroundExitIfNeeded() {
        guard backgroundExitTask == nil else { return }
        let hasCourtPresenceIntent =
            currentCourtId?.trimmedNilIfBlank != nil
            || courtPresence?.isEffectivelyOccupied() == true
        guard hasPrimarySessionIntent || streamingService.isRecordingLocally || liveStartedAt != nil || hasCourtPresenceIntent else { return }

        backgroundExitTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 8_000_000_000)
            await self?.performBackgroundExitIfNeeded()
        }
    }

    private func performBackgroundExitIfNeeded() async {
        backgroundExitTask = nil

        guard !appIsActive else { return }
        let hasCourtPresenceIntent =
            currentCourtId?.trimmedNilIfBlank != nil
            || courtPresence?.isEffectivelyOccupied() == true
        guard hasPrimarySessionIntent || streamingService.isRecordingLocally || liveStartedAt != nil || hasCourtPresenceIntent else { return }

        heartbeatTask?.cancel()
        heartbeatTask = nil
        runtimePollTask?.cancel()
        runtimePollTask = nil
        goLiveCountdownTask?.cancel()
        goLiveCountdownTask = nil
        stopLiveCountdownTask?.cancel()
        stopLiveCountdownTask = nil
        goLiveCountdownSeconds = nil
        stopLiveCountdownSeconds = nil
        endingLive = false

        let hadActiveLivestream = hasActiveLivestreamSession
        let liveMatchId = activeMatch?.id.trimmedNilIfBlank
        let shouldStopRecording = streamingService.isRecordingLocally || activeRecording != nil

        if hadActiveLivestream, let liveMatchId {
            _ = try? await environment.apiClient.notifyStreamEnded(
                matchId: liveMatchId,
                clientSessionId: streamingService.clientSessionId,
                userMatch: launchTarget.isUserMatchLaunch
            )
        }

        streamingService.stopPublishing()
        resetStreamLeaseState()
        overlaySnapshot = nil
        streamingService.overlaySnapshot = nil

        if shouldStopRecording {
            await streamingService.stopRecording()
            recordingFinalizeRequested = activeRecording != nil
        }

        if let courtId = currentCourtId?.trimmedNilIfBlank {
            _ = try? await environment.apiClient.endCourtPresence(
                courtId: courtId,
                clientSessionId: streamingService.clientSessionId
            )
        }
        courtPresence = nil

        streamingService.stopPreview()
        environment.matchSocket.disconnect()
        environment.courtRuntimeSocket.disconnect()
        environment.courtPresenceSocket.disconnect()

        socketConnected = false
        runtimeSocketConnected = false
        presenceSocketConnected = false
        activeSocketMatchId = nil
        lastSocketPayloadAt = nil
        streamState = .idle
        liveSession = nil
        liveStartedAt = nil
        waitingForCourt = false
        waitingForMatchLive = false
        waitingForNextMatch = false
        goLiveArmed = false
        recordOnlyArmed = false
        preflightIssues = []
        freshEntryRequired = true

        if activeRecording != nil {
            recordingStateText = recordingPendingUploads > 0 ? "Đang tải segment cuối" : "Đang chốt recording"
            await maybeFinalizeRecordingIfReady()
        } else {
            recordingStateText = liveMode.includesRecording ? "Đã dừng do app background" : "Chưa ghi hình"
        }

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
        if activeMatch != nil || currentCourtId?.trimmedNilIfBlank != nil {
            await refreshCurrentContext()
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
                if connected {
                    Task { [weak self] in
                        await self?.resumeRecordingQueueIfPossible(force: true)
                    }
                }
            }
            .store(in: &cancellables)

        environment.networkMonitor.$isWiFi
            .receive(on: DispatchQueue.main)
            .sink { [weak self] isWiFi in
                self?.networkIsWiFi = isWiFi
            }
            .store(in: &cancellables)

        environment.deviceMonitor.$batteryLevel
            .receive(on: DispatchQueue.main)
            .sink { [weak self] batteryLevel in
                self?.batteryLevel = batteryLevel
            }
            .store(in: &cancellables)

        environment.deviceMonitor.$batteryState
            .receive(on: DispatchQueue.main)
            .sink { [weak self] batteryState in
                self?.batteryState = batteryState
            }
            .store(in: &cancellables)

        environment.deviceMonitor.$lowPowerModeEnabled
            .receive(on: DispatchQueue.main)
            .sink { [weak self] isEnabled in
                self?.systemLowPowerModeEnabled = isEnabled
            }
            .store(in: &cancellables)

        environment.deviceMonitor.$thermalState
            .receive(on: DispatchQueue.main)
            .sink { [weak self] thermalState in
                self?.thermalState = thermalState
                self?.maybeReleaseSafetyDegrade()
                self?.syncStreamingSafetyProfile()
            }
            .store(in: &cancellables)

        environment.deviceMonitor.$lastThermalEvent
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                guard let self else { return }
                self.lastThermalEvent = event
                if let event {
                    self.streamingService.noteThermalPressure(
                        summary: "Thermal event mới ở trạng thái \(self.thermalStateLabel.lowercased()).",
                        critical: self.thermalCritical
                    )
                    if self.thermalCritical {
                        self.engageSafetyDegrade(reason: "Thiết bị quá nóng")
                    } else if self.thermalWarning {
                        self.engageSafetyDegrade(reason: "Thiết bị đang nóng")
                    }
                }
                self.syncStreamingSafetyProfile()
            }
            .store(in: &cancellables)

        environment.deviceMonitor.$thermalEvents
            .receive(on: DispatchQueue.main)
            .sink { [weak self] events in
                self?.thermalEvents = events
            }
            .store(in: &cancellables)

        environment.deviceMonitor.$lastMemoryPressure
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                guard let self else { return }
                self.lastMemoryPressure = event
                if let event {
                    self.streamingService.noteMemoryPressure(summary: event.summary)
                    self.engageSafetyDegrade(reason: event.summary)
                }
                self.syncStreamingSafetyProfile()
            }
            .store(in: &cancellables)

        environment.deviceMonitor.$memoryPressureEvents
            .receive(on: DispatchQueue.main)
            .sink { [weak self] events in
                self?.memoryPressureEvents = events
            }
            .store(in: &cancellables)

        refreshStorageMetrics()

        NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                guard let self else { return }
                self.appIsActive = true
                self.backgroundExitTask?.cancel()
                self.backgroundExitTask = nil
                self.refreshStorageMetrics()
                self.environment.deviceMonitor.refresh()
                Task { @MainActor in
                    LiveAppOrientationController.apply(self.orientationMode)
                    self.streamingService.updateOrientationMode(self.orientationMode)
                    if let courtId = self.currentCourtId?.trimmedNilIfBlank {
                        await self.refreshCourtRuntime(courtId: courtId)
                        if !self.freshEntryRequired {
                            let presence = try? await self.environment.apiClient.heartbeatCourtPresence(
                                courtId: courtId,
                                clientSessionId: self.streamingService.clientSessionId,
                                screenState: self.currentPresenceScreenState(),
                                matchId: self.activeMatch?.id
                            )
                            self.applyPresenceResponse(presence, matchId: self.activeMatch?.id)
                        }
                    }
                    self.maybeReleaseSafetyDegrade()
                    self.syncStreamingSafetyProfile()
                    await self.performHealthMaintenanceIfNeeded(force: true)
                }
            }
            .store(in: &cancellables)

        NotificationCenter.default.publisher(for: UIApplication.willResignActiveNotification)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                guard let self else { return }
                self.appIsActive = false
                if self.hasPrimarySessionIntent {
                    self.freshEntryRequired = true
                }
                self.scheduleBackgroundExitIfNeeded()
            }
            .store(in: &cancellables)

        streamingService.$connectionState
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                guard let self else { return }
                self.streamState = state
                if case .live = state {
                    if self.liveStartedAt == nil {
                        self.liveStartedAt = Date()
                    }
                    self.endingLive = false
                    self.freshEntryRequired = false
                }
                if case .failed(let message) = state {
                    self.errorMessage = message
                }
                if case .reconnecting(let detail) = state {
                    self.streamingService.noteSocketSelfHeal(detail)
                }
                self.refreshOperatorRecoveryDialog()
            }
            .store(in: &cancellables)

        streamingService.$overlaySnapshot
            .receive(on: DispatchQueue.main)
            .sink { [weak self] snapshot in
                guard let self else { return }
                guard let snapshot else { return }
                self.overlaySnapshot = snapshot
                self.updateOverlayHealthState()
            }
            .store(in: &cancellables)

        streamingService.$recoveryState
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                self?.recoveryState = state
                self?.refreshOperatorRecoveryDialog()
            }
            .store(in: &cancellables)

        streamingService.$overlayHealth
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                self?.overlayHealth = state
            }
            .store(in: &cancellables)

        streamingService.$lastRecovery
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                self?.lastRecovery = event
                self?.refreshOperatorRecoveryDialog()
            }
            .store(in: &cancellables)

        let liveActivityPrimary = Publishers.CombineLatest4($route, $activeMatch, $overlaySnapshot, $streamState)
        let liveActivitySecondary = Publishers.CombineLatest4($waitingForCourt, $waitingForMatchLive, $waitingForNextMatch, $liveMode)
        let liveActivityTertiary = Publishers.CombineLatest4($recordOnlyArmed, $goLiveArmed, $recordingStateText, $liveStartedAt)

        Publishers.CombineLatest3(liveActivityPrimary, liveActivitySecondary, liveActivityTertiary)
            .receive(on: DispatchQueue.main)
            .sink { primary, secondary, tertiary in
#if canImport(ActivityKit)
                if #available(iOS 16.1, *) {
                    let (route, activeMatch, overlaySnapshot, streamState) = primary
                    let (waitingForCourt, waitingForMatchLive, waitingForNextMatch, liveMode) = secondary
                    let (recordOnlyArmed, goLiveArmed, recordingStateText, liveStartedAt) = tertiary

                    Task {
                        await LiveMatchActivityCoordinator.shared.sync(
                            route: route,
                            match: activeMatch,
                            snapshot: overlaySnapshot,
                            streamState: streamState,
                            waitingForCourt: waitingForCourt,
                            waitingForMatchLive: waitingForMatchLive,
                            waitingForNextMatch: waitingForNextMatch,
                            liveMode: liveMode,
                            recordOnlyArmed: recordOnlyArmed,
                            goLiveArmed: goLiveArmed,
                            recordingStateText: recordingStateText,
                            liveStartedAt: liveStartedAt
                        )
                    }
                }
#endif
            }
            .store(in: &cancellables)

        let runtimeRegistryPrimary = Publishers.CombineLatest4($route, $selectedCourt, $activeMatch, $liveSession)
        let runtimeRegistrySecondary = Publishers.CombineLatest4($streamState, $recordingStateText, $overlayHealth, $courtPresence)
        let runtimeRegistryTertiary = Publishers.CombineLatest4($waitingForCourt, $waitingForMatchLive, $waitingForNextMatch, $liveStartedAt)

        Publishers.CombineLatest3(runtimeRegistryPrimary, runtimeRegistrySecondary, runtimeRegistryTertiary)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] primary, secondary, tertiary in
                guard let self else { return }
                let (route, selectedCourt, activeMatch, liveSession) = primary
                let (streamState, recordingStateText, overlayHealth, courtPresence) = secondary
                let (waitingForCourt, waitingForMatchLive, waitingForNextMatch, _) = tertiary

                self.environment.runtimeRegistry.update(
                    LiveRuntimeSnapshot(
                        routeLabel: self.routeLabel(for: route),
                        courtId: self.currentCourtId?.trimmedNilIfBlank,
                        courtName: selectedCourt?.displayName ?? self.courtRuntime?.name?.trimmedNilIfBlank,
                        matchId: activeMatch?.id.trimmedNilIfBlank,
                        matchCode: activeMatch?.displayCode?.trimmedNilIfBlank ?? activeMatch?.code?.trimmedNilIfBlank,
                        liveSessionId: liveSession?.facebook?.pageId?.trimmedNilIfBlank,
                        streamStateSummary: self.streamStateSummary(streamState),
                        recordingStateSummary: recordingStateText,
                        overlayAttached: overlayHealth.attached,
                        overlayRoomMismatch: overlayHealth.roomMismatch,
                        overlayIssue: overlayHealth.lastIssue?.trimmedNilIfBlank,
                        waitingForCourt: waitingForCourt || courtPresence?.occupied == false,
                        waitingForMatchLive: waitingForMatchLive,
                        waitingForNextMatch: waitingForNextMatch,
                        updatedAt: Date()
                    )
                )
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
                guard let self, self.session?.accessToken.trimmedNilIfBlank != nil else { return }
                await self.enqueueRecordingUpload(segment)
            }
        }

        streamingService.onRecordingFailure = { [weak self] message in
            Task { @MainActor in
                guard let self, self.session?.accessToken.trimmedNilIfBlank != nil else { return }
                self.recordingStateText = "Ghi hình lỗi"
                self.errorMessage = message
            }
        }
    }

    private func configureSockets() {
        environment.matchSocket.onOverlaySnapshot = { [weak self] snapshot in
            Task { @MainActor in
                guard let self else { return }
                guard self.session?.accessToken.trimmedNilIfBlank != nil else { return }
                let enrichedSnapshot = self.enrichOverlaySnapshot(snapshot, match: self.activeMatch) ?? snapshot
                self.overlaySnapshot = enrichedSnapshot
                self.streamingService.overlaySnapshot = enrichedSnapshot
                self.updateOverlayHealthState()
            }
        }

        environment.matchSocket.onConnectionChange = { [weak self] connected in
            Task { @MainActor in
                guard let self, self.session?.accessToken.trimmedNilIfBlank != nil else { return }
                self.socketConnected = connected
                self.updateOverlayHealthState()
            }
        }

        environment.matchSocket.onStatusChange = { [weak self] status in
            Task { @MainActor in
                guard let self else { return }
                guard self.session?.accessToken.trimmedNilIfBlank != nil else { return }
                guard let normalizedStatus = status?.trimmedNilIfBlank else { return }
                guard var activeMatch = self.activeMatch else { return }
                activeMatch.status = normalizedStatus
                self.activeMatch = activeMatch
                if normalizedStatus.lowercased() == "live" {
                    self.lastHandledTerminalMatchId = nil
                } else if
                    let activeMatchId = activeMatch.id.trimmedNilIfBlank,
                    self.isTerminalMatchStatus(normalizedStatus)
                {
                    Task { @MainActor [weak self] in
                        await self?.handleTerminalMatchStatus(status: normalizedStatus, matchId: activeMatchId)
                    }
                }
                self.maybeAutoStartArmedSession()
            }
        }

        environment.matchSocket.onActiveMatchChange = { [weak self] matchId in
            Task { @MainActor in
                guard let self, self.session?.accessToken.trimmedNilIfBlank != nil else { return }
                self.activeSocketMatchId = matchId
                self.updateOverlayHealthState()
            }
        }

        environment.matchSocket.onPayloadTimestamp = { [weak self] date in
            Task { @MainActor in
                guard let self, self.session?.accessToken.trimmedNilIfBlank != nil else { return }
                self.lastSocketPayloadAt = date
                self.updateOverlayHealthState()
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
                guard self.session?.accessToken.trimmedNilIfBlank != nil else { return }
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
                guard self.session?.accessToken.trimmedNilIfBlank != nil else { return }

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
            environment.authCoordinator.cancelInteractiveAuthorizationFlow()
            let nextSession = try await environment.authCoordinator.signIn(osAuthToken: token)
            environment.sessionStore.replace(nextSession)
            bannerMessage = "Đã nhận phiên từ PickleTour."
            if let target = currentLaunchTarget, target.isUserMatchLaunch {
                await applyLaunchTarget(target)
            } else {
                await refreshBootstrap()
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func shouldIgnoreProgrammaticAuthCancellation(_ error: Error) -> Bool {
        let nsError = error as NSError
        return nsError.domain == "org.openid.appauth.general" && nsError.code == -4
    }

    private func buildPasswordLoginRequest(loginId: String, password: String) -> LivePasswordLoginRequest {
        let normalizedId = loginId.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedPassword = password.trimmingCharacters(in: .whitespacesAndNewlines)
        let loweredEmail = normalizedId.contains("@") ? normalizedId.lowercased() : nil
        let normalizedPhone = normalizePhoneForPasswordLogin(normalizedId)

        return LivePasswordLoginRequest(
            email: loweredEmail,
            phone: loweredEmail == nil ? normalizedPhone : nil,
            nickname: loweredEmail == nil && normalizedPhone == nil ? normalizedId : nil,
            password: normalizedPassword
        )
    }

    private func normalizePhoneForPasswordLogin(_ raw: String) -> String? {
        var value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.isEmpty == false else { return nil }
        if value.hasPrefix("+84") {
            value = "0" + value.dropFirst(3)
        }
        value = String(value.filter { $0.isNumber })
        return value.range(of: #"^0\d{8,10}$"#, options: .regularExpression) == nil ? nil : value
    }

    private func applyBootstrap(_ bootstrap: LiveAppBootstrapResponse) async throws {
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
    }

    private var currentLaunchTarget: LiveLaunchTarget? {
        if let pendingLaunchTarget {
            return pendingLaunchTarget
        }

        if launchTarget.courtId?.trimmedNilIfBlank != nil || launchTarget.matchId?.trimmedNilIfBlank != nil {
            return launchTarget
        }

        return nil
    }

    private func applyDirectUserMatchSession(_ accessToken: String) {
        let normalizedToken = accessToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard normalizedToken.isEmpty == false else { return }

        environment.sessionStore.replace(
            AuthSession(
                accessToken: normalizedToken,
                refreshToken: nil,
                idToken: nil,
                userId: nil,
                displayName: session?.displayName
            )
        )

        user = nil
        bootstrap = nil
        clusters = []
        selectedCluster = nil
        courts = []
        selectedCourt = nil
    }

    private func clearAuthenticatedStateAfterLoginFailure() {
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
        route = .login
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
            if let presence = runtime.presence, presence.isEffectivelyOccupied() {
                let courtName =
                    selectedCourt?.displayName
                    ?? runtime.name?.trimmedNilIfBlank
                    ?? "Sân này"
                throw LiveAPIError.server(
                    statusCode: 409,
                    message: presence.occupiedMessage(for: courtName)
                )
            }
            let nextMatchId = try await environment.apiClient.getNextMatchByCourt(courtId: courtId)
            courtRuntime = runtime
            courtPresence = runtime.presence
            resolved.matchId = target.matchId?.trimmedNilIfBlank
                ?? runtime.currentMatchId?.trimmedNilIfBlank
                ?? runtime.nextMatchId?.trimmedNilIfBlank
                ?? nextMatchId?.trimmedNilIfBlank
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
        activeSocketMatchId = nil
        lastSocketPayloadAt = nil
        recoveryState = StreamRecoveryState()
        overlayHealth = OverlayHealth()
        lastRecovery = nil
        operatorRecoveryDialog = nil
        lastHandledTerminalMatchId = nil
        resetStreamLeaseState()

        streamingService.stopPublishing()
        await streamingService.stopRecording()

        let matchId = target.matchId?.trimmedNilIfBlank
        if let matchId {
            let match = try await environment.apiClient.getMatchRuntime(
                matchId: matchId,
                userMatch: target.isUserMatchLaunch
            )
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
        recordingPendingQueueBytes = 0
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
            leaseHeartbeatIntervalMs = max(runtime.leaseHints?.heartbeatIntervalMs ?? leaseHeartbeatIntervalMs, 5_000)
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
        if livePreviewPlaceholderMessage == nil {
            try await streamingService.preparePreview(quality: selectedQuality)
        } else {
            streamState = .idle
        }
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
                if let matchId = self.activeMatch?.id.trimmedNilIfBlank, self.shouldMaintainStreamLease {
                    let response = try? await (
                        self.streamLeaseId?.trimmedNilIfBlank == nil
                        ? self.environment.apiClient.notifyStreamStarted(
                            matchId: matchId,
                            clientSessionId: self.streamingService.clientSessionId,
                            userMatch: self.launchTarget.isUserMatchLaunch
                        )
                        : self.environment.apiClient.notifyStreamHeartbeat(
                            matchId: matchId,
                            clientSessionId: self.streamingService.clientSessionId,
                            userMatch: self.launchTarget.isUserMatchLaunch
                        )
                    )
                    _ = await self.handleStreamLeaseResponse(response, matchId: matchId)
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

                await self.performHealthMaintenanceIfNeeded()

                let streamIntervalMs = self.shouldMaintainStreamLease ? max(self.streamHeartbeatIntervalMs, 5_000) : Int.max
                let presenceIntervalMs = self.currentCourtId?.trimmedNilIfBlank == nil ? Int.max : max(self.leaseHeartbeatIntervalMs, 5_000)
                let intervalMs = min(min(streamIntervalMs, presenceIntervalMs), 10_000)
                try? await Task.sleep(nanoseconds: UInt64(intervalMs) * 1_000_000)
            }
        }
    }

    private func applyPresenceResponse(_ response: CourtPresenceResponse?, matchId: String?) {
        leaseId = response?.leaseId?.trimmedNilIfBlank ?? leaseId
        leaseHeartbeatIntervalMs = max(response?.heartbeatIntervalMs ?? courtRuntime?.leaseHints?.heartbeatIntervalMs ?? 10_000, 5_000)
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
            lastHandledTerminalMatchId = nil
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
        do {
            let snapshot = try await environment.recordingCoordinator.enqueueSegment(segment)
            applyRecordingQueueSnapshot(snapshot)
            if segment.isFinal {
                recordingFinalizeRequested = true
            }

            let updatedRecordings = await environment.recordingCoordinator.resumePendingUploads()
            for recording in updatedRecordings {
                if activeRecording?.id == nil || activeRecording?.id == recording.id {
                    activeRecording = recording
                }
            }

            let latestSnapshot = await environment.recordingCoordinator.queueSnapshot()
            applyRecordingQueueSnapshot(latestSnapshot)
            await maybeFinalizeRecordingIfReady(recordingId: segment.recordingId, matchId: segment.matchId)
            return
        } catch {
            errorMessage = error.localizedDescription
            recordingStateText = "Upload recording lỗi"
        }
    }

    private func maybeFinalizeRecordingIfReady(recordingId: String? = nil, matchId: String? = nil) async {
        let requestedRecordingId = recordingId?.trimmedNilIfBlank ?? activeRecording?.id?.trimmedNilIfBlank
        let requestedMatchId =
            matchId?.trimmedNilIfBlank
            ?? activeRecording?.matchId?.trimmedNilIfBlank
            ?? activeMatch?.id.trimmedNilIfBlank

        if (recordingFinalizeRequested || requestedRecordingId != nil),
           recordingPendingUploads == 0,
           let requestedRecordingId,
           let requestedMatchId {
            do {
                if let recording = try await environment.recordingCoordinator.finalizeWhenReady(recordingId: requestedRecordingId, matchId: requestedMatchId) {
                    activeRecording = recording
                    recordingStateText = recording.status ?? "Đã chốt recording"
                }
                recordingFinalizeRequested = false
                let snapshot = await environment.recordingCoordinator.queueSnapshot()
                applyRecordingQueueSnapshot(snapshot)
                return
            } catch {
                recordingFinalizeRequested = true
                recordingStateText = "Chốt recording lỗi"
                errorMessage = error.localizedDescription
                return
            }
        }

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

    private func restoreRecordingQueue() async {
        let snapshot = await environment.recordingCoordinator.restorePersistedQueue()
        applyRecordingQueueSnapshot(snapshot)
        await resumeRecordingQueueIfPossible(force: true)
    }

    private func resumeRecordingQueueIfPossible(force: Bool = false) async {
        guard session?.accessToken.trimmedNilIfBlank != nil else { return }
        guard !isResumingRecordingQueue else { return }
        if
            !force,
            let lastRecordingQueueResumeAt,
            Date().timeIntervalSince(lastRecordingQueueResumeAt) < 6
        {
            return
        }

        isResumingRecordingQueue = true
        lastRecordingQueueResumeAt = Date()
        defer {
            isResumingRecordingQueue = false
            lastRecordingQueueResumeAt = Date()
        }

        let updatedRecordings = await environment.recordingCoordinator.resumePendingUploads()
        for recording in updatedRecordings {
            if activeRecording?.id == nil || activeRecording?.id == recording.id {
                activeRecording = recording
            }
        }
        let snapshot = await environment.recordingCoordinator.queueSnapshot()
        applyRecordingQueueSnapshot(snapshot)
        await environment.recordingCoordinator.clearCompletedArtifacts()
    }

    private func applyRecordingQueueSnapshot(_ snapshot: RecordingQueueSnapshot) {
        recordingPendingUploads = snapshot.pendingUploadCount
        recordingPendingQueueBytes = snapshot.pendingQueueBytes
        recordingPendingFinalizations = snapshot.pendingFinalizations.count

        if recordingPendingUploads > 0 {
            recordingStateText = "Đang tải \(recordingPendingUploads) segment"
        } else if recordingPendingFinalizations > 0 || recordingFinalizeRequested {
            recordingStateText = "Đang chốt recording"
        } else if let status = activeRecording?.status?.trimmedNilIfBlank {
            recordingStateText = status
        } else if !streamingService.isRecordingLocally {
            recordingStateText = "Chưa ghi hình"
        }
    }

    private func updateOverlayHealthState() {
        let snapshotFresh = overlaySnapshot != nil && (!socketConnected || !socketPayloadStale)
        streamingService.noteOverlayInputs(
            snapshotFresh: snapshotFresh,
            roomMismatch: socketRoomMismatch || socketRoomPending,
            brandingConfigured: brandingConfigured
        )
    }

    private func routeLabel(for route: AppRoute) -> String {
        switch route {
        case .login:
            return "login"
        case .adminHome:
            return "admin_home"
        case .courtSetup:
            return "court_setup"
        case .liveStream:
            return "live_stream"
        }
    }

    private func streamStateSummary(_ state: StreamConnectionState) -> String {
        switch state {
        case .idle:
            return "idle"
        case .preparingPreview:
            return "preparing_preview"
        case .previewReady:
            return "preview_ready"
        case .connecting:
            return "connecting"
        case .live:
            return "live"
        case .reconnecting:
            return "reconnecting"
        case .stopped:
            return "stopped"
        case .failed:
            return "failed"
        }
    }

    private func refreshOperatorRecoveryDialog() {
        guard recoveryState.isActive else {
            operatorRecoveryDialog = nil
            return
        }

        guard hasPrimarySessionIntent || streamState != .idle else {
            operatorRecoveryDialog = nil
            return
        }

        let detail = [
            recoveryState.detail?.trimmedNilIfBlank ?? recoveryState.summary.trimmedNilIfBlank,
            "Stage: \(recoveryState.stage.label)",
            "Severity: \(recoveryState.severity.label)",
            "Attempt: \(recoveryState.attempt)",
            "Budget còn lại: \(recoveryState.budgetRemaining)",
            recoveryState.lastFatalReason?.trimmedNilIfBlank.map { "Nguồn lỗi gần nhất: \($0)" }
        ]
        .compactMap { $0 }
        .joined(separator: "\n")

        operatorRecoveryDialog = OperatorRecoveryDialogState(
            title: recoveryState.severity == .critical ? "Live đang tự cứu ở mức nghiêm trọng" : "Live đang tự hồi phục",
            summary: recoveryState.summary,
            detail: detail,
            severity: recoveryState.severity,
            stage: recoveryState.stage,
            attempt: recoveryState.attempt,
            budgetRemaining: recoveryState.budgetRemaining,
            activeMitigations: recoveryState.activeMitigations,
            lastFatalReason: recoveryState.lastFatalReason,
            isFailSoftImminent: recoveryState.isFailSoftImminent
        )
    }

    private func parseLaunchTarget(from url: URL) -> LiveLaunchTarget {
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let items = components?.queryItems ?? []
        return LiveLaunchTarget(
            courtId: items.first(where: { $0.name == "courtId" })?.value?.trimmedNilIfBlank,
            matchId: items.first(where: { $0.name == "matchId" })?.value?.trimmedNilIfBlank,
            pageId: items.first(where: { $0.name == "pageId" })?.value?.trimmedNilIfBlank,
            launchMode: LiveLaunchMode(rawValue: items.first(where: { $0.name == "launchMode" })?.value ?? "") ?? .tournamentCourt
        )
    }

    private func applyLaunchTarget(_ target: LiveLaunchTarget) async {
        launchTarget = target

        if target.isUserMatchLaunch {
            selectedCourt = nil
            courtRuntime = nil
            courtPresence = nil
            liveMode = .streamOnly
            await continueFromSetup()
            return
        }

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
        var handoff = URLComponents()
        handoff.scheme = "pickletourapp"
        handoff.host = "live-auth"
        let continueURL = environment.authCoordinator.prepareAuthorizationRequestURL()
        authDebugContinueURL = continueURL.absoluteString
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
            authDebugTargetURL = targetURL.absoluteString
        } else {
            authDebugTargetURL = nil
        }
        handoff.queryItems = queryItems
        let handoffURL = handoff.url
        authDebugHandoffURL = handoffURL?.absoluteString
        return handoffURL
    }

    private func buildNativeStreamURL(for target: LiveLaunchTarget) -> URL? {
        var components = URLComponents()
        components.scheme = "pickletour-live"
        components.host = "stream"

        var queryItems: [URLQueryItem] = []
        if let courtId = target.courtId?.trimmedNilIfBlank {
            queryItems.append(URLQueryItem(name: "courtId", value: courtId))
        }
        if let matchId = target.matchId?.trimmedNilIfBlank {
            queryItems.append(URLQueryItem(name: "matchId", value: matchId))
        }
        if let pageId = target.pageId?.trimmedNilIfBlank {
            queryItems.append(URLQueryItem(name: "pageId", value: pageId))
        }
        if target.launchMode != .tournamentCourt {
            queryItems.append(URLQueryItem(name: "launchMode", value: target.launchMode.rawValue))
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
        backgroundExitTask?.cancel()
        backgroundExitTask = nil
    }

    private func cancelRecordingUploads() {
        isResumingRecordingQueue = false
        lastRecordingQueueResumeAt = nil
    }

    private var shouldMaintainStreamLease: Bool {
        guard liveMode.includesLivestream else { return false }
        guard activeMatch?.id.trimmedNilIfBlank != nil else { return false }
        switch streamState {
        case .live, .connecting, .reconnecting:
            return true
        case .idle, .preparingPreview, .previewReady, .stopped, .failed:
            return false
        }
    }

    private var hasActiveLivestreamSession: Bool {
        liveSession != nil || streamLeaseId?.trimmedNilIfBlank != nil || matchesLiveSessionState
    }

    private func isTerminalMatchStatus(_ status: String) -> Bool {
        switch status.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "ended", "finished", "completed", "done", "closed", "final", "cancelled", "canceled":
            return true
        default:
            return false
        }
    }

    private func resetStreamLeaseState() {
        streamLeaseId = nil
        streamHeartbeatIntervalMs = 15_000
        lastStreamLeaseRecoveryAt = nil
        isRecoveringStreamLease = false
    }

    private func handleTerminalMatchStatus(status: String, matchId: String) async {
        guard lastHandledTerminalMatchId != matchId else { return }

        let hasActiveSession =
            hasActiveLivestreamSession
            || streamingService.isRecordingLocally
            || activeRecording != nil
            || liveStartedAt != nil
            || goLiveArmed
            || recordOnlyArmed

        guard hasActiveSession else { return }

        lastHandledTerminalMatchId = matchId

        if currentCourtId?.trimmedNilIfBlank != nil {
            waitingForCourt = true
            waitingForMatchLive = false
            waitingForNextMatch = true
        } else {
            errorMessage = "Trận đã kết thúc. App đang đóng phiên hiện tại của trận này."
        }

        if hasActiveLivestreamSession || streamingService.isRecordingLocally || activeRecording != nil || liveStartedAt != nil {
            await stopLive()
            if currentCourtId?.trimmedNilIfBlank != nil, queuedCourtMatchId?.trimmedNilIfBlank == nil {
                waitingForCourt = true
                waitingForMatchLive = false
                waitingForNextMatch = true
                overlaySnapshot = nil
                streamingService.overlaySnapshot = nil
                bannerMessage = "Trận đã kết thúc. App đang chờ trận kế tiếp trên sân."
            }
            return
        }

        goLiveArmed = false
        recordOnlyArmed = false
    }

    private func applyStreamLeaseResponse(_ response: StreamNotifyResponse?) -> Bool {
        guard let response else { return false }

        streamLeaseId = response.leaseId?.trimmedNilIfBlank ?? streamLeaseId
        streamHeartbeatIntervalMs = max(response.heartbeatIntervalMs ?? streamHeartbeatIntervalMs, 5_000)

        let leaseStatus = response.leaseStatus?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let leaseIsActive = response.ok && (leaseStatus == nil || leaseStatus == "active")
        return !leaseIsActive && ["expired", "not_found", "ended", "conflict"].contains(leaseStatus ?? "")
    }

    private func handleStreamLeaseResponse(_ response: StreamNotifyResponse?, matchId: String) async -> Bool {
        guard let response else { return false }
        let shouldRecover = applyStreamLeaseResponse(response)
        if shouldRecover {
            await recoverExpiredStreamLease(for: matchId, reason: response.leaseStatus?.trimmedNilIfBlank ?? "inactive")
            return true
        }
        return false
    }

    private func recoverExpiredStreamLease(for matchId: String, reason: String) async {
        guard liveMode.includesLivestream else { return }
        guard activeMatch?.id == matchId else { return }
        guard !freshEntryRequired else { return }
        guard !isRecoveringStreamLease else { return }

        if let lastStreamLeaseRecoveryAt, Date().timeIntervalSince(lastStreamLeaseRecoveryAt) < 10 {
            return
        }

        isRecoveringStreamLease = true
        lastStreamLeaseRecoveryAt = Date()
        defer { isRecoveringStreamLease = false }

        streamLeaseId = nil
        streamHeartbeatIntervalMs = 15_000

        do {
            let refreshedSession = try await environment.apiClient.createLiveSession(
                matchId: matchId,
                pageId: launchTarget.pageId,
                force: true,
                userMatch: launchTarget.isUserMatchLaunch
            )
            liveSession = refreshedSession

            guard
                let rawURL = refreshedSession.facebook?.resolvedRTMPURL,
                let destination = RTMPDestination.parse(from: rawURL)
            else {
                throw LiveAPIError.server(statusCode: 0, message: "Không nhận được RTMP URL hợp lệ khi xin lại live session.")
            }

            streamingService.stopPublishing()
            try await streamingService.startPublishing(to: destination)

            let response = try await environment.apiClient.notifyStreamStarted(
                matchId: matchId,
                clientSessionId: streamingService.clientSessionId,
                userMatch: launchTarget.isUserMatchLaunch
            )
            _ = applyStreamLeaseResponse(response)
            liveStartedAt = liveStartedAt ?? Date()
        } catch {
            errorMessage = "Không tự khôi phục được live lease (\(reason)): \(error.localizedDescription)"
        }
    }
}

#if canImport(ActivityKit)
@available(iOS 16.1, *)
actor LiveMatchActivityCoordinator {
    static let shared = LiveMatchActivityCoordinator()

    private var currentActivity: Activity<PickleTourMatchActivityAttributes>?
    private var lastState: PickleTourMatchActivityAttributes.ContentState?
    private var lastKey: MatchActivitySnapshotKey?

    private struct MatchActivitySnapshotKey: Equatable {
        var matchId: String
        var tournamentName: String
        var courtName: String
        var matchCode: String
        var teamAName: String
        var teamBName: String
        var scoreA: Int
        var scoreB: Int
        var statusText: String
        var detailText: String
    }

    func sync(
        route: AppRoute,
        match: MatchData?,
        snapshot: LiveOverlaySnapshot?,
        streamState: StreamConnectionState,
        waitingForCourt: Bool,
        waitingForMatchLive: Bool,
        waitingForNextMatch: Bool,
        liveMode: LiveStreamMode,
        recordOnlyArmed: Bool,
        goLiveArmed: Bool,
        recordingStateText: String,
        liveStartedAt: Date?
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

        let nextState = makeState(
            match: match,
            snapshot: snapshot,
            streamState: streamState,
            waitingForCourt: waitingForCourt,
            waitingForMatchLive: waitingForMatchLive,
            waitingForNextMatch: waitingForNextMatch,
            liveMode: liveMode,
            recordOnlyArmed: recordOnlyArmed,
            goLiveArmed: goLiveArmed,
            recordingStateText: recordingStateText,
            liveStartedAt: liveStartedAt
        )
        let nextKey = makeKey(matchId: matchId, state: nextState)

        if let currentActivity, currentActivity.attributes.matchId == matchId {
            guard nextKey != lastKey else { return }
            await currentActivity.update(using: nextState)
            lastState = nextState
            lastKey = nextKey
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
            lastKey = nextKey
        } catch {
            currentActivity = nil
            lastState = nil
            lastKey = nil
        }
    }

    private func endCurrent() async {
        if let currentActivity {
            await currentActivity.end(
                using: lastState ?? endedFallbackState(),
                dismissalPolicy: .immediate
            )
        }
        currentActivity = nil
        lastState = nil
        lastKey = nil
    }

    private func makeState(
        match: MatchData,
        snapshot: LiveOverlaySnapshot?,
        streamState: StreamConnectionState,
        waitingForCourt: Bool,
        waitingForMatchLive: Bool,
        waitingForNextMatch: Bool,
        liveMode: LiveStreamMode,
        recordOnlyArmed: Bool,
        goLiveArmed: Bool,
        recordingStateText: String,
        liveStartedAt: Date?
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

        do {
            let detailText = liveActivityDetailText(
                baseDetailText: detailText,
                waitingForCourt: waitingForCourt,
                waitingForMatchLive: waitingForMatchLive,
                waitingForNextMatch: waitingForNextMatch,
                liveMode: liveMode,
                recordingStateText: recordingStateText
            )

            return PickleTourMatchActivityAttributes.ContentState(
            tournamentName: tournamentName,
            courtName: courtName,
            matchCode: matchCode,
            teamAName: teamAName,
            teamBName: teamBName,
            scoreA: scoreA,
            scoreB: scoreB,
            statusText: liveActivityStatusText(
                streamState: streamState,
                matchStatus: match.status,
                waitingForCourt: waitingForCourt,
                waitingForMatchLive: waitingForMatchLive,
                waitingForNextMatch: waitingForNextMatch,
                liveMode: liveMode,
                recordOnlyArmed: recordOnlyArmed,
                goLiveArmed: goLiveArmed,
                liveStartedAt: liveStartedAt
            ),
            detailText: detailText.trimmedNilIfBlank ?? "Đang cập nhật tỉ số",
            updatedAt: Date()
        )
        }
    }

    private func makeKey(
        matchId: String,
        state: PickleTourMatchActivityAttributes.ContentState
    ) -> MatchActivitySnapshotKey {
        MatchActivitySnapshotKey(
            matchId: matchId,
            tournamentName: state.tournamentName,
            courtName: state.courtName,
            matchCode: state.matchCode,
            teamAName: state.teamAName,
            teamBName: state.teamBName,
            scoreA: state.scoreA,
            scoreB: state.scoreB,
            statusText: state.statusText,
            detailText: state.detailText
        )
    }

    private func liveActivityStatusText(
        streamState: StreamConnectionState,
        matchStatus: String?,
        waitingForCourt: Bool,
        waitingForMatchLive: Bool,
        waitingForNextMatch: Bool,
        liveMode: LiveStreamMode,
        recordOnlyArmed: Bool,
        goLiveArmed: Bool,
        liveStartedAt: Date?
    ) -> String {
        if waitingForNextMatch {
            return "Chờ trận kế tiếp"
        }

        if waitingForCourt {
            return liveMode == .recordOnly ? "Chờ ghi hình" : "Chờ lên sân"
        }

        if waitingForMatchLive {
            return liveMode == .recordOnly ? "Chờ trận vào live" : "Armed chờ live"
        }

        if recordOnlyArmed {
            return "Armed ghi hình"
        }

        if goLiveArmed {
            return "Armed phát live"
        }

        switch streamState {
        case .live:
            return liveMode == .recordOnly ? "Đang ghi hình" : "Đang live"
        case .connecting:
            return "Đang kết nối"
        case .preparingPreview:
            return "Đang chuẩn bị"
        case .previewReady:
            if liveStartedAt != nil {
                return liveMode == .recordOnly ? "Đang ghi hình" : "Preview sẵn sàng"
            }
            return "Preview sẵn sàng"
        case let .reconnecting(reason):
            return reason.trimmedNilIfBlank ?? "Đang nối lại"
        case let .failed(message):
            return message.trimmedNilIfBlank ?? (liveMode == .recordOnly ? "Ghi hình lỗi" : "Live lỗi")
        case .stopped:
            return liveMode == .recordOnly ? "Đã dừng ghi" : "Đã dừng"
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

    private func liveActivityDetailText(
        baseDetailText: String,
        waitingForCourt: Bool,
        waitingForMatchLive: Bool,
        waitingForNextMatch: Bool,
        liveMode: LiveStreamMode,
        recordingStateText: String
    ) -> String {
        if waitingForCourt {
            return liveMode == .recordOnly
                ? "Đã armed, app sẽ tự ghi khi sân có trận."
                : "Đã armed, app sẽ tự mở khi sân có trận."
        }

        if waitingForMatchLive {
            return liveMode == .recordOnly
                ? "App sẽ tự ghi khi trận chuyển sang LIVE."
                : "App sẽ tự vào phiên khi trận chuyển sang LIVE."
        }

        if waitingForNextMatch {
            return "Phiên hiện tại đang kết thúc, chờ chuyển sang trận kế tiếp."
        }

        if liveMode.includesRecording, let recordingState = recordingStateText.trimmedNilIfBlank {
            let enriched = [baseDetailText.trimmedNilIfBlank, recordingState].compactMap { $0 }
            return enriched.isEmpty ? "Đang cập nhật tỉ số" : enriched.joined(separator: " | ")
        }

        return baseDetailText.trimmedNilIfBlank ?? "Đang cập nhật tỉ số"
    }

    private func endedFallbackState() -> PickleTourMatchActivityAttributes.ContentState {
        PickleTourMatchActivityAttributes.ContentState(
            tournamentName: "PickleTour",
            courtName: "Court",
            matchCode: "-",
            teamAName: "Đội A",
            teamBName: "Đội B",
            scoreA: 0,
            scoreB: 0,
            statusText: "Đã dừng",
            detailText: "Phiên live đã kết thúc",
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
#endif
