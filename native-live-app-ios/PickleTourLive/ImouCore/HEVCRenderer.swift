// HEVCRenderer.swift — direct HEVC decode + render via AVSampleBufferDisplayLayer.
//
// Pipeline:
//   DhRtspClient/DhHttpClient → DHAV chunks
//     → DHAVParser.Assembler  → full DHAV frame (HEVC NALs in payload)
//     → HEVCNalExtractor       → individual NALs (VPS/SPS/PPS/IDR/slice)
//     → builds CMVideoFormatDescription once parameter sets are known
//     → wraps slice NALs as CMSampleBuffer
//     → enqueue(displayLayer)  → hardware decode via VideoToolbox → render
//
// Latency target: ~200ms (vs ~1500ms with HLS pipeline). Matches Imou app.

import Foundation
import AVFoundation
import CoreMedia
import CoreVideo
import VideoToolbox

public final class HEVCRenderer {

  public enum RendererError: Error {
    case formatDescriptionFailed(OSStatus)
    case sampleBufferFailed(OSStatus)
  }

  public weak var displayLayer: AVSampleBufferDisplayLayer?

  // PLAN A (live): tap frame ĐÃ GIẢI MÃ để đẩy sang HaishinKit → FB. Khi set,
  // mỗi CMSampleBuffer HEVC (đã dựng đầy đủ VPS/SPS/PPS + keyframe logic) sẽ
  // được giải mã qua VTDecompression → CVPixelBuffer + PTS → callback. Tái dùng
  // toàn bộ logic parse của renderer (không viết trùng). displayLayer có thể nil
  // (dùng live-only, không cần hiển thị cục bộ).
  public var onDecodedPixelBuffer: ((CVPixelBuffer, CMTime) -> Void)?
  private var liveDecompression: VTDecompressionSession?
  private var liveDecompFmt: CMVideoFormatDescription?
  // Live-only: không có view hiển thị cục bộ. Khi cần reveal (chống green-flash
  // ở đường hiển thị) thì gọi callback này; đường live để nil.
  public var onRevealLayer: (() -> Void)?
  // Green-flash fix: ẩn layer cho tới khi steady state (warmupFrames frame đã
  // enqueue thành công). Trên simulator iOS, software-decode warmup ~10-15
  // frame (>device), nên chọn 15 (~600ms) để chắc; device thật cũng OK.
  private let warmupFrames = 15
  public private(set) var enqueuedSinceReset = 0
  private func tryRevealIfReady() {
    if enqueuedSinceReset >= warmupFrames { onRevealLayer?() }
  }

  private let psCache = HEVCNalExtractor.ParamSetCache()
  private var formatDescription: CMVideoFormatDescription?
  /// Once we've seen a parameter-set NAL whose first byte unambiguously
  /// identifies the codec (HEVC VPS=0x40 / SPS=0x42 / PPS=0x44 vs H.264
  /// SPS=0x67 / PPS=0x68), we lock the codec so subsequent slice NALs
  /// (whose byte ranges overlap between codecs) are interpreted correctly.
  private var detectedCodec: VideoCodec?
  /// Until we see the first IDR (or after a format-desc rebuild), slice NALs
  /// reference frames the decoder hasn't seen — rendering them produces
  /// gray/blocky garbage. Gate on this flag and drop slices until keyframe.
  private var awaitingKeyframe = true

  /// 90 kHz timebase like H.264/HEVC convention.
  private let timescale: CMTimeScale = 90000
  private var lastDhavMs: UInt32 = 0
  private var firstPtsAtMs: UInt32?
  /// Anchor on the host clock (= AVSampleBufferDisplayLayer's default control
  /// timebase). First-frame PTS = streamStartTime + liveBufferLag so subsequent
  /// frames are presented on their DHAV-relative schedule. Without this anchor
  /// the layer renders every frame ASAP and jitter shows as stutter.
  private var streamStartTime: CMTime?
  /// Live pre-roll buffer — gives decoder a moment to warm up + absorbs
  /// minor network jitter before first frame is shown. 200ms strikes a
  /// balance between immediate display and clean decoder startup.
  private let liveBufferLag = CMTime(value: 200, timescale: 1000)
  // Debug counters
  private var dbgIn = 0, dbgDroppedAwaitKf = 0, dbgEnqueued = 0
  private var dbgLastLog = Date()

