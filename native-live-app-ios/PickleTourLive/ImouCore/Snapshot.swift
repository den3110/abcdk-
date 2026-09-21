// Snapshot.swift — short-lived live session that captures one decoded frame
// as JPEG and writes to a temp file.
//
// Pipeline:
//   DhRtspClient (audio=false) → DHAV chunks
//     → DHAVParser.Assembler
//     → first frame with isKeyframe == true → HEVCNalExtractor + VTDecompressionSession
//     → CVPixelBuffer → CIImage → JPEG → file://
//
// We DON'T use AVSampleBufferDisplayLayer here — we need pixel buffer access,
// so we drive a VTDecompressionSession directly.

import Foundation
import AVFoundation
import VideoToolbox
import CoreImage

public final class Snapshot {

  public enum SnapshotError: Error {
    case noKeyframe, decodeFailed(OSStatus), writeFailed
  }

  /// Capture one JPEG frame from a live stream, returning file:// URL.
  public static func capture(streamUrl: String,
                              timeoutSeconds: TimeInterval = 8.0) async throws -> URL {
    let client = DhRtspClient(.init(url: streamUrl, audio: false))
    try await client.open()
    defer { client.close() }

    let assembler = DHAVParser.Assembler(key: Data())
    let psCache = HEVCNalExtractor.ParamSetCache()
    var fmtDesc: CMVideoFormatDescription?
    var session: VTDecompressionSession?
    var capturedPixelBuffer: CVPixelBuffer?
    var detectedCodec: VideoCodec?   // sticky (HEVC or H.264)

    let deadline = Date().addingTimeInterval(timeoutSeconds)
    try await client.runChunkLoop { chunk -> Bool in
      if Date() > deadline { return false }
      assembler.push(chunk)
      for frame in assembler.popFrames() {
        guard frame.count > 0x18 else { continue }
        let ft = frame[frame.startIndex + 4]
        guard ft == 0xfd || ft == 0xfc else { continue }
        let extHdrLen = Int(frame[frame.startIndex + 0x16])
        let pStart = frame.startIndex + 0x18 + extHdrLen
        let pEnd = frame.endIndex - 8
        guard pStart < pEnd else { continue }
        let payload = frame.subdata(in: pStart..<pEnd)
        let nalus = HEVCNalExtractor.extractNalus(payload, codecHint: detectedCodec)
        if nalus.isEmpty { continue }
        if detectedCodec == nil { detectedCodec = nalus.first?.codec }  // sticky
        psCache.absorb(nalus)
        if !psCache.isComplete { continue }

        if fmtDesc == nil { fmtDesc = try? buildFormatDesc(psCache) }
        if session == nil, let fd = fmtDesc {
          session = try? createSession(fmt: fd) { pb in
            capturedPixelBuffer = pb
          }
        }
        guard let s = session else { continue }

        let dataNals = nalus.filter {
          $0.type.isKeyframe || $0.type == .slice
        }
        if !dataNals.contains(where: { $0.type.isKeyframe }) { continue }

        let blob = HEVCNalExtractor.toLengthPrefixed(dataNals)
        try? decodeOne(session: s, formatDesc: fmtDesc!, blob: blob)
        if capturedPixelBuffer != nil { break }
      }
      return capturedPixelBuffer == nil
    }

    guard let pb = capturedPixelBuffer else { throw SnapshotError.noKeyframe }
    return try writeJpeg(pixelBuffer: pb)
  }

  // MARK: – Internals

