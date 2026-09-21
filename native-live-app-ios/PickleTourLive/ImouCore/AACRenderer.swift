// AACRenderer.swift — decode AAC ADTS audio frames from DHAV stream and
// render through AVAudioEngine.
//
// Audio frames in DHAV stream:
//   - frame[4] == 0xf0 (audio frame type)
//   - payload (after ext_hdr) is one AAC ADTS packet: starts with 0xFF Fx
//   - sample rate / channels parsed from ADTS header
//
// Pipeline:
//   enqueue(dhavFrame) → strip DHAV wrapper → parse ADTS header
//     → push AAC payload to pendingPackets
//     → kick decodeQueue if idle
//   decodeQueue: AudioConverter (AAC LC → PCM Float32)
//     → AVAudioPCMBuffer → player.scheduleBuffer → audio out
//
// Latency target: <200ms. Best-effort sync with video (no PTS-driven sync,
// audio engine free-runs).

import Foundation
import AVFoundation
import AudioToolbox

public final class AACRenderer {

  public private(set) var isStarted = false
  public var enabled: Bool = true

  private let engine = AVAudioEngine()
  private let player = AVAudioPlayerNode()
  private var converter: AudioConverterRef?
  private var outputAVFormat: AVAudioFormat?
  private var sampleRate: Double = 0
  private var channels: UInt32 = 0

  /// Snapshot config cho Recorder seed audio track. nil nếu chưa parse ADTS. */
  public func audioConfigSnapshot() -> (sampleRate: Double, channels: UInt32)? {
    if sampleRate <= 0 || channels == 0 { return nil }
    return (sampleRate, channels)
  }

  /// Queue of raw AAC payloads (after ADTS 7-byte header stripped), as
  /// owned `[UInt8]`.
  private let queueLock = NSLock()
  private var pendingPackets: [[UInt8]] = []
  /// Raw bytes buffer currently being fed to the converter. Allocated +
  /// freed per FillComplexBuffer call from drainDecodeQueue.
  private var currentPacketBuf: UnsafeMutableRawPointer? = nil
  private var currentPacketLen: Int = 0
  private var currentPacketConsumed: Bool = false
  /// Heap-allocated so its pointer is stable to hand back to the converter
  /// via the inputCallback's `outDataPacketDescription` parameter (which
  /// expects a pointer that outlives the callback's local scope).
  private let packetDescPtr: UnsafeMutablePointer<AudioStreamPacketDescription> =
    UnsafeMutablePointer.allocate(capacity: 1)

  /// Dedicated serial queue for decode so we don't block the recv thread.
  private let decodeQueue = DispatchQueue(label: "imou.audio.decode",
                                          qos: .userInitiated)
  private var decodeBusy = false

  public init() {}

  deinit {
    packetDescPtr.deallocate()
  }

  public func start() {
    guard !isStarted else { return }
    isStarted = true
    // Set up audio session. On simulator no real device, but `.playback`
    // category is harmless.
    let session = AVAudioSession.sharedInstance()
    try? session.setCategory(.playback, mode: .moviePlayback,
                              options: [.mixWithOthers])
    try? session.setActive(true)
  }

  public func stop() {
    guard isStarted else { return }
    isStarted = false
    player.stop()
    engine.stop()
    if let c = converter { AudioConverterDispose(c); converter = nil }
    outputAVFormat = nil
    queueLock.lock()
    pendingPackets.removeAll()
    queueLock.unlock()
  }

  public func reset() { stop() }

  /// Runtime mute. Drops player volume to 0 (still decodes) so toggling
  /// is instantaneous — no need to tear down decoder.
  public func setMuted(_ muted: Bool) {
    if engine.isRunning {
      engine.mainMixerNode.outputVolume = muted ? 0.0 : 1.0
    }
  }

  // MARK: – Public entry point