  public init() {}

  /// Feed one decrypted DHAV frame (payload + ext + trailer intact).
  public func enqueue(dhavFrame frame: Data, isLive: Bool) {
    dbgIn += 1
    if Date().timeIntervalSince(dbgLastLog) >= 5 {
      NSLog("[HEVCRenderer] in=\(dbgIn) enqueued=\(dbgEnqueued) droppedAwaitKf=\(dbgDroppedAwaitKf) hasFmt=\(formatDescription != nil) awaitKf=\(awaitingKeyframe)")
      dbgLastLog = Date()
    }
    guard frame.count > 0x18,
          frame.prefix(4) == Data("DHAV".utf8) else { return }

    // Only handle video frames here. Audio (type 0xf0) goes elsewhere.
    let frameType = frame[frame.startIndex + 4]
    let isVideo = (frameType == 0xfd || frameType == 0xfc)
    guard isVideo else { return }

    let extHdrLen = Int(frame[frame.startIndex + 0x16])
    let pStart = frame.startIndex + 0x18 + extHdrLen
    let pEnd = frame.endIndex - 8
    guard pStart < pEnd else { return }
    let payload = frame.subdata(in: pStart..<pEnd)

    // First pass with whatever codec hint we have (sticky once detected).
    var nalus = HEVCNalExtractor.extractNalus(payload, codecHint: detectedCodec)
    if nalus.isEmpty { return }
    // If we don't yet have a sticky codec, lock it as soon as we see a
    // param-set NAL whose first byte unambiguously names the codec.
    if detectedCodec == nil {
      for n in nalus where !n.bytes.isEmpty {
        let b = n.bytes[n.bytes.startIndex]
        if b == 0x40 || b == 0x42 || b == 0x44 {  // HEVC VPS/SPS/PPS
          detectedCodec = .hevc; break
        }
        if b == 0x67 || b == 0x68 {                // H.264 SPS/PPS
          detectedCodec = .h264; break
        }
      }
      // If detection changed the codec, re-parse with the correct hint.
      if let c = detectedCodec, c != nalus.first?.codec {
        nalus = HEVCNalExtractor.extractNalus(payload, codecHint: c)
      }
    }

    let psChanged = psCache.absorb(nalus)
    if psChanged || formatDescription == nil {
      if psCache.isComplete {
        do { try rebuildFormatDescription() }
        catch { NSLog("[HEVCRenderer] fmt desc failed: \(error)"); return }
        // New decoder state — must re-anchor on a keyframe before any slice.
        awaitingKeyframe = true
      } else {
        // Don't enqueue slice data before we have all 3 parameter sets;
        // would only produce decode errors anyway.
        return
      }
    }

    // GREEN-SCREEN FIX: nếu decoder đã lỗi (mất reference do rớt gói), layer
    // chuyển .failed và đứng frame xanh tới IDR tự nhiên kế tiếp. Flush + bắt
    // buộc chờ keyframe → re-anchor sạch ở IDR kế thay vì nhồi P-frame vào
    // decoder hỏng (giữ màn xanh/nhiễu). Imou app cũng recover kiểu này.
    if let layer = displayLayer, layer.status == .failed {
      layer.flush()
      awaitingKeyframe = true
    }

    // Filter to keyframe + slice NALs for the actual frame data.
    let dataNals = nalus.filter {
      $0.type.isKeyframe || $0.type == .slice
    }
    if dataNals.isEmpty { return }
    let hasKeyframe = dataNals.contains(where: { $0.type.isKeyframe })
    if awaitingKeyframe {
      if !hasKeyframe { dbgDroppedAwaitKf += 1; return }
      awaitingKeyframe = false
    }

    let pts = computePts(dhavFrame: frame, isLive: isLive)
    do {
      let sample = try buildSampleBuffer(nalus: dataNals, pts: pts,
                                          isKeyframe: hasKeyframe)
      enqueueOnLayer(sample)
      if onDecodedPixelBuffer != nil { decodeForLive(sample, pts: pts) }
      dbgEnqueued += 1
      // Reveal layer sau warmupFrames frame thành công (chống green-flash).
      // Gọi mỗi frame > warmup (revealLayer idempotent — no-op khi đã hiện).
      enqueuedSinceReset += 1
      if enqueuedSinceReset >= warmupFrames { onRevealLayer?() }
    } catch {
      NSLog("[HEVCRenderer] sample buffer failed: \(error)")
    }
  }

