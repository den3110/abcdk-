// HEVCNalExtractor.swift — split Annex-B HEVC/H.264 payload into individual
// NALUs, identify parameter sets vs slice data, and convert to iOS-friendly
// length-prefixed format for CMSampleBuffer.
//
// HEVC NAL unit types we care about (6-bit, bits 1..6 of byte 0):
//   32 (VPS), 33 (SPS), 34 (PPS)
//   19/20/21 (IDR keyframe), 0/1 (P-slice)
//
// H.264 NAL unit types (5-bit, bits 0..4 of byte 0):
//   7 (SPS), 8 (PPS)
//   5 (IDR keyframe), 1 (P-slice non-IDR)
//   6 (SEI), 9 (AUD)

import Foundation

public enum VideoCodec {
  case hevc, h264
}

public enum HEVCNalType: Equatable {
  case vps, sps, pps, idr, slice, sei, unknown(Int)

  public var isKeyframe: Bool {
    switch self { case .idr: return true; default: return false }
  }
  public var isParamSet: Bool {
    switch self { case .vps, .sps, .pps: return true; default: return false }
  }
}

public struct HEVCNalu {
  public let type: HEVCNalType
  public let nalUnitType: Int          // raw type
  public let bytes: Data               // NAL payload WITHOUT startcode prefix
  public let codec: VideoCodec
}

public enum HEVCNalExtractor {

  /// Walk Annex-B-framed bytes, yield each NAL. Accepts both `00 00 00 01`
  /// and `00 00 01` startcodes. If `codecHint` is supplied, NAL types are
  /// interpreted in that codec; otherwise auto-detected per-call (heuristic
  /// best for parameter-set NALs).
  public static func extractNalus(_ bytes: Data, codecHint: VideoCodec? = nil) -> [HEVCNalu] {
    var out: [HEVCNalu] = []
    let n = bytes.count
    var i = 0
    var nalStart = -1
    // First pass: collect raw NAL ranges
    var ranges: [(Int, Int)] = []
    while i < n - 2 {
      let isStart3 = bytes[bytes.startIndex + i] == 0 &&
                     bytes[bytes.startIndex + i + 1] == 0 &&
                     bytes[bytes.startIndex + i + 2] == 1
      let isStart4 = i < n - 3 &&
                     bytes[bytes.startIndex + i] == 0 &&
                     bytes[bytes.startIndex + i + 1] == 0 &&
                     bytes[bytes.startIndex + i + 2] == 0 &&
                     bytes[bytes.startIndex + i + 3] == 1
      if isStart4 || isStart3 {
        if nalStart >= 0 {
          ranges.append((nalStart, i))
        }
        i += isStart4 ? 4 : 3
        nalStart = i
        continue
      }
      i += 1
    }
    if nalStart >= 0 && nalStart < n {
      ranges.append((nalStart, n))
    }
    // Codec resolution: use caller hint if provided (sticky from previous
    // detection); otherwise heuristic from first NAL byte.
    var codec: VideoCodec = codecHint ?? .hevc
    if codecHint == nil {
      for r in ranges {
        if r.1 > r.0 {
          let head = bytes[bytes.startIndex + r.0]
          codec = detectCodec(firstNalByte: head)
          break
        }
      }
    }
    for r in ranges {
      let slice = bytes.subdata(in:
        (bytes.startIndex + r.0)..<(bytes.startIndex + r.1))
      out.append(makeNal(slice, codec: codec))
    }
    return out
  }

