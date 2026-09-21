// URLLiveSource.swift — nguồn video từ LINK tùy chỉnh (m3u8/HLS/HTTP/file) làm
// nguồn cho HaishinKit → FB, thay camera điện thoại.
//
// Dùng AVPlayer + AVPlayerItemVideoOutput: play link → poll CVPixelBuffer theo
// CADisplayLink → bọc CMSampleBuffer (PTS host-clock, khớp đồng hồ Screen của
// HaishinKit) → onSampleBuffer → LiveStreamingService append vào mixer offscreen.
//
// ⚠ AVPlayer KHÔNG hỗ trợ rtsp:// — link rtsp sẽ báo lỗi rõ ràng (cần RTSP client
// riêng, làm sau). Hỗ trợ: .m3u8 (HLS), http(s) progressive (mp4…), file://.

import Foundation
import AVFoundation
import CoreMedia
import CoreVideo
import QuartzCore

public final class URLLiveSource {
    public enum State: Equatable { case idle, connecting, streaming, stopped, error(String) }

    public var onSampleBuffer: ((CMSampleBuffer) -> Void)?
    public var onState: ((State) -> Void)?

    private let url: URL
    private let isRTSP: Bool
    private var player: AVPlayer?
    private var itemOutput: AVPlayerItemVideoOutput?
    private var displayLink: CADisplayLink?
    private var statusObs: NSKeyValueObservation?
    private var stopped = false

    public init?(urlString: String) {
        let s = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let u = URL(string: s) else { return nil }
        self.url = u
        self.isRTSP = s.lowercased().hasPrefix("rtsp")
    }

    public func start() {
        stopped = false
        onState?(.connecting)
        if isRTSP {
            // AVPlayer không chơi được rtsp:// — báo lỗi rõ để UI hiển thị.
            NSLog("[URLSrc] rtsp:// không hỗ trợ bằng AVPlayer")
            onState?(.error("Link RTSP chưa hỗ trợ trên iOS (dùng link m3u8/HTTP, hoặc app desktop cho RTSP)."))
            return
        }
        NSLog("[URLSrc] start url=\(url.absoluteString.prefix(80))…")
        let item = AVPlayerItem(url: url)
        // 420 biplanar video-range: khớp pixel format mixer HaishinKit dùng.
        let attrs: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange),
            kCVPixelBufferIOSurfacePropertiesKey as String: [:],
        ]
        let output = AVPlayerItemVideoOutput(pixelBufferAttributes: attrs)
        item.add(output)
        itemOutput = output

        statusObs = item.observe(\.status, options: [.new]) { [weak self] it, _ in
            guard let self, !self.stopped else { return }
            switch it.status {
            case .failed:
                let msg = it.error?.localizedDescription ?? "không phát được link"
                NSLog("[URLSrc] item failed: \(msg)")
                self.onState?(.error(msg))
            case .readyToPlay:
                NSLog("[URLSrc] readyToPlay")
                self.onState?(.streaming)
            default: break
            }
        }

        let p = AVPlayer(playerItem: item)
        p.isMuted = true
        p.automaticallyWaitsToMinimizeStalling = false
        player = p
        p.play()

        let dl = CADisplayLink(target: self, selector: #selector(tick(_:)))
        dl.preferredFramesPerSecond = 30
        dl.add(to: .main, forMode: .common)
        displayLink = dl
    }

    @objc private func tick(_ link: CADisplayLink) {
        guard !stopped, let output = itemOutput else { return }
        let host = CACurrentMediaTime()
        let itemTime = output.itemTime(forHostTime: host)
        guard output.hasNewPixelBuffer(forItemTime: itemTime),
              let px = output.copyPixelBuffer(forItemTime: itemTime, itemTimeForDisplay: nil) else { return }
        if let sb = wrap(px) { onSampleBuffer?(sb) }
    }

    /// PTS theo host-time clock (khớp đồng hồ Screen HaishinKit → không bị drop
    /// -12764/QueueIsFull do lệch timebase như bản đầu của nguồn Imou).
    private func wrap(_ pixelBuffer: CVPixelBuffer) -> CMSampleBuffer? {
        var fmt: CMVideoFormatDescription?
        guard CMVideoFormatDescriptionCreateForImageBuffer(
                allocator: kCFAllocatorDefault, imageBuffer: pixelBuffer,
                formatDescriptionOut: &fmt) == noErr, let fmt else { return nil }
        let pts = CMClockGetTime(CMClockGetHostTimeClock())
        var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 30),
                                        presentationTimeStamp: pts, decodeTimeStamp: .invalid)
        var sample: CMSampleBuffer?
        let st = CMSampleBufferCreateReadyWithImageBuffer(
            allocator: kCFAllocatorDefault, imageBuffer: pixelBuffer,
            formatDescription: fmt, sampleTiming: &timing, sampleBufferOut: &sample)
        return st == noErr ? sample : nil
    }

    public func stop() {
        stopped = true
        displayLink?.invalidate(); displayLink = nil
        statusObs?.invalidate(); statusObs = nil
        player?.pause(); player = nil
        itemOutput = nil
        onState?(.stopped)
    }
}
