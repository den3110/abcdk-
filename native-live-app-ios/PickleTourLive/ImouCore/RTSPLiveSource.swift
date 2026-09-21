// RTSPLiveSource.swift — nguồn RTSP thuần (H.264/H.265 over RTP/TCP interleaved)
// làm nguồn cho HaishinKit → FB. Dùng cho cam IP RTSP nội bộ (rtsp://user:pass@ip:554/…).
//
// Luồng: NWConnection TCP → RTSP handshake (OPTIONS/DESCRIBE/SETUP/PLAY, hỗ trợ
// Basic + Digest auth) → đọc RTP interleaved ($ ch len rtp) → depacketize (single/
// STAP-A/FU-A cho H264; AP/FU cho H265) → gom access-unit (marker bit) → Annex-B →
// HEVCRenderer.enqueue(nalUnitStream:) → VTDecompress → CVPixelBuffer → PTS host-clock
// → onSampleBuffer → LiveStreamingService append.
//
// TRẠNG THÁI: viết theo RFC 2326/6184/7798, CHƯA test cam thật (không có cam ở máy build).

import Foundation
import Network
import CoreMedia
import CoreVideo
import CryptoKit
import QuartzCore

public final class RTSPLiveSource {
    public enum State: Equatable { case idle, connecting, streaming, stopped, error(String) }

    public var onSampleBuffer: ((CMSampleBuffer) -> Void)?
    public var onState: ((State) -> Void)?

    private let url: URL
    private let host: String
    private let port: UInt16
    private let user: String?
    private let pass: String?
    private var rtspPath: String

    private let renderer = HEVCRenderer()
    private var conn: NWConnection?
    private var cseq = 1
    private var sessionId: String?
    private var authHeader: String?          // dựng sau 401 (Basic/Digest)
    private var stopped = false
    private let queue = DispatchQueue(label: "rtsp.live.source")

    // buffer nhận + trạng thái depacketize
    private var rx = Data()
    private var expectInterleaved = false
    private var fuBuffer = Data()            // FU-A/FU đang ghép
    private var accessUnit = Data()          // gom NAL 1 frame (Annex-B)
    private var isHEVC = false

    public init?(urlString: String) {
        let s = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let u = URL(string: s), let h = u.host else { return nil }
        self.url = u
        self.host = h
        self.port = UInt16(u.port ?? 554)
        self.user = u.user?.removingPercentEncoding
        self.pass = u.password?.removingPercentEncoding
        // path + query (bỏ userinfo) để gửi trong RTSP request-URI
        var path = u.path.isEmpty ? "/" : u.path
        if let q = u.query { path += "?\(q)" }
        self.rtspPath = path
        renderer.displayLayer = nil
        renderer.onDecodedPixelBuffer = { [weak self] px, _ in
            guard let self, let sb = self.wrap(px) else { return }
            self.onSampleBuffer?(sb)
        }
    }

    /// Request-URI đầy đủ (không userinfo) cho các lệnh RTSP.
    private var requestURI: String {
        let scheme = "rtsp"
        return "\(scheme)://\(host):\(port)\(rtspPath)"
    }

    public func start() {
        stopped = false
        onState?(.connecting)
        let params = NWParameters.tcp
        let c = NWConnection(host: NWEndpoint.Host(host),
                             port: NWEndpoint.Port(rawValue: port) ?? 554,
                             using: params)
        conn = c
        c.stateUpdateHandler = { [weak self] st in
            guard let self else { return }
            switch st {
            case .ready:
                NSLog("[RTSP] TCP ready → OPTIONS")
                self.receiveLoop()
                self.sendRequest(method: "OPTIONS", uri: self.requestURI, extra: [:])
            case .failed(let e):
                if !self.stopped { self.onState?(.error("TCP: \(e.localizedDescription)")) }
            case .cancelled:
                break
            default: break
            }
        }
        c.start(queue: queue)
    }

    public func stop() {
        stopped = true
        if let s = sessionId { sendRequest(method: "TEARDOWN", uri: requestURI, extra: ["Session": s]) }
        conn?.cancel(); conn = nil
        onState?(.stopped)
    }

    // MARK: - RTSP request/response