  /// Look at the first byte of a NAL and decide whether the stream is HEVC
  /// or H.264.
  /// HEVC byte0 = `0 | nal_type[6] | layer_id_high[1]`. Common params: VPS=0x40, SPS=0x42, PPS=0x44.
  /// H.264 byte0 = `0 | nal_ref_idc[2] | nal_type[5]`. Common params: SPS=0x67, PPS=0x68, IDR=0x65.
  /// Heuristic: H.264 SPS/PPS/IDR have bit 5 set (0x20). HEVC parameter sets
  /// have bit 6 set (0x40) but bit 5 clear. Use these to disambiguate.
  private static func detectCodec(firstNalByte b: UInt8) -> VideoCodec {
    // HEVC NAL types of interest (decoded from (b >> 1) & 0x3f):
    //   32 (VPS), 33 (SPS), 34 (PPS), 19/20/21 (IDR), 0/1 (P-slice)
    // → first bytes 0x40, 0x42, 0x44, 0x26/0x28/0x2a, 0x00/0x02
    // H.264 SPS=0x67 (forbidden=0 ref=3 type=7), PPS=0x68, IDR=0x65, P=0x41.
    // Quick discriminator: H.264 typical bytes have high nibble 6 or 4
    // (0x65, 0x67, 0x68, 0x61, 0x41); HEVC has high nibble 4 or 2 with
    // even low nibble (0x40, 0x42, 0x44, 0x26, 0x28, 0x2a).
    if b == 0x67 || b == 0x68 || b == 0x65 || b == 0x61 { return .h264 }
    return .hevc
  }

  private static func makeNal(_ data: Data, codec: VideoCodec) -> HEVCNalu {
    guard !data.isEmpty else {
      return HEVCNalu(type: .unknown(-1), nalUnitType: -1, bytes: data, codec: codec)
    }
    let head = data[data.startIndex]
    let nt: Int
    let kind: HEVCNalType
    switch codec {
    case .hevc:
      nt = Int((head >> 1) & 0x3f)
      switch nt {
      case 32: kind = .vps
      case 33: kind = .sps
      case 34: kind = .pps
      case 19, 20, 21: kind = .idr
      case 0, 1: kind = .slice
      case 39, 40: kind = .sei
      default: kind = .unknown(nt)
      }
    case .h264:
      nt = Int(head & 0x1f)
      switch nt {
      case 7: kind = .sps
      case 8: kind = .pps
      case 5: kind = .idr
      case 1: kind = .slice
      case 6: kind = .sei
      case 9: kind = .sei  // AUD — treat as SEI (skip)
      default: kind = .unknown(nt)
      }
    }
    return HEVCNalu(type: kind, nalUnitType: nt, bytes: data, codec: codec)
  }

  /// Convert a list of NALs into a CMSampleBuffer-friendly length-prefixed
  /// blob: each NAL is preceded by its 4-byte BIG-ENDIAN length. Same format
  /// for both HEVC (hvcC) and H.264 (avcC).
  public static func toLengthPrefixed(_ nalus: [HEVCNalu]) -> Data {
    var out = Data()
    out.reserveCapacity(nalus.reduce(0) { $0 + $1.bytes.count + 4 })
    for nal in nalus {
      let len = UInt32(nal.bytes.count).bigEndian
      withUnsafeBytes(of: len) { out.append(contentsOf: $0) }
      out.append(nal.bytes)
    }
    return out
  }

  /// Holds the latest parameter set NAL bytes for either codec.
  /// HEVC needs VPS+SPS+PPS; H.264 needs SPS+PPS only (no VPS).
  public final class ParamSetCache {
    public private(set) var vps: Data?
    public private(set) var sps: Data?
    public private(set) var pps: Data?
    public private(set) var codec: VideoCodec = .hevc

    public init() {}

    public var isComplete: Bool {
      switch codec {
      case .hevc: return vps != nil && sps != nil && pps != nil
      case .h264: return sps != nil && pps != nil
      }
    }

    /// Returns true if any parameter set changed (or codec switched).
    @discardableResult
    public func absorb(_ nalus: [HEVCNalu]) -> Bool {
      var changed = false
      // If codec switched, reset cache.
      if let first = nalus.first, first.codec != codec {
        codec = first.codec
        vps = nil; sps = nil; pps = nil
        changed = true
      }
      for n in nalus {
        switch n.type {
        case .vps: if vps != n.bytes { vps = n.bytes; changed = true }
        case .sps: if sps != n.bytes { sps = n.bytes; changed = true }
        case .pps: if pps != n.bytes { pps = n.bytes; changed = true }
        default: break
        }
      }
      return changed
    }
  }
}
