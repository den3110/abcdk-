// DHAVParser.swift — port of imou/crypto.py and imou/dh_rtsp.decrypt_dhav_stream
//
// DHAV frame layout (verified, see memory imou_decrypter_jni):
//   0x00..0x03  'DHAV'
//   0x04        type (0xfd=I, 0xfc=P, 0xf0=audio)
//   0x05..0x07  reserved
//   0x08..0x0b  expected total size (sometimes >file; ignore — use 0x0c)
//   0x0c..0x0f  actual frame size LE (THIS is the one to chunk by)
//   0x10..0x15  timestamp + seq
//   0x16        ext_hdr_len byte
//   0x17        reserved
//   0x18..0x18+ext_hdr_len   TLV extensions
//   ...                       payload (encrypted iff 0x95 or 0xb5 ext present)
//   size-8..size-4            'dhav' lowercase trailer
//   size-4..size              frame size copy

import Foundation

public enum DHAVParser {

  // MARK: – Ext TLV walker

  public struct ExtEntry {
    public let type: UInt8
    public let bytes: Data  // full entry including type+length header
  }

  /// Robust ext_hdr walker. Unknown byte type → assume 2-byte entry so the
  /// walk reaches downstream 0x95/0xb5 markers instead of bailing out.
  /// (This was the fix in Session 8 — previously walker stopped at first
  /// unrecognised byte, missing the encryption marker → I-frame stayed
  /// encrypted → ffmpeg failed POC ref → "1-second jumps".)
  public static func walkExt(_ ext: Data) -> [ExtEntry] {
    let fixed: [UInt8: Int] = [
      0x82: 8, 0x81: 4, 0xa0: 2,
      0x95: 8, 0xb3: 8, 0x88: 4,
    ]
    var out: [ExtEntry] = []
    var i = 0
    while i < ext.count {
      let t = ext[ext.startIndex + i]
      if t == 0xb5 {
        guard i + 1 < ext.count else { return out }
        let l = Int(ext[ext.startIndex + i + 1])
        // Force forward progress — length byte can be 0 on some frames,
        // which would loop forever and OOM. b5 entry minimum is 2 bytes
        // (type + length).
        let advance = max(l, 2)
        let end = min(i + advance, ext.count)
        out.append(ExtEntry(type: t, bytes: ext.subdata(in: (ext.startIndex + i)..<(ext.startIndex + end))))
        i = end
        continue
      }
      let sz = fixed[t] ?? 2
      let end = min(i + sz, ext.count)
      out.append(ExtEntry(type: t, bytes: ext.subdata(in: (ext.startIndex + i)..<(ext.startIndex + end))))
      // Defensive: if end == i (e.g. ext.count == i), break instead of loop
      if end <= i { break }
      i = end
    }
    return out
  }

  public static func findB5(_ ext: Data) -> Data? {
    for e in walkExt(ext) where e.type == 0xb5 {
      // strip 2-byte header (type + length)
      return e.bytes.count > 2 ? e.bytes.subdata(in: (e.bytes.startIndex + 2)..<e.bytes.endIndex) : nil
    }
    return nil
  }

  public static func hasExtType(_ ext: Data, _ target: UInt8) -> Bool {
    return walkExt(ext).contains { $0.type == target }
  }

  // MARK: – Timestamp extract

  /// DHAV header carries a 4-byte timestamp at offset 0x10 (little-endian
  /// uint32 milliseconds since stream start) and a 2-byte sequence/sub-ts
  /// at 0x14. For live streams the camera resets to 0; for SD playback the
  /// timestamps reflect record-time minute boundaries (best-effort).
  ///
  /// We use this as a monotonic PTS source. If the LE u32 looks bogus
  /// (jumps backward), the caller should fall back to wall-clock pacing.
  public static func frameTimestampMs(_ frame: Data) -> UInt32 {
    guard frame.count >= 0x18 else { return 0 }
    let b = frame.startIndex
    return UInt32(frame[b + 0x10]) |
          (UInt32(frame[b + 0x11]) << 8) |
          (UInt32(frame[b + 0x12]) << 16) |
          (UInt32(frame[b + 0x13]) << 24)
  }

  // MARK: – Per-frame decrypt

  public static let ENC2_PREFIX_BYTES = 256
  public static let ENC3_PREFIX_BYTES = 256