  /// Feed one DHAV audio frame from Player. Strips DHAV wrapper, parses
  /// ADTS header to configure converter (one-time), pushes raw AAC payload
  /// to decode queue.
  public func enqueue(dhavFrame frame: Data) {
    guard enabled, isStarted else { return }
    // DHAV layout:
    //   0x00..0x03  'DHAV'
    //   0x04        type (must be 0xf0 for audio)
    //   0x16        ext_hdr_len
    //   0x18..      ext_hdr ... then ADTS payload ... then 8-byte trailer
    guard frame.count > 0x20,
          frame.prefix(4) == Data("DHAV".utf8) else { return }
    let b = frame.startIndex
    guard frame[b + 4] == 0xf0 else { return }
    let extLen = Int(frame[b + 0x16])
    let pStart = b + 0x18 + extLen
    let pEnd = frame.endIndex - 8
    guard pStart + 7 < pEnd else { return }

    // ADTS header check (0xFF Fx)
    guard frame[pStart] == 0xFF, (frame[pStart + 1] & 0xF0) == 0xF0 else { return }

    // Configure converter on first packet (idempotent).
    if converter == nil {
      configureFromAdts(headerStart: pStart, frame: frame)
      if converter == nil { return }
    }

    // ADTS frame_length = bits at byte[3].lsb 2bits | byte[4] (8) | byte[5].msb 3 bits
    let len = (Int(frame[pStart + 3] & 0x03) << 11)
            | (Int(frame[pStart + 4]) << 3)
            | (Int(frame[pStart + 5]) >> 5)
    let actualEnd = min(pStart + len, pEnd)
    guard actualEnd > pStart + 7 else { return }

    // Raw AAC payload = ADTS frame without the 7-byte header.
    let payload = Array(frame[(pStart + 7)..<actualEnd])

    queueLock.lock()
    pendingPackets.append(payload)
    let kick = !decodeBusy
    if kick { decodeBusy = true }
    queueLock.unlock()

    if kick { decodeQueue.async { [weak self] in self?.drainDecodeQueue() } }
  }

  // MARK: – Converter setup

  private func configureFromAdts(headerStart: Int, frame: Data) {
    // ADTS bits:
    //   syncword(12) | id(1) | layer(2) | protection_absent(1)
    //   profile(2) | sampling_frequency_index(4) | private_bit(1)
    //   channel_configuration(3) | ...
    let sfIdx = (Int(frame[headerStart + 2]) >> 2) & 0x0f
    let chCfg = ((Int(frame[headerStart + 2]) & 0x01) << 2)
              | (Int(frame[headerStart + 3]) >> 6)
    let table: [Double] = [
      96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050,
      16000, 12000, 11025, 8000, 7350,
    ]
    sampleRate = table.indices.contains(sfIdx) ? table[sfIdx] : 16000.0
    channels = UInt32(chCfg == 0 ? 1 : chCfg)
    NSLog("[AACRenderer] configuring: \(sampleRate)Hz \(channels)ch")

    var input = AudioStreamBasicDescription(
      mSampleRate: sampleRate, mFormatID: kAudioFormatMPEG4AAC,
      mFormatFlags: 2,  // kMPEG4Object_AAC_LC = 2
      mBytesPerPacket: 0, mFramesPerPacket: 1024,
      mBytesPerFrame: 0, mChannelsPerFrame: channels,
      mBitsPerChannel: 0, mReserved: 0
    )
    var output = AudioStreamBasicDescription(
      mSampleRate: sampleRate, mFormatID: kAudioFormatLinearPCM,
      mFormatFlags: kAudioFormatFlagIsFloat
                  | kAudioFormatFlagIsPacked
                  | kAudioFormatFlagsNativeEndian,
      mBytesPerPacket: 4 * channels, mFramesPerPacket: 1,
      mBytesPerFrame: 4 * channels, mChannelsPerFrame: channels,
      mBitsPerChannel: 32, mReserved: 0
    )

    var conv: AudioConverterRef?
    let st = AudioConverterNew(&input, &output, &conv)
    guard st == noErr, let conv = conv else {
      NSLog("[AACRenderer] AudioConverterNew failed: \(st)")
      return
    }
    converter = conv

    let fmt = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                             sampleRate: sampleRate,
                             channels: channels,
                             interleaved: true)
    outputAVFormat = fmt
    guard let fmt = fmt else { return }

