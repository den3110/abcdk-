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
    @Published private(set) var recordingStateText: String = "Chưa ghi hình"

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
            let session = try await environment.authCoordinator.signIn()
            environment.sessionStore.replace(session)
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
        heartbeatTask?.cancel()
        runtimePollTask?.cancel()
        environment.matchSocket.disconnect()
        environment.courtRuntimeSocket.disconnect()
        environment.courtPresenceSocket.disconnect()
        streamingService.stopPublishing()
        streamingService.stopPreview()
        environment.sessionStore.replace(nil)
        session = nil
        user = nil
        bootstrap = nil
        clusters = []
        courts = []
        selectedCluster = nil
        selectedCourt = nil
        activeMatch = nil
        liveSession = nil
        overlayConfig = nil
        overlaySnapshot = nil
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

    func openCourt(_ court: AdminCourtData) async {
        selectedCourt = court
        launchTarget.courtId = court.id
        launchTarget.matchId = court.currentMatchId
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

            if let selectedCluster, clusters.contains(where: { $0.id == selectedCluster.id }) {
                await loadCourts(clusterId: selectedCluster.id)
            } else if let firstCluster = clusters.first {
                await selectCluster(firstCluster)
            }

            if let tournamentId = bootstrap.manageableTournaments.first?.id.trimmedNilIfBlank {
                environment.courtPresenceSocket.watchTournament(tournamentId)
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

    func startLive() async {
        guard let activeMatch else {
            errorMessage = "Chưa có trận để phát live."
            return
        }

        isWorking = true
        errorMessage = nil
        defer { isWorking = false }

        do {
            streamingService.applyQuality(selectedQuality)

            if liveMode.includesRecording {
                let recording = try await environment.apiClient.startRecording(
                    StartMatchRecordingRequest(
                        matchId: activeMatch.id,
                        courtId: launchTarget.courtId,
                        tournamentId: activeMatch.tournament?.id,
                        streamSessionId: streamingService.clientSessionId,
                        mode: liveMode.rawValue
                    )
                )
                activeRecording = recording.recording
                recordingStateText = recording.recording?.status ?? "Đã mở phiên recording"
            } else {
                activeRecording = nil
                recordingStateText = "Không ghi hình"
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
            bannerMessage = "Đã bắt đầu live."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func stopLive() async {
        heartbeatTask?.cancel()
        isWorking = true
        defer { isWorking = false }

        do {
            if let matchId = activeMatch?.id.trimmedNilIfBlank {
                _ = try? await environment.apiClient.notifyStreamEnded(
                    matchId: matchId,
                    clientSessionId: streamingService.clientSessionId
                )
            }

            if let recordingId = activeRecording?.id?.trimmedNilIfBlank {
                _ = try? await environment.apiClient.finalizeRecording(recordingId: recordingId)
                recordingStateText = "Đã chốt recording"
            }

            if let courtId = launchTarget.courtId?.trimmedNilIfBlank {
                _ = try? await environment.apiClient.endCourtPresence(
                    courtId: courtId,
                    clientSessionId: streamingService.clientSessionId
                )
            }

            streamingService.stopPublishing()
            bannerMessage = "Đã dừng live."
        }
    }

    func leaveLiveScreen() async {
        heartbeatTask?.cancel()
        runtimePollTask?.cancel()
        if streamState == .live || streamState == .connecting {
            await stopLive()
        } else if let courtId = launchTarget.courtId?.trimmedNilIfBlank {
            _ = try? await environment.apiClient.endCourtPresence(
                courtId: courtId,
                clientSessionId: streamingService.clientSessionId
            )
        }
        environment.matchSocket.unwatch()
        if let courtId = selectedCourt?.id {
            environment.courtRuntimeSocket.unwatchStation(courtId)
        }
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
            let token = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?
                .first(where: { $0.name == "osAuthToken" })?
                .value

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
                if snapshot != nil {
                    self?.overlaySnapshot = snapshot
                }
            }
            .store(in: &cancellables)
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
                if let station = payload.station, station.id == self.selectedCourt?.id {
                    self.selectedCourt = station
                    self.courts = self.courts.map { $0.id == station.id ? station : $0 }
                }
                if let currentMatch = payload.currentMatch, currentMatch.id == self.activeMatch?.id || self.activeMatch == nil {
                    self.activeMatch = currentMatch
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
                guard let self, let courtId = self.selectedCourt?.id else { return }
                self.courtPresence = snapshot.courts.first(where: { $0.courtId == courtId })?.liveScreenPresence
            }
        }
    }

    private func continueWithOsAuthToken(_ token: String?) async {
        errorMessage = nil
        isWorking = true
        defer { isWorking = false }

        do {
            let session = try await environment.authCoordinator.signIn(osAuthToken: token)
            environment.sessionStore.replace(session)
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
            if let first = loaded.first {
                selectedCourt = first
            }
            environment.courtRuntimeSocket.watchCluster(clusterId)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func refreshCourtRuntime(courtId: String) async {
        do {
            let runtime = try await environment.apiClient.getCourtRuntime(courtId: courtId)
            courtRuntime = runtime
            courtPresence = runtime.presence
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
                let interval = UInt64(max(self.courtRuntime?.recommendedPollIntervalMs ?? 5_000, 2_000))
                try? await Task.sleep(nanoseconds: interval * 1_000_000)
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
        let matchId = target.matchId ?? ""
        let match = try await environment.apiClient.getMatchRuntime(matchId: matchId)
        activeMatch = match
        overlaySnapshot = LiveOverlaySnapshot(match: match)
        streamingService.overlaySnapshot = overlaySnapshot

        if let tournamentId = match.tournament?.id.trimmedNilIfBlank {
            overlayConfig = try? await environment.apiClient.getOverlayConfig(tournamentId: tournamentId)
            environment.courtPresenceSocket.watchTournament(tournamentId)
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
            environment.courtRuntimeSocket.watchStation(courtId)
            await startRuntimePolling(for: courtId)
        }

        environment.matchSocket.watch(matchId: matchId)
        environment.courtRuntimeSocket.connectIfNeeded()
        environment.courtPresenceSocket.watchTournament(match.tournament?.id ?? bootstrap?.manageableTournaments.first?.id ?? "")
        try await streamingService.preparePreview(quality: selectedQuality)
        await refreshOverlay()
    }

    private func startHeartbeats() {
        heartbeatTask?.cancel()
        heartbeatTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                do {
                    if
                        let matchId = self.activeMatch?.id.trimmedNilIfBlank,
                        self.streamState == .live
                    {
                        _ = try? await self.environment.apiClient.notifyStreamHeartbeat(
                            matchId: matchId,
                            clientSessionId: self.streamingService.clientSessionId
                        )
                    }

                    if let courtId = self.launchTarget.courtId?.trimmedNilIfBlank {
                        let screenState = self.streamState == .live ? "live" : "preview"
                        let presence = try? await self.environment.apiClient.heartbeatCourtPresence(
                            courtId: courtId,
                            clientSessionId: self.streamingService.clientSessionId,
                            screenState: screenState,
                            matchId: self.activeMatch?.id
                        )
                        self.courtPresence = CourtLiveScreenPresence(
                            occupied: presence?.occupied,
                            status: nil,
                            screenState: presence?.screenState,
                            matchId: self.activeMatch?.id,
                            startedAt: nil,
                            lastHeartbeatAt: Date().iso8601UTCString,
                            expiresAt: presence?.expiresAt,
                            previewModeSince: nil,
                            previewReleaseAt: presence?.previewReleaseAt,
                            warningAt: nil,
                            previewWarningMs: nil
                        )
                    }
                }

                try? await Task.sleep(nanoseconds: 10_000_000_000)
            }
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

        if let courtId = target.courtId?.trimmedNilIfBlank {
            if let located = await findCourt(by: courtId) {
                selectedCluster = located.cluster
                courts = located.courts
                selectedCourt = located.court
            }
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
}