    private func sendRequest(method: String, uri: String, extra: [String: String]) {
        guard let c = conn else { return }
        var headers = extra
        headers["CSeq"] = String(cseq)
        if let a = authHeader { headers["Authorization"] = a }
        if let s = sessionId, headers["Session"] == nil, method != "OPTIONS", method != "DESCRIBE" {
            headers["Session"] = s
        }
        var req = "\(method) \(uri) RTSP/1.0\r\n"
        for (k, v) in headers { req += "\(k): \(v)\r\n" }
        req += "User-Agent: PickleTourLive\r\n\r\n"
        pendingMethod = method
        c.send(content: req.data(using: .utf8), completion: .contentProcessed { _ in })
        cseq += 1
    }

    private var pendingMethod = "OPTIONS"

    private func receiveLoop() {
        conn?.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] data, _, isComplete, err in
            guard let self, !self.stopped else { return }
            if let data, !data.isEmpty {
                self.rx.append(data)
                self.drain()
            }
            if let err { if !self.stopped { self.onState?(.error("recv: \(err.localizedDescription)")) }; return }
            if isComplete { return }
            self.receiveLoop()
        }
    }

    /// Xử lý buffer: xen kẽ giữa response RTSP (text, kết thúc \r\n\r\n) và RTP
    /// interleaved (bắt đầu byte 0x24 '$'). Sau PLAY thì chủ yếu là RTP.
    private func drain() {
        while !rx.isEmpty {
            if rx[rx.startIndex] == 0x24 { // '$' interleaved RTP
                guard rx.count >= 4 else { return }
                let len = Int(rx[rx.startIndex + 2]) << 8 | Int(rx[rx.startIndex + 3])
                guard rx.count >= 4 + len else { return }
                let pkt = rx.subdata(in: rx.startIndex + 4 ..< rx.startIndex + 4 + len)
                rx.removeSubrange(rx.startIndex ..< rx.startIndex + 4 + len)
                handleRTP(pkt)
            } else {
                // RTSP response text tới hết \r\n\r\n
                guard let range = rx.range(of: Data("\r\n\r\n".utf8)) else { return }
                let headerData = rx.subdata(in: rx.startIndex ..< range.upperBound)
                // Content-Length (SDP body cho DESCRIBE)
                let headerStr = String(decoding: headerData, as: UTF8.self)
                var bodyLen = 0
                for line in headerStr.split(separator: "\r\n") {
                    if line.lowercased().hasPrefix("content-length:") {
                        bodyLen = Int(line.split(separator: ":").last?.trimmingCharacters(in: .whitespaces) ?? "0") ?? 0
                    }
                }
                guard rx.count >= (range.upperBound - rx.startIndex) + bodyLen else { return }
                let body = bodyLen > 0 ? rx.subdata(in: range.upperBound ..< range.upperBound + bodyLen) : Data()
                rx.removeSubrange(rx.startIndex ..< range.upperBound + bodyLen)
                handleResponse(headerStr, body: String(decoding: body, as: UTF8.self))
            }
        }
    }

    private func handleResponse(_ header: String, body: String) {
        let lines = header.split(separator: "\r\n")
        guard let status = lines.first else { return }
        let code = status.split(separator: " ").dropFirst().first.flatMap { Int($0) } ?? 0
        NSLog("[RTSP] \(pendingMethod) → \(status.prefix(20))")

        if code == 401 {
            // dựng Authorization từ WWW-Authenticate rồi gửi lại đúng method vừa rồi
            if authHeader == nil, let wwwLine = lines.first(where: { $0.lowercased().hasPrefix("www-authenticate:") }) {
                buildAuth(String(wwwLine))
                switch pendingMethod {
                case "OPTIONS": sendRequest(method: "OPTIONS", uri: requestURI, extra: [:])
                case "DESCRIBE": sendRequest(method: "DESCRIBE", uri: requestURI, extra: ["Accept": "application/sdp"])
                default: sendRequest(method: pendingMethod, uri: requestURI, extra: [:])
                }
                return
            }
            onState?(.error("RTSP 401 (sai user/pass?)"))
            return
        }
        guard code == 200 else {
            if code != 0 { onState?(.error("RTSP \(code) ở \(pendingMethod)")) }
            return
        }

        // Session id (từ SETUP)
        if let sLine = lines.first(where: { $0.lowercased().hasPrefix("session:") }) {
            let val = sLine.split(separator: ":").last?.trimmingCharacters(in: .whitespaces) ?? ""
            sessionId = val.split(separator: ";").first.map(String.init) ?? val
        }

        switch pendingMethod {
        case "OPTIONS":
            sendRequest(method: "DESCRIBE", uri: requestURI, extra: ["Accept": "application/sdp"])
        case "DESCRIBE":
            parseSDP(body)
            // SETUP video track (TCP interleaved 0-1)
            let setupURI = controlURI ?? requestURI
            sendRequest(method: "SETUP", uri: setupURI,
                        extra: ["Transport": "RTP/AVP/TCP;unicast;interleaved=0-1"])
        case "SETUP":
            sendRequest(method: "PLAY", uri: requestURI, extra: sessionId.map { ["Session": $0] } ?? [:])
        case "PLAY":
            NSLog("[RTSP] PLAY OK → nhận RTP")
            onState?(.streaming)
        default: break
        }
    }

    // MARK: - SDP

    private var controlURI: String?
    private func parseSDP(_ sdp: String) {
        var vps: Data?, sps: Data?, pps: Data?
        for line in sdp.split(separator: "\n").map({ $0.trimmingCharacters(in: .whitespaces) }) {
            let l = line.lowercased()
            if l.hasPrefix("m=video") { /* video track */ }
            if l.contains("h265") || l.contains("hevc") { isHEVC = true }
            if l.contains("h264") { isHEVC = false }
            if l.hasPrefix("a=control:") {
                let c = String(line.dropFirst("a=control:".count))
                if c.hasPrefix("rtsp://") { controlURI = c }
                else if c != "*" { controlURI = requestURI.hasSuffix("/") ? requestURI + c : requestURI + "/" + c }
            }
            if l.hasPrefix("a=fmtp:") {
                // H264: sprop-parameter-sets=<sps64>,<pps64>
                if let r = line.range(of: "sprop-parameter-sets=", options: .caseInsensitive) {
                    let rest = String(line[r.upperBound...]).split(separator: ";").first.map(String.init) ?? ""
                    let parts = rest.split(separator: ",")
                    if parts.count >= 2 {
                        sps = Data(base64Encoded: String(parts[0]).trimmingCharacters(in: .whitespaces))
                        pps = Data(base64Encoded: String(parts[1]).trimmingCharacters(in: .whitespaces))
                    }
                }
                // H265: sprop-vps / sprop-sps / sprop-pps
                for (key, target) in [("sprop-vps=", 0), ("sprop-sps=", 1), ("sprop-pps=", 2)] {
                    if let r = line.range(of: key, options: .caseInsensitive) {
                        let v = String(line[r.upperBound...]).split(separator: ";").first.map(String.init) ?? ""
                        let d = Data(base64Encoded: v.trimmingCharacters(in: .whitespaces))
                        if target == 0 { vps = d } else if target == 1 { sps = d } else { pps = d }
                    }
                }
            }
        }
        // Seed param-sets vào renderer (prepend Annex-B) để có format-desc sớm.
        var seed = Data()
        for nal in [vps, sps, pps].compactMap({ $0 }) {
            seed.append(contentsOf: [0, 0, 0, 1]); seed.append(nal)
        }
        if !seed.isEmpty { renderer.enqueue(nalUnitStream: seed, isLive: true) }
    }

    // MARK: - Auth

    private func buildAuth(_ wwwAuthenticate: String) {
        let line = wwwAuthenticate.dropFirst("www-authenticate:".count).trimmingCharacters(in: .whitespaces)
        let u = user ?? "", p = pass ?? ""
        if line.lowercased().hasPrefix("basic") {
            let cred = Data("\(u):\(p)".utf8).base64EncodedString()
            authHeader = "Basic \(cred)"
            return
        }
        // Digest
        func field(_ name: String) -> String? {
            guard let r = line.range(of: "\(name)=\"", options: .caseInsensitive) else { return nil }
            let rest = line[r.upperBound...]
            return rest.split(separator: "\"").first.map(String.init)
        }
        let realm = field("realm") ?? "", nonce = field("nonce") ?? ""
        let uri = requestURI
        func md5(_ s: String) -> String {
            Insecure.MD5.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined()
        }
        let ha1 = md5("\(u):\(realm):\(p)")
        let ha2 = md5("\(pendingMethod):\(uri)")
        let response = md5("\(ha1):\(nonce):\(ha2)")
        authHeader = "Digest username=\"\(u)\", realm=\"\(realm)\", nonce=\"\(nonce)\", uri=\"\(uri)\", response=\"\(response)\""
    }

    // MARK: - RTP depacketize

    private func handleRTP(_ pkt: Data) {
        guard pkt.count > 12 else { return }
        let b0 = pkt[pkt.startIndex]
        let cc = Int(b0 & 0x0F)
        let hasExt = (b0 & 0x10) != 0
        let marker = (pkt[pkt.startIndex + 1] & 0x80) != 0
        var off = pkt.startIndex + 12 + cc * 4
        if hasExt {
            guard pkt.count >= (off - pkt.startIndex) + 4 else { return }
            let extLen = Int(pkt[off + 2]) << 8 | Int(pkt[off + 3])
            off += 4 + extLen * 4
        }
        guard off < pkt.endIndex else { return }
        let payload = pkt.subdata(in: off ..< pkt.endIndex)
        if isHEVC { depacketizeHEVC(payload, marker: marker) }
        else { depacketizeH264(payload, marker: marker) }
    }

    private func appendNAL(_ nal: Data) {
        accessUnit.append(contentsOf: [0, 0, 0, 1])
        accessUnit.append(nal)
    }

    private func flushAU() {
        if !accessUnit.isEmpty {
            renderer.enqueue(nalUnitStream: accessUnit, isLive: true)
            accessUnit.removeAll(keepingCapacity: true)
        }
    }

    private func depacketizeH264(_ p: Data, marker: Bool) {
        guard !p.isEmpty else { return }
        let nalType = Int(p[p.startIndex] & 0x1F)
        switch nalType {
        case 1...23:
            appendNAL(p)
        case 24: // STAP-A
            var i = p.startIndex + 1
            while i + 2 <= p.endIndex {
                let sz = Int(p[i]) << 8 | Int(p[i + 1]); i += 2
                guard i + sz <= p.endIndex else { break }
                appendNAL(p.subdata(in: i ..< i + sz)); i += sz
            }
        case 28: // FU-A
            let fuHeader = p[p.startIndex + 1]
            let start = (fuHeader & 0x80) != 0
            let end = (fuHeader & 0x40) != 0
            let origType = (p[p.startIndex] & 0xE0) | (fuHeader & 0x1F)
            if start { fuBuffer = Data([origType]) }
            fuBuffer.append(p.subdata(in: p.startIndex + 2 ..< p.endIndex))
            if end { appendNAL(fuBuffer); fuBuffer.removeAll(keepingCapacity: true) }
        default: break
        }
        if marker { flushAU() }
    }

    private func depacketizeHEVC(_ p: Data, marker: Bool) {
        guard p.count >= 2 else { return }
        let nalType = Int((p[p.startIndex] >> 1) & 0x3F)
        switch nalType {
        case 0...47:
            appendNAL(p)
        case 48: // AP (aggregation)
            var i = p.startIndex + 2
            while i + 2 <= p.endIndex {
                let sz = Int(p[i]) << 8 | Int(p[i + 1]); i += 2
                guard i + sz <= p.endIndex else { break }
                appendNAL(p.subdata(in: i ..< i + sz)); i += sz
            }
        case 49: // FU
            let fuHeader = p[p.startIndex + 2]
            let start = (fuHeader & 0x80) != 0
            let end = (fuHeader & 0x40) != 0
            let fuType = fuHeader & 0x3F
            if start {
                // dựng lại 2-byte NAL header HEVC: type field ở byte0 bit1..6
                let b0 = (p[p.startIndex] & 0x81) | (fuType << 1)
                let b1 = p[p.startIndex + 1]
                fuBuffer = Data([b0, b1])
            }
            fuBuffer.append(p.subdata(in: p.startIndex + 3 ..< p.endIndex))
            if end { appendNAL(fuBuffer); fuBuffer.removeAll(keepingCapacity: true) }
        default: break
        }
        if marker { flushAU() }
    }

    // MARK: - wrap CVPixelBuffer → CMSampleBuffer (PTS host-clock)

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
}
