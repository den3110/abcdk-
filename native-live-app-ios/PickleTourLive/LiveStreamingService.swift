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

    @Published var mlpOverlay: MlpOverlay? {
        didSet {
            overlayEffect.update(mlpOverlay: mlpOverlay)
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

    static var cameraAuthorizationStatus: AVAuthorizationStatus {
        AVCaptureDevice.authorizationStatus(for: .video)
    }

    static var microphonePermissionGranted: Bool {
        AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
    }

    static var microphoneAuthorizationStatus: AVAuthorizationStatus {
        AVCaptureDevice.authorizationStatus(for: .audio)
    }

    static var cameraDeviceAvailable: Bool {
        AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) != nil
            || AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) != nil
    }

    static var microphoneDeviceAvailable: Bool {
        AVCaptureDevice.default(for: .audio) != nil
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
    private var orientationMode: DeviceOrientationMode = .auto
    private var currentVideoOrientation: AVCaptureVideoOrientation = .portrait
    private let microphoneTrack: UInt8 = 0
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
    private var recorderEmptySegmentStrikes = 0
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
        stream.addEventListener(.rtmpStatus, selector: #selector(handleRTMPStatus(_:)), observer: self)
        UIDevice.current.beginGeneratingDeviceOrientationNotifications()

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
        notificationObservers.append(
            NotificationCenter.default.addObserver(
                forName: UIDevice.orientationDidChangeNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                Task { @MainActor [weak self] in
                    self?.syncVideoOrientation()
                }
            }
        )

        recorder.delegate = recorderProxy
        stream.addObserver(recorder)
        registerOverlayEffectIfNeeded()
        syncVideoOrientation(force: true)
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
        // CADisplayLink (RunLoop.main) giữ mạnh choreographer → phải dừng Screen khi huỷ,
        // nếu không loop tiếp tục tick với delegate nil tới khi process thoát.
        stream.screen.stopRunning()
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
            syncVideoOrientation(force: true)
            registerOverlayEffectIfNeeded()
            // Bắt buộc sau khi bật offscreen (applyQuality): khởi động render loop của Screen
            // để effect overlay thực sự được chạy trên từng frame. Đặt TRƯỚC nhánh reuse camera
            // bên dưới để cả hai đường (dựng mới / dùng lại preview) đều có loop chạy.
            ensureOffscreenScreenRunning()

            attachMicrophoneIfNeeded()

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
        // Dừng DisplayLink của Screen offscreen khi thả preview (tránh render loop chạy nền).
        stream.screen.stopRunning()
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
        recorderEmptySegmentStrikes = 0
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
            // Sau stopPreview (đã stopRunning) mà đổi camera trước preparePreview kế tiếp thì
            // frame được enqueue vào Screen nhưng không ai render → đen. Bật lại loop (idempotent).
            ensureOffscreenScreenRunning()
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
        applyMicrophoneMuteState()
    }

    private func applyMicrophoneMuteState() {
        var mixerSettings = stream.audioMixerSettings
        mixerSettings.isMuted = !stats.micEnabled

        var trackSettings = mixerSettings.tracks[microphoneTrack] ?? .default
        trackSettings.isMuted = !stats.micEnabled
        mixerSettings.tracks[microphoneTrack] = trackSettings

        stream.audioMixerSettings = mixerSettings
        appendDiagnostic(stats.micEnabled ? "Microphone unmuted." : "Microphone muted.")
    }

    private func attachMicrophoneIfNeeded() {
        guard Self.microphonePermissionGranted else {
            stats.micEnabled = false
            applyMicrophoneMuteState()
            return
        }
        guard let microphone = AVCaptureDevice.default(for: .audio) else {
            stats.micEnabled = false
            applyMicrophoneMuteState()
            return
        }
        stream.attachAudio(microphone, track: microphoneTrack)
        applyMicrophoneMuteState()
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

        // ROOT CAUSE overlay không bao giờ hiện trên iOS: HaishinKit 1.9.x chỉ chạy
        // VideoEffect khi videoMixerSettings.mode == .offscreen (frame đi qua Screen →
        // VideoTrackScreenObject.makeImage → effect.execute). Mặc định là .passthrough:
        // IOVideoMixer.append đẩy thẳng frame ra output, effect đã registerVideoEffect
        // nhưng KHÔNG BAO GIỜ được gọi → không overlay/sponsor dù dữ liệu đúng.
        // Lưu ý: Screen.size chỉ là canvas offscreen (phải khớp hướng/aspect camera để không
        // viền đen); độ phân giải STREAM do videoSettings.videoSize quyết định — được đồng bộ
        // trong syncOffscreenScreenSize(). Không bật lại nếu fail-soft đã tắt overlay.
        if activeOverlayPerformanceMode != .disabled {
            setOffscreenPipelineEnabled(true)
        }
        stream.screen.frameRate = quality.frameRate
        syncOffscreenScreenSize()

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

        // 0 = HaishinKit tự lấy theo NGUỒN thật (sample rate/channels từ mixer, kích thước từ
        // frame) — đúng mặc định của thư viện. Ép cứng 44.1kHz trong khi mixer chạy 48kHz (log
        // IOAudioMixerTrack) làm AVAssetWriterInput audio tạo/append thất bại → thiếu input audio
        // → isReadyForStartWriting=false → writer không bao giờ .writing → mỗi lần xoay segment
        // báo failedToFinishWriting (IOStreamRecorder.Error error 3) + banner đỏ.
        recorder.settings = [
            .audio: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 0,
                AVNumberOfChannelsKey: 0
            ],
            .video: [
                AVVideoCodecKey: AVVideoCodecType.h264,
                AVVideoWidthKey: 0,
                AVVideoHeightKey: 0,
                AVVideoCompressionPropertiesKey: [
                    AVVideoAverageBitRateKey: quality.videoBitrate,
                    AVVideoMaxKeyFrameIntervalDurationKey: 2
                ]
            ]
        ]
    }

    func attachPreviewView(_ view: MTHKView) {
        previewViews.add(view)
        view.videoGravity = .resizeAspect // WYSIWYG: hiện trọn frame 16:9 (fill sẽ crop mất overlay ở lề như Android không bị)
        view.videoOrientation = currentVideoOrientation
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

    func updateOrientationMode(_ mode: DeviceOrientationMode) {
        orientationMode = mode
        syncVideoOrientation(force: true)
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
        syncVideoOrientation()
        for view in previewViews.allObjects {
            view.videoOrientation = currentVideoOrientation
            view.attachStream(stream)
        }
    }

    private func syncVideoOrientation(force: Bool = false) {
        guard let nextOrientation = resolvedVideoOrientation() else { return }
        guard force || currentVideoOrientation != nextOrientation else { return }

        currentVideoOrientation = nextOrientation
        stream.videoOrientation = nextOrientation
        // Screen offscreen phải đổi kích thước theo hướng mới (portrait ↔ landscape).
        syncOffscreenScreenSize()

        for view in previewViews.allObjects {
            view.videoOrientation = nextOrientation
        }
    }

    private func resolvedVideoOrientation() -> AVCaptureVideoOrientation? {
        switch orientationMode {
        case .portrait:
            return .portrait
        case .landscape:
            return currentInterfaceVideoOrientation(allowPortraitFallback: false) ?? .landscapeRight
        case .auto:
            return currentInterfaceVideoOrientation(allowPortraitFallback: true)
                ?? DeviceUtil.videoOrientation(by: UIDevice.current.orientation)
                ?? currentVideoOrientation
        }
    }

    private func currentInterfaceVideoOrientation(allowPortraitFallback: Bool) -> AVCaptureVideoOrientation? {
        let interfaceOrientation = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first(where: { $0.activationState == .foregroundActive })?
            .interfaceOrientation

        guard let interfaceOrientation else {
            return allowPortraitFallback ? .portrait : nil
        }

        guard let videoOrientation = DeviceUtil.videoOrientation(by: interfaceOrientation) else {
            return allowPortraitFallback ? .portrait : nil
        }

        if !allowPortraitFallback, videoOrientation == .portrait {
            return nil
        }

        return videoOrientation
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
        // Fail-soft thật sự: .disabled phải tắt hẳn pipeline offscreen (về passthrough +
        // dừng DisplayLink) — chỉ null overlay CIImage thì chi phí render mỗi frame vẫn còn
        // nguyên đúng lúc thiết bị đang thiếu RAM. Rời .disabled thì bật lại.
        if nextMode == .disabled {
            setOffscreenPipelineEnabled(false)
        } else if previousMode == .disabled {
            setOffscreenPipelineEnabled(true)
        }

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
        guard cameraAllowed else {
            throw LiveAPIError.server(statusCode: 0, message: "Ứng dụng chưa có quyền camera.")
        }

        let micAllowed = await AVCaptureDevice.requestAccessIfNeeded(for: .audio)
        if !micAllowed {
            stats.micEnabled = false
            applyMicrophoneMuteState()
            appendDiagnostic("Microphone permission missing. Continuing preview without audio.")
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
                guard self.pendingStartContinuation != nil else { return }
                switch self.connectionState {
                case .connecting, .reconnecting:
                    break
                case .idle, .preparingPreview, .previewReady, .live, .stopped, .failed:
                    return
                }
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

    /// Kích thước canvas theo độ phân giải đã chọn VÀ hướng xoay hiện tại (portrait đảo w/h).
    /// Buffer camera tới đã được xoay theo stream.videoOrientation (portrait = 1080x1920).
    private func offscreenCanvasSize() -> CGSize {
        let resolution = stats.quality.resolution
        let isPortrait = currentVideoOrientation == .portrait || currentVideoOrientation == .portraitUpsideDown
        return isPortrait
            ? CGSize(width: CGFloat(resolution.height), height: CGFloat(resolution.width))
            : CGSize(width: CGFloat(resolution.width), height: CGFloat(resolution.height))
    }

    /// Đồng bộ 3 thứ theo cùng một kích thước có hướng:
    /// - Screen.size (canvas offscreen): VideoTrackScreenObject fit ảnh bằng .resizeAspect,
    ///   sai hướng/aspect sẽ bị viền đen.
    /// - videoSettings.videoSize: KÍCH THƯỚC ENCODER H264 (VTCompressionSession được tạo
    ///   từ đây, mặc định HaishinKit 854x480 — trước đây app chưa bao giờ set nên stream
    ///   "1080p" thực tế chỉ 854x480). Đổi videoSize sẽ tạo lại VT session (đúng ý).
    /// (recorder mp4 tự lấy kích thước theo frame nguồn — settings width/height = 0.)
    private func syncOffscreenScreenSize() {
        let size = offscreenCanvasSize()
        if stream.screen.size != size {
            stream.screen.size = size
        }
        var videoSettings = stream.videoSettings
        if videoSettings.videoSize != size {
            videoSettings.videoSize = size
            stream.videoSettings = videoSettings
        }
    }

    /// HaishinKit KHÔNG tự khởi động render loop (DisplayLinkChoreographer) của Screen.
    /// Ở chế độ offscreen, không startRunning thì Screen không bao giờ xuất frame →
    /// preview/RTMP đen. Idempotent (Screen.startRunning tự guard isRunning).
    /// Tôn trọng fail-soft: khi overlay đã bị tắt (.disabled) thì không bật lại pipeline.
    private func ensureOffscreenScreenRunning() {
        guard activeOverlayPerformanceMode != .disabled else { return }
        stream.screen.startRunning()
    }

    /// Bật/tắt toàn bộ pipeline offscreen. Tắt = về .passthrough + dừng DisplayLink để
    /// thực sự cắt chi phí (pool ARGB, readback CIContext mỗi frame trên main run loop)
    /// khi fail-soft .disabled; bật = .offscreen + chạy loop nếu đã có camera.
    private func setOffscreenPipelineEnabled(_ enabled: Bool) {
        var mixerSettings = stream.videoMixerSettings
        let target: IOVideoMixerSettings.Mode = enabled ? .offscreen : .passthrough
        if mixerSettings.mode != target {
            mixerSettings.mode = target
            stream.videoMixerSettings = mixerSettings
        }
        if enabled {
            if currentCamera != nil {
                stream.screen.startRunning()
            }
        } else {
            stream.screen.stopRunning()
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
        recorderEmptySegmentStrikes = 0
        guard let boundary = pendingRecordingBoundary else {
            resolvePendingRecordingStop()
            return
        }

        pendingRecordingBoundary = nil
        let outputURL = writer.outputURL
        let duration = max(0, boundary.segmentFinishedAt.timeIntervalSince(boundary.segmentStartedAt))
        let fileExists = FileManager.default.fileExists(atPath: outputURL.path)
        let fileSize = (try? outputURL.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0

        if fileExists && fileSize > 0 {
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
        } else if fileExists {
            appendDiagnostic("Dropped empty recording segment #\(boundary.segmentIndex + 1).")
            try? FileManager.default.removeItem(at: outputURL)
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

        // failedToFinishWriting = writer chưa từng vào .writing khi đóng segment (chưa nhận sample
        // nào, ví dụ input audio chưa có). Segment rỗng không phải lỗi nghiêm trọng: mở segment kế
        // tiếp (tối đa 2 lần liên tiếp) thay vì hạ cả ghi hình + banner đỏ giữa lúc đang live.
        if case .failedToFinishWriting = error, let boundary = pendingRecordingBoundary {
            pendingRecordingBoundary = nil
            if boundary.isFinal {
                appendDiagnostic("Segment cuối rỗng (writer chưa có sample) → kết thúc ghi hình êm.")
                activeRecordingSession = nil
                localRecordingState = .idle
                resolvePendingRecordingStop()
                return
            }
            if recorderEmptySegmentStrikes < 2, var nextSession = activeRecordingSession {
                recorderEmptySegmentStrikes += 1
                appendDiagnostic("Segment #\(boundary.segmentIndex + 1) rỗng (writer chưa có sample) → mở segment mới (\(recorderEmptySegmentStrikes)/2).")
                nextSession.segmentIndex = boundary.segmentIndex + 1
                nextSession.segmentStartedAt = Date()
                activeRecordingSession = nextSession
                beginRecordingSegment()
                return
            }
        }

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
    private nonisolated func handleRTMPStatus(_ notification: Notification) {
        // HaishinKit gọi listener này trên THREAD NỀN của nó. Class là @MainActor và tất cả
        // nhánh dưới đây mutate @Published (connectionState, diagnostics, recovery state…),
        // nên BẮT BUỘC nhảy về main actor. Nếu mutate thẳng trên thread nền sẽ dính
        // "Publishing changes from background threads is not allowed" → undefined behavior
        // → app đứng hình rồi crash (đúng lỗi user gặp sau khi RTMP "Connection is ready").
        let event = Event.from(notification)
        guard
            let data = event.data as? ASObject,
            let code = data["code"] as? String
        else {
            return
        }
        Task { @MainActor [weak self] in
            self?.processRTMPStatus(code: code)
        }
    }

    @MainActor
    private func processRTMPStatus(code: String) {
        switch code {
        case RTMPConnection.Code.connectSuccess.rawValue:
            clearLocalRTMPCloseSuppression()
            appendDiagnostic("RTMP connected.")
            if let publishName = pendingPublishName {
                stream.publish(publishName)
                pendingPublishName = nil
                appendDiagnostic("RTMP publish requested.")
                connectionState = .connecting
            } else {
                cancelPublishTimeout()
                connectionState = currentCamera == nil ? .stopped : .previewReady
                clearRecoveryIfNeeded()
            }
        case RTMPStream.Code.publishStart.rawValue:
            clearLocalRTMPCloseSuppression()
            cancelPublishTimeout()
            appendDiagnostic("RTMP publish started.")
            connectionState = .live
            resolvePendingStart(with: nil)
            clearRecoveryIfNeeded()
        case RTMPConnection.Code.connectClosed.rawValue,
            RTMPStream.Code.connectClosed.rawValue:
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
        case RTMPConnection.Code.connectRejected.rawValue,
            RTMPStream.Code.connectRejected.rawValue,
            RTMPStream.Code.publishBadName.rawValue:
            if shouldIgnoreRTMPFailureAfterLocalClose() && pendingStartContinuation == nil {
                acknowledgeLocalRTMPCloseEvent()
                cancelPublishTimeout()
                appendDiagnostic("RTMP reject ignored because session was already closing.")
                return
            }
            clearLocalRTMPCloseSuppression()
            cancelPublishTimeout()
            appendDiagnostic("RTMP rejected: \(code)")
            currentDestination = nil
            connectionState = .failed(code)
            reportRecovery(
                stage: .pipelineRebuild,
                severity: .critical,
                summary: "RTMP bị từ chối",
                detail: code,
                activeMitigations: ["Đóng session cũ", "Xin live session mới"],
                lastFatalReason: code
            )
            resolvePendingStart(with: LiveAPIError.server(statusCode: 0, message: code))
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
    private nonisolated func handleRTMPError(_ notification: Notification) {
        // Xem ghi chú ở handleRTMPStatus: phải nhảy về main actor trước khi mutate @Published.
        Task { @MainActor [weak self] in
            self?.processRTMPError()
        }
    }

    @MainActor
    private func processRTMPError() {
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
        previewView.videoGravity = .resizeAspect // WYSIWYG: hiện trọn frame 16:9 (fill sẽ crop mất overlay ở lề như Android không bị)
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

    func update(mlpOverlay: MlpOverlay?) {
        renderer.update(mlpOverlay: mlpOverlay)
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
        // CISourceOverCompositing trả về UNION extent (overlay scale theo size/renderSize có
        // sai số float → có thể lớn hơn input 1px). ScreenRendererByCPU.draw của HaishinKit
        // KHÔNG clip → ghi tràn buffer. Crop về đúng extent input để an toàn.
        return (filter.outputImage ?? image).cropped(to: image.extent)
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
    private var mlpOverlay: MlpOverlay?
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
        // 2 logo + tối đa 8 sponsor (Android MAX_SPONSORS) ở 320px ≈ 4MB → nới trần.
        cache.countLimit = 16
        cache.totalCostLimit = 12 * 1024 * 1024
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

    func update(mlpOverlay: MlpOverlay?) {
        lock.lock()
        self.mlpOverlay = mlpOverlay
        cachedKey = nil
        cachedImage = nil
        lock.unlock()
    }

    func overlayImage(for size: CGSize) -> CIImage? {
        guard size.width > 0, size.height > 0 else { return nil }

        let snapshot: LiveOverlaySnapshot?
        let mlp: MlpOverlay?
        let cacheKey: String
        let renderSize: CGSize
        let tournamentLogoImage: UIImage?
        let webLogoImage: UIImage?
        let sponsorLogoImages: [UIImage]
        let performanceMode: OverlayPerformanceMode

        lock.lock()
        snapshot = self.snapshot
        mlp = self.mlpOverlay
        performanceMode = self.performanceMode
        renderSize = Self.normalizedRenderSize(for: size, mode: performanceMode)
        cacheKey = Self.cacheKey(snapshot: self.snapshot, mlp: self.mlpOverlay, size: renderSize, mode: performanceMode)
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

        let renderedBase: CIImage?
        if let mlp {
            renderedBase = Self.renderMlp(
                mlp: mlp,
                size: renderSize,
                tournamentLogoImage: tournamentLogoImage,
                webLogoImage: webLogoImage,
                sponsorLogoImages: sponsorLogoImages,
                performanceMode: performanceMode
            )
        } else if let snapshot {
            renderedBase = Self.render(
                snapshot: snapshot,
                size: renderSize,
                tournamentLogoImage: tournamentLogoImage,
                webLogoImage: webLogoImage,
                sponsorLogoImages: sponsorLogoImages,
                performanceMode: performanceMode
            )
        } else {
            return nil
        }
        guard var rendered = renderedBase else { return nil }

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

    /// Trim, bỏ rỗng, khử trùng lặp giữ thứ tự (Android: trim / filter blank / distinct / take(8)).
    private static func distinctTrimmed(_ urls: [String]?) -> [String] {
        var seen = Set<String>()
        var result: [String] = []
        for url in urls ?? [] {
            guard let trimmed = url.trimmedNilIfBlank, !seen.contains(trimmed) else { continue }
            seen.insert(trimmed)
            result.append(trimmed)
        }
        return result
    }

    // Key cache phải chứa MỌI field renderer vẽ (theo layout Android): thiếu field nào thì
    // frame không vẽ lại khi field đó đổi.
    private static func cacheKey(snapshot: LiveOverlaySnapshot?, mlp: MlpOverlay?, size: CGSize, mode: OverlayPerformanceMode) -> String {
        let sponsorKey = distinctTrimmed(snapshot?.sponsorLogoURLs).joined(separator: ",")
        let mlpKey: String? = mlp.map { m in
            [
                "MLP", m.mode,
                m.tournament?.name, m.slot?.label,
                m.teamA?.color, m.teamB?.color,
                (m.teamA?.slotWins).map { String($0) },
                (m.teamB?.slotWins).map { String($0) },
                (m.isDreamBreaker ? m.dreamBreaker?.scoreA : m.score?.currentGameA).map { String($0) },
                (m.isDreamBreaker ? m.dreamBreaker?.scoreB : m.score?.currentGameB).map { String($0) },
                (m.dreamBreaker?.target).map { String($0) },
                m.teamA?.displayName, m.teamB?.displayName,
                (m.teamA?.players ?? []).map { $0.displayName }.joined(separator: "/"),
                (m.teamB?.players ?? []).map { $0.displayName }.joined(separator: "/"),
                m.teamA?.currentPlayer?.displayName,
                m.teamB?.currentPlayer?.displayName
            ].compactMap { $0 }.joined(separator: "~")
        }

        return [
            mlpKey,
            snapshot?.tournamentName,
            snapshot?.courtName,
            snapshot?.stageName,
            snapshot?.teamAName,
            snapshot?.teamBName,
            (snapshot?.scoreA).map { String($0) },
            (snapshot?.scoreB).map { String($0) },
            (snapshot?.seedA).map { String($0) },
            (snapshot?.seedB).map { String($0) },
            snapshot?.serveSide,
            (snapshot?.serveCount).map { String($0) },
            (snapshot?.isBreak).map { String($0) },
            snapshot?.breakNote,
            snapshot?.overlayNameStyle,
            assetKey(snapshot: snapshot),
            mode.label,
            sponsorKey.isEmpty ? nil : sponsorKey,
            "\(Int(size.width))x\(Int(size.height))"
        ]
        .compactMap { $0 }
        .joined(separator: "|")
    }

    private static func assetKey(snapshot: LiveOverlaySnapshot?) -> String {
        let sponsorKey = distinctTrimmed(snapshot?.sponsorLogoURLs).joined(separator: ",")

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

        // Android MAX_SPONSORS = 8 (trim / distinct / take 8); .constrained là fail-soft riêng iOS → 4.
        let sponsorLimit = mode == .constrained ? 4 : 8
        let sponsorURLs = Array(Self.distinctTrimmed(snapshot.sponsorLogoURLs).prefix(sponsorLimit))
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
        let sponsorCount = distinctTrimmed(snapshot.sponsorLogoURLs).prefix(8).count
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
        guard let rawTrimmed = rawURL?.trimmedNilIfBlank else { return nil }
        // ATS chặn http:// → logo giải, web logo, sponsor không tải được (log: "does not
        // conform to ATS policy" cho các URL http://pickletour.vn/uploads/...). Nâng
        // http→https (server đã phục vụ https) để branding/sponsor hiển thị như bản Android.
        let urlString = rawTrimmed.hasPrefix("http://")
            ? "https://" + rawTrimmed.dropFirst("http://".count)
            : rawTrimmed
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
        // Scale ĐỀU hai chiều, làm tròn chẵn — bỏ làm tròn bội 16 (gây lệch ~1% x/y khi CI
        // upscale về frame thật, làm layout Android-parity bị méo nhẹ).
        let scale = largestSide > maxDimension ? maxDimension / largestSide : 1
        let width = max(CGFloat(320), (size.width * scale / 2).rounded() * 2)
        let height = max(CGFloat(180), (size.height * scale / 2).rounded() * 2)
        return CGSize(width: width, height: height)
    }

    // MARK: - Overlay vẽ đúng thiết kế Android (native-live-app OverlayBitmapRenderer.kt)
    //
    // Hệ toạ độ: basis 1280x720 → uiScale = min(w/1280, h/720), margin = 16*uiScale (đúng công
    // thức Android). Card scoreboard được Android vẽ trong bitmap 520x160 rồi blit ở 0.75*uiScale
    // → card chiếm basis (16,16,390,120); mọi số đo dưới đây ĐÃ đổi sang basis (local*0.75).
    // Text: Android drawText đặt BASELINE → iOS vẽ tại origin.y = baseline - font.ascender.
    // Lớp vẽ theo thứ tự Android: card (normal/break/MLP) → logo box (góc phải trên) →
    // sponsor bar (góc phải dưới). Không có badge debug, không viền, không bóng.

    private struct OverlayLayout {
        let size: CGSize
        let uiScale: CGFloat
        let margin: CGFloat
        init(size: CGSize) {
            self.size = size
            uiScale = min(size.width / 1280, size.height / 720)
            margin = 16 * uiScale
        }
        var cardRect: CGRect { CGRect(x: margin, y: margin, width: 390 * uiScale, height: 120 * uiScale) }
    }

    private enum TextAlign { case left, center }

    // Màu đúng Android (ARGB)
    private static let colorScoreGreen = UIColor(red: 65 / 255, green: 147 / 255, blue: 93 / 255, alpha: 1)      // #41935D
    private static let colorDivider = UIColor(red: 1, green: 1, blue: 1, alpha: 77 / 255)                          // #4DFFFFFF
    private static let colorServeDot = UIColor(red: 34 / 255, green: 197 / 255, blue: 94 / 255, alpha: 1)        // #22C55E
    private static let colorLogoBoxBg = UIColor(red: 0, green: 0, blue: 0, alpha: 90 / 255)                       // #5A000000
    private static let colorBreakBg = UIColor(red: 26 / 255, green: 26 / 255, blue: 26 / 255, alpha: 230 / 255)   // #E61A1A1A
    private static let colorBreakSub = UIColor(red: 154 / 255, green: 164 / 255, blue: 175 / 255, alpha: 1)      // #9AA4AF
    private static let colorMlpSub = UIColor(red: 199 / 255, green: 206 / 255, blue: 214 / 255, alpha: 1)        // #C7CED6
    private static let colorMlpDbGold = UIColor(red: 245 / 255, green: 197 / 255, blue: 66 / 255, alpha: 1)      // #F5C542
    private static let colorMlpSeriesBg = UIColor(red: 30 / 255, green: 41 / 255, blue: 59 / 255, alpha: 1)      // #1E293B
    private static let colorMlpDbScoreBg = UIColor(red: 184 / 255, green: 134 / 255, blue: 11 / 255, alpha: 1)   // #B8860B
    private static let colorMlpTeamADefault = UIColor(red: 37 / 255, green: 194 / 255, blue: 160 / 255, alpha: 1) // #25C2A0
    private static let colorMlpTeamBDefault = UIColor(red: 96 / 255, green: 165 / 255, blue: 250 / 255, alpha: 1) // #60A5FA

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
        // Android: webLogoUrl ưu tiên, không có thì tournamentLogoUrl; chỉ vẽ ĐÚNG MỘT logo.
        let logoImage = shouldRenderLogos ? (webLogoImage ?? tournamentLogoImage) : nil
        let sponsorCap = performanceMode == .constrained ? 4 : 8
        let sponsors = shouldRenderLogos ? Array(sponsorLogoImages.prefix(sponsorCap)) : []

        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        let image = autoreleasepool { () -> UIImage in
            renderer.image { context in
                let cg = context.cgContext
                cg.clear(CGRect(origin: .zero, size: size))
                cg.interpolationQuality = .high
                let layout = OverlayLayout(size: size)
                if snapshot.isBreak == true {
                    drawBreakCard(snapshot, layout: layout, in: cg)
                } else {
                    drawNormalCard(snapshot, layout: layout, in: cg)
                }
                if let logoImage {
                    drawLogoBox(logoImage, layout: layout, in: cg)
                }
                if !sponsors.isEmpty {
                    drawSponsorBar(sponsors, layout: layout, in: cg)
                }
            }
        }
        return CIImage(image: image)
    }

    /// Scoreboard giải đồng đội MLP — sub-match (2v2) ↔ DreamBreaker, layout đúng Android.
    private static func renderMlp(
        mlp: MlpOverlay,
        size: CGSize,
        tournamentLogoImage: UIImage?,
        webLogoImage: UIImage?,
        sponsorLogoImages: [UIImage] = [],
        performanceMode: OverlayPerformanceMode = .normal
    ) -> CIImage? {
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = false
        let shouldRenderLogos = performanceMode.rawValue < OverlayPerformanceMode.minimal.rawValue
        let logoImage = shouldRenderLogos ? (webLogoImage ?? tournamentLogoImage) : nil
        let sponsorCap = performanceMode == .constrained ? 4 : 8
        let sponsors = shouldRenderLogos ? Array(sponsorLogoImages.prefix(sponsorCap)) : []

        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        let image = autoreleasepool { () -> UIImage in
            renderer.image { context in
                let cg = context.cgContext
                cg.clear(CGRect(origin: .zero, size: size))
                cg.interpolationQuality = .high
                let layout = OverlayLayout(size: size)
                drawMlpCard(mlp, layout: layout, in: cg)
                if let logoImage {
                    drawLogoBox(logoImage, layout: layout, in: cg)
                }
                if !sponsors.isEmpty {
                    drawSponsorBar(sponsors, layout: layout, in: cg)
                }
            }
        }
        return CIImage(image: image)
    }

    // MARK: Text helpers (đo bằng cùng font để fit và vẽ khớp nhau)

    private static func textWidth(_ text: String, _ font: UIFont) -> CGFloat {
        (text as NSString).size(withAttributes: [.font: font]).width
    }

    private static func drawText(
        _ text: String, font: UIFont, color: UIColor,
        x: CGFloat, baseline: CGFloat, align: TextAlign
    ) {
        let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
        let originX = align == .center ? x - textWidth(text, font) / 2 : x
        (text as NSString).draw(at: CGPoint(x: originX, y: baseline - font.ascender), withAttributes: attributes)
    }

    /// Android truncateText: cắt bớt ký tự tới khi vừa + "..." (3 dấu chấm ASCII).
    private static func truncateText(_ text: String, font: UIFont, maxWidth: CGFloat) -> String {
        if textWidth(text, font) <= maxWidth { return text }
        let ellipsis = "..."
        let ellipsisWidth = textWidth(ellipsis, font)
        var end = text.count
        while end > 0, textWidth(String(text.prefix(end)), font) + ellipsisWidth > maxWidth {
            end -= 1
        }
        if end == 0 { return text }
        return String(text.prefix(end)) + ellipsis
    }

    private static func fillRoundedBar(_ rect: CGRect, radius: CGFloat, roundTop: Bool, color: UIColor) {
        color.setFill()
        let corners: UIRectCorner = roundTop ? [.topLeft, .topRight] : [.bottomLeft, .bottomRight]
        UIBezierPath(roundedRect: rect, byRoundingCorners: corners, cornerRadii: CGSize(width: radius, height: radius)).fill()
    }

    // MARK: OverlayNameStyle.kt (port nguyên văn) — chỉ dùng cho card thường

    private static func normalizeTeamSeparator(_ raw: String) -> String {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        s = s.replacingOccurrences(of: #"\s*&\s*"#, with: " / ", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\s*/\s*"#, with: " / ", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\s{2,}"#, with: " ", options: .regularExpression)
        return s
    }

    private static func abbreviatePlayerName(_ value: String, aggressive: Bool) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let parts = trimmed.split(whereSeparator: { $0.isWhitespace }).map(String.init).filter { !$0.isEmpty }
        guard parts.count > 1 else { return trimmed }
        func initial(_ token: String) -> String {
            token.unicodeScalars.first.map { String($0).uppercased() } ?? ""
        }
        if !aggressive {
            return ([initial(parts[0])] + parts.dropFirst()).joined(separator: " ")
        }
        return parts.enumerated().map { index, token in
            index == parts.count - 1 ? token : initial(token)
        }.joined(separator: " ")
    }

    private static func abbreviateTeamName(_ base: String, aggressive: Bool) -> String {
        base.components(separatedBy: "/")
            .map { abbreviatePlayerName($0, aggressive: aggressive) }
            .joined(separator: " / ")
    }

    private static func overlayTeamNameCandidates(_ rawName: String, style: String?) -> [String] {
        let rawStyle = style?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "1"
        let normalizedStyle = ["1", "2", "3", "4"].contains(rawStyle) ? rawStyle : "1"
        let base = normalizeTeamSeparator(rawName)
        let firstTokenShort = abbreviateTeamName(base, aggressive: false)
        let compactShort = abbreviateTeamName(base, aggressive: true)
        let ordered: [String]
        switch normalizedStyle {
        case "2": ordered = [base]
        case "3": ordered = [firstTokenShort, compactShort, base]
        case "4": ordered = [compactShort, firstTokenShort, base]
        default: ordered = [base, firstTokenShort, compactShort]
        }
        var seen = Set<String>()
        var result: [String] = []
        for candidate in ordered {
            let trimmed = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty, !seen.contains(trimmed) else { continue }
            seen.insert(trimmed)
            result.append(trimmed)
        }
        return result
    }

    // Thang cỡ chữ (basis = local*0.75): primary [28,26,24,22,20,18], compact [26,...,14]
    private static let primaryNameLadder: [CGFloat] = [21, 19.5, 18, 16.5, 15, 13.5]
    private static let compactNameLadder: [CGFloat] = [19.5, 18, 16.5, 15, 13.5, 12, 10.5]

    private static func chooseFittedTeamName(_ raw: String, style: String?, maxWidth: CGFloat, uiScale: CGFloat) -> (text: String, sizeBasis: CGFloat) {
        let candidates = overlayTeamNameCandidates(raw, style: style)
        let normalizedStyle = style?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "1"
        for (index, candidate) in candidates.enumerated() {
            let ladder = (normalizedStyle == "2" || index == 0) ? primaryNameLadder : compactNameLadder
            for sizeBasis in ladder {
                let font = UIFont.systemFont(ofSize: sizeBasis * uiScale, weight: .bold)
                if textWidth(candidate, font) <= maxWidth { return (candidate, sizeBasis) }
            }
        }
        return (candidates.last ?? raw.trimmingCharacters(in: .whitespacesAndNewlines), 10.5)
    }

    // MARK: Card thường (drawV2Scoreboard)

    private static func drawNormalCard(_ s: LiveOverlaySnapshot, layout: OverlayLayout, in cg: CGContext) {
        let u = layout.uiScale
        let ox = layout.margin
        let oy = layout.margin
        cg.saveGState()
        cg.clip(to: layout.cardRect)

        // OP1-2: thanh trắng trên + tên giải (in hoa, cắt bớt)
        let barFont = UIFont.systemFont(ofSize: 16.5 * u, weight: .bold)
        fillRoundedBar(CGRect(x: ox, y: oy + 3 * u, width: 390 * u, height: 24 * u), radius: 6 * u, roundTop: true, color: .white)
        let title = truncateText((s.tournamentName?.trimmedNilIfBlank ?? "GIẢI PICKLETOUR BETA").uppercased(), font: barFont, maxWidth: 369 * u)
        drawText(title, font: barFont, color: .black, x: ox + 195 * u, baseline: oy + 20.5 * u, align: .center)

        // OP3: khối đen giữa (cách thanh trên 1.5 basis trong suốt)
        UIColor.black.setFill()
        cg.fill(CGRect(x: ox, y: oy + 28.5 * u, width: 390 * u, height: 63 * u))

        // OP4-9: hai hàng đội (seed → tên fit → chấm giao bóng)
        let serveSide = (s.serveSide ?? "A").trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let serveCount = s.serveCount ?? 1
        drawTeamRow(
            seed: s.seedA, name: s.teamAName?.trimmedNilIfBlank ?? "Team A", style: s.overlayNameStyle,
            serving: serveSide == "A", serveCount: serveCount,
            seedBaseline: oy + 53.5 * u, nameBaseline: oy + 55 * u, dotCenterY: oy + 48 * u,
            ox: ox, u: u, in: cg
        )
        drawTeamRow(
            seed: s.seedB, name: s.teamBName?.trimmedNilIfBlank ?? "Team B", style: s.overlayNameStyle,
            serving: serveSide == "B", serveCount: serveCount,
            seedBaseline: oy + 83.5 * u, nameBaseline: oy + 85 * u, dotCenterY: oy + 78 * u,
            ox: ox, u: u, in: cg
        )

        // OP10-13: cột điểm xanh (vẽ SAU hàng để đè phần tràn) + 2 điểm + vạch chia
        colorScoreGreen.setFill()
        cg.fill(CGRect(x: ox + 337.5 * u, y: oy + 28.5 * u, width: 52.5 * u, height: 63 * u))
        let scoreFont = UIFont.systemFont(ofSize: 31.5 * u, weight: .bold)
        drawText(String(s.scoreA ?? 0), font: scoreFont, color: .white, x: ox + 363.75 * u, baseline: oy + 58.5 * u, align: .center)
        colorDivider.setFill()
        cg.fill(CGRect(x: ox + 340.5 * u, y: oy + 59.625 * u, width: 46.5 * u, height: 0.75 * u))
        drawText(String(s.scoreB ?? 0), font: scoreFont, color: .white, x: ox + 363.75 * u, baseline: oy + 88.5 * u, align: .center)

        // OP14-15: thanh trắng dưới chỉ khi có stageName
        if let stage = s.stageName?.trimmedNilIfBlank {
            fillRoundedBar(CGRect(x: ox, y: oy + 93 * u, width: 390 * u, height: 24 * u), radius: 6 * u, roundTop: false, color: .white)
            let text = truncateText(stage.uppercased(), font: barFont, maxWidth: 369 * u)
            drawText(text, font: barFont, color: .black, x: ox + 195 * u, baseline: oy + 110.5 * u, align: .center)
        }
        cg.restoreGState()
    }

    private static func drawTeamRow(
        seed: Int?, name: String, style: String?, serving: Bool, serveCount: Int,
        seedBaseline: CGFloat, nameBaseline: CGFloat, dotCenterY: CGFloat,
        ox: CGFloat, u: CGFloat, in cg: CGContext
    ) {
        var cursorX = ox + 10.5 * u
        if let seed, seed > 0 {
            let seedFont = UIFont.systemFont(ofSize: 16.5 * u, weight: .regular)
            let seedText = String(seed)
            drawText(seedText, font: seedFont, color: .white, x: cursorX, baseline: seedBaseline, align: .left)
            cursorX += textWidth(seedText, seedFont) + 4.5 * u
        }
        // nameAreaW 337.5 (local 450) − vị trí con trỏ − dotArea 27 (local 36) − 7.5 (local 10)
        let maxWidth = 337.5 * u - (cursorX - ox) - 27 * u - 7.5 * u
        let fitted = chooseFittedTeamName(name, style: style, maxWidth: maxWidth, uiScale: u)
        let font = UIFont.systemFont(ofSize: fitted.sizeBasis * u, weight: .bold)
        let measured = textWidth(fitted.text, font)
        let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: UIColor.white]
        let origin = CGPoint(x: cursorX, y: nameBaseline - font.ascender)
        if measured > maxWidth, measured > 0 {
            // Android: bóp ngang quanh (x, baseline) khi vẫn không vừa, không bao giờ cắt "..."
            let scaleX = min(1, maxWidth / measured)
            cg.saveGState()
            cg.translateBy(x: cursorX, y: nameBaseline)
            cg.scaleBy(x: scaleX, y: 1)
            cg.translateBy(x: -cursorX, y: -nameBaseline)
            (fitted.text as NSString).draw(at: origin, withAttributes: attributes)
            cg.restoreGState()
        } else {
            (fitted.text as NSString).draw(at: origin, withAttributes: attributes)
        }
        if serving {
            colorServeDot.setFill()
            let r = 3.75 * u
            cg.fillEllipse(in: CGRect(x: ox + 310.5 * u - r, y: dotCenterY - r, width: 2 * r, height: 2 * r))
            if serveCount >= 2 {
                cg.fillEllipse(in: CGRect(x: ox + 321 * u - r, y: dotCenterY - r, width: 2 * r, height: 2 * r))
            }
        }
    }

    // MARK: Card tạm nghỉ (drawBreakCard)

    private static func drawBreakCard(_ s: LiveOverlaySnapshot, layout: OverlayLayout, in cg: CGContext) {
        let u = layout.uiScale
        let ox = layout.margin
        let oy = layout.margin
        cg.saveGState()
        cg.clip(to: layout.cardRect)

        colorBreakBg.setFill()
        UIBezierPath(roundedRect: layout.cardRect, cornerRadius: 6 * u).fill()

        let subFont = UIFont.systemFont(ofSize: 13.5 * u, weight: .regular)
        let x = ox + 12 * u
        var y: CGFloat = 18 // baseline cursor (basis)
        if let tournament = s.tournamentName?.trimmedNilIfBlank {
            drawText(tournament, font: subFont, color: colorBreakSub, x: x, baseline: oy + y * u, align: .left)
            y += 15
        }
        if let court = s.courtName?.trimmedNilIfBlank {
            drawText("Sân: " + court, font: subFont, color: colorBreakSub, x: x, baseline: oy + y * u, align: .left)
            y += 15
        }
        y += 3
        drawText("ĐANG TẠM NGHỈ", font: UIFont.systemFont(ofSize: 22.5 * u, weight: .bold), color: .white, x: x, baseline: oy + y * u, align: .left)
        y += 18
        drawText("Chờ trọng tài bắt đầu game tiếp theo...", font: subFont, color: colorBreakSub, x: x, baseline: oy + y * u, align: .left)
        y += 15
        if let note = s.breakNote?.trimmedNilIfBlank {
            drawText(note, font: subFont, color: colorBreakSub, x: x, baseline: oy + y * u, align: .left)
            y += 15
        }
        y += 3
        let teams = (s.teamAName?.trimmedNilIfBlank ?? "Team A") + " vs " + (s.teamBName?.trimmedNilIfBlank ?? "Team B")
        drawText(teams, font: UIFont.systemFont(ofSize: 15 * u, weight: .regular), color: .white, x: x, baseline: oy + y * u, align: .left)
        cg.restoreGState()
    }

    // MARK: Card MLP (drawMlpScoreboard)

    private static func drawMlpCard(_ mlp: MlpOverlay, layout: OverlayLayout, in cg: CGContext) {
        let u = layout.uiScale
        let ox = layout.margin
        let oy = layout.margin
        let isDb = mlp.isDreamBreaker
        cg.saveGState()
        cg.clip(to: layout.cardRect)

        // OP1-2: thanh trắng trên + tên giải
        let barFont = UIFont.systemFont(ofSize: 16.5 * u, weight: .bold)
        fillRoundedBar(CGRect(x: ox, y: oy + 3 * u, width: 390 * u, height: 24 * u), radius: 6 * u, roundTop: true, color: .white)
        let title = truncateText((mlp.tournament?.name?.trimmedNilIfBlank ?? "GIẢI MLP").uppercased(), font: barFont, maxWidth: 369 * u)
        drawText(title, font: barFont, color: .black, x: ox + 195 * u, baseline: oy + 20.5 * u, align: .center)

        // OP3: khối đen giữa (local 88)
        UIColor.black.setFill()
        cg.fill(CGRect(x: ox, y: oy + 28.5 * u, width: 390 * u, height: 66 * u))

        // OP4-9: hai hàng đội — vạch màu đội + tên + dòng phụ (VĐV)
        let nameFont = UIFont.systemFont(ofSize: 19.5 * u, weight: .bold)
        let subFont = UIFont.systemFont(ofSize: 12 * u, weight: .regular)
        let subColor = isDb ? colorMlpDbGold : colorMlpSub
        func subLine(_ team: MlpOverlayTeam?) -> String {
            if isDb {
                return team?.currentPlayer?.displayName.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            }
            return (team?.players ?? [])
                .map { $0.displayName.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
                .joined(separator: " / ")
        }
        func drawRow(_ team: MlpOverlayTeam?, accent: UIColor, barY: CGFloat, nameBaseline: CGFloat, subBaseline: CGFloat) {
            accent.setFill()
            cg.fill(CGRect(x: ox, y: oy + barY * u, width: 4.5 * u, height: 30 * u))
            let name = truncateText(team?.displayName.trimmedNilIfBlank ?? "Đội", font: nameFont, maxWidth: 285 * u)
            drawText(name, font: nameFont, color: .white, x: ox + 12 * u, baseline: oy + nameBaseline * u, align: .left)
            let sub = subLine(team)
            if !sub.isEmpty {
                drawText(truncateText(sub, font: subFont, maxWidth: 285 * u), font: subFont, color: subColor, x: ox + 12 * u, baseline: oy + subBaseline * u, align: .left)
            }
        }
        drawRow(mlp.teamA, accent: parseTeamColor(mlp.teamA?.color, fallback: colorMlpTeamADefault), barY: 30, nameBaseline: 45, subBaseline: 57)
        drawRow(mlp.teamB, accent: parseTeamColor(mlp.teamB?.color, fallback: colorMlpTeamBDefault), barY: 63, nameBaseline: 78, subBaseline: 90)

        // OP10-12: cột series (slotWins) navy — vẽ SAU hàng
        colorMlpSeriesBg.setFill()
        cg.fill(CGRect(x: ox + 306 * u, y: oy + 28.5 * u, width: 34.5 * u, height: 66 * u))
        let seriesFont = UIFont.systemFont(ofSize: 22.5 * u, weight: .bold)
        drawText(String(mlp.teamA?.slotWins ?? 0), font: seriesFont, color: .white, x: ox + 323.25 * u, baseline: oy + 52.5 * u, align: .center)
        drawText(String(mlp.teamB?.slotWins ?? 0), font: seriesFont, color: .white, x: ox + 323.25 * u, baseline: oy + 85.5 * u, align: .center)

        // OP13-16: cột điểm (xanh / vàng đậm khi DreamBreaker) + 2 điểm + vạch chia
        (isDb ? colorMlpDbScoreBg : colorScoreGreen).setFill()
        cg.fill(CGRect(x: ox + 340.5 * u, y: oy + 28.5 * u, width: 49.5 * u, height: 66 * u))
        let scoreFont = UIFont.systemFont(ofSize: 30 * u, weight: .bold)
        let scoreA = isDb ? (mlp.dreamBreaker?.scoreA ?? 0) : (mlp.score?.currentGameA ?? 0)
        let scoreB = isDb ? (mlp.dreamBreaker?.scoreB ?? 0) : (mlp.score?.currentGameB ?? 0)
        drawText(String(scoreA), font: scoreFont, color: .white, x: ox + 365.25 * u, baseline: oy + 55 * u, align: .center)
        colorDivider.setFill()
        cg.fill(CGRect(x: ox + 343.5 * u, y: oy + 61.125 * u, width: 43.5 * u, height: 0.75 * u))
        drawText(String(scoreB), font: scoreFont, color: .white, x: ox + 365.25 * u, baseline: oy + 88 * u, align: .center)

        // OP17-18: thanh trắng dưới (luôn có ở MLP)
        fillRoundedBar(CGRect(x: ox, y: oy + 96 * u, width: 390 * u, height: 22.5 * u), radius: 6 * u, roundTop: false, color: .white)
        let bottomText = isDb
            ? "DREAM BREAKER · CHẠM " + String(mlp.dreamBreaker?.target ?? 21)
            : (mlp.slot?.label?.trimmedNilIfBlank ?? "MLP").uppercased()
        drawText(truncateText(bottomText, font: barFont, maxWidth: 369 * u), font: barFont, color: .black, x: ox + 195 * u, baseline: oy + 112.75 * u, align: .center)
        cg.restoreGState()
    }

    /// Android parseColor: "#RRGGBB" hoặc "#AARRGGBB" (alpha ĐỨNG TRƯỚC), thiếu '#' thì thêm.
    private static func parseTeamColor(_ hex: String?, fallback: UIColor) -> UIColor {
        guard var s = hex?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return fallback }
        if s.hasPrefix("#") { s.removeFirst() }
        guard let value = UInt64(s, radix: 16) else { return fallback }
        switch s.count {
        case 6:
            return UIColor(
                red: CGFloat((value >> 16) & 0xFF) / 255, green: CGFloat((value >> 8) & 0xFF) / 255,
                blue: CGFloat(value & 0xFF) / 255, alpha: 1
            )
        case 8:
            return UIColor(
                red: CGFloat((value >> 16) & 0xFF) / 255, green: CGFloat((value >> 8) & 0xFF) / 255,
                blue: CGFloat(value & 0xFF) / 255, alpha: CGFloat((value >> 24) & 0xFF) / 255
            )
        default:
            return fallback
        }
    }

    // MARK: Lớp logo (drawLogoLayer) — hộp 68x68 góc phải trên, nền đen 35%, bo 10, logo fit trong lề 8

    private static func drawLogoBox(_ image: UIImage, layout: OverlayLayout, in cg: CGContext) {
        let u = layout.uiScale
        let boxSize = 68 * u
        let box = CGRect(x: layout.size.width - layout.margin - boxSize, y: layout.margin, width: boxSize, height: boxSize)
        colorLogoBoxBg.setFill()
        UIBezierPath(roundedRect: box, cornerRadius: 10 * u).fill()
        let content = box.insetBy(dx: 8 * u, dy: 8 * u)
        image.draw(in: aspectFitRect(for: image.size, in: content))
    }

    // MARK: Sponsor bar (drawSponsorsLayer) — góc phải dưới, KHÔNG nền, ô 44.8 basis kéo giãn vuông, pad 5.6

    private static func drawSponsorBar(_ images: [UIImage], layout: OverlayLayout, in cg: CGContext) {
        let u = layout.uiScale
        let n = CGFloat(images.count)
        let barHeight = 56 * u
        let tile = 44.8 * u
        let pad = 5.6 * u
        let barWidth = (5.6 + 50.4 * n) * u
        let barRight = layout.size.width - layout.margin
        let barBottom = layout.size.height - layout.margin
        let barLeft = barRight - barWidth
        let barTop = barBottom - barHeight
        for (index, image) in images.enumerated() {
            let dst = CGRect(x: barLeft + pad + CGFloat(index) * (tile + pad), y: barTop + pad, width: tile, height: tile)
            image.draw(in: dst) // stretch, giống Android drawBitmap(null src)
        }
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
