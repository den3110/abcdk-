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

    @Published var launchTarget = LiveLaunchTarget()
    @Published var liveMode: LiveStreamMode = .streamAndRecord
    @Published var selectedQuality: LiveQualityPreset = .balanced1080

    @Published private(set) var socketConnected = false
    @Published private(set) var runtimeSocketConnected = false
    @Published private(set) var presenceSocketConnected = false
    @Published private(set) var activeSocketMatchId: String?
    @Published private(set) var lastSocketPayloadAt: Date?
    @Published private(set) var streamState: StreamConnectionState = .idle

    let streamingService = LiveStreamingService()

    private let environment = LiveAppEnvironment.shared
    private var cancellables = Set<AnyCancellable>()
    private var heartbeatTask: Task<Void, Never>?
    private var runtimePollTask: Task<Void, Never>?
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
            route = .adminHome

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

        if let snapshot {
            overlaySnapshot = snapshot
            streamingService.overlaySnapshot = snapshot
        }
        if let config {
            overlayConfig = config
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

        isWorking = true
        errorMessage = nil
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
            bannerMessage = liveMode.includesRecording ? "Đã bắt đầu live và recording." : "Đã bắt đầu live."
        } catch {
            if let recordingId = activeRecording?.id?.trimmedNilIfBlank {
                _ = try? await environment.apiClient.finalizeRecording(recordingId: recordingId)
            }
            activeRecording = nil
            recordingFinalizeRequested = false
            recordingStateText = "Chưa ghi hình"
            errorMessage = error.localizedDescription
        }
    }

    func stopLive() async {
        stopBackgroundLoops()
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
        await maybeFinalizeRecordingIfReady()

        bannerMessage = liveMode == .recordOnly ? "Đã dừng ghi hình." : "Đã dừng live."

        if let queuedCourtMatchId, queuedCourtMatchId != activeMatch?.id {
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

    private func bind() {
        environment.sessionStore.$session
            .receive(on: DispatchQueue.main)
            .sink { [weak self] session in
                self?.session = session
            }
            .store(in: &cancellables)

        streamingService.$connectionState
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                self?.streamState = state
            }
            .store(in: &cancellables)

        streamingService.$overlaySnapshot
            .receive(on: DispatchQueue.main)
            .sink { [weak self] snapshot in
                guard let snapshot else { return }
                self?.overlaySnapshot = snapshot
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
                self?.overlaySnapshot = snapshot
                self?.streamingService.overlaySnapshot = snapshot
            }
        }

        environment.matchSocket.onConnectionChange = { [weak self] connected in
            Task { @MainActor in
                self?.socketConnected = connected
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

        guard resolved.matchId?.trimmedNilIfBlank != nil else {
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

        let matchId = target.matchId ?? ""
        let match = try await environment.apiClient.getMatchRuntime(matchId: matchId)
        activeMatch = match
        overlaySnapshot = LiveOverlaySnapshot(match: match)
        streamingService.overlaySnapshot = overlaySnapshot
        liveSession = nil
        activeRecording = nil
        recordingFinalizeRequested = false
        recordingPendingUploads = 0
        recordingStateText = "Chưa ghi hình"

        if let tournamentId = match.tournament?.id.trimmedNilIfBlank {
            overlayConfig = try? await environment.apiClient.getOverlayConfig(tournamentId: tournamentId)
            watchTournament(tournamentId)
        }

        if let courtId = target.courtId?.trimmedNilIfBlank {
            let runtime = try await environment.apiClient.getCourtRuntime(courtId: courtId)
            courtRuntime = runtime
            courtPresence = runtime.presence
            _ = try? await environment.apiClient.startCourtPresence(
                courtId: courtId,
                clientSessionId: streamingService.clientSessionId,
                screenState: "preview",
                matchId: target.matchId
            )
            watchCourt(courtId)
            await startRuntimePolling(for: courtId)
        }

        environment.matchSocket.watch(matchId: matchId)
        environment.courtRuntimeSocket.connectIfNeeded()
        try await streamingService.preparePreview(quality: selectedQuality)
        await refreshOverlay()
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
                    let screenState = self.streamState == .live ? "live" : "preview"
                    let presence = try? await self.environment.apiClient.heartbeatCourtPresence(
                        courtId: courtId,
                        clientSessionId: self.streamingService.clientSessionId,
                        screenState: screenState,
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
            overlaySnapshot = LiveOverlaySnapshot(match: match)
            streamingService.overlaySnapshot = overlaySnapshot
            environment.matchSocket.watch(matchId: match.id)

            if let tournamentId = match.tournament?.id.trimmedNilIfBlank {
                watchTournament(tournamentId)
                overlayConfig = try? await environment.apiClient.getOverlayConfig(tournamentId: tournamentId)
            }

            if let courtId = currentCourtId {
                let presence = try? await environment.apiClient.heartbeatCourtPresence(
                    courtId: courtId,
                    clientSessionId: streamingService.clientSessionId,
                    screenState: streamState == .live ? "live" : "preview",
                    matchId: match.id
                )
                applyPresenceResponse(presence, matchId: match.id)
            }

            await refreshOverlay()

            if let announcement {
                bannerMessage = announcement
            }
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
        handoff.queryItems = [
            URLQueryItem(name: "continueUrl", value: continueURL.absoluteString),
            URLQueryItem(name: "callbackUri", value: "pickletour-live://auth-init")
        ]
        return handoff.url
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
    }

    private func cancelRecordingUploads() {
        recordingUploadTasks.values.forEach { $0.cancel() }
        recordingUploadTasks.removeAll()
    }
}
