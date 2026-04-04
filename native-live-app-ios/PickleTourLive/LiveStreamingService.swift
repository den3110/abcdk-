import AVFoundation
import CoreGraphics
import CoreImage
import HaishinKit
import ImageIO
import SwiftUI
import UIKit
import VideoToolbox

struct LocalRecordingSegment: Equatable {
    let recordingId: String
    let matchId: String
    let segmentIndex: Int
    let fileURL: URL
    let durationSeconds: Double
    let isFinal: Bool
}

enum LocalRecordingState: Equatable {
    case idle
    case recording(recordingId: String, segmentIndex: Int)
    case finalizing(recordingId: String)
    case failed(String)
}

@MainActor
final class LiveStreamingService: NSObject, ObservableObject {
    @Published private(set) var connectionState: StreamConnectionState = .idle
    @Published private(set) var stats = StreamStatsSnapshot(
        currentBitrate: 0,
        quality: .balanced1080,
        torchEnabled: false,
        micEnabled: true,
        zoomFactor: 1
    )
    @Published var overlaySnapshot: LiveOverlaySnapshot? {
        didSet {
            overlayEffect.update(snapshot: overlaySnapshot)
            if overlaySnapshot == nil {
                markOverlayIssue("Overlay snapshot bị mất khỏi pipeline.")
            } else {
                overlayHealth.snapshotFresh = true
                overlayHealth.lastEvent = "Overlay snapshot updated"
                if !overlayHealth.attached || !overlayEffectRegistered {
                    reattachOverlay(reason: "Có snapshot mới nhưng overlay effect chưa gắn.")
                } else {
                    overlayHealth.lastIssue = nil
                    overlayHealth.lastIssueAtMs = 0
                }
            }
        }
    }
    @Published private(set) var diagnostics: [String] = []
    @Published private(set) var localRecordingState: LocalRecordingState = .idle
    @Published private(set) var recoveryState = StreamRecoveryState()
    @Published private(set) var overlayHealth = OverlayHealth()
    @Published private(set) var lastRecovery: RecoveryEvent?
    @Published private(set) var maxZoomFactor: CGFloat = 6

    let clientSessionId = UUID().uuidString

    var onRecordingSegmentReady: ((LocalRecordingSegment) -> Void)?
    var onRecordingFailure: ((String) -> Void)?

    var isRecordingLocally: Bool {
        switch localRecordingState {
        case .idle:
            return false
        case .recording, .finalizing:
            return true
        case .failed:
            return false
        }
    }

    var isPreviewReady: Bool {
        switch connectionState {
        case .previewReady, .connecting, .live, .reconnecting:
            return true
        case .idle, .preparingPreview, .stopped, .failed:
            return false
        }
    }

    static var cameraPermissionGranted: Bool {
        AVCaptureDevice.authorizationStatus(for: .video) == .authorized
    }

    static var microphonePermissionGranted: Bool {
        AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
    }

    private let connection = RTMPConnection()
    private let stream: RTMPStream
    private let overlayEffect = LiveScoreboardVideoEffect()
    private let recorder = IOStreamRecorder()
    private lazy var recorderProxy: StreamRecorderDelegateProxy = {
        let proxy = StreamRecorderDelegateProxy()
        proxy.onFinishWriting = { [weak self] writer in
            Task { [weak self] in
                await self?.handleRecorderFinishWriting(writer)
            }
        }
        proxy.onError = { [weak self] error in
            Task { [weak self] in
                await self?.handleRecorderError(error)
            }
        }
        return proxy
    }()

    private var previewViews = NSHashTable<MTHKView>.weakObjects()
    private var currentCameraPosition: AVCaptureDevice.Position = .back
    private var currentCamera: AVCaptureDevice?
    private var pendingPublishName: String?
    private var pendingStartContinuation: CheckedContinuation<Void, Error>?
    private var locallyClosingRTMP = false
    private var suppressRTMPFailureUntilMs: Int64 = 0
    private var currentDestination: RTMPDestination? {
        didSet {
            overlayHealth.destinationBound = currentDestination != nil
        }
    }
    private var statsTimer: Timer?
    private var publishTimeoutTask: Task<Void, Never>?
    private var recordingRotationTimer: Timer?
    private var recordingStopTimeoutTask: Task<Void, Never>?
    private var pendingRecordingStopContinuation: CheckedContinuation<Void, Never>?
    private var activeRecordingSession: ActiveLocalRecordingSession?
    private var pendingRecordingBoundary: PendingRecordingBoundary?
    private var notificationObservers: [NSObjectProtocol] = []
    private var overlayEffectRegistered = false
    private var overlayStabilityMode: OverlayPerformanceMode = .normal
    private var activeOverlayPerformanceMode: OverlayPerformanceMode = .normal
    private var overlayMemoryWarningEvents: [Int64] = []
    private let recoveryBudgetWindowMs: Int64 = 180_000
    private let maxRecoveryBudget = 6
    private var recoveryEventWindow: [Int64] = []
    private var lifecycleGeneration: Int64 = 0