  // PLAN A (RTSP): nạp trực tiếp 1 access-unit dạng Annex-B (chuỗi NAL, mỗi NAL
  // có start code 00 00 00 01) — dùng cho nguồn RTSP/RTP (không có bọc DHAV).
  // Tái dùng toàn bộ logic detect codec / param-set / format-desc / decodeForLive.
  public func enqueue(nalUnitStream payload: Data, isLive: Bool) {
    guard !payload.isEmpty else { return }
    var nalus = HEVCNalExtractor.extractNalus(payload, codecHint: detectedCodec)
    if nalus.isEmpty { return }
    if detectedCodec == nil {
      for n in nalus where !n.bytes.isEmpty {
        let b = n.bytes[n.bytes.startIndex]
        if b == 0x40 || b == 0x42 || b == 0x44 { detectedCodec = .hevc; break }
        if b == 0x67 || b == 0x68 { detectedCodec = .h264; break }
      }
      if let c = detectedCodec, c != nalus.first?.codec {
        nalus = HEVCNalExtractor.extractNalus(payload, codecHint: c)
      }
    }
    let psChanged = psCache.absorb(nalus)
    if psChanged || formatDescription == nil {
      if psCache.isComplete {
        do { try rebuildFormatDescription() } catch { return }
        awaitingKeyframe = true
      } else { return }
    }
    let dataNals = nalus.filter { $0.type.isKeyframe || $0.type == .slice }
    if dataNals.isEmpty { return }
    let hasKeyframe = dataNals.contains(where: { $0.type.isKeyframe })
    if awaitingKeyframe { if !hasKeyframe { return }; awaitingKeyframe = false }
    // PTS 90kHz tăng theo host clock (đường live tự re-stamp host-clock lúc append).
    let pts = CMTime(seconds: CACurrentMediaTime(), preferredTimescale: 90000)
    do {
      let sample = try buildSampleBuffer(nalus: dataNals, pts: pts, isKeyframe: hasKeyframe)
      if onDecodedPixelBuffer != nil { decodeForLive(sample, pts: pts) }
    } catch {
      NSLog("[HEVCRenderer] annexB sample buffer failed: \(error)")
    }
  }

  // PLAN A: giải mã CMSampleBuffer HEVC (nén) → CVPixelBuffer → callback cho
  // HaishinKit. Session tạo lại khi formatDescription đổi. Async decode.
  private func decodeForLive(_ sample: CMSampleBuffer, pts: CMTime) {
    guard let fmt = formatDescription else { return }
    if liveDecompression == nil || liveDecompFmt !== fmt {
      if let d = liveDecompression { VTDecompressionSessionInvalidate(d) }
      liveDecompression = nil
      let attrs: [CFString: Any] = [
        kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
        kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary,
      ]
      var sess: VTDecompressionSession?
      let st = VTDecompressionSessionCreate(
        allocator: kCFAllocatorDefault, formatDescription: fmt,
        decoderSpecification: nil, imageBufferAttributes: attrs as CFDictionary,
        outputCallback: nil, decompressionSessionOut: &sess)
      guard st == noErr, let s = sess else {
        NSLog("[HEVCRenderer] live VTDecompressionSessionCreate \(st)"); return
      }
      liveDecompression = s; liveDecompFmt = fmt
    }
    guard let dec = liveDecompression else { return }
    let cb = onDecodedPixelBuffer
    VTDecompressionSessionDecodeFrame(
      dec, sampleBuffer: sample,
      flags: [._EnableAsynchronousDecompression], infoFlagsOut: nil
    ) { status, _, imageBuffer, _, _ in
      guard status == noErr, let px = imageBuffer else { return }
      cb?(px, pts)
    }
  }

  /// Pause/resume video by halting/restarting the layer's control timebase.
  /// Decoder keeps running for buffered frames; recv loop keeps draining
  /// TCP. Audio is muted separately by Player via AACRenderer.setMuted.
  public func setPaused(_ paused: Bool) {
    guard let layer = displayLayer, let tb = layer.controlTimebase else { return }
    CMTimebaseSetRate(tb, rate: paused ? 0.0 : 1.0)
  }