    engine.attach(player)
    engine.connect(player, to: engine.mainMixerNode, format: fmt)
    do {
      try engine.start()
      player.play()
      NSLog("[AACRenderer] engine started OK")
    } catch {
      NSLog("[AACRenderer] engine.start failed: \(error)")
    }
  }

  // MARK: – Decode loop

  /// Pulls packets off pendingPackets and feeds them through the
  /// converter, scheduling resulting PCM into the player node.
  private func drainDecodeQueue() {
    guard let conv = converter, let outFmt = outputAVFormat else {
      queueLock.lock(); decodeBusy = false; queueLock.unlock()
      return
    }
    while true {
      queueLock.lock()
      guard !pendingPackets.isEmpty else {
        decodeBusy = false
        queueLock.unlock()
        return
      }
      let pkt = pendingPackets.removeFirst()
      queueLock.unlock()

      // One AAC packet decodes to exactly 1024 PCM frames (LC profile).
      var outFrames: UInt32 = 1024
      guard let pcm = AVAudioPCMBuffer(pcmFormat: outFmt,
                                        frameCapacity: outFrames) else { continue }

      // Allocate a stable buffer for the input packet that lives until
      // FillComplexBuffer returns. Then free.
      let buf = UnsafeMutableRawPointer.allocate(byteCount: pkt.count,
                                                   alignment: 1)
      pkt.withUnsafeBufferPointer { src in
        buf.copyMemory(from: src.baseAddress!, byteCount: pkt.count)
      }
      currentPacketBuf = buf
      currentPacketLen = pkt.count
      currentPacketConsumed = false
      packetDescPtr.pointee = AudioStreamPacketDescription(
        mStartOffset: 0,
        mVariableFramesInPacket: 0,
        mDataByteSize: UInt32(pkt.count)
      )
      let ctxPtr = Unmanaged.passUnretained(self).toOpaque()
      let abl = pcm.mutableAudioBufferList
      // AVAudioPCMBuffer leaves mDataByteSize=0 by default — converter
      // refuses to write into "size 0" output. Set it to the allocated
      // capacity in bytes so converter knows it can write up to here.
      abl.pointee.mBuffers.mDataByteSize = outFrames * 4 * channels

      let st = AudioConverterFillComplexBuffer(
        conv,
        Self.inputCallback,
        ctxPtr,
        &outFrames,
        abl,
        nil
      )

      buf.deallocate()
      currentPacketBuf = nil
      currentPacketLen = 0

      if st != noErr {
        NSLog("[AACRenderer] FillComplexBuffer status=\(st)")
        continue
      }
      if outFrames == 0 { continue }
      pcm.frameLength = outFrames
      player.scheduleBuffer(pcm, completionHandler: nil)
      dbgDecoded += 1
      if dbgDecoded % 100 == 0 {
        NSLog("[AACRenderer] decoded=\(dbgDecoded) packets, last=\(outFrames) PCM frames, player.isPlaying=\(player.isPlaying)")
      }
    }
  }
  private var dbgDecoded = 0

  /// Static C callback handed to AudioConverterFillComplexBuffer.
  /// Returns exactly 1 packet (the currentPacketBuf), then nil after.
  private static let inputCallback: AudioConverterComplexInputDataProc = {
    (_, ioNumberDataPackets, ioData, outPacketDesc, inUserData) in

    let owner = Unmanaged<AACRenderer>.fromOpaque(inUserData!)
                  .takeUnretainedValue()
    if owner.currentPacketConsumed || owner.currentPacketBuf == nil {
      ioNumberDataPackets.pointee = 0
      return noErr
    }
    owner.currentPacketConsumed = true

    ioData.pointee.mNumberBuffers = 1
    ioData.pointee.mBuffers.mNumberChannels = owner.channels
    ioData.pointee.mBuffers.mDataByteSize = UInt32(owner.currentPacketLen)
    ioData.pointee.mBuffers.mData = owner.currentPacketBuf
    ioNumberDataPackets.pointee = 1

    // Hand back the packet description via the heap-allocated pointer
    // that lives as long as the renderer.
    if let pd = outPacketDesc {
      pd.pointee = owner.packetDescPtr
    }
    return noErr
  }
}