    override init() {
        stream = RTMPStream(connection: connection)
        super.init()

        overlayEffect.onBrandingStatusChange = { [weak self] status in
            Task { @MainActor [weak self] in
                self?.applyBrandingStatus(status)
            }
        }

        connection.addEventListener(.rtmpStatus, selector: #selector(handleRTMPStatus(_:)), observer: self)
        connection.addEventListener(.ioError, selector: #selector(handleRTMPError(_:)), observer: self)

        notificationObservers.append(
            NotificationCenter.default.addObserver(
                forName: UIApplication.didReceiveMemoryWarningNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                Task { @MainActor [weak self] in
                    self?.handleOverlayMemoryWarning()
                }
            }
        )
        notificationObservers.append(
            NotificationCenter.default.addObserver(
                forName: UIApplication.didEnterBackgroundNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                Task { @MainActor [weak self] in
                    self?.handleApplicationDidEnterBackground()
                }
            }
        )

        recorder.delegate = recorderProxy
        stream.addObserver(recorder)
        registerOverlayEffectIfNeeded()
        appendDiagnostic("Live streaming service ready.")
    }

    deinit {
        statsTimer?.invalidate()
        recordingRotationTimer?.invalidate()
        publishTimeoutTask?.cancel()
        recordingStopTimeoutTask?.cancel()
        let pendingStartContinuation = pendingStartContinuation
        self.pendingStartContinuation = nil
        let pendingRecordingStopContinuation = pendingRecordingStopContinuation
        self.pendingRecordingStopContinuation = nil
        notificationObservers.forEach(NotificationCenter.default.removeObserver)
        pendingStartContinuation?.resume(
            throwing: LiveAPIError.server(
                statusCode: 0,
                message: "Streaming service disposed before publish completed."
            )
        )
        pendingRecordingStopContinuation?.resume(returning: ())
        stream.attachCamera(nil)
        stream.attachAudio(nil)
        connection.close()
    }

    func preparePreview(quality: LiveQualityPreset = .balanced1080) async throws {
        let operationGeneration = lifecycleGeneration
        connectionState = .preparingPreview
        do {
            try configureAudioSession()
            try await requestCapturePermissions()
            guard operationGeneration == lifecycleGeneration else {
                appendDiagnostic("Preview setup ignored because lifecycle moved on.")
                return
            }
            applyQuality(quality)
            registerOverlayEffectIfNeeded()

            if stats.micEnabled, let microphone = AVCaptureDevice.default(for: .audio) {
                stream.attachAudio(microphone)
            } else {
                stream.attachAudio(nil)
            }

            if let currentCamera, currentCamera.position == currentCameraPosition {
                maxZoomFactor = max(1, min(currentCamera.activeFormat.videoMaxZoomFactor, 10))
                syncTorchStateWithCurrentCamera()
                refreshPreviewBindings()
                startStatsTimer()

                switch connectionState {
                case .live, .connecting, .reconnecting:
                    break
                default:
                    connectionState = .previewReady
                }

                clearRecoveryIfNeeded()
                appendDiagnostic("Preview reused on \(currentCameraPosition == .back ? "rear" : "front") camera.")
                return
            }

            let camera = try resolveCamera(position: currentCameraPosition)
            currentCamera = camera
            maxZoomFactor = max(1, min(camera.activeFormat.videoMaxZoomFactor, 10))

            try await attachCameraAndAwait(camera)
            guard operationGeneration == lifecycleGeneration else {
                appendDiagnostic("Preview attach completed late and was ignored.")
                return
            }

            syncTorchStateWithCurrentCamera()
            refreshPreviewBindings()
            connectionState = .previewReady
            startStatsTimer()
            clearRecoveryIfNeeded()
            appendDiagnostic("Preview attached to \(currentCameraPosition == .back ? "rear" : "front") camera.")
        } catch {
            reportRecovery(
                stage: .cameraRebuild,
                severity: .warning,
                summary: "Không dựng được preview camera",
                detail: error.localizedDescription,
                activeMitigations: ["Kiểm tra quyền camera", "Dựng lại pipeline preview"],
                lastFatalReason: error.localizedDescription
            )
            throw error
        }
    }

    func startPublishing(to destination: RTMPDestination) async throws {
        let operationGeneration = lifecycleGeneration
        if case .live = connectionState {
            appendDiagnostic("Publish request ignored because RTMP is already live.")
            return
        }

        if case .connecting = connectionState {
            appendDiagnostic("Publish request ignored because RTMP is already connecting.")
            return
        }

        currentDestination = destination

        switch connectionState {
        case .previewReady, .live, .connecting, .reconnecting(_):
            break
        default:
            try await preparePreview(quality: stats.quality)
        }

        guard operationGeneration == lifecycleGeneration else {
            currentDestination = nil
            appendDiagnostic("Publish request dropped because preview lifecycle changed.")
            return
        }

        try await withCheckedThrowingContinuation { continuation in
            clearLocalRTMPCloseSuppression()
            resolvePendingStart(with: LiveAPIError.server(statusCode: 0, message: "Superseded by a new publish attempt."))
            pendingStartContinuation = continuation
            pendingPublishName = destination.publishName
            connectionState = .connecting
            reportRecovery(
                stage: .socketSelfHeal,
                severity: .info,
                summary: "Đang kết nối RTMP",
                detail: destination.connectURL,
                activeMitigations: ["Giữ preview", "Mở RTMP session mới"]
            )
            appendDiagnostic("Connecting to \(destination.connectURL)")
            beginPublishTimeout()
            connection.connect(destination.connectURL)
        }
    }

    func stopPublishing() {
        beginLocalRTMPCloseSuppression()
        cancelPublishTimeout()
        pendingPublishName = nil
        resolvePendingStart(with: nil)
        currentDestination = nil
        stream.close()
        connection.close()
        connectionState = currentCamera == nil ? .stopped : .previewReady
        stats.currentBitrate = 0
        overlayHealth.destinationBound = false
        appendDiagnostic("Publishing stopped.")
    }

    func stopPreview() {
        lifecycleGeneration &+= 1
        beginLocalRTMPCloseSuppression()
        cancelPublishTimeout()
        cancelRecordingStopTimeout()
        recordingRotationTimer?.invalidate()
        recordingRotationTimer = nil
        statsTimer?.invalidate()
        statsTimer = nil
        stats.currentBitrate = 0
        resetTorchState()
        stream.attachCamera(nil)
        stream.attachAudio(nil)
        currentCamera = nil
        maxZoomFactor = 6
        connectionState = .idle
        activeRecordingSession = nil
        pendingRecordingBoundary = nil
        localRecordingState = .idle
        overlayHealth.destinationBound = false
        overlayEffect.handleMemoryWarning()
        resolvePendingRecordingStop()
        refreshPreviewBindings()
        appendDiagnostic("Preview released.")
    }

    func startRecording(recordingId: String, matchId: String, segmentDuration: TimeInterval = 6.0) async throws {
        let operationGeneration = lifecycleGeneration
        guard let recordingId = recordingId.trimmedNilIfBlank, let matchId = matchId.trimmedNilIfBlank else {
            throw LiveAPIError.server(statusCode: 0, message: "Thiếu thông tin recording để bắt đầu ghi hình.")
        }

        if currentCamera == nil {
            try await preparePreview(quality: stats.quality)
        }

        guard operationGeneration == lifecycleGeneration else {
            appendDiagnostic("Recording request ignored because preview lifecycle changed.")
            return
        }

        if isRecordingLocally {
            await stopRecording()
        }

        let nextSession = ActiveLocalRecordingSession(
            recordingId: recordingId,
            matchId: matchId,
            segmentIndex: 0,
            segmentStartedAt: Date(),
            segmentDuration: max(segmentDuration, 4)
        )

        activeRecordingSession = nextSession
        localRecordingState = .recording(recordingId: recordingId, segmentIndex: 0)
        appendDiagnostic("Recording armed for match \(matchId).")
        beginRecordingSegment()
    }

    func stopRecording() async {
        recordingRotationTimer?.invalidate()
        recordingRotationTimer = nil

        if pendingRecordingStopContinuation != nil {
            return
        }

        guard activeRecordingSession != nil || pendingRecordingBoundary != nil else {
            localRecordingState = .idle
            return
        }

        await withCheckedContinuation { continuation in
            pendingRecordingStopContinuation = continuation
            beginRecordingStopTimeout()

            if pendingRecordingBoundary != nil {
                return
            }

            rotateRecordingSegment(isFinal: true)
        }
    }

    func toggleCamera() async throws {
        let operationGeneration = lifecycleGeneration
        let previousPosition = currentCameraPosition
        let nextPosition: AVCaptureDevice.Position = previousPosition == .back ? .front : .back
        let previousCamera = currentCamera
        let previousMaxZoomFactor = maxZoomFactor

        resetTorchState()
        currentCameraPosition = nextPosition

        do {
            let camera = try resolveCamera(position: nextPosition)
            currentCamera = camera
            maxZoomFactor = max(1, min(camera.activeFormat.videoMaxZoomFactor, 10))

            try await attachCameraAndAwait(camera)
            guard operationGeneration == lifecycleGeneration else {
                appendDiagnostic("Camera switch completed late and was ignored.")
                return
            }
            syncTorchStateWithCurrentCamera()
            appendDiagnostic("Switched to \(currentCameraPosition == .back ? "rear" : "front") camera.")
        } catch {
            currentCameraPosition = previousPosition
            currentCamera = previousCamera
            maxZoomFactor = previousMaxZoomFactor
            syncTorchStateWithCurrentCamera()
            appendDiagnostic("Camera switch failed: \(error.localizedDescription)")
            throw error
        }
    }

    func setTorchEnabled(_ enabled: Bool) throws {
        guard let camera = currentCamera, camera.hasTorch else { return }
        try camera.lockForConfiguration()
        camera.torchMode = enabled ? .on : .off
        camera.unlockForConfiguration()
        stats.torchEnabled = enabled
    }

    func setMicrophoneEnabled(_ enabled: Bool) {
        stats.micEnabled = enabled
        if enabled, let microphone = AVCaptureDevice.default(for: .audio) {
            stream.attachAudio(microphone)
        } else {
            stream.attachAudio(nil)
        }
    }

    func setZoomFactor(_ zoomFactor: CGFloat) throws {
        guard let camera = currentCamera else { return }
        let supported = max(1, min(zoomFactor, camera.activeFormat.videoMaxZoomFactor))
        try camera.lockForConfiguration()
        camera.videoZoomFactor = supported
        camera.unlockForConfiguration()
        stats.zoomFactor = supported
    }

    func applyQuality(_ quality: LiveQualityPreset) {
        stats.quality = quality
        let resolution = quality.resolution
        stream.frameRate = Double(quality.frameRate)
        stream.sessionPreset = resolution.width >= 1900 ? .hd1920x1080 : .hd1280x720

        var videoSettings = stream.videoSettings
        videoSettings.bitRate = max(0, quality.videoBitrate)
        videoSettings.maxKeyFrameIntervalDuration = 2
        videoSettings.profileLevel = resolution.width >= 1900
            ? String(kVTProfileLevel_H264_High_AutoLevel)
            : String(kVTProfileLevel_H264_Main_AutoLevel)
        stream.videoSettings = videoSettings

        var audioSettings = stream.audioSettings
        audioSettings.bitRate = 128_000
        stream.audioSettings = audioSettings

        recorder.settings = [
            .audio: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 44_100,
                AVNumberOfChannelsKey: 1
            ],
            .video: [
                AVVideoCodecKey: AVVideoCodecType.h264,
                AVVideoWidthKey: resolution.width,
                AVVideoHeightKey: resolution.height,
                AVVideoCompressionPropertiesKey: [
                    AVVideoAverageBitRateKey: quality.videoBitrate,
                    AVVideoMaxKeyFrameIntervalDurationKey: 2
                ]
            ]
        ]
    }

    func attachPreviewView(_ view: MTHKView) {
        previewViews.add(view)
        view.videoGravity = .resizeAspectFill
        view.attachStream(stream)
    }

    func detachPreviewView(_ view: MTHKView) {
        view.attachStream(nil)
        previewViews.remove(view)
    }

    func clearDiagnostics() {
        diagnostics.removeAll()
        appendDiagnostic("Đã xoá diagnostics cũ.")
    }

    func updateStabilityProfile(
        safetyDegradeActive: Bool,
        recentMemoryPressure: Bool,
        thermalWarning: Bool,
        thermalCritical: Bool
    ) {
        if thermalCritical {
            overlayStabilityMode = .minimal
        } else if recentMemoryPressure {
            overlayStabilityMode = .minimal
        } else if safetyDegradeActive || thermalWarning {
            overlayStabilityMode = .constrained
        } else {
            overlayStabilityMode = .normal
        }
        refreshOverlayPerformanceMode()
    }

    func noteOverlayInputs(snapshotFresh: Bool, roomMismatch: Bool, brandingConfigured: Bool) {
        overlayHealth.snapshotFresh = snapshotFresh
        overlayHealth.roomMismatch = roomMismatch
        overlayHealth.brandingConfigured = brandingConfigured

        if !brandingConfigured {
            overlayHealth.brandingLoading = false
            overlayHealth.brandingReady = true
            overlayHealth.brandingLoadedCount = 0
            overlayHealth.brandingAssetCount = 0
        }

        if roomMismatch {
            markOverlayIssue("Overlay đang đứng sai room match.")
            reportRecovery(
                stage: .socketSelfHeal,
                severity: .warning,
                summary: "Overlay đang chờ đúng room match",
                detail: "Socket overlay đang đứng sai room so với match hiện tại.",
                activeMitigations: ["Chờ room mới", "Giữ preview", "Không burn-in payload cũ"]
            )
            return
        }

        if !snapshotFresh {
            markOverlayIssue("Overlay snapshot đang stale hoặc chưa có.")
            reportRecovery(
                stage: .overlayRebuild,
                severity: .warning,
                summary: "Overlay snapshot đang stale",
                detail: "Chưa có snapshot mới hoặc payload overlay đã quá cũ.",
                activeMitigations: ["Giữ preview", "Chờ payload mới", "Cho phép refresh context"]
            )
            return
        }

        if !overlayHealth.attached || !overlayEffectRegistered {
            reattachOverlay(reason: "Overlay health báo detached.")
            return
        }

        if brandingConfigured && !overlayHealth.brandingReady {
            if activeOverlayPerformanceMode == .disabled {
                overlayHealth.lastEvent = "Overlay fail-soft mode disabled branding burn-in"
            } else if activeOverlayPerformanceMode == .minimal {
                overlayHealth.lastEvent = "Overlay fail-soft mode keeps scoreboard only"
            } else {
                overlayHealth.lastEvent = overlayHealth.brandingLoading
                    ? "Overlay loading branding assets"
                    : "Overlay running with partial branding"
            }
            return
        }

        overlayHealth.lastIssue = nil
        overlayHealth.lastIssueAtMs = 0
        overlayHealth.lastEvent = "Overlay health nominal"
    }

    func noteSocketSelfHeal(_ detail: String) {
        reportRecovery(
            stage: .socketSelfHeal,
            severity: .warning,
            summary: "Socket đang tự nối lại",
            detail: detail,
            activeMitigations: ["Giữ preview", "Chờ room match khớp lại"]
        )
    }

    func noteMemoryPressure(summary: String) {
        refreshOverlayPerformanceMode()
        reportRecovery(
            stage: .degraded,
            severity: .warning,
            summary: "Thiết bị đang bị áp lực bộ nhớ",
            detail: summary,
            activeMitigations: ["Giữ cấu hình encode an toàn", "Ưu tiên giữ app sống"]
        )
    }

    func noteThermalPressure(summary: String, critical: Bool) {
        refreshOverlayPerformanceMode()
        reportRecovery(
            stage: critical ? .failSoftGuard : .degraded,
            severity: critical ? .critical : .warning,
            summary: critical ? "Thiết bị quá nóng" : "Thiết bị đang nóng",
            detail: summary,
            activeMitigations: critical
                ? ["Chặn start mới", "Yêu cầu hạ nhiệt máy"]
                : ["Giảm tải operator", "Theo dõi camera / encoder"],
            lastFatalReason: critical ? summary : nil
        )
    }

    private func refreshPreviewBindings() {
        for view in previewViews.allObjects {
            view.attachStream(stream)
        }
    }

    private func handleOverlayMemoryWarning() {
        overlayMemoryWarningEvents.append(Self.nowMs())
        overlayEffect.handleMemoryWarning()
        refreshOverlayPerformanceMode()
        appendDiagnostic("Memory warning received. Dropped overlay image caches.")
    }

    private func handleApplicationDidEnterBackground() {
        overlayEffect.handleMemoryWarning()
        appendDiagnostic("App entered background. Released overlay caches.")
    }

    private func applyBrandingStatus(_ status: OverlayBrandingAssetStatus) {
        overlayHealth.brandingConfigured = status.configuredCount > 0
        overlayHealth.brandingLoading = status.isLoading
        overlayHealth.brandingLoadedCount = status.loadedCount
        overlayHealth.brandingAssetCount = status.configuredCount
        overlayHealth.brandingReady = status.isReady

        if status.isLoading {
            overlayHealth.lastEvent = "Branding assets loading"
        } else if status.isReady {
            overlayHealth.lastEvent = status.configuredCount == 0
                ? "Overlay has no branding assets configured"
                : "Branding assets ready"
        } else if let lastError = status.lastError?.trimmedNilIfBlank {
            overlayHealth.lastEvent = lastError
        } else if status.configuredCount > 0 {
            overlayHealth.lastEvent = "Branding assets incomplete"
        }
    }

    private func refreshOverlayPerformanceMode() {
        let nowMs = Self.nowMs()
        overlayMemoryWarningEvents = overlayMemoryWarningEvents.filter { nowMs - $0 <= 180_000 }

        let warningEscalationMode: OverlayPerformanceMode
        switch overlayMemoryWarningEvents.count {
        case 3...:
            warningEscalationMode = .disabled
        case 2:
            warningEscalationMode = .minimal
        case 1:
            warningEscalationMode = .constrained
        default:
            warningEscalationMode = .normal
        }

        let nextMode = overlayStabilityMode.rawValue >= warningEscalationMode.rawValue
            ? overlayStabilityMode
            : warningEscalationMode

        guard nextMode != activeOverlayPerformanceMode else { return }

        let previousMode = activeOverlayPerformanceMode
        activeOverlayPerformanceMode = nextMode
        overlayEffect.setPerformanceMode(nextMode)

        if nextMode == .normal {
            overlayHealth.lastEvent = "Overlay renderer restored to normal mode"
            appendDiagnostic("Overlay renderer returned to normal mode.")
            return
        }

        overlayHealth.lastEvent = "Overlay renderer entered \(nextMode.label) mode"
        appendDiagnostic("Overlay renderer entered \(nextMode.label) mode.")

        let severity: RecoverySeverity = nextMode == .disabled ? .critical : .warning
        let stage: RecoveryStage = nextMode == .disabled ? .failSoftGuard : .degraded
        let detail: String
        switch nextMode {
        case .constrained:
            detail = "Overlay burn-in sẽ render nhẹ hơn để giảm peak RAM và tránh crash."
        case .minimal:
            detail = "Overlay đã hạ xuống chế độ tối thiểu, ưu tiên giữ stream và camera sống."
        case .disabled:
            detail = "Overlay burn-in đã tắt tạm thời để bảo vệ app khỏi crash do áp lực bộ nhớ."
        case .normal:
            detail = "Overlay đã trở lại mức đầy đủ."
        }

        if previousMode != nextMode {
            reportRecovery(
                stage: stage,
                severity: severity,
                summary: "Overlay đang tự hạ tải",
                detail: detail,
                activeMitigations: [
                    "Giảm chi phí render overlay",
                    "Ưu tiên giữ camera / encoder sống",
                    "Cho phép quay lại normal mode khi máy ổn định"
                ],
                lastFatalReason: nextMode == .disabled ? "overlay_fail_soft_guard" : nil
            )
        }
    }

    private func reportRecovery(
        stage: RecoveryStage,
        severity: RecoverySeverity,
        summary: String,
        detail: String?,
        activeMitigations: [String] = [],
        lastFatalReason: String? = nil
    ) {
        let nowMs = Self.nowMs()
        recoveryEventWindow = recoveryEventWindow.filter { nowMs - $0 <= recoveryBudgetWindowMs }
        recoveryEventWindow.append(nowMs)

        let attempt = recoveryEventWindow.count
        let budgetRemaining = max(maxRecoveryBudget - attempt, 0)
        let failSoftImminent = budgetRemaining <= 1 || severity == .critical

        recoveryState = StreamRecoveryState(
            stage: failSoftImminent && stage != .failSoftGuard ? .failSoftGuard : stage,
            severity: failSoftImminent ? maxSeverity(severity, .critical) : severity,
            summary: summary,
            detail: detail,
            attempt: attempt,
            budgetRemaining: budgetRemaining,
            activeMitigations: activeMitigations,
            lastFatalReason: lastFatalReason,
            isFailSoftImminent: failSoftImminent,
            atMs: nowMs
        )
        lastRecovery = RecoveryEvent(reason: summary, atMs: nowMs)
    }

    private func clearRecoveryIfNeeded() {
        guard recoveryState.isActive else { return }
        recoveryState = StreamRecoveryState()
    }

    private func beginLocalRTMPCloseSuppression(windowMs: Int64 = 4_000) {
        locallyClosingRTMP = true
        suppressRTMPFailureUntilMs = max(suppressRTMPFailureUntilMs, Self.nowMs() + windowMs)
    }

    private func acknowledgeLocalRTMPCloseEvent() {
        locallyClosingRTMP = false
    }

    private func clearLocalRTMPCloseSuppression() {
        locallyClosingRTMP = false
        suppressRTMPFailureUntilMs = 0
    }

    private func shouldIgnoreRTMPFailureAfterLocalClose() -> Bool {
        locallyClosingRTMP || Self.nowMs() < suppressRTMPFailureUntilMs
    }

    private func markOverlayIssue(_ message: String) {
        overlayHealth.lastIssue = message
        overlayHealth.lastIssueAtMs = Self.nowMs()
        overlayHealth.lastEvent = message
    }

    private func reattachOverlay(reason: String) {
        overlayHealth.reattaching = true
        overlayEffect.update(snapshot: overlaySnapshot)
        registerOverlayEffectIfNeeded()
        overlayHealth.attached = overlayEffectRegistered
        overlayHealth.reattaching = false
        overlayHealth.lastAttachedAtMs = Self.nowMs()
        overlayHealth.lastIssue = nil
        overlayHealth.lastIssueAtMs = 0
        overlayHealth.lastEvent = "Overlay reattached"

        reportRecovery(
            stage: .overlayRebuild,
            severity: .warning,
            summary: "Overlay vừa được gắn lại",
            detail: reason,
            activeMitigations: ["Gắn lại burn-in", "Giữ preview", "Đợi payload socket mới"]
        )
    }

    private func requestCapturePermissions() async throws {
        let cameraAllowed = await AVCaptureDevice.requestAccessIfNeeded(for: .video)
        let micAllowed = await AVCaptureDevice.requestAccessIfNeeded(for: .audio)
        guard cameraAllowed, micAllowed else {
            throw LiveAPIError.server(statusCode: 0, message: "Ứng dụng chưa có quyền camera hoặc micro.")
        }
    }

    private func configureAudioSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setPreferredSampleRate(44_100)
        try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
        try session.setActive(true)
    }