  /// Decrypt one full DHAV frame. Auto-detects mode from ext_hdr:
  ///   - 0xb5 present  → enc3 (AES-256-OFB, 256B prefix, IV from b5[25:41])
  ///   - 0x95 present  → enc2 (AES-128-ECB, 256B prefix)
  ///   - neither       → P-frame / plaintext → return unchanged
  ///
  /// Pass:
  ///   - enc2: 16-byte key from CryptoCore.vodFrameKey()
  ///   - enc3: 32-byte key from CryptoCore.vodFrameKeyEnc3()
  public static func decryptVodFrame(_ frame: Data, key: Data) -> Data {
    // Short-circuit for live streams (no decryption key). Skips walkExt
    // + multiple subdata allocs per frame — at ~25 fps with several entries
    // per ext header that adds up to ~1000 Data allocations/sec which
    // halts the render pipeline on iOS sim and device.
    if key.isEmpty { return frame }
    guard frame.count >= 24, frame.prefix(4) == Data("DHAV".utf8) else { return frame }
    let b = frame.startIndex
    let size = UInt32(frame[b + 12]) |
              (UInt32(frame[b + 13]) << 8) |
              (UInt32(frame[b + 14]) << 16) |
              (UInt32(frame[b + 15]) << 24)
    guard Int(size) == frame.count else { return frame }
    let extHdrLen = Int(frame[frame.startIndex + 0x16])
    let pStart = 0x18 + extHdrLen
    let pEnd = frame.count - 8
    guard pStart < pEnd else { return frame }
    let ext = frame.subdata(in: (frame.startIndex + 0x18)..<(frame.startIndex + 0x18 + extHdrLen))
    let payload = frame.subdata(in: (frame.startIndex + pStart)..<(frame.startIndex + pEnd))

    let head: Data
    if let b5 = findB5(ext) {
      // enc3
      guard key.count == 32, b5.count >= 41 else { return frame }
      let iv = b5.subdata(in: (b5.startIndex + 25)..<(b5.startIndex + 41))
      let nEnc = min(ENC3_PREFIX_BYTES, payload.count) / 16 * 16
      guard nEnc > 0 else { return frame }
      let dec = CryptoCore.aesOfbDecrypt(payload.prefix(nEnc), key: key, iv: iv)
      head = dec
      return frame.subdata(in: frame.startIndex..<(frame.startIndex + pStart))
        + head + payload.suffix(payload.count - nEnc)
        + frame.subdata(in: (frame.startIndex + pEnd)..<frame.endIndex)
    } else if hasExtType(ext, 0x95) {
      // enc2
      guard key.count == 16 else { return frame }
      let nEnc = min(ENC2_PREFIX_BYTES, payload.count) / 16 * 16
      guard nEnc > 0 else { return frame }
      head = CryptoCore.aesEcbDecrypt(payload.prefix(nEnc), key: key)
      return frame.subdata(in: frame.startIndex..<(frame.startIndex + pStart))
        + head + payload.suffix(payload.count - nEnc)
        + frame.subdata(in: (frame.startIndex + pEnd)..<frame.endIndex)
    } else {
      // P-frame / audio without 0x95 — plaintext
      return frame
    }
  }

  // MARK: – Stream assembler

  /// Stateful DHAV frame reassembler. Feed chunks via `push`, drain with
  /// `popFrames()`. Auto-decrypts each frame using `key` (auto enc2/enc3).
  public final class Assembler {
    // Read-cursor design — avoid `removeFirst()` (which is O(n) per call on
    // Data and was causing the stream loop to fall behind under sustained
    // streaming on iOS sim). Bytes from [0, readIdx) are dead, compacted
    // periodically when readIdx grows large.
    private var buf = [UInt8]()
    private var readIdx = 0
    private let key: Data

    public init(key: Data) {
      self.key = key
      buf.reserveCapacity(256 * 1024)
    }

    public var bufLen: Int { buf.count - readIdx }

    public func push(_ chunk: Data) {
      chunk.withUnsafeBytes { raw in
        let p = raw.bindMemory(to: UInt8.self)
        buf.append(contentsOf: p)
      }
      // Compact dead prefix occasionally so buf doesn't grow unbounded.
      if readIdx > 64 * 1024 {
        buf.removeFirst(readIdx)
        readIdx = 0
      }
    }

    /// Find "DHAV" magic in buf[readIdx...] without searching dead prefix.
    /// Returns index relative to buf, or nil.
    /// Uses withUnsafeBufferPointer for raw pointer access — Array subscript
    /// has bounds-check overhead that adds up at 40+ scans/s over ~50KB buf.
    private func findDhav(from start: Int) -> Int? {
      let bufCount = buf.count
      let end = bufCount - 4
      if start > end { return nil }
      return buf.withUnsafeBufferPointer { ptr -> Int? in
        let base = ptr.baseAddress!
        var i = start
        while i <= end {
          if base[i] == 0x44 && base[i+1] == 0x48 &&
             base[i+2] == 0x41 && base[i+3] == 0x56 {
            return i
          }
          i += 1
        }
        return nil
      }
    }

    public func popFrames() -> [Data] {
      var out: [Data] = []
      buf.withUnsafeBufferPointer { ptr in
        let base = ptr.baseAddress!
        let bufCount = buf.count
        while true {
          // Inline DHAV magic scan via raw pointer (no nested
          // withUnsafeBufferPointer — that was hitting a slow path).
          var found = -1
          if readIdx + 4 <= bufCount {
            var i = readIdx
            let end = bufCount - 4
            while i <= end {
              if base[i] == 0x44 && base[i+1] == 0x48 &&
                 base[i+2] == 0x41 && base[i+3] == 0x56 {
                found = i; break
              }
              i += 1
            }
          }
          if found < 0 { break }
          readIdx = found
          let remaining = bufCount - readIdx
          guard remaining >= 24 else { break }
          let size = Int(base[readIdx + 12]) |
                    (Int(base[readIdx + 13]) << 8) |
                    (Int(base[readIdx + 14]) << 16) |
                    (Int(base[readIdx + 15]) << 24)
          if size < 32 || size > 64 * 1024 * 1024 { readIdx += 4; continue }
          guard remaining >= size else { break }
          let frame = Data(bytes: base.advanced(by: readIdx), count: size)
          readIdx += size
          out.append(DHAVParser.decryptVodFrame(frame, key: key))
        }
      }
      return out
    }
  }
}