  /// Codec-aware format-desc builder. HEVC needs VPS+SPS+PPS;
  /// H.264 needs SPS+PPS only (no VPS) — mirrors HEVCRenderer.
  private static func buildFormatDesc(_ ps: HEVCNalExtractor.ParamSetCache) throws
      -> CMVideoFormatDescription {
    guard let s = ps.sps, let p = ps.pps else {
      throw SnapshotError.decodeFailed(-1)
    }
    var fmt: CMVideoFormatDescription?
    let status: OSStatus
    switch ps.codec {
    case .hevc:
      guard let v = ps.vps else { throw SnapshotError.decodeFailed(-1) }
      status = v.withUnsafeBytes { vRaw -> OSStatus in
        s.withUnsafeBytes { sRaw -> OSStatus in
          p.withUnsafeBytes { pRaw -> OSStatus in
            let pointers: [UnsafePointer<UInt8>] = [
              vRaw.bindMemory(to: UInt8.self).baseAddress!,
              sRaw.bindMemory(to: UInt8.self).baseAddress!,
              pRaw.bindMemory(to: UInt8.self).baseAddress!,
            ]
            let sizes: [Int] = [v.count, s.count, p.count]
            return pointers.withUnsafeBufferPointer { ptrBuf in
              sizes.withUnsafeBufferPointer { sizeBuf in
                CMVideoFormatDescriptionCreateFromHEVCParameterSets(
                  allocator: kCFAllocatorDefault, parameterSetCount: 3,
                  parameterSetPointers: ptrBuf.baseAddress!,
                  parameterSetSizes: sizeBuf.baseAddress!,
                  nalUnitHeaderLength: 4, extensions: nil,
                  formatDescriptionOut: &fmt
                )
              }
            }
          }
        }
      }
    case .h264:
      status = s.withUnsafeBytes { sRaw -> OSStatus in
        p.withUnsafeBytes { pRaw -> OSStatus in
          let pointers: [UnsafePointer<UInt8>] = [
            sRaw.bindMemory(to: UInt8.self).baseAddress!,
            pRaw.bindMemory(to: UInt8.self).baseAddress!,
          ]
          let sizes: [Int] = [s.count, p.count]
          return pointers.withUnsafeBufferPointer { ptrBuf in
            sizes.withUnsafeBufferPointer { sizeBuf in
              CMVideoFormatDescriptionCreateFromH264ParameterSets(
                allocator: kCFAllocatorDefault, parameterSetCount: 2,
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
    if status != noErr || fmt == nil { throw SnapshotError.decodeFailed(status) }
    return fmt!
  }

  private static func createSession(fmt: CMVideoFormatDescription,
                                     onFrame: @escaping (CVPixelBuffer) -> Void)
                                     throws -> VTDecompressionSession {
    let attrs: [String: Any] = [
      kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA),
      kCVPixelBufferIOSurfacePropertiesKey as String: [:],
    ]
    var callback = VTDecompressionOutputCallbackRecord(
      decompressionOutputCallback: { (refcon, _, status, _, imageBuffer, _, _) in
        guard status == noErr, let imageBuffer = imageBuffer,
              let refcon = refcon else { return }
        let cb = Unmanaged<CallbackBox>.fromOpaque(refcon).takeUnretainedValue()
        cb.handler(imageBuffer)
      },
      decompressionOutputRefCon: nil
    )
    let box = CallbackBox(handler: onFrame)
    callback.decompressionOutputRefCon = Unmanaged.passRetained(box).toOpaque()
    var session: VTDecompressionSession?
    let st = VTDecompressionSessionCreate(
      allocator: kCFAllocatorDefault,
      formatDescription: fmt,
      decoderSpecification: nil,
      imageBufferAttributes: attrs as CFDictionary,
      outputCallback: &callback,
      decompressionSessionOut: &session
    )
    if st != noErr || session == nil { throw SnapshotError.decodeFailed(st) }
    return session!
  }

  private static func decodeOne(session: VTDecompressionSession,
                                 formatDesc: CMVideoFormatDescription,
                                 blob: Data) throws {
    var bb: CMBlockBuffer?
    let allocStatus = CMBlockBufferCreateWithMemoryBlock(
      allocator: kCFAllocatorDefault, memoryBlock: nil,
      blockLength: blob.count, blockAllocator: nil,
      customBlockSource: nil, offsetToData: 0,
      dataLength: blob.count, flags: 0,
      blockBufferOut: &bb
    )
    if allocStatus != kCMBlockBufferNoErr {
      throw SnapshotError.decodeFailed(allocStatus)
    }
    _ = blob.withUnsafeBytes {
      CMBlockBufferReplaceDataBytes(with: $0.baseAddress!, blockBuffer: bb!,
                                    offsetIntoDestination: 0, dataLength: blob.count)
    }
    var timing = CMSampleTimingInfo(duration: .invalid,
                                     presentationTimeStamp: .zero,
                                     decodeTimeStamp: .invalid)
    var sampleSize = blob.count
    var sample: CMSampleBuffer?
    let st = CMSampleBufferCreateReady(
      allocator: kCFAllocatorDefault, dataBuffer: bb,
      formatDescription: formatDesc, sampleCount: 1,
      sampleTimingEntryCount: 1, sampleTimingArray: &timing,
      sampleSizeEntryCount: 1, sampleSizeArray: &sampleSize,
      sampleBufferOut: &sample
    )
    if st != noErr || sample == nil { throw SnapshotError.decodeFailed(st) }
    var flagsOut = VTDecodeInfoFlags()
    let dec = VTDecompressionSessionDecodeFrame(
      session, sampleBuffer: sample!,
      flags: [._EnableAsynchronousDecompression],
      frameRefcon: nil, infoFlagsOut: &flagsOut
    )
    if dec != noErr { throw SnapshotError.decodeFailed(dec) }
    VTDecompressionSessionWaitForAsynchronousFrames(session)
  }

  private static func writeJpeg(pixelBuffer: CVPixelBuffer) throws -> URL {
    let ci = CIImage(cvPixelBuffer: pixelBuffer)
    let ctx = CIContext()
    let url = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
      .appendingPathComponent("imou-snap-\(UUID().uuidString).jpg")
    let cs = CGColorSpace(name: CGColorSpace.sRGB)!
    try ctx.writeJPEGRepresentation(of: ci, to: url, colorSpace: cs, options: [:])
    return url
  }

  private final class CallbackBox {
    let handler: (CVPixelBuffer) -> Void
    init(handler: @escaping (CVPixelBuffer) -> Void) { self.handler = handler }
  }
}