    private func resolveCamera(position: AVCaptureDevice.Position) throws -> AVCaptureDevice {
        if let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position) {
            return device
        }
        throw LiveAPIError.server(statusCode: 0, message: "Không tìm thấy camera phù hợp.")
    }

    private func beginPublishTimeout(seconds: TimeInterval = 18) {
        publishTimeoutTask?.cancel()
        publishTimeoutTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(max(seconds, 5) * 1_000_000_000))
            await MainActor.run {
                guard let self else { return }
                guard case .connecting = self.connectionState else { return }
                self.pendingPublishName = nil
                self.currentDestination = nil
                self.stream.close()
                self.connection.close()
                self.connectionState = .failed("RTMP timeout")
                self.reportRecovery(
                    stage: .pipelineRebuild,
                    severity: .critical,
                    summary: "RTMP timeout",
                    detail: "RTMP kết nối quá lâu và đã bị huỷ.",
                    activeMitigations: ["Đóng connection cũ", "Cho phép retry session"],
                    lastFatalReason: "RTMP timeout"
                )
                self.appendDiagnostic("RTMP connect timed out.")
                self.resolvePendingStart(with: LiveAPIError.server(statusCode: 0, message: "RTMP kết nối quá lâu và đã bị hủy."))
            }
        }
    }

    private func cancelPublishTimeout() {
        publishTimeoutTask?.cancel()
        publishTimeoutTask = nil
    }

    private func beginRecordingStopTimeout(seconds: TimeInterval = 8) {
        recordingStopTimeoutTask?.cancel()
        let timeoutGeneration = lifecycleGeneration
        recordingStopTimeoutTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(max(seconds, 3) * 1_000_000_000))
            await MainActor.run {
                guard let self else { return }
                guard timeoutGeneration == self.lifecycleGeneration else { return }
                guard self.pendingRecordingStopContinuation != nil else { return }

                self.pendingRecordingBoundary = nil
                self.activeRecordingSession = nil
                self.localRecordingState = .idle
                self.appendDiagnostic("Recording stop timed out. Forced local cleanup to avoid a stuck pipeline.")
                self.reportRecovery(
                    stage: .pipelineRebuild,
                    severity: .warning,
                    summary: "Dừng recording quá lâu",
                    detail: "App đã tự dọn local recording state để tránh treo pipeline khi đóng segment.",
                    activeMitigations: ["Bỏ segment đang kẹt", "Giữ preview sống", "Cho phép operator thử lại"]
                )
                self.resolvePendingRecordingStop()
            }
        }
    }

    private func cancelRecordingStopTimeout() {
        recordingStopTimeoutTask?.cancel()
        recordingStopTimeoutTask = nil
    }

    private func resetTorchState() {
        guard let camera = currentCamera, camera.hasTorch else {
            stats.torchEnabled = false
            return
        }

        guard (try? camera.lockForConfiguration()) != nil else {
            stats.torchEnabled = false
            appendDiagnostic("Torch reset skipped because camera configuration lock failed.")
            return
        }

        camera.torchMode = .off
        camera.unlockForConfiguration()
        stats.torchEnabled = false
    }

    private func syncTorchStateWithCurrentCamera() {
        guard let camera = currentCamera, camera.hasTorch else {
            stats.torchEnabled = false
            return
        }

        do {
            try camera.lockForConfiguration()
            camera.torchMode = stats.torchEnabled ? .on : .off
            camera.unlockForConfiguration()
        } catch {
            stats.torchEnabled = false
            appendDiagnostic("Torch sync failed: \(error.localizedDescription)")
        }
    }

    private func attachCameraAndAwait(_ camera: AVCaptureDevice) async throws {
        var attachError: Error?
        stream.attachCamera(camera) { _, error in
            attachError = error
        }
        try await Task.sleep(nanoseconds: 300_000_000)
        if let attachError {
            throw attachError
        }
    }

    private func registerOverlayEffectIfNeeded() {
        guard !overlayEffectRegistered else {
            overlayHealth.attached = true
            if overlayHealth.lastAttachedAtMs == 0 {
                overlayHealth.lastAttachedAtMs = Self.nowMs()
            }
            return
        }
        _ = stream.registerVideoEffect(overlayEffect)
        overlayEffectRegistered = true
        overlayHealth.attached = true
        overlayHealth.lastAttachedAtMs = Self.nowMs()
        overlayHealth.lastEvent = "Overlay effect registered"
    }

    private func beginRecordingSegment() {
        guard let session = activeRecordingSession else {
            resolvePendingRecordingStop()
            return
        }

        cancelRecordingStopTimeout()
        recorder.fileName = "pickletour-live-\(session.recordingId)-\(String(format: "%04d", session.segmentIndex)).mp4"
        recorder.startRunning()
        localRecordingState = .recording(recordingId: session.recordingId, segmentIndex: session.segmentIndex)

        recordingRotationTimer?.invalidate()
        recordingRotationTimer = Timer.scheduledTimer(withTimeInterval: session.segmentDuration, repeats: false) { [weak self] _ in
            Task { [weak self] in
                await self?.rotateRecordingSegment(isFinal: false)
            }
        }

        appendDiagnostic("Recording segment #\(session.segmentIndex + 1) started.")
    }

    private func rotateRecordingSegment(isFinal: Bool) {
        guard let session = activeRecordingSession, pendingRecordingBoundary == nil else {
            if isFinal {
                resolvePendingRecordingStop()
            }
            return
        }

        recordingRotationTimer?.invalidate()
        recordingRotationTimer = nil

        pendingRecordingBoundary = PendingRecordingBoundary(
            recordingId: session.recordingId,
            matchId: session.matchId,
            segmentIndex: session.segmentIndex,
            segmentStartedAt: session.segmentStartedAt,
            segmentFinishedAt: Date(),
            isFinal: isFinal
        )

        if isFinal {
            localRecordingState = .finalizing(recordingId: session.recordingId)
        }

        appendDiagnostic("Closing recording segment #\(session.segmentIndex + 1).")
        recorder.stopRunning()
    }

    private func handleRecorderFinishWriting(_ writer: AVAssetWriter) {
        cancelRecordingStopTimeout()
        guard let boundary = pendingRecordingBoundary else {
            resolvePendingRecordingStop()
            return
        }

        pendingRecordingBoundary = nil
        let outputURL = writer.outputURL
        let duration = max(0, boundary.segmentFinishedAt.timeIntervalSince(boundary.segmentStartedAt))

        if FileManager.default.fileExists(atPath: outputURL.path) {
            onRecordingSegmentReady?(
                LocalRecordingSegment(
                    recordingId: boundary.recordingId,
                    matchId: boundary.matchId,
                    segmentIndex: boundary.segmentIndex,
                    fileURL: outputURL,
                    durationSeconds: duration,
                    isFinal: boundary.isFinal
                )
            )
            appendDiagnostic("Recording segment #\(boundary.segmentIndex + 1) ready at \(outputURL.lastPathComponent).")
        } else {
            let message = "Recorder closed a segment but no output file was found."
            appendDiagnostic(message)
            onRecordingFailure?(message)
        }

        if boundary.isFinal {
            activeRecordingSession = nil
            localRecordingState = .idle
            resolvePendingRecordingStop()
            return
        }

        guard var nextSession = activeRecordingSession else {
            localRecordingState = .idle
            resolvePendingRecordingStop()
            return
        }

        nextSession.segmentIndex = boundary.segmentIndex + 1
        nextSession.segmentStartedAt = Date()
        activeRecordingSession = nextSession
        beginRecordingSegment()
    }

    private func handleRecorderError(_ error: IOStreamRecorder.Error) {
        cancelRecordingStopTimeout()
        let message = error.localizedDescription
        appendDiagnostic("Recorder error: \(message)")
        localRecordingState = .failed(message)
        activeRecordingSession = nil
        pendingRecordingBoundary = nil
        recordingRotationTimer?.invalidate()
        recordingRotationTimer = nil
        reportRecovery(
            stage: .pipelineRebuild,
            severity: .warning,
            summary: "Recording engine lỗi",
            detail: message,
            activeMitigations: ["Dừng segment hiện tại", "Chờ operator retry"],
            lastFatalReason: message
        )
        onRecordingFailure?(message)
        resolvePendingRecordingStop()
    }

    private func resolvePendingRecordingStop() {
        cancelRecordingStopTimeout()
        guard let continuation = pendingRecordingStopContinuation else { return }
        pendingRecordingStopContinuation = nil
        continuation.resume(returning: ())
    }

    private func startStatsTimer() {
        statsTimer?.invalidate()
        statsTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            self.refreshOverlayPerformanceMode()
            switch self.connectionState {
            case .live:
                self.stats.currentBitrate = self.stats.quality.videoBitrate
            case .connecting, .reconnecting(_):
                self.stats.currentBitrate = self.stats.quality.videoBitrate / 2
            default:
                self.stats.currentBitrate = 0
            }
        }
    }

    private func appendDiagnostic(_ message: String) {
        let timestamp = DateFormatter.liveDiagnostics.string(from: Date())
        diagnostics.insert("[\(timestamp)] \(message)", at: 0)
        diagnostics = Array(diagnostics.prefix(30))
    }

    @objc
    private func handleRTMPStatus(_ notification: Notification) {
        let event = Event.from(notification)
        guard
            let data = event.data as? ASObject,
            let code = data["code"] as? String
        else {
            return
        }

        switch code {
        case RTMPConnection.Code.connectSuccess.rawValue:
            clearLocalRTMPCloseSuppression()
            cancelPublishTimeout()
            appendDiagnostic("RTMP connected.")
            if let publishName = pendingPublishName {
                stream.publish(publishName)
                pendingPublishName = nil
                connectionState = .live
                resolvePendingStart(with: nil)
            } else {
                connectionState = currentCamera == nil ? .stopped : .previewReady
            }
            clearRecoveryIfNeeded()
        case RTMPConnection.Code.connectClosed.rawValue:
            if shouldIgnoreRTMPFailureAfterLocalClose() && pendingStartContinuation == nil {
                acknowledgeLocalRTMPCloseEvent()
                cancelPublishTimeout()
                appendDiagnostic("RTMP closed after local stop.")
                return
            }
            clearLocalRTMPCloseSuppression()
            cancelPublishTimeout()
            appendDiagnostic("RTMP closed.")
            currentDestination = nil
            connectionState = currentCamera == nil ? .stopped : .previewReady
            reportRecovery(
                stage: .pipelineRebuild,
                severity: .warning,
                summary: "RTMP đã đóng",
                detail: "Connection RTMP đóng trước khi phiên ổn định.",
                activeMitigations: ["Giữ preview", "Cho phép retry session"],
                lastFatalReason: "RTMP closed"
            )
            resolvePendingStart(with: LiveAPIError.server(statusCode: 0, message: "RTMP đã đóng trước khi publish."))
        case RTMPConnection.Code.connectRejected.rawValue:
            if shouldIgnoreRTMPFailureAfterLocalClose() && pendingStartContinuation == nil {
                acknowledgeLocalRTMPCloseEvent()
                cancelPublishTimeout()
                appendDiagnostic("RTMP reject ignored because session was already closing.")
                return
            }
            clearLocalRTMPCloseSuppression()
            cancelPublishTimeout()
            appendDiagnostic("RTMP rejected.")
            currentDestination = nil
            connectionState = .failed("RTMP bị từ chối.")
            reportRecovery(
                stage: .pipelineRebuild,
                severity: .critical,
                summary: "RTMP bị từ chối",
                detail: "Server RTMP từ chối phiên publish hiện tại.",
                activeMitigations: ["Đóng session cũ", "Xin live session mới"],
                lastFatalReason: "RTMP rejected"
            )
            resolvePendingStart(with: LiveAPIError.server(statusCode: 0, message: "RTMP bị từ chối."))
        default:
            if code.lowercased().contains("failed") {
                if shouldIgnoreRTMPFailureAfterLocalClose() && pendingStartContinuation == nil {
                    acknowledgeLocalRTMPCloseEvent()
                    cancelPublishTimeout()
                    appendDiagnostic("RTMP failure ignored because session was already closing.")
                    return
                }
                clearLocalRTMPCloseSuppression()
                cancelPublishTimeout()
                appendDiagnostic("RTMP failure: \(code)")
                currentDestination = nil
                connectionState = .failed(code)
                reportRecovery(
                    stage: .pipelineRebuild,
                    severity: .critical,
                    summary: "RTMP publish thất bại",
                    detail: code,
                    activeMitigations: ["Đóng session cũ", "Cho phép retry session"],
                    lastFatalReason: code
                )
                resolvePendingStart(with: LiveAPIError.server(statusCode: 0, message: code))
            } else if code.lowercased().contains("reconnect") {
                clearLocalRTMPCloseSuppression()
                appendDiagnostic("RTMP reconnecting: \(code)")
                connectionState = .reconnecting(code)
                reportRecovery(
                    stage: .pipelineRebuild,
                    severity: .warning,
                    summary: "RTMP đang reconnect",
                    detail: code,
                    activeMitigations: ["Giữ preview", "Chờ RTMP ổn định lại"]
                )
            }
        }
    }

    @objc
    private func handleRTMPError(_ notification: Notification) {
        if shouldIgnoreRTMPFailureAfterLocalClose() && pendingStartContinuation == nil {
            acknowledgeLocalRTMPCloseEvent()
            cancelPublishTimeout()
            appendDiagnostic("RTMP I/O error ignored because session was already closing.")
            return
        }
        clearLocalRTMPCloseSuppression()
        cancelPublishTimeout()
        appendDiagnostic("RTMP I/O error.")
        currentDestination = nil
        connectionState = .failed("RTMP I/O error")
        reportRecovery(
            stage: .pipelineRebuild,
            severity: .critical,
            summary: "RTMP I/O error",
            detail: "RTMP I/O error",
            activeMitigations: ["Đóng session cũ", "Cho phép retry session"],
            lastFatalReason: "RTMP I/O error"
        )
        resolvePendingStart(with: LiveAPIError.server(statusCode: 0, message: "RTMP I/O error"))
    }

    private func resolvePendingStart(with error: Error?) {
        guard let continuation = pendingStartContinuation else { return }
        pendingStartContinuation = nil
        if let error {
            continuation.resume(throwing: error)
        } else {
            continuation.resume(returning: ())
        }
    }

    private func maxSeverity(_ lhs: RecoverySeverity, _ rhs: RecoverySeverity) -> RecoverySeverity {
        switch (lhs, rhs) {
        case (.critical, _), (_, .critical):
            return .critical
        case (.warning, _), (_, .warning):
            return .warning
        default:
            return .info
        }
    }

    private static func nowMs() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }
}