  /// Reset internal state (call when switching session).
  /// Snapshot param-sets hiện tại (để Recorder seed). nil nếu chưa đủ.
  public func paramSetsSnapshot() -> (vps: Data?, sps: Data, pps: Data, codec: VideoCodec)? {
    guard psCache.isComplete, let sps = psCache.sps, let pps = psCache.pps else { return nil }
    return (psCache.vps, sps, pps, psCache.codec)
  }

  public func reset() {
    formatDescription = nil
    enqueuedSinceReset = 0   // re-arm green-flash hide cho session mới
    firstPtsAtMs = nil
    streamStartTime = nil
    lastDhavMs = 0
    globalFrameIdx = 0
    awaitingKeyframe = true
    detectedCodec = nil
    if let layer = displayLayer {
      // Timebase ops are thread-safe — do them synchronously here so they
      // happen-before any frame enqueue from the renderQ. The earlier
      // dispatch-main approach raced with computePts (which sets rate=1
      // from renderQ on the first frame) — sometimes main ran AFTER and
      // reset rate to 0, freezing the layer with corrupted decoder state.
      if let tb = layer.controlTimebase {
        CMTimebaseSetRate(tb, rate: 0.0)
        CMTimebaseSetTime(tb, time: .zero)
      }
      DispatchQueue.main.async { layer.flushAndRemoveImage() }
    }
  }

  // MARK: – Internals

  private func rebuildFormatDescription() throws {
    guard let sps = psCache.sps, let pps = psCache.pps else { return }
    var fmt: CMVideoFormatDescription?
    let status: OSStatus
    switch psCache.codec {
    case .hevc:
      guard let vps = psCache.vps else { return }
      status = vps.withUnsafeBytes { vpsRaw -> OSStatus in
        sps.withUnsafeBytes { spsRaw -> OSStatus in
          pps.withUnsafeBytes { ppsRaw -> OSStatus in
            let pointers: [UnsafePointer<UInt8>] = [
              vpsRaw.bindMemory(to: UInt8.self).baseAddress!,
              spsRaw.bindMemory(to: UInt8.self).baseAddress!,
              ppsRaw.bindMemory(to: UInt8.self).baseAddress!,
            ]
            let sizes: [Int] = [vps.count, sps.count, pps.count]
            return pointers.withUnsafeBufferPointer { ptrBuf in
              sizes.withUnsafeBufferPointer { sizeBuf in
                CMVideoFormatDescriptionCreateFromHEVCParameterSets(
                  allocator: kCFAllocatorDefault,
                  parameterSetCount: 3,
                  parameterSetPointers: ptrBuf.baseAddress!,
                  parameterSetSizes: sizeBuf.baseAddress!,
                  nalUnitHeaderLength: 4,
                  extensions: nil,
                  formatDescriptionOut: &fmt
                )
              }
            }
          }
        }
      }
    case .h264:
      status = sps.withUnsafeBytes { spsRaw -> OSStatus in
        pps.withUnsafeBytes { ppsRaw -> OSStatus in
          let pointers: [UnsafePointer<UInt8>] = [
            spsRaw.bindMemory(to: UInt8.self).baseAddress!,
            ppsRaw.bindMemory(to: UInt8.self).baseAddress!,
          ]
          let sizes: [Int] = [sps.count, pps.count]
          return pointers.withUnsafeBufferPointer { ptrBuf in
            sizes.withUnsafeBufferPointer { sizeBuf in
              CMVideoFormatDescriptionCreateFromH264ParameterSets(
                allocator: kCFAllocatorDefault,
                parameterSetCount: 2,
                parameterSetPointers: ptrBuf.baseAddress!,
                parameterSetSizes: sizeBuf.baseAddress!,
                nalUnitHeaderLength: 4,
                formatDescriptionOut: &fmt
              )
            }
          }
        }
      }
    }
    guard status == noErr, let f = fmt else {
      throw RendererError.formatDescriptionFailed(status)
    }
    self.formatDescription = f
    NSLog("[HEVCRenderer] formatDescription rebuilt (codec=\(psCache.codec))")
  }

