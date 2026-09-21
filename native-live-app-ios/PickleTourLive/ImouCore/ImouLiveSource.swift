// ImouLiveSource.swift — Plan A (iOS): nguồn cam Imou (DHAV relay) làm video
// source cho HaishinKit → đẩy FB, thay camera điện thoại.
//
// Luồng (tái dùng toàn bộ decoder Imou đã có trong ImouCore/):
//   ApiClient(session).streamUrl(device)          → relay URL
//     → DhRtspClient.runChunkLoop                 → DHAV bytes
//     → DHAVParser.Assembler.popFrames            → HEVC frame
//     → HEVCRenderer.enqueue(dhavFrame:)          → parse + build CMSampleBuffer
//         → (onDecodedPixelBuffer) VTDecompress   → CVPixelBuffer
//     → wrap CMSampleBuffer (PTS = wallclock)     → onSampleBuffer
//     → LiveStreamingService append vào HaishinKit (Screen offscreen chồng
//       overlay → encode H.264 → RTMP → FB)
//
// TRẠNG THÁI: cần build qua Xcode/CI (ios-live-beta) + test iPhone thật với cam
// online + FB (VTDecompression/HaishinKit không verify được trên máy build này).

import Foundation
import CoreMedia
import CoreVideo
import QuartzCore   // CACurrentMediaTime

public final class ImouLiveSource {
    public enum State: Equatable { case idle, connecting, streaming, stopped, error(String) }

    /// Mỗi CVPixelBuffer đã giải mã → bọc CMSampleBuffer (PTS wallclock) cho HaishinKit.
    public var onSampleBuffer: ((CMSampleBuffer) -> Void)?
    public var onState: ((State) -> Void)?

    private let session: ImouSession
    private let deviceId: String
    private var productId: String                 // rỗng → tự tìm qua listDevices()
    private let streamId: String                 // "0"=chính, "1"=phụ (nhẹ)
    private let renderer = HEVCRenderer()         // tái dùng decoder đã test
    private var task: Task<Void, Never>?
    private var rtsp: DhRtspClient?
    private var startHostTime = CACurrentMediaTime()
    private var stopped = false

    public init(session: ImouSession, deviceId: String, productId: String = "",
                streamId: String = "0") {
        self.session = session
        self.deviceId = deviceId
        self.productId = productId
        self.streamId = streamId
        renderer.displayLayer = nil               // live-only: không cần hiển thị
        renderer.onDecodedPixelBuffer = { [weak self] px, _ in
            guard let self, let out = self.wrapWallclock(px) else { return }
            self.onSampleBuffer?(out)
        }
    }

    public func start() {
        stopped = false
        onState?(.connecting)
        task = Task { [weak self] in
            guard let self else { return }
            do { try await self.runLoop() }
            catch { if !self.stopped { self.onState?(.error(String(describing: error))) } }
        }
    }

    public func stop() {
        stopped = true
        task?.cancel()
        rtsp?.close(); rtsp = nil
        onState?(.stopped)
    }

    private func runLoop() async throws {
        let api = ApiClient(session)
        // productId rỗng → tra từ danh sách thiết bị (app chỉ cần session+deviceId).
        if productId.isEmpty {
            if let cam = try await api.listDevices().first(where: { $0.deviceId == deviceId }) {
                productId = cam.productId
            }
        }
        while !stopped {
            let quality: ApiClient.StreamQuality = (streamId == "1") ? .sd : .hd
            let url = try await api.streamUrl(deviceId: deviceId, productId: productId,
                                              quality: quality)
            let client = DhRtspClient(.init(url: url, audio: false))
            rtsp = client
            try await client.open()
            onState?(.streaming)
            startHostTime = CACurrentMediaTime()
            // LIVE: Assembler dùng key rỗng (không giải mã — như Player.swift).
            let assembler = DHAVParser.Assembler(key: Data())
            try await client.runChunkLoop { [weak self] chunk in
                guard let self, !self.stopped else { return false }
                assembler.push(chunk)
                for frame in assembler.popFrames() {
                    // Demux theo byte type: 0xf0 = audio (bỏ, live không tiếng);
                    // còn lại (0xfd/0xfc) = video → renderer.
                    let ft = frame.count > 4 ? frame[frame.startIndex + 4] : 0
                    if ft != 0xf0 { self.renderer.enqueue(dhavFrame: frame, isLive: true) }
                }
                return true
            }
            if stopped { break }
            // relay cap → mở lại ngay ở mép live (bỏ backlog) → chống trễ dồn.
        }
    }

    /// PTS = wallclock (thời điểm nhận) → nhịp ra khớp thời gian thực, không dồn trễ.
    private func wrapWallclock(_ pixelBuffer: CVPixelBuffer) -> CMSampleBuffer? {
        var fmt: CMVideoFormatDescription?
        guard CMVideoFormatDescriptionCreateForImageBuffer(
                allocator: kCFAllocatorDefault, imageBuffer: pixelBuffer,
                formatDescriptionOut: &fmt) == noErr, let fmt else { return nil }
        let elapsed = CACurrentMediaTime() - startHostTime
        let pts = CMTime(seconds: elapsed, preferredTimescale: 1_000_000)
        var timing = CMSampleTimingInfo(duration: .invalid, presentationTimeStamp: pts,
                                        decodeTimeStamp: .invalid)
        var sample: CMSampleBuffer?
        let st = CMSampleBufferCreateReadyWithImageBuffer(
            allocator: kCFAllocatorDefault, imageBuffer: pixelBuffer,
            formatDescription: fmt, sampleTiming: &timing, sampleBufferOut: &sample)
        return st == noErr ? sample : nil
    }
}