struct LivePreviewSurface: UIViewRepresentable {
    @ObservedObject var service: LiveStreamingService

    func makeUIView(context: Context) -> LivePreviewContainerView {
        let view = LivePreviewContainerView()
        service.attachPreviewView(view.previewView)
        return view
    }

    func updateUIView(_ uiView: LivePreviewContainerView, context: Context) {
        service.attachPreviewView(uiView.previewView)
    }

    static func dismantleUIView(_ uiView: LivePreviewContainerView, coordinator: ()) {
        uiView.previewView.attachStream(nil)
    }
}

final class LivePreviewContainerView: UIView {
    let previewView = MTHKView(frame: .zero)

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        previewView.translatesAutoresizingMaskIntoConstraints = false
        previewView.videoGravity = .resizeAspectFill
        addSubview(previewView)
        NSLayoutConstraint.activate([
            previewView.topAnchor.constraint(equalTo: topAnchor),
            previewView.leadingAnchor.constraint(equalTo: leadingAnchor),
            previewView.trailingAnchor.constraint(equalTo: trailingAnchor),
            previewView.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        return nil
    }
}

private struct ActiveLocalRecordingSession {
    let recordingId: String
    let matchId: String
    var segmentIndex: Int
    var segmentStartedAt: Date
    let segmentDuration: TimeInterval
}

private struct PendingRecordingBoundary {
    let recordingId: String
    let matchId: String
    let segmentIndex: Int
    let segmentStartedAt: Date
    let segmentFinishedAt: Date
    let isFinal: Bool
}

private final class StreamRecorderDelegateProxy: NSObject, IOStreamRecorderDelegate {
    var onFinishWriting: ((AVAssetWriter) -> Void)?
    var onError: ((IOStreamRecorder.Error) -> Void)?