  /// Frame counter for PTS spacing (frame-index based, ignores camera
  /// timestamps). The DHAV header timestamp turned out to be seconds-only
  /// resolution AND the server pre-roll cached frames come in with sparse
  /// camera timestamps that cause big PTS jumps when real-time frames
  /// arrive (visible as "image appears then 5-second freeze then smooth").
  /// Using frame-index × 1/fps gives perfectly even PTS spread regardless
  /// of how the server delivers them.
  private var globalFrameIdx: Int64 = 0
  private let assumedFps: Int64 = 25
  private func computePts(dhavFrame: Data, isLive: Bool) -> CMTime {
    if firstPtsAtMs == nil { firstPtsAtMs = 1 }  // marker so reset() works
    let relTime = CMTime(
      value: globalFrameIdx * Int64(timescale) / assumedFps,
      timescale: timescale
    )
    globalFrameIdx += 1

    // PTS uses an arbitrary stream-relative base (zero + DHAV deltas).
    // The first sample's PTS is `0`; subsequent samples are `relTime`
    // forward of that. Starting the view's controlTimebase below at
    // (-liveBufferLag) makes the layer wait `liveBufferLag` ms before
    // showing the first frame, which gives subsequent jittery frames
    // a queue to drain from — that is what produces smooth playback.
    if streamStartTime == nil {
      streamStartTime = .zero
      // Start the layer's timebase synchronously from this thread —
      // CMTimebase is thread-safe and going via main was getting delayed
      // by RN bridge activity at startup, causing the first frame to
      // hang on screen while later frames piled up.
      if let layer = displayLayer, let tb = layer.controlTimebase {
        let initial = isLive ? CMTimeMultiply(liveBufferLag, multiplier: -1) : .zero
        CMTimebaseSetTime(tb, time: initial)
        CMTimebaseSetRate(tb, rate: 1.0)
      }
    }
    return CMTimeAdd(streamStartTime!, relTime)
  }

  private func buildSampleBuffer(nalus: [HEVCNalu], pts: CMTime,
                                  isKeyframe: Bool) throws -> CMSampleBuffer {
    let blob = HEVCNalExtractor.toLengthPrefixed(nalus)

    var blockBuffer: CMBlockBuffer?
    let allocStatus = CMBlockBufferCreateWithMemoryBlock(
      allocator: kCFAllocatorDefault,
      memoryBlock: nil,
      blockLength: blob.count,
      blockAllocator: nil,
      customBlockSource: nil,
      offsetToData: 0,
      dataLength: blob.count,
      flags: 0,
      blockBufferOut: &blockBuffer
    )
    guard allocStatus == kCMBlockBufferNoErr, let bb = blockBuffer else {
      throw RendererError.sampleBufferFailed(allocStatus)
    }
    let copyStatus = blob.withUnsafeBytes { src -> OSStatus in
      CMBlockBufferReplaceDataBytes(
        with: src.baseAddress!, blockBuffer: bb,
        offsetIntoDestination: 0, dataLength: blob.count
      )
    }
    guard copyStatus == kCMBlockBufferNoErr else {
      throw RendererError.sampleBufferFailed(copyStatus)
    }

    var timing = CMSampleTimingInfo(
      duration: .invalid,
      presentationTimeStamp: pts,
      decodeTimeStamp: .invalid
    )
    var sampleSize = blob.count
    var sample: CMSampleBuffer?
    let status = CMSampleBufferCreateReady(
      allocator: kCFAllocatorDefault,
      dataBuffer: bb,
      formatDescription: formatDescription,
      sampleCount: 1,
      sampleTimingEntryCount: 1,
      sampleTimingArray: &timing,
      sampleSizeEntryCount: 1,
      sampleSizeArray: &sampleSize,
      sampleBufferOut: &sample
    )
    guard status == noErr, let s = sample else {
      throw RendererError.sampleBufferFailed(status)
    }

    // Mark non-keyframes for proper sync handling in the queue.
    if !isKeyframe {
      if let attsArr = CMSampleBufferGetSampleAttachmentsArray(s, createIfNecessary: true)
          as? [NSMutableDictionary], let attrs = attsArr.first {
        attrs[kCMSampleAttachmentKey_NotSync as String] = true
      }
    }
    return s
  }

  private func enqueueOnLayer(_ sample: CMSampleBuffer) {
    guard let layer = displayLayer else { return }
    // AVSampleBufferDisplayLayer.enqueue is thread-safe per docs; calling
    // from main flooded the main queue and led to render-thread starvation
    // after ~6s of high-fps stream on iOS 17 sim.
    if layer.status == .failed {
      layer.flush()
    }
    layer.enqueue(sample)
  }

}
