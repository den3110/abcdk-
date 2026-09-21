// DhHttpClient.swift — port of imou/dh_rtsp.DhHttpSession
//
// SD playback transport: HTTP-tunnel GET to relay :9132
// Relay = `AEDA HTTP Server/1.0`. Wire format:
//   GET /vod/playback.rtpxav?... HTTP/1.0
//   Accept: application/x-rtsp-tunnelled
//   [optional] Authorization: WSSE profile="UsernameToken"
//   [optional] WSSE: UsernameToken Username=...
//   \r\n\r\n
//   HTTP/1.1 200 OK
//   Private-Length: <sdp-len>
//   Private-Type: application/sdp
//   \r\n\r\n
//   <SDP plaintext, Private-Length bytes>
//   <interleaved binary frames>:
//      $<channel:u8><length:u16-BE><RTP-header-12B><DHAV-payload>
//
// Uses raw POSIX socket (Darwin) — NWConnection had the same sustained
// recv issue as DhRtspClient (callbacks stop firing ~10s in) on iOS sim.

import Foundation
import Darwin

public final class DhHttpClient {

  public struct Config {
    public let url: String
    public let audio: Bool
    public let connectTimeout: TimeInterval
    public let readTimeout: TimeInterval
    public let userAgent: String
    public let wssePassword: String?  // for encrypt=3 streams
    public let wsseUser: String

    public init(url: String, audio: Bool = true,
                connectTimeout: TimeInterval = 20,
                readTimeout: TimeInterval = 60,
                userAgent: String = "EASY4IP",
                wsseUser: String = "admin",
                wssePassword: String? = nil) {
      self.url = url; self.audio = audio
      self.connectTimeout = connectTimeout; self.readTimeout = readTimeout
      self.userAgent = userAgent
      self.wsseUser = wsseUser; self.wssePassword = wssePassword
    }
  }

  public enum DhError: Error {
    case badUrl, badResponse(String), io(String), timeout
  }

  private let cfg: Config
  private var sock: Int32 = -1
  private var rxBuf = Data()
  public private(set) var sdp: String = ""
  public private(set) var sessionId: String?

  public init(_ cfg: Config) { self.cfg = cfg }

  // MARK: – Open

  public func open() async throws {
    guard let url = URL(string: cfg.url) else { throw DhError.badUrl }
    let host = url.host ?? ""
    let port = UInt16(url.port ?? 80)
    let pathQuery: String = {
      var p = url.path
      if !p.hasPrefix("/") { p = "/" + p }
      if let q = url.query { return "\(p)?\(q)" }
      return p
    }()

    try connectSocket(host: host, port: port, timeout: cfg.connectTimeout)

    NSLog("[DhHttpClient] OPEN \(host):\(port)\(pathQuery.prefix(80))…")

    // Build request
    var extra = ""
    if let pwd = cfg.wssePassword {
      let tok = CryptoCore.makeWsseToken(devPwd: pwd, username: cfg.wsseUser)
      extra = """
        Authorization: WSSE profile="UsernameToken"\r
        WSSE: UsernameToken Username="\(tok.username)", PasswordDigest="\(tok.passwordDigest)", Nonce="\(tok.nonceHex)", Created="\(tok.created)"\r
        """
    }
    let reqStr = """
      GET \(pathQuery) HTTP/1.0\r
      Host: \(host):\(port)\r
      User-Agent: \(cfg.userAgent)\r
      Accept: application/x-rtsp-tunnelled\r
      Cache-Control: no-store\r
      \(extra)\r
      \r
      """
    try sendAll(Data(reqStr.utf8))

    // Read header
    try readUntilDoubleCrlf()
    let (headLine, headers, sdpLen, leftover) = parseHeader(rxBuf)
    rxBuf = leftover

    guard headLine.contains(" 200 ") || headLine.hasSuffix(" 200") else {
      throw DhError.badResponse("relay rejected: \(headLine)")
    }
    self.sessionId = headers["session-id"]
    NSLog("[DhHttpClient] HTTP \(headLine) sdpLen=\(sdpLen)")

    // Read SDP body
    while rxBuf.count < sdpLen {
      let chunk = try recvSome()
      rxBuf.append(chunk)
    }
    self.sdp = String(data: rxBuf.prefix(sdpLen), encoding: .utf8) ?? ""
    rxBuf.removeSubrange(0..<sdpLen)
  }

  // MARK: – Streaming loop