    func recorder(_ recorder: IOStreamRecorder, finishWriting writer: AVAssetWriter) {
        onFinishWriting?(writer)
    }

    func recorder(_ recorder: IOStreamRecorder, errorOccured error: IOStreamRecorder.Error) {
        onError?(error)
    }
}

private final class LiveScoreboardVideoEffect: VideoEffect {
    private let renderer = LiveScoreboardOverlayRenderer()

    var onBrandingStatusChange: ((OverlayBrandingAssetStatus) -> Void)? {
        didSet {
            renderer.onBrandingStatusChange = onBrandingStatusChange
        }
    }

    func update(snapshot: LiveOverlaySnapshot?) {
        renderer.update(snapshot: snapshot)
    }

    func handleMemoryWarning() {
        renderer.handleMemoryWarning()
    }

    func setPerformanceMode(_ mode: OverlayPerformanceMode) {
        renderer.setPerformanceMode(mode)
    }

    override func execute(_ image: CIImage, info: CMSampleBuffer?) -> CIImage {
        guard let overlay = renderer.overlayImage(for: image.extent.size) else {
            return image
        }

        guard let filter = CIFilter(name: "CISourceOverCompositing") else {
            return image
        }

        filter.setValue(overlay, forKey: kCIInputImageKey)
        filter.setValue(image, forKey: kCIInputBackgroundImageKey)
        return filter.outputImage ?? image
    }
}

private struct OverlayBrandingAssetStatus: Equatable {
    var configuredCount: Int = 0
    var loadedCount: Int = 0
    var isLoading: Bool = false
    var lastError: String?

