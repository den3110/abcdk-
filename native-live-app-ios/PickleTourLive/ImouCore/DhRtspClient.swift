// DhRtspClient.swift — port of imou/dh_rtsp.DhRtspSession
//
// Live transport: standard RTSP verbs (OPTIONS / DESCRIBE / SETUP / PLAY /
// TEARDOWN) over TCP, BUT with Dahua's custom packetization profile:
//
//   Transport: DH/RTP/TCP;unicast;interleaved=0-1   (video)
//   Transport: DH/RTP/TCP;unicast;interleaved=2-3   (audio, if requested)
//
// Stock Transport: RTP/AVP/TCP is 200-OK'd but server never pushes frames.
//
// Uses raw POSIX socket (Darwin) instead of NWConnection — NWConnection's
// receive callback stops firing ~10s into the stream on iOS 17 sim, while
// the underlying TCP keeps delivering data (verified via Python imou-pkg
// which sustains the same stream for 30s+ using socket.recv()).

import Foundation
import Darwin

public final class DhRtspClient {

  public struct Config {
    public let url: String
    public let audio: Bool
    public let connectTimeout: TimeInterval
    public let readTimeout: TimeInterval
    public let playRange: String

    public init(url: String, audio: Bool = true,
                connectTimeout: TimeInterval = 20,
                readTimeout: TimeInterval = 8,
                playRange: String = "npt=0.000-") {
      self.url = url; self.audio = audio
      self.connectTimeout = connectTimeout; self.readTimeout = readTimeout
      self.playRange = playRange
    }
  }

  public enum DhRtspError: Error {
    case badUrl, badResponse(String), io(String)
  }

  private let cfg: Config
  private var sock: Int32 = -1
  private var rxBuf = Data()
  private var cseq = 1
  private var sessionId: String?
  private let sockLock = NSLock()
  private var keepaliveTask: Task<Void, Never>?

  public init(_ cfg: Config) { self.cfg = cfg }

  // MARK: – Open / handshake

  public func open() async throws {
    guard let url = URL(string: cfg.url) else { throw DhRtspError.badUrl }
    let host = url.host ?? ""
    let port = UInt16(url.port ?? 554)
    try await connect(host: host, port: port,
                      timeout: cfg.connectTimeout)

    NSLog("[DhRtspClient] OPEN url=\(cfg.url)")
    try sendRtspSync("OPTIONS", url: cfg.url, headers: [:])
    let optResp = try readRtspResponseSync()
    NSLog("[DhRtspClient] OPTIONS → \(optResp.statusLine)")

    try sendRtspSync("DESCRIBE", url: cfg.url, headers: ["Accept": "application/sdp"])
    let descResp = try readRtspResponseSync()
    NSLog("[DhRtspClient] DESCRIBE → \(descResp.statusLine) body=\(descResp.body.count)B")

    try sendRtspSync("SETUP", url: cfg.url + "/trackID=0",
                     headers: ["Transport": "DH/RTP/TCP;unicast;interleaved=0-1"])
    let setupResp = try readRtspResponseSync()
    NSLog("[DhRtspClient] SETUP video → \(setupResp.statusLine) session=\(setupResp.headers["session"] ?? "<none>")")
    sessionId = setupResp.headers["session"]?.split(separator: ";").first.map(String.init)
                 .map { $0.trimmingCharacters(in: .whitespaces) }

    if cfg.audio, let sid = sessionId {
      try sendRtspSync("SETUP", url: cfg.url + "/trackID=1",
                       headers: [
                        "Transport": "DH/RTP/TCP;unicast;interleaved=2-3",
                        "Session": sid,
                       ])
      let setupAudio = try readRtspResponseSync()
      NSLog("[DhRtspClient] SETUP audio → \(setupAudio.statusLine)")
    }

    try sendRtspSync("PLAY", url: cfg.url + "/",
                     headers: [
                      "Session": sessionId ?? "",
                      "Range": cfg.playRange,
                     ])
    let playResp = try readRtspResponseSync()
    NSLog("[DhRtspClient] PLAY → \(playResp.statusLine)")
    startKeepalive()
  }

