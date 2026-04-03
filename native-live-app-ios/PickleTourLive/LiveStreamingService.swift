import AVFoundation
import CoreGraphics
import CoreImage
import HaishinKit
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
        }
    }
    @Published private(set) var diagnostics: [String] = []
    @Published private(set) var localRecordingState: LocalRecordingState = .idle

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
    private var currentDestination: RTMPDestination?
    private var statsTimer: Timer?
    private var recordingRotationTimer: Timer?
    private var pendingRecordingStopContinuation: CheckedContinuation<Void, Never>?
    private var activeRecordingSession: ActiveLocalRecordingSession?
    private var pendingRecordingBoundary: PendingRecordingBoundary?
    private var overlayEffectRegistered = false

    override init() {
        stream = RTMPStream(connection: connection)
        super.init()

        connection.addEventListener(.rtmpStatus, selector: #selector(handleRTMPStatus(_:)), observer: self)
        connection.addEventListener(.ioError, selector: #selector(handleRTMPError(_:)), observer: self)

        recorder.delegate = recorderProxy
        stream.addObserver(recorder)
        registerOverlayEffectIfNeeded()
        appendDiagnostic("Live streaming service ready.")
    }

    deinit {
        statsTimer?.invalidate()
        recordingRotationTimer?.invalidate()
    }

    func preparePreview(quality: LiveQualityPreset = .balanced1080) async throws {
        connectionState = .preparingPreview
        try configureAudioSession()
        try await requestCapturePermissions()
        applyQuality(quality)
        registerOverlayEffectIfNeeded()

        if stats.micEnabled, let microphone = AVCaptureDevice.default(for: .audio) {
            stream.attachAudio(microphone)
        } else {
            stream.attachAudio(nil)
        }

        let camera = try resolveCamera(position: currentCameraPosition)
        currentCamera = camera

        try await attachCameraAndAwait(camera)

        refreshPreviewBindings()
        connectionState = .previewReady
        startStatsTimer()
        appendDiagnostic("Preview attached to \(currentCameraPosition == .back ? "rear" : "front") camera.")
    }

    func startPublishing(to destination: RTMPDestination) async throws {
        currentDestination = destination

        switch connectionState {
        case .previewReady, .live, .connecting, .reconnecting(_):
            break
        default:
            try await preparePreview(quality: stats.quality)
        }

        try await withCheckedThrowingContinuation { continuation in
            pendingStartContinuation = continuation
            pendingPublishName = destination.publishName
            connectionState = .connecting
            appendDiagnostic("Connecting to \(destination.connectURL)")
            connection.connect(destination.connectURL)
        }
    }

    func stopPublishing() {
        pendingPublishName = nil
        resolvePendingStart(with: nil)
        currentDestination = nil
        stream.close()
        connection.close()
        connectionState = currentCamera == nil ? .stopped : .previewReady
        appendDiagnostic("Publishing stopped.")
    }

    func stopPreview() {
        recordingRotationTimer?.invalidate()
        stream.attachCamera(nil)
        stream.attachAudio(nil)
        currentCamera = nil
        connectionState = .idle
        refreshPreviewBindings()
        appendDiagnostic("Preview released.")
    }

    func startRecording(recordingId: String, matchId: String, segmentDuration: TimeInterval = 6.0) async throws {
        guard let recordingId = recordingId.trimmedNilIfBlank, let matchId = matchId.trimmedNilIfBlank else {
            throw LiveAPIError.server(statusCode: 0, message: "Thiếu thông tin recording để bắt đầu ghi hình.")
        }

        if currentCamera == nil {
            try await preparePreview(quality: stats.quality)
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

        guard activeRecordingSession != nil || pendingRecordingBoundary != nil else {
            localRecordingState = .idle
            return
        }

        await withCheckedContinuation { continuation in
            pendingRecordingStopContinuation = continuation

            if pendingRecordingBoundary != nil {
                return
            }

            rotateRecordingSegment(isFinal: true)
        }
    }

    func toggleCamera() async throws {
        currentCameraPosition = currentCameraPosition == .back ? .front : .back
        let camera = try resolveCamera(position: currentCameraPosition)
        currentCamera = camera

        try await attachCameraAndAwait(camera)

        appendDiagnostic("Switched to \(currentCameraPosition == .back ? "rear" : "front") camera.")
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
        videoSettings.bitRate = UInt32(max(0, quality.videoBitrate))
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

    private func refreshPreviewBindings() {
        for view in previewViews.allObjects {
            view.attachStream(stream)
        }
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

    private func attachCameraAndAwait(_ camera: AVCaptureDevice) async throws {
        var attachError: Error?
        stream.attachCamera(camera) { error in
            attachError = error
        }
        try await Task.sleep(nanoseconds: 300_000_000)
        if let attachError {
            throw attachError
        }
    }

    private func registerOverlayEffectIfNeeded() {
        guard !overlayEffectRegistered else { return }
        _ = stream.registerVideoEffect(overlayEffect)
        overlayEffectRegistered = true
    }

    private func beginRecordingSegment() {
        guard let session = activeRecordingSession else {
            resolvePendingRecordingStop()
            return
        }

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
        let message = error.localizedDescription
        appendDiagnostic("Recorder error: \(message)")
        localRecordingState = .failed(message)
        activeRecordingSession = nil
        pendingRecordingBoundary = nil
        recordingRotationTimer?.invalidate()
        recordingRotationTimer = nil
        onRecordingFailure?(message)
        resolvePendingRecordingStop()
    }

    private func resolvePendingRecordingStop() {
        guard let continuation = pendingRecordingStopContinuation else { return }
        pendingRecordingStopContinuation = nil
        continuation.resume(returning: ())
    }

    private func startStatsTimer() {
        statsTimer?.invalidate()
        statsTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let self else { return }
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
            appendDiagnostic("RTMP connected.")
            if let publishName = pendingPublishName {
                stream.publish(publishName)
                pendingPublishName = nil
                connectionState = .live
                resolvePendingStart(with: nil)
            } else {
                connectionState = currentCamera == nil ? .stopped : .previewReady
            }
        case RTMPConnection.Code.connectClosed.rawValue:
            appendDiagnostic("RTMP closed.")
            connectionState = currentCamera == nil ? .stopped : .previewReady
            resolvePendingStart(with: LiveAPIError.server(statusCode: 0, message: "RTMP đã đóng trước khi publish."))
        case RTMPConnection.Code.connectRejected.rawValue:
            appendDiagnostic("RTMP rejected.")
            connectionState = .failed("RTMP bị từ chối.")
            resolvePendingStart(with: LiveAPIError.server(statusCode: 0, message: "RTMP bị từ chối."))
        default:
            if code.lowercased().contains("failed") {
                appendDiagnostic("RTMP failure: \(code)")
                connectionState = .failed(code)
                resolvePendingStart(with: LiveAPIError.server(statusCode: 0, message: code))
            } else if code.lowercased().contains("reconnect") {
                appendDiagnostic("RTMP reconnecting: \(code)")
                connectionState = .reconnecting(code)
            }
        }
    }

    @objc
    private func handleRTMPError(_ notification: Notification) {
        appendDiagnostic("RTMP I/O error.")
        connectionState = .failed("RTMP I/O error")
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
        fatalError("init(coder:) has not been implemented")
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

    func update(snapshot: LiveOverlaySnapshot?) {
        renderer.update(snapshot: snapshot)
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

private final class LiveScoreboardOverlayRenderer {
    private let lock = NSLock()
    private var snapshot: LiveOverlaySnapshot?
    private var cachedKey: String?
    private var cachedImage: CIImage?

    func update(snapshot: LiveOverlaySnapshot?) {
        lock.lock()
        self.snapshot = snapshot
        cachedKey = nil
        cachedImage = nil
        lock.unlock()
    }

    func overlayImage(for size: CGSize) -> CIImage? {
        guard size.width > 0, size.height > 0 else { return nil }

        let snapshot: LiveOverlaySnapshot?
        let cacheKey: String

        lock.lock()
        snapshot = self.snapshot
        cacheKey = Self.cacheKey(snapshot: self.snapshot, size: size)
        if cacheKey == cachedKey, let cachedImage {
            lock.unlock()
            return cachedImage
        }
        lock.unlock()

        guard let snapshot else { return nil }
        let rendered = Self.render(snapshot: snapshot, size: size)

        lock.lock()
        cachedKey = cacheKey
        cachedImage = rendered
        lock.unlock()
        return rendered
    }

    private static func cacheKey(snapshot: LiveOverlaySnapshot?, size: CGSize) -> String {
        [
            snapshot?.tournamentName,
            snapshot?.courtName,
            snapshot?.teamAName,
            snapshot?.teamBName,
            snapshot?.scoreA.map(String.init),
            snapshot?.scoreB.map(String.init),
            snapshot?.serveSide,
            snapshot?.phaseText,
            snapshot?.roundLabel,
            snapshot?.webLogoURL,
            snapshot?.sponsorLogoURLs?.joined(separator: ","),
            snapshot?.sets?.map { "\($0.index):\($0.a ?? 0)-\($0.b ?? 0)" }.joined(separator: ";"),
            "\(Int(size.width))x\(Int(size.height))"
        ]
        .compactMap { $0 }
        .joined(separator: "|")
    }

    private static func render(snapshot: LiveOverlaySnapshot, size: CGSize) -> CIImage? {
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = false

        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        let image = renderer.image { context in
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

            NSString(string: snapshot.tournamentName?.trimmedNilIfBlank ?? "PickleTour").draw(
                in: CGRect(x: contentRect.minX, y: contentRect.minY, width: contentRect.width, height: 20),
                withAttributes: smallTextAttributes
            )

            NSString(string: snapshot.courtName?.trimmedNilIfBlank ?? "Court").draw(
                in: CGRect(x: contentRect.minX, y: contentRect.minY + 22, width: contentRect.width, height: 30),
                withAttributes: strongTextAttributes
            )

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

            let brandingBits = [
                snapshot.webLogoURL?.trimmedNilIfBlank.map { _ in "WEB" },
                snapshot.sponsorLogoURLs?.isEmpty == false ? "SPONSOR x\(snapshot.sponsorLogoURLs?.count ?? 0)" : nil
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

        return CIImage(image: image)
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