    var isReady: Bool {
        configuredCount == 0 || loadedCount >= configuredCount
    }
}

private enum OverlayPerformanceMode: Int {
    case normal = 0
    case constrained = 1
    case minimal = 2
    case disabled = 3

    var label: String {
        switch self {
        case .normal:
            return "normal"
        case .constrained:
            return "constrained"
        case .minimal:
            return "minimal"
        case .disabled:
            return "disabled"
        }
    }
}

private final class LiveScoreboardOverlayRenderer {
    private let lock = NSLock()
    private var snapshot: LiveOverlaySnapshot?
    private var cachedKey: String?
    private var cachedImage: CIImage?
    private var assetKey: String?
    private var tournamentLogoImage: UIImage?
    private var webLogoImage: UIImage?
    private var sponsorLogoImages: [UIImage] = []
    private var assetLoadTask: Task<Void, Never>?
    private var performanceMode: OverlayPerformanceMode = .normal

    private static let maxRemoteImageDataBytes = 4 * 1024 * 1024
    private static let downsampleMaxPixelSize: CGFloat = 320
    private static let remoteImageCache: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 12
        cache.totalCostLimit = 8 * 1024 * 1024
        return cache
    }()
    var onBrandingStatusChange: ((OverlayBrandingAssetStatus) -> Void)?

    deinit {
        assetLoadTask?.cancel()
    }

    func setPerformanceMode(_ mode: OverlayPerformanceMode) {
        lock.lock()
        let changed = performanceMode != mode
        performanceMode = mode
        cachedKey = nil
        cachedImage = nil
        if mode.rawValue >= OverlayPerformanceMode.minimal.rawValue {
            tournamentLogoImage = nil
            webLogoImage = nil
            sponsorLogoImages = []
            assetLoadTask?.cancel()
            assetLoadTask = nil
        }
        lock.unlock()

        if changed, let snapshot {
            update(snapshot: snapshot)
        }
    }

    func update(snapshot: LiveOverlaySnapshot?) {
        let nextAssetKey = Self.assetKey(snapshot: snapshot)
        var shouldLoadAssets = false
        var snapshotForAssets: LiveOverlaySnapshot?
        let configuredAssetCount = Self.configuredAssetCount(for: snapshot)
        var loadedAssetCount = 0
        var loadingAssets = false
        var performanceMode = OverlayPerformanceMode.normal

        lock.lock()
        performanceMode = self.performanceMode
        self.snapshot = snapshot
        cachedKey = nil
        cachedImage = nil
        if snapshot == nil {
            assetKey = nil
            tournamentLogoImage = nil
            webLogoImage = nil
            sponsorLogoImages = []
            assetLoadTask?.cancel()
            assetLoadTask = nil
            lock.unlock()
            notifyBrandingStatus(OverlayBrandingAssetStatus())
            return
        }

        if assetKey != nextAssetKey {
            assetKey = nextAssetKey
            tournamentLogoImage = nil
            webLogoImage = nil
            sponsorLogoImages = []
            assetLoadTask?.cancel()
            assetLoadTask = nil
            shouldLoadAssets = !nextAssetKey.isEmpty && performanceMode.rawValue < OverlayPerformanceMode.minimal.rawValue
            if performanceMode.rawValue < OverlayPerformanceMode.minimal.rawValue {
                snapshotForAssets = snapshot
            }
        } else {
            loadedAssetCount = (tournamentLogoImage == nil ? 0 : 1)
                + (webLogoImage == nil ? 0 : 1)
                + sponsorLogoImages.count
            loadingAssets = assetLoadTask != nil
        }
        lock.unlock()

        if !shouldLoadAssets {
            notifyBrandingStatus(
                OverlayBrandingAssetStatus(
                    configuredCount: configuredAssetCount,
                    loadedCount: loadedAssetCount,
                    isLoading: loadingAssets,
                    lastError: !loadingAssets && configuredAssetCount > 0 && loadedAssetCount < configuredAssetCount
                        ? "Một phần branding assets chưa tải được"
                        : nil
                )
            )
            return
        }

        guard let snapshotForAssets else { return }

        notifyBrandingStatus(
            OverlayBrandingAssetStatus(
                configuredCount: configuredAssetCount,
                loadedCount: 0,
                isLoading: true,
                lastError: nil
            )
        )

        let task = Task<Void, Never>(priority: .utility) { [weak self] in
            guard let self else { return }
            await self.loadAssets(for: snapshotForAssets, assetKey: nextAssetKey)
        }

        lock.lock()
        if assetKey == nextAssetKey {
            assetLoadTask = task
            lock.unlock()
        } else {
            lock.unlock()
            task.cancel()
        }
    }