  private func connect(host: String, port: UInt16, timeout: TimeInterval) async throws {
    let s = Darwin.socket(AF_INET, SOCK_STREAM, IPPROTO_TCP)
    guard s >= 0 else { throw DhRtspError.io("socket() failed: \(errno)") }

    // Resolve host
    var hints = addrinfo(ai_flags: 0, ai_family: AF_INET, ai_socktype: SOCK_STREAM,
                         ai_protocol: IPPROTO_TCP,
                         ai_addrlen: 0, ai_canonname: nil, ai_addr: nil, ai_next: nil)
    var result: UnsafeMutablePointer<addrinfo>? = nil
    let rv = getaddrinfo(host, String(port), &hints, &result)
    guard rv == 0, let info = result else {
      Darwin.close(s)
      throw DhRtspError.io("getaddrinfo failed: \(rv)")
    }
    defer { freeaddrinfo(info) }

    let conRv = Darwin.connect(s, info.pointee.ai_addr, info.pointee.ai_addrlen)
    guard conRv == 0 else {
      Darwin.close(s)
      throw DhRtspError.io("connect() failed: \(errno)")
    }

    // Set non-blocking? No — Python uses blocking with settimeout. We'll
    // do the same: blocking with a recv-side timeout.
    var tv = timeval(tv_sec: Int(timeout), tv_usec: 0)
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
    var on: Int32 = 1
    setsockopt(s, IPPROTO_TCP, TCP_NODELAY, &on, socklen_t(MemoryLayout<Int32>.size))
    // Constrain TCP receive buffer to match Python's `recv(16384)` pattern.
    // Default iOS sim RCVBUF is much larger and lets the server burst
    // hundreds of KB up front, after which a token-bucket on the relay
    // pauses for the equivalent steady-rate duration. Smaller RCVBUF
    // throttles inbound so server stays in steady-state.
    var rcvBufSize: Int32 = 32 * 1024
    setsockopt(s, SOL_SOCKET, SO_RCVBUF, &rcvBufSize,
               socklen_t(MemoryLayout<Int32>.size))

    self.sock = s
  }

  // MARK: – Synchronous wire I/O

  private func sendAll(_ data: Data) throws {
    sockLock.lock(); defer { sockLock.unlock() }
    guard sock >= 0 else { throw DhRtspError.io("not open") }
    try data.withUnsafeBytes { raw in
      let base = raw.bindMemory(to: UInt8.self).baseAddress!
      var sent = 0
      while sent < data.count {
        let n = Darwin.send(sock, base.advanced(by: sent), data.count - sent, 0)
        if n < 0 {
          if errno == EINTR { continue }
          throw DhRtspError.io("send() failed: \(errno)")
        }
        if n == 0 { throw DhRtspError.io("send() returned 0 (closed)") }
        sent += n
      }
    }
  }

  /// Blocking recv of up to `maxBytes`. Returns the bytes read (may be < max
  /// if recv() returned early). Throws on error or EOF.
  private func recvSome(maxBytes: Int = 65536) throws -> Data {
    guard sock >= 0 else { throw DhRtspError.io("not open") }
    var buf = [UInt8](repeating: 0, count: maxBytes)
    let n = buf.withUnsafeMutableBufferPointer { ptr -> Int in
      return Darwin.recv(sock, ptr.baseAddress!, maxBytes, 0)
    }
    if n < 0 {
      if errno == EAGAIN || errno == EWOULDBLOCK {
        throw DhRtspError.io("recv() timeout")
      }
      throw DhRtspError.io("recv() failed: \(errno)")
    }
    if n == 0 { throw DhRtspError.io("closed") }
    return Data(buf.prefix(n))
  }

  // MARK: – RTSP request/response (synchronous)

  private func sendRtspSync(_ method: String, url: String, headers: [String: String]) throws {
    cseq += 1
    var lines = ["\(method) \(url) RTSP/1.0",
                 "CSeq: \(cseq)",
                 "User-Agent: imou-rn-native/0.1"]
    for (k, v) in headers { lines.append("\(k): \(v)") }
    let req = lines.joined(separator: "\r\n") + "\r\n\r\n"
    try sendAll(Data(req.utf8))
  }

  private struct RtspResponse {
    let statusLine: String
    let headers: [String: String]
    let body: Data
  }

  private func readRtspResponseSync() throws -> RtspResponse {
    while rxBuf.range(of: Data("\r\n\r\n".utf8)) == nil {
      let chunk = try recvSome()
      rxBuf.append(chunk)
    }
    guard let range = rxBuf.range(of: Data("\r\n\r\n".utf8)) else {
      throw DhRtspError.badResponse("no header end")
    }
    let headData = rxBuf.subdata(in: rxBuf.startIndex..<range.lowerBound)
    rxBuf.removeSubrange(rxBuf.startIndex..<range.upperBound)
    let lines = String(data: headData, encoding: .utf8)?.components(separatedBy: "\r\n") ?? []
    let status = lines.first ?? ""
    var headers: [String: String] = [:]
    var contentLength = 0
    for line in lines.dropFirst() {
      let p = line.split(separator: ":", maxSplits: 1).map(String.init)
      if p.count == 2 {
        let k = p[0].lowercased().trimmingCharacters(in: .whitespaces)
        let v = p[1].trimmingCharacters(in: .whitespaces)
        headers[k] = v
        if k == "content-length" { contentLength = Int(v) ?? 0 }
      }
    }
    while rxBuf.count < contentLength {
      let chunk = try recvSome()
      rxBuf.append(chunk)
    }
    let body = rxBuf.subdata(in: rxBuf.startIndex..<(rxBuf.startIndex + contentLength))
    rxBuf.removeSubrange(rxBuf.startIndex..<(rxBuf.startIndex + contentLength))
    return RtspResponse(statusLine: status, headers: headers, body: body)
  }