  /// Calls `onChunk` for each DHAV-byte chunk (RTP 12-byte header stripped).
  /// Return `false` from the closure to stop. Runs on a background queue.
  public func runChunkLoop(onChunk: @escaping (Data) -> Bool) async throws {
    let keepChannels: Set<UInt8> = cfg.audio ? [0, 2] : [0]
    try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
      DispatchQueue.global(qos: .userInitiated).async { [weak self] in
        guard let self = self else { cont.resume(); return }
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
            if keepChannels.contains(ch), pkt.count > 12 {
              if !onChunk(pkt.subdata(in: 12..<pkt.count)) {
                keepGoing = false; break
              }
            }
          }
          if !keepGoing { break }
          do {
            let chunk = try self.recvSome()
            self.rxBuf.append(chunk)
          } catch {
            cont.resume(throwing: error)
            return
          }
        }
        cont.resume()
      }
    }
  }

  // MARK: – Close

  public func close() {
    if sock >= 0 { Darwin.close(sock); sock = -1 }
  }

  // MARK: – POSIX socket wire

  private func connectSocket(host: String, port: UInt16, timeout: TimeInterval) throws {
    let s = Darwin.socket(AF_INET, SOCK_STREAM, IPPROTO_TCP)
    guard s >= 0 else { throw DhError.io("socket() failed: \(errno)") }

    var hints = addrinfo(ai_flags: 0, ai_family: AF_INET, ai_socktype: SOCK_STREAM,
                         ai_protocol: IPPROTO_TCP,
                         ai_addrlen: 0, ai_canonname: nil, ai_addr: nil, ai_next: nil)
    var result: UnsafeMutablePointer<addrinfo>? = nil
    let rv = getaddrinfo(host, String(port), &hints, &result)
    guard rv == 0, let info = result else {
      Darwin.close(s)
      throw DhError.io("getaddrinfo failed: \(rv)")
    }
    defer { freeaddrinfo(info) }

    let conRv = Darwin.connect(s, info.pointee.ai_addr, info.pointee.ai_addrlen)
    guard conRv == 0 else {
      Darwin.close(s)
      throw DhError.io("connect() failed: \(errno)")
    }

    var tv = timeval(tv_sec: Int(timeout), tv_usec: 0)
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
    var on: Int32 = 1
    setsockopt(s, IPPROTO_TCP, TCP_NODELAY, &on, socklen_t(MemoryLayout<Int32>.size))

    self.sock = s
  }

  private func sendAll(_ data: Data) throws {
    guard sock >= 0 else { throw DhError.io("not open") }
    try data.withUnsafeBytes { raw in
      let base = raw.bindMemory(to: UInt8.self).baseAddress!
      var sent = 0
      while sent < data.count {
        let n = Darwin.send(sock, base.advanced(by: sent), data.count - sent, 0)
        if n < 0 {
          if errno == EINTR { continue }
          throw DhError.io("send() failed: \(errno)")
        }
        if n == 0 { throw DhError.io("send() returned 0") }
        sent += n
      }
    }
  }

  private func recvSome(maxBytes: Int = 65536) throws -> Data {
    guard sock >= 0 else { throw DhError.io("not open") }
    var buf = [UInt8](repeating: 0, count: maxBytes)
    let n = buf.withUnsafeMutableBufferPointer { ptr -> Int in
      return Darwin.recv(sock, ptr.baseAddress!, maxBytes, 0)
    }
    if n < 0 {
      if errno == EAGAIN || errno == EWOULDBLOCK {
        throw DhError.io("recv() timeout")
      }
      throw DhError.io("recv() failed: \(errno)")
    }
    if n == 0 { throw DhError.io("closed") }
    return Data(buf.prefix(n))
  }

  private func readUntilDoubleCrlf() throws {
    while rxBuf.range(of: Data("\r\n\r\n".utf8)) == nil {
      let chunk = try recvSome()
      rxBuf.append(chunk)
    }
  }

  /// Returns (statusLine, headersLowercased, privateLength, leftoverAfterHeader)
  private func parseHeader(_ buf: Data)
      -> (String, [String: String], Int, Data) {
    guard let range = buf.range(of: Data("\r\n\r\n".utf8)) else {
      return ("", [:], 0, buf)
    }
    let head = buf.subdata(in: 0..<range.lowerBound)
    let leftover = buf.subdata(in: range.upperBound..<buf.endIndex)
    let lines = String(data: head, encoding: .utf8)?.components(separatedBy: "\r\n") ?? []
    let statusLine = lines.first ?? ""
    var headers: [String: String] = [:]
    var sdpLen = 0
    for line in lines.dropFirst() {
      let parts = line.split(separator: ":", maxSplits: 1).map(String.init)
      if parts.count == 2 {
        let k = parts[0].trimmingCharacters(in: .whitespaces).lowercased()
        let v = parts[1].trimmingCharacters(in: .whitespaces)
        headers[k] = v
        if k == "private-length" { sdpLen = Int(v) ?? 0 }
      }
    }
    return (statusLine, headers, sdpLen, leftover)
  }
}