    func overlayImage(for size: CGSize) -> CIImage? {
        guard size.width > 0, size.height > 0 else { return nil }

        let snapshot: LiveOverlaySnapshot?
        let cacheKey: String
        let renderSize: CGSize
        let tournamentLogoImage: UIImage?
        let webLogoImage: UIImage?
        let sponsorLogoImages: [UIImage]
        let performanceMode: OverlayPerformanceMode

        lock.lock()
        snapshot = self.snapshot
        performanceMode = self.performanceMode
        renderSize = Self.normalizedRenderSize(for: size, mode: performanceMode)
        cacheKey = Self.cacheKey(snapshot: self.snapshot, size: renderSize, mode: performanceMode)
        tournamentLogoImage = self.tournamentLogoImage
        webLogoImage = self.webLogoImage
        sponsorLogoImages = self.sponsorLogoImages
        if cacheKey == cachedKey, let cachedImage {
            lock.unlock()
            return cachedImage
        }
        lock.unlock()

        guard performanceMode != .disabled else { return nil }
        guard renderSize.width > 0, renderSize.height > 0 else { return nil }
        guard let snapshot else { return nil }
        guard var rendered = Self.render(
            snapshot: snapshot,
            size: renderSize,
            tournamentLogoImage: tournamentLogoImage,
            webLogoImage: webLogoImage,
            sponsorLogoImages: sponsorLogoImages,
            performanceMode: performanceMode
        )
        else {
            return nil
        }

        if renderSize != size {
            let scaleX = size.width / renderSize.width
            let scaleY = size.height / renderSize.height
            rendered = rendered.transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))
        }

        lock.lock()
        cachedKey = cacheKey
        cachedImage = rendered
        lock.unlock()
        return rendered
    }

    func handleMemoryWarning() {
        lock.lock()
        cachedKey = nil
        cachedImage = nil
        tournamentLogoImage = nil
        webLogoImage = nil
        sponsorLogoImages = []
        assetLoadTask?.cancel()
        assetLoadTask = nil
        lock.unlock()
        Self.remoteImageCache.removeAllObjects()
    }

    private static func cacheKey(snapshot: LiveOverlaySnapshot?, size: CGSize, mode: OverlayPerformanceMode) -> String {
        let setKey = (snapshot?.sets ?? [])
            .map { "\($0.index):\($0.a ?? 0)-\($0.b ?? 0)" }
            .joined(separator: ";")
        let sponsorKey = (snapshot?.sponsorLogoURLs ?? [])
            .compactMap { $0.trimmedNilIfBlank }
            .joined(separator: ",")

        return [
            snapshot?.tournamentName,
            snapshot?.courtName,
            snapshot?.teamAName,
            snapshot?.teamBName,
            snapshot?.scoreA.map(String.init),
            snapshot?.scoreB.map(String.init),
            snapshot?.serveSide,
            snapshot?.phaseText,
            snapshot?.roundLabel,
            assetKey(snapshot: snapshot),
            mode.label,
            snapshot?.webLogoURL?.trimmedNilIfBlank,
            sponsorKey.isEmpty ? nil : sponsorKey,
            setKey.isEmpty ? nil : setKey,
            "\(Int(size.width))x\(Int(size.height))"
        ]
        .compactMap { $0 }
        .joined(separator: "|")
    }

    private static func assetKey(snapshot: LiveOverlaySnapshot?) -> String {
        let sponsorKey = (snapshot?.sponsorLogoURLs ?? [])
            .compactMap { $0.trimmedNilIfBlank }
            .joined(separator: ",")

        return [
            snapshot?.tournamentLogoURL?.trimmedNilIfBlank,
            snapshot?.webLogoURL?.trimmedNilIfBlank,
            sponsorKey.isEmpty ? nil : sponsorKey
        ]
        .compactMap { $0 }
        .joined(separator: "|")
    }

    private func loadAssets(for snapshot: LiveOverlaySnapshot, assetKey: String) async {
        let mode: OverlayPerformanceMode
        lock.lock()
        mode = performanceMode
        lock.unlock()

        guard mode.rawValue < OverlayPerformanceMode.minimal.rawValue else {
            notifyBrandingStatus(
                OverlayBrandingAssetStatus(
                    configuredCount: Self.configuredAssetCount(for: snapshot),
                    loadedCount: 0,
                    isLoading: false,
                    lastError: "Branding assets skipped in fail-soft mode"
                )
            )
            return
        }

        async let tournamentLogoTask = Self.loadRemoteImage(from: snapshot.tournamentLogoURL)
        async let webLogoTask = Self.loadRemoteImage(from: snapshot.webLogoURL)

        let sponsorLimit = mode == .constrained ? 1 : 3
        let sponsorURLs = Array((snapshot.sponsorLogoURLs ?? []).compactMap { $0.trimmedNilIfBlank }.prefix(sponsorLimit))
        var sponsorImages: [UIImage] = []
        for sponsorURL in sponsorURLs {
            guard !Task.isCancelled else { return }
            if let image = await Self.loadRemoteImage(from: sponsorURL) {
                sponsorImages.append(image)
            }
        }

        let tournamentLogoImage = await tournamentLogoTask
        let webLogoImage = await webLogoTask
        guard !Task.isCancelled else { return }
        let configuredCount = Self.configuredAssetCount(for: snapshot)
        let loadedCount = (tournamentLogoImage == nil ? 0 : 1)
            + (webLogoImage == nil ? 0 : 1)
            + sponsorImages.count
        let lastError =
            configuredCount > 0 && loadedCount < configuredCount
            ? "Một phần branding assets chưa tải được"
            : nil

        lock.lock()
        guard self.assetKey == assetKey else {
            lock.unlock()
            return
        }
        self.tournamentLogoImage = tournamentLogoImage
        self.webLogoImage = webLogoImage
        self.sponsorLogoImages = sponsorImages
        self.cachedKey = nil
        self.cachedImage = nil
        self.assetLoadTask = nil
        lock.unlock()

        notifyBrandingStatus(
            OverlayBrandingAssetStatus(
                configuredCount: configuredCount,
                loadedCount: loadedCount,
                isLoading: false,
                lastError: lastError
            )
        )
    }

    private static func configuredAssetCount(for snapshot: LiveOverlaySnapshot?) -> Int {
        guard let snapshot else { return 0 }
        let sponsorCount = Array((snapshot.sponsorLogoURLs ?? []).compactMap { $0.trimmedNilIfBlank }.prefix(3)).count
        let baseCount = [
            snapshot.tournamentLogoURL?.trimmedNilIfBlank,
            snapshot.webLogoURL?.trimmedNilIfBlank
        ]
        .compactMap { $0 }
        .count
        return baseCount + sponsorCount
    }

    private func notifyBrandingStatus(_ status: OverlayBrandingAssetStatus) {
        onBrandingStatusChange?(status)
    }

    private static func loadRemoteImage(from rawURL: String?) async -> UIImage? {
        guard let urlString = rawURL?.trimmedNilIfBlank else { return nil }
        let cacheKey = NSString(string: urlString)
        if let cached = remoteImageCache.object(forKey: cacheKey) {
            return cached
        }

        guard let url = URL(string: urlString) else { return nil }

        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let httpResponse = response as? HTTPURLResponse, (200 ..< 300).contains(httpResponse.statusCode) else {
                return nil
            }
            guard data.count <= maxRemoteImageDataBytes else { return nil }
            guard let image = downsampledImage(data: data, maxPixelSize: downsampleMaxPixelSize) else { return nil }
            remoteImageCache.setObject(image, forKey: cacheKey, cost: imageMemoryCost(image))
            return image
        } catch {
            return nil
        }
    }

    private static func downsampledImage(data: Data, maxPixelSize: CGFloat) -> UIImage? {
        let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let imageSource = CGImageSourceCreateWithData(data as CFData, sourceOptions) else {
            return nil
        }

        let thumbnailOptions: CFDictionary = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize
        ] as CFDictionary

        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(imageSource, 0, thumbnailOptions) else {
            return nil
        }

        return UIImage(cgImage: cgImage)
    }

    private static func imageMemoryCost(_ image: UIImage) -> Int {
        let pixelWidth = Int((image.size.width * image.scale).rounded(.up))
        let pixelHeight = Int((image.size.height * image.scale).rounded(.up))
        return max(pixelWidth * pixelHeight * 4, 1)
    }

    private static func normalizedRenderSize(for size: CGSize, mode: OverlayPerformanceMode) -> CGSize {
        let maxDimension: CGFloat
        switch mode {
        case .normal:
            maxDimension = 1440
        case .constrained:
            maxDimension = 1080
        case .minimal:
            maxDimension = 720
        case .disabled:
            maxDimension = 0
        }

        guard maxDimension > 0 else { return .zero }
        let largestSide = max(size.width, size.height)
        let scale = largestSide > maxDimension ? maxDimension / largestSide : 1
        let width = max(CGFloat(320), (size.width * scale / 16).rounded(.up) * 16)
        let height = max(CGFloat(180), (size.height * scale / 16).rounded(.up) * 16)
        return CGSize(width: width, height: height)
    }

    private static func render(
        snapshot: LiveOverlaySnapshot,
        size: CGSize,
        tournamentLogoImage: UIImage?,
        webLogoImage: UIImage?,
        sponsorLogoImages: [UIImage],
        performanceMode: OverlayPerformanceMode
    ) -> CIImage? {
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = false
        let shouldRenderLogos = performanceMode.rawValue < OverlayPerformanceMode.minimal.rawValue
        let visibleSponsorImages = Array(sponsorLogoImages.prefix(performanceMode == .constrained ? 1 : 2))

        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        let image = autoreleasepool { () -> UIImage in
            return renderer.image { context in
                let cg = context.cgContext
                cg.setFillColor(UIColor.clear.cgColor)
                cg.fill(CGRect(origin: .zero, size: size))

                let cardWidth = min(size.width * 0.42, 620)
                let cardHeight = min(size.height * 0.26, 230)
                let cardRect = CGRect(x: size.width * 0.04, y: size.height * 0.05, width: cardWidth, height: cardHeight)

                let background = UIBezierPath(roundedRect: cardRect, cornerRadius: 28)
                UIColor(red: 0.05, green: 0.09, blue: 0.14, alpha: 0.82).setFill()
                background.fill()

                UIColor.white.withAlphaComponent(0.10).setStroke()
                background.lineWidth = 2
                background.stroke()

            let contentRect = cardRect.insetBy(dx: 20, dy: 18)
            let smallTextAttributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: 15, weight: .semibold),
                .foregroundColor: UIColor.white.withAlphaComponent(0.72)
            ]
            let strongTextAttributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: 24, weight: .heavy),
                .foregroundColor: UIColor.white
            ]
            let teamTextAttributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: 22, weight: .bold),
                .foregroundColor: UIColor.white
            ]
            let scoreATextAttributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.monospacedDigitSystemFont(ofSize: 58, weight: .black),
                .foregroundColor: UIColor(red: 0.77, green: 0.90, blue: 0.44, alpha: 1)
            ]
            let scoreBTextAttributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.monospacedDigitSystemFont(ofSize: 58, weight: .black),
                .foregroundColor: UIColor(red: 0.42, green: 0.82, blue: 0.98, alpha: 1)
            ]

            let tournamentLogoRect = CGRect(x: contentRect.minX, y: contentRect.minY, width: 42, height: 42)
            let hasTournamentLogo = shouldRenderLogos && tournamentLogoImage != nil
            if shouldRenderLogos, let tournamentLogoImage {
                drawLogo(tournamentLogoImage, in: tournamentLogoRect, context: cg)
            }

            let titleX = hasTournamentLogo ? tournamentLogoRect.maxX + 12 : contentRect.minX
            let titleWidth = contentRect.maxX - titleX - 52

            NSString(string: snapshot.tournamentName?.trimmedNilIfBlank ?? "PickleTour").draw(
                in: CGRect(x: titleX, y: contentRect.minY, width: titleWidth, height: 20),
                withAttributes: smallTextAttributes
            )

            NSString(string: snapshot.courtName?.trimmedNilIfBlank ?? "Court").draw(
                in: CGRect(x: titleX, y: contentRect.minY + 22, width: titleWidth, height: 30),
                withAttributes: strongTextAttributes
            )

            if shouldRenderLogos, let webLogoImage {
                drawLogo(
                    webLogoImage,
                    in: CGRect(x: cardRect.maxX - 60, y: contentRect.minY, width: 40, height: 40),
                    context: cg
                )
            }

            let scoreboardTop = contentRect.minY + 66
            let leftColumn = CGRect(x: contentRect.minX, y: scoreboardTop, width: contentRect.width * 0.5 - 8, height: 100)
            let rightColumn = CGRect(x: contentRect.midX + 8, y: scoreboardTop, width: contentRect.width * 0.5 - 8, height: 100)

            NSString(string: snapshot.teamAName?.trimmedNilIfBlank ?? "Đội A").draw(
                in: CGRect(x: leftColumn.minX, y: leftColumn.minY, width: leftColumn.width, height: 26),
                withAttributes: teamTextAttributes
            )
            NSString(string: "\(snapshot.scoreA ?? 0)").draw(
                in: CGRect(x: leftColumn.minX, y: leftColumn.minY + 26, width: leftColumn.width, height: 64),
                withAttributes: scoreATextAttributes
            )

            NSString(string: snapshot.teamBName?.trimmedNilIfBlank ?? "Đội B").draw(
                in: CGRect(x: rightColumn.minX, y: rightColumn.minY, width: rightColumn.width, height: 26),
                withAttributes: teamTextAttributes
            )
            NSString(string: "\(snapshot.scoreB ?? 0)").draw(
                in: CGRect(x: rightColumn.minX, y: rightColumn.minY + 26, width: rightColumn.width, height: 64),
                withAttributes: scoreBTextAttributes
            )

            let footer = [
                snapshot.phaseText?.trimmedNilIfBlank,
                snapshot.roundLabel?.trimmedNilIfBlank,
                snapshot.serveSide?.trimmedNilIfBlank.map { "Giao bóng: \($0)" }
            ]
            .compactMap { $0 }
            .joined(separator: " | ")

            if !footer.isEmpty {
                NSString(string: footer).draw(
                    in: CGRect(x: contentRect.minX, y: cardRect.maxY - 38, width: contentRect.width, height: 20),
                    withAttributes: smallTextAttributes
                )
            }

            if let sets = snapshot.sets, !sets.isEmpty {
                let setSummary = sets
                    .prefix(3)
                    .map { "S\($0.index + 1) \($0.a ?? 0)-\($0.b ?? 0)" }
                    .joined(separator: " | ")

                NSString(string: setSummary).draw(
                    in: CGRect(x: contentRect.minX, y: cardRect.maxY - 62, width: contentRect.width, height: 18),
                    withAttributes: smallTextAttributes
                )
            }

            if shouldRenderLogos, !visibleSponsorImages.isEmpty {
                let sponsorRects = visibleSponsorImages.enumerated().map { index, _ in
                    CGRect(
                        x: cardRect.maxX - CGFloat((visibleSponsorImages.count - index)) * 42 - 18,
                        y: cardRect.maxY - 80,
                        width: 34,
                        height: 34
                    )
                }

                for (index, sponsorLogoImage) in visibleSponsorImages.enumerated() {
                    drawLogo(sponsorLogoImage, in: sponsorRects[index], context: cg, inset: 4)
                }
            }

            let brandingBits = [
                shouldRenderLogos
                    ? (webLogoImage != nil ? "WEB" : snapshot.webLogoURL?.trimmedNilIfBlank.map { _ in "WEB..." })
                    : nil,
                shouldRenderLogos
                    ? (!visibleSponsorImages.isEmpty
                        ? "SPONSOR x\(visibleSponsorImages.count)"
                        : (snapshot.sponsorLogoURLs?.isEmpty == false ? "SPONSOR..." : nil))
                    : nil
            ]
            .compactMap { $0 }
            .joined(separator: " | ")

            if !brandingBits.isEmpty {
                let badgeRect = CGRect(
                    x: cardRect.maxX - 164,
                    y: cardRect.maxY - 46,
                    width: 144,
                    height: 26
                )
                let badgePath = UIBezierPath(roundedRect: badgeRect, cornerRadius: 12)
                UIColor(red: 0.12, green: 0.19, blue: 0.25, alpha: 0.92).setFill()
                badgePath.fill()
                UIColor.white.withAlphaComponent(0.16).setStroke()
                badgePath.lineWidth = 1
                badgePath.stroke()

                let brandingAttributes: [NSAttributedString.Key: Any] = [
                    .font: UIFont.systemFont(ofSize: 12, weight: .bold),
                    .foregroundColor: UIColor.white.withAlphaComponent(0.84)
                ]

                NSString(string: brandingBits).draw(
                    in: badgeRect.insetBy(dx: 10, dy: 6),
                    withAttributes: brandingAttributes
                )
            }
        }
    }

        return CIImage(image: image)
    }

    private static func drawLogo(
        _ image: UIImage,
        in rect: CGRect,
        context: CGContext,
        inset: CGFloat = 5
    ) {
        let containerPath = UIBezierPath(roundedRect: rect, cornerRadius: min(rect.width, rect.height) * 0.24)
        UIColor.white.withAlphaComponent(0.10).setFill()
        containerPath.fill()
        UIColor.white.withAlphaComponent(0.16).setStroke()
        containerPath.lineWidth = 1
        containerPath.stroke()

        context.saveGState()
        containerPath.addClip()
        let fittedRect = aspectFitRect(for: image.size, in: rect.insetBy(dx: inset, dy: inset))
        image.draw(in: fittedRect)
        context.restoreGState()
    }

    private static func aspectFitRect(for imageSize: CGSize, in bounds: CGRect) -> CGRect {
        guard imageSize.width > 0, imageSize.height > 0, bounds.width > 0, bounds.height > 0 else {
            return bounds
        }

        let scale = min(bounds.width / imageSize.width, bounds.height / imageSize.height)
        let width = imageSize.width * scale
        let height = imageSize.height * scale
        return CGRect(
            x: bounds.midX - width / 2,
            y: bounds.midY - height / 2,
            width: width,
            height: height
        )
    }
}

private extension AVCaptureDevice {
    static func requestAccessIfNeeded(for mediaType: AVMediaType) async -> Bool {
        switch authorizationStatus(for: mediaType) {
        case .authorized:
            return true
        case .notDetermined:
            return await AVCaptureDevice.requestAccess(for: mediaType)
        default:
            return false
        }
    }
}

private extension DateFormatter {
    static let liveDiagnostics: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter
    }()
}