  // MARK: – Streaming loop

  /// Calls `onChunk` for every DHAV interleaved packet payload.
  /// Return `true` from the closure to continue, `false` to stop the loop.
  /// The ENTIRE recv loop runs on a background thread (mirrors Python's
  /// blocking recv pattern). No async/await context switch per chunk —
  /// that introduced enough scheduling overhead under load that frames
  /// stopped reaching the renderer after ~12s on iOS 17 sim.
  public func runChunkLoop(onChunk: @escaping (Data) -> Bool) async throws {
    let keep: Set<UInt8> = cfg.audio ? [0, 2] : [0]
    try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
      DispatchQueue.global(qos: .userInitiated).async { [weak self] in
        guard let self = self else { cont.resume(); return }
        var totalBytesRead = 0
        var chunksYielded = 0
        var lastLog = Date()
        var keepGoing = true
        while keepGoing && !Task.isCancelled {
          while self.rxBuf.count >= 4, self.rxBuf.first == UInt8(ascii: "$") {
            let b = self.rxBuf.startIndex
            let ch = self.rxBuf[b + 1]
            let len = (Int(self.rxBuf[b + 2]) << 8) | Int(self.rxBuf[b + 3])
            if self.rxBuf.count < 4 + len { break }
            let pktStart = b + 4
            let pkt = self.rxBuf.subdata(in: pktStart..<(pktStart + len))
            self.rxBuf.removeSubrange(b..<(b + 4 + len))
            if keep.contains(ch), pkt.count > 12 {
              if !onChunk(pkt.subdata(in: 12..<pkt.count)) { keepGoing = false; break }
              chunksYielded += 1
            }
          }
          if !keepGoing { break }
          if !self.rxBuf.isEmpty, self.rxBuf.first != UInt8(ascii: "$") {
            if let dollarRange = self.rxBuf.range(of: Data([UInt8(ascii: "$")])) {
              let drop = dollarRange.lowerBound - self.rxBuf.startIndex
              NSLog("[DhRtspClient] resync: drop \(drop) garbage bytes before next $")
              self.rxBuf.removeSubrange(self.rxBuf.startIndex..<dollarRange.lowerBound)
            } else {
              NSLog("[DhRtspClient] no $ in rxBuf (\(self.rxBuf.count)B) — clearing")
              self.rxBuf.removeAll(keepingCapacity: true)
            }
          }
          if Date().timeIntervalSince(lastLog) >= 5 {
            NSLog("[DhRtspClient] stats: rxBytes=\(totalBytesRead) chunks=\(chunksYielded) buf=\(self.rxBuf.count)B")
            lastLog = Date()
          }
          do {
            let chunk = try self.recvSome()
            totalBytesRead += chunk.count
            self.rxBuf.append(chunk)
          } catch {
            NSLog("[DhRtspClient] recv threw: \(error)")
            cont.resume(throwing: error)
            return
          }
        }
        cont.resume()
      }
    }
  }

  // MARK: – Keepalive (periodic OPTIONS to refresh RTSP session)

  private func startKeepalive() {
    let sid = self.sessionId
    keepaliveTask = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: 25_000_000_000)
        if Task.isCancelled { break }
        guard let self = self else { return }
        do {
          try self.sendRtspSync("OPTIONS", url: self.cfg.url,
                                headers: ["Session": sid ?? ""])
          NSLog("[DhRtspClient] keepalive OPTIONS sent")
        } catch {
          NSLog("[DhRtspClient] keepalive failed: \(error)")
          break
        }
      }
    }
  }

  // MARK: – Close

  public func close() {
    keepaliveTask?.cancel(); keepaliveTask = nil
    if let sid = sessionId, sock >= 0 {
      try? sendRtspSync("TEARDOWN", url: cfg.url, headers: ["Session": sid])
    }
    if sock >= 0 { Darwin.close(sock); sock = -1 }
  }
}
