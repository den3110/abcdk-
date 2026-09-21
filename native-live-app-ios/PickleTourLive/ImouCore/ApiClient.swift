// ApiClient.swift — high-level API on top of SaaSClient.
// Mirrors imou-pkg/imou/api.py's Client + Camera methods.

import Foundation

public struct Camera {
  public let deviceId: String
  public let name: String
  public let model: String
  public let productId: String
  public let online: Bool
}

public struct Recording {
  public let begin: String       // YYYYMMDDTHHMMSS
  public let end: String
  public let durationS: Int
  public let typeName: String
}

public final class ApiClient {

  private var session: ImouSession
  private let saas: SaaSClient
  /// Called on SaaS code 12002. Returns a fresh ImouSession or nil.
  private let onSessionExpired: (() async -> ImouSession?)?

  // device password cache (decrypted) — used for WSSE in encrypt=3 playback
  private var devicePasswordCache: [String: (user: String, pwd: String)] = [:]

  public init(_ session: ImouSession,
              saas: SaaSClient = SaaSClient(),
              onSessionExpired: (() async -> ImouSession?)? = nil) {
    self.session = session
    self.saas = saas
    self.onSessionExpired = onSessionExpired
  }

  /// Run a SaaS-throwing block; if it throws `SaaSError.server(code=12002)`,
  /// invoke `onSessionExpired` to obtain a fresh session, swap it in, and
  /// retry the block exactly once. Other errors propagate unchanged.
  private func withRelogin<T>(_ block: () async throws -> T) async throws -> T {
    do { return try await block() }
    catch let err {
      if case let SaaSError.server(code, _, _) = err, code == 12002,
         let cb = onSessionExpired,
         let fresh = await cb() {
        self.session = fresh
        self.devicePasswordCache.removeAll()
        return try await block()
      }
      throw err
    }
  }

  // MARK: – Devices

  public func listDevices() async throws -> [Camera] {
    try await withRelogin { try await self._listDevices() }
  }

  private func _listDevices() async throws -> [Camera] {
    let auth = SaaSClient.uuidAuth(uuidUser: session.uuidUser,
                                    token: session.uuidKey,
                                    sessionId: session.sessionId,
                                    apiver: "191204")
    let r = try await saas.call(
      host: session.regionalHost,
      methodPath: "device.list.BasicList",
      data: [
        "familyId": "-1", "limit": 128, "offset": 0,
        "roomId": "-1", "transferStr": "",
      ],
      auth: auth
    )
    guard (r["code"] as? Int) == 10000 else {
      throw SaaSError.server(code: (r["code"] as? Int) ?? 0,
                             desc: (r["desc"] as? String) ?? "",
                             raw: r)
    }
    let data = r["data"] as? [String: Any] ?? [:]
    let devs = (data["deviceList"] as? [[String: Any]]) ?? []
    return devs.compactMap { d -> Camera? in
      guard let id = d["deviceId"] as? String else { return nil }
      // Skip entries with no channelList (older firmware shape).
      let channels = (d["channelList"] as? [[String: Any]]) ?? []
      guard let ch0 = channels.first else { return nil }
      // Legacy LeChange-brand devices have empty productId — keep as "".
      let pid = (ch0["productId"] as? String) ?? ""
      let name = (d["deviceName"] as? String)
        ?? (ch0["channelName"] as? String) ?? id
      let model = (d["deviceModel"] as? String)
        ?? (d["productModel"] as? String) ?? ""
      // BasicList doesn't include online status — that's a separate MQTT
      // subscription. Default true; UI can flip via separate online-status
      // API later.
      return Camera(
        deviceId: id, name: name, model: model, productId: pid,
        online: true
      )
    }
  }

  // MARK: – Recordings (SD card)

  public func listRecordings(deviceId: String, productId: String,
                             begin: Date, end: Date,
                             limit: Int = 300) async throws -> [Recording] {
    try await withRelogin {
      try await self._listRecordings(deviceId: deviceId, productId: productId,
                                      begin: begin, end: end, limit: limit)
    }
  }

  private func _listRecordings(deviceId: String, productId: String,
                              begin: Date, end: Date,
                              limit: Int = 300) async throws -> [Recording] {
    // FIX 2026-06-02: dùng iot.control.SetService (KHÔNG SetIotService) — method
    // app gốc dùng, verified MITM. Sửa: 24102=END / 24103=BEGIN (cũ đảo), bỏ
    // 24106-24109, phân trang qua 24104↔24121, type lấy ở 24163 (24162 là size).
    // → hết lỗi 10003 trên device legacy LeChange (productId == "").
    let f = DateFormatter()
    f.dateFormat = "yyyyMMdd'T'HHmmss"
    f.timeZone = TimeZone(secondsFromGMT: 0)
    f.locale = Locale(identifier: "en_US_POSIX")
    let beginStr = f.string(from: begin)
    let endStr = f.string(from: end)

    var results: [Recording] = []
    var cursor = ""
    var seenCursors = Set<String>()
    for _ in 0..<30 {
      let auth = SaaSClient.uuidAuth(uuidUser: session.uuidUser,
                                      token: session.uuidKey,
                                      sessionId: session.sessionId)
      let r = try await saas.call(
        host: session.regionalHost,
        methodPath: "iot.control.SetService",
        data: [
          "channelId": 0,
          "deviceId": deviceId,
          "groupControlFlg": "",
          "productId": productId,
          "service": "24100",
          "inputData": [
            "24101": 0,            // record type, 0 = all
            "24102": endStr,       // ⚠️ 24102 = END
            "24103": beginStr,     // ⚠️ 24103 = BEGIN
            "24104": cursor,       // pagination cursor (24121 của trang trước)
            "24105": limit,
          ],
          "keepAlive": false, "qos": 1, "timeout": 0,
        ],
        auth: auth
      )
      let code = (r["code"] as? Int) ?? 0
      if code != 10000 {
        throw SaaSError.server(code: code, desc: (r["desc"] as? String) ?? "", raw: r)
      }
      let data = r["data"] as? [String: Any] ?? [:]
      let out = data["outputData"] as? [String: Any] ?? data
      let page = out["24124"] as? [[String: Any]] ?? []
      for rec in page {
        guard let b = (rec["24165"] as? String) ?? (rec["beginTime"] as? String),
              let e = (rec["24166"] as? String) ?? (rec["endTime"] as? String) else { continue }
        let dur: Int = {
          guard let t0 = f.date(from: b), let t1 = f.date(from: e) else { return 0 }
          return Int(t1.timeIntervalSince(t0))
        }()
        let type = (rec["24163"] as? Int) ?? 0
        results.append(Recording(begin: b, end: e, durationS: dur,
                                 typeName: recTypeName(type)))
      }
      let nextCursor = "\(out["24121"] ?? "")"
      let hasCursor = !nextCursor.isEmpty && nextCursor != "0"
      if page.isEmpty || page.count < limit || !hasCursor || seenCursors.contains(nextCursor) {
        break
      }
      seenCursors.insert(nextCursor)
      cursor = nextCursor
    }
    return results
  }

  private func recTypeName(_ t: Int) -> String {
    // Bitmask: 1=motion, 2=manual, 4=schedule, 8=alarm
    if t & 1 != 0 { return "motion" }
    if t & 2 != 0 { return "manual" }
    if t & 4 != 0 { return "schedule" }
    if t & 8 != 0 { return "alarm" }
    return "unknown"
  }

  // MARK: – Stream URLs

  /// `quality`: `.hd` (main stream, full bitrate) or `.sd` (sub stream, ~1/4
  /// bitrate). Maps to relay's `streamId` param: "0" = HD, "1" = SD.
  public enum StreamQuality {
    case hd, sd
    var streamId: String {
      switch self { case .hd: return "0"; case .sd: return "1" }
    }
  }

  public func streamUrl(deviceId: String, productId: String,
                         quality: StreamQuality = .hd,
                         quic: Bool = false) async throws -> String {
    try await withRelogin {
      try await self._streamUrl(deviceId: deviceId, productId: productId,
                                 quality: quality, quic: quic)
    }
  }

  private func _streamUrl(deviceId: String, productId: String,
                          quality: StreamQuality = .hd,
                          quic: Bool = false) async throws -> String {
    let auth = SaaSClient.uuidAuth(uuidUser: session.uuidUser,
                                    token: session.uuidKey,
                                    sessionId: session.sessionId,
                                    apiver: "197891")
    let r = try await saas.call(
      host: session.regionalHost,
      methodPath: "things.media.GetRealTransferStreamUrl",
      data: [
        "deviceId": deviceId, "productId": productId, "channelId": "0",
        "streamId": quality.streamId,
        "type": "0", "encrypt": "0", "assistStream": "0",
        "quic": quic ? "1" : "0",
        "design": "live", "skipAuth": "0",
        "videoLimit": 0, "imageSize": 0, "talkType": "0",
        "owner": session.uuidUser, "ownerType": "0",
        "windowNum": "1", "timeLimit": false,
      ],
      auth: auth
    )
    let code = (r["code"] as? Int) ?? 0
    if code != 10000 {
      throw SaaSError.server(code: code, desc: (r["desc"] as? String) ?? "", raw: r)
    }
    guard let data = r["data"] as? [String: Any],
          let url = (data["resource"] as? String) ?? (data["url"] as? String) else {
      throw SaaSError.malformed("GetRealTransferStreamUrl missing url: \(r)")
    }
    return url
  }

  // MARK: – Event recordings (alarm clips + thumbnail)

  /// Danh sách clip sự kiện/alarm (service 90800) kèm thumbnail. Trả dict sẵn cho
  /// JS: {recordId, begin, end, durationS, title, eventCode, thumbnail}. Phân
  /// trang qua 90803 (alarmId record cuối) + 90809 (time record cuối).
  public func listEventRecordings(deviceId: String, productId: String,
                                   begin: Date, end: Date,
                                   limit: Int = 100) async throws -> [[String: Any]] {
    try await withRelogin {
      try await self._listEventRecordings(deviceId: deviceId, productId: productId,
                                           begin: begin, end: end, limit: limit)
    }
  }

  private func _listEventRecordings(deviceId: String, productId: String,
                                    begin: Date, end: Date,
                                    limit: Int = 100) async throws -> [[String: Any]] {
    let f = DateFormatter()
    f.dateFormat = "yyyyMMdd'T'HHmmss"
    f.timeZone = TimeZone(secondsFromGMT: 0)
    f.locale = Locale(identifier: "en_US_POSIX")
    let beginStr = f.string(from: begin)
    let endStr = f.string(from: end)

    var results: [[String: Any]] = []
    var cursor: Any = -1
    var cursorTime = ""
    for _ in 0..<30 {
      let auth = SaaSClient.uuidAuth(uuidUser: session.uuidUser,
                                      token: session.uuidKey,
                                      sessionId: session.sessionId)
      let r = try await saas.call(
        host: session.regionalHost,
        methodPath: "iot.control.SetService",
        data: [
          "channelId": 0, "deviceId": deviceId, "groupControlFlg": "",
          "productId": productId, "service": "90800",
          "inputData": [
            "90801": beginStr, "90802": endStr,
            "90803": cursor, "90804": -1, "90805": limit, "90809": cursorTime,
          ],
          "keepAlive": false, "qos": 1, "timeout": 0,
        ],
        auth: auth
      )
      let code = (r["code"] as? Int) ?? 0
      if code != 10000 {
        throw SaaSError.server(code: code, desc: (r["desc"] as? String) ?? "", raw: r)
      }
      let data = r["data"] as? [String: Any] ?? [:]
      let out = data["outputData"] as? [String: Any] ?? data
      let page = out["90822"] as? [[String: Any]] ?? []
      for rec in page {
        let bt = (rec["90869"] as? String) ?? ""
        let dur = (rec["90868"] as? Int) ?? 0
        let endT: String = {
          guard let t0 = f.date(from: bt) else { return bt }
          return f.string(from: t0.addingTimeInterval(TimeInterval(dur)))
        }()
        results.append([
          "recordId": (rec["90861"] as? String) ?? "",
          "begin": bt,
          "end": endT,
          "durationS": dur,
          "title": (rec["90875"] as? String) ?? "",
          "eventCode": "\(rec["90882"] ?? "")",
          "thumbnail": (rec["90873"] as? String) ?? "",
        ])
      }
      if page.isEmpty || page.count < limit { break }
      if let last = page.last {
        cursor = last["90863"] ?? -1
        cursorTime = (last["90869"] as? String) ?? ""
      } else { break }
    }
    return results
  }

  // MARK: – Resolution

  /// Đổi resolution device qua service 96500 (field 96505). Code device-specific:
  /// 4MP=51, 1080P=18, 480P=5. Sau khi set, caller phải stop + reopen live stream
  /// để nhận stream theo resolution mới. SetService cho legacy (productId==""),
  /// SetIotService cho things device.
  public func setResolution(deviceId: String, productId: String, code: Int) async throws {
    try await withRelogin {
      try await self._setResolution(deviceId: deviceId, productId: productId, code: code)
    }
  }

  private func _setResolution(deviceId: String, productId: String, code: Int) async throws {
    let method = productId.isEmpty ? "iot.control.SetService" : "iot.control.SetIotService"
    let auth = SaaSClient.uuidAuth(uuidUser: session.uuidUser,
                                    token: session.uuidKey,
                                    sessionId: session.sessionId)
    let r = try await saas.call(
      host: session.regionalHost,
      methodPath: method,
      data: [
        "channelId": 0, "deviceId": deviceId, "groupControlFlg": "",
        "productId": productId, "service": "96500",
        "inputData": ["96502": "0", "96505": code],
        "keepAlive": false, "qos": 1, "timeout": 0,
      ],
      auth: auth
    )
    let rc = (r["code"] as? Int) ?? 0
    if rc != 10000 {
      throw SaaSError.server(code: rc, desc: (r["desc"] as? String) ?? "", raw: r)
    }
  }

  // MARK: – PTZ

  /// Relative move with normalized speeds + duration.
  /// - `h` ∈ [-1, 1]: horizontal (neg=left, pos=right)
  /// - `v` ∈ [-1, 1]: vertical (neg=down, pos=up)
  /// - `zoom` ∈ [-1, 1]: zoom (neg=wide, pos=tele)
  /// - `durationMs` ∈ [1, 99999]
  /// Cam khác nhau hỗ trợ service PTZ khác nhau: speed-dome dùng `PtzMoveEight`
  /// (22100), nhiều PT-cam chỉ nhận `PtzMoveFour` (24300) — 22100 sẽ trả device
  /// error 40999. Ta thử lần lượt + cache service chạy được cho mỗi device.
  public func ptzMove(deviceId: String, productId: String,
                       h: Double, v: Double, zoom: Double,
                       durationMs: Int) async throws {
    try await withRelogin {
      try await self._ptzMove(deviceId: deviceId, productId: productId,
                               h: h, v: v, zoom: zoom, durationMs: durationMs)
    }
  }

  // Variant move-service: (service, hRef, vRef, zoomRef, durRef). vRef rỗng =
  // cam không có trục dọc (pan-only LR).
  private struct PtzMoveVariant {
    let service: String; let h: String; let v: String?; let zoom: String; let dur: String
  }
  private static let ptzMoveVariants: [PtzMoveVariant] = [
    .init(service: "22100", h: "22101", v: "22102", zoom: "22103", dur: "22104"), // Eight
    .init(service: "24300", h: "24301", v: "24302", zoom: "24303", dur: "24304"), // Four
    .init(service: "24500", h: "24501", v: nil,     zoom: "24502", dur: "24503"), // TwoLR
  ]
  private var ptzMoveServiceByDevice: [String: String] = [:]

  private func _ptzMove(deviceId: String, productId: String,
                        h: Double, v: Double, zoom: Double,
                        durationMs: Int) async throws {
    let hh = min(max(h, -1.0), 1.0)
    let vv = min(max(v, -1.0), 1.0)
    let zz = min(max(zoom, -1.0), 1.0)
    let dur = min(max(durationMs, 1), 99999)

    // Cached service first, rồi tới các variant còn lại.
    var variants = Self.ptzMoveVariants
    if let cached = ptzMoveServiceByDevice[deviceId],
       let idx = variants.firstIndex(where: { $0.service == cached }) {
      let v0 = variants.remove(at: idx); variants.insert(v0, at: 0)
    }

    var lastErr = SaaSError.server(code: 0, desc: "no ptz variant", raw: [:])
    for variant in variants {
      let auth = SaaSClient.uuidAuth(uuidUser: session.uuidUser,
                                      token: session.uuidKey,
                                      sessionId: session.sessionId)
      var input: [String: Any] = [
        variant.h: String(hh), variant.zoom: String(zz), variant.dur: dur,
      ]
      if let vRef = variant.v { input[vRef] = String(vv) }
      let r = try await saas.call(
        host: session.regionalHost,
        methodPath: "iot.control.SetIotService",
        data: [
          "deviceId": deviceId, "productId": productId, "channelId": "0",
          "service": variant.service, "inputData": input,
        ],
        auth: auth
      )
      let code = (r["code"] as? Int) ?? 0
      if code == 10000 {
        ptzMoveServiceByDevice[deviceId] = variant.service
        return
      }
      // 12002 = session expired → để withRelogin xử lý.
      if code == 12002 {
        throw SaaSError.server(code: 12002, desc: (r["desc"] as? String) ?? "", raw: r)
      }
      // Device-capability error (vd 40999) → thử variant kế tiếp.
      lastErr = SaaSError.server(code: code, desc: (r["desc"] as? String) ?? "", raw: r)
    }
    throw lastErr
  }

  // MARK: – PTZ capability auto-detect

  private static func ptzMoveKind(_ service: String) -> String {
    switch service {
    case "22100": return "eight"
    case "24300": return "four"
    case "24500": return "twoLR"
    default: return "none"
    }
  }
  private var ptzCapByDevice: [String: [String: Any]] = [:]

  /// Tự nhận diện khả năng PTZ của camera (không di chuyển cam): probe mỗi move
  /// service với `h=v=zoom=0, dur=1` — service hỗ trợ trả 10000, không thì 40999.
  /// Trả `["move": "eight"|"four"|"twoLR"|"none", "zoom": Bool]`. Cache per-device.
  public func getPtzCapability(deviceId: String, productId: String) async throws
      -> [String: Any] {
    if let cached = ptzCapByDevice[deviceId] { return cached }
    return try await withRelogin {
      try await self._getPtzCapability(deviceId: deviceId, productId: productId)
    }
  }

  private func _getPtzCapability(deviceId: String, productId: String) async throws
      -> [String: Any] {
    func probe(service: String, input: [String: Any]) async throws -> Int {
      let auth = SaaSClient.uuidAuth(uuidUser: session.uuidUser,
                                      token: session.uuidKey,
                                      sessionId: session.sessionId)
      let r = try await saas.call(
        host: session.regionalHost, methodPath: "iot.control.SetIotService",
        data: ["deviceId": deviceId, "productId": productId, "channelId": "0",
               "service": service, "inputData": input],
        auth: auth)
      let code = (r["code"] as? Int) ?? 0
      NSLog("ImouRN PTZCAP \(deviceId) svc=\(service) -> \(code)")
      if code == 12002 {
        throw SaaSError.server(code: 12002, desc: (r["desc"] as? String) ?? "", raw: r)
      }
      return code
    }

    // Device trả lời dứt khoát = có code 10000 (hỗ trợ) hoặc 40999 (không hỗ
    // trợ). Nếu chỉ toàn 12099 (offline/unknown) → KHÔNG cache để probe lại sau.
    var conclusive = false
    func isAnswer(_ c: Int) -> Bool { c == 10000 || c == 40999 }

    // Move type: thử Eight → Four → TwoLR (no-move).
    var moveKind = "none"
    for variant in Self.ptzMoveVariants {
      var input: [String: Any] = [variant.h: "0", variant.zoom: "0", variant.dur: 1]
      if let vRef = variant.v { input[vRef] = "0" }
      let code = try await probe(service: variant.service, input: input)
      if isAnswer(code) { conclusive = true }
      if code == 10000 {
        moveKind = Self.ptzMoveKind(variant.service)
        ptzMoveServiceByDevice[deviceId] = variant.service  // prime cache cho ptzMove
        break
      }
    }
    // Optical zoom: GetZoomFocus 22400 trả 10000 nếu có.
    let zcode = try await probe(service: "22400", input: [:] as [String: Any])
    if isAnswer(zcode) { conclusive = true }
    let hasZoom = zcode == 10000

    let cap: [String: Any] = ["move": moveKind, "zoom": hasZoom]
    if conclusive { ptzCapByDevice[deviceId] = cap }
    return cap
  }

  /// Set absolute zoom level (`SetZoomFocus`, ref 25100, Type=3 cover/absolute).
  /// `level` ∈ [0.0, 1.0] normalized — 0=widest, 1=max optical (đơn vị gốc của
  /// cloud, KHÔNG có số "×"). Output 25121 chỉ echo lại request, không phải vị
  /// trí thật → đọc vị trí thật qua `getZoomLevel` sau khi optics settle (~3s).
  public func setZoomLevel(deviceId: String, productId: String,
                            level: Double) async throws {
    try await withRelogin {
      try await self._setZoomLevel(deviceId: deviceId, productId: productId,
                                    level: level)
    }
  }

  private func _setZoomLevel(deviceId: String, productId: String,
                              level: Double) async throws {
    let clamped = min(max(level, 0.0), 1.0)
    let auth = SaaSClient.uuidAuth(uuidUser: session.uuidUser,
                                    token: session.uuidKey,
                                    sessionId: session.sessionId)
    let r = try await saas.call(
      host: session.regionalHost,
      methodPath: "iot.control.SetIotService",
      data: [
        "deviceId": deviceId, "productId": productId, "channelId": "0",
        "service": "25100",
        "inputData": ["25101": "3", "25102": String(clamped)],
      ],
      auth: auth
    )
    if (r["code"] as? Int) != 10000 {
      throw SaaSError.server(code: (r["code"] as? Int) ?? 0,
                             desc: (r["desc"] as? String) ?? "", raw: r)
    }
  }

  /// Get current zoom level (`GetZoomFocus`, ref 22400). Returns 0..1.
  public func getZoomLevel(deviceId: String, productId: String) async throws -> Double {
    try await withRelogin {
      try await self._getZoomLevel(deviceId: deviceId, productId: productId)
    }
  }

  private func _getZoomLevel(deviceId: String, productId: String) async throws -> Double {
    let auth = SaaSClient.uuidAuth(uuidUser: session.uuidUser,
                                    token: session.uuidKey,
                                    sessionId: session.sessionId)
    let r = try await saas.call(
      host: session.regionalHost,
      methodPath: "iot.control.SetIotService",
      data: [
        "deviceId": deviceId, "productId": productId, "channelId": "0",
        "service": "22400", "inputData": [:] as [String: Any],
      ],
      auth: auth
    )
    if (r["code"] as? Int) != 10000 {
      throw SaaSError.server(code: (r["code"] as? Int) ?? 0,
                             desc: (r["desc"] as? String) ?? "", raw: r)
    }
    let data = (r["data"] as? [String: Any]) ?? [:]
    let outBlock = (data["outputData"] as? [String: Any]) ?? data
    // Server returns ref 22421 as a JSON **number** (e.g. 0.2366), not a string.
    // `as? String` fails on NSNumber → always 0.0, so coerce both shapes.
    let raw = outBlock["22421"]
    if let n = raw as? NSNumber { return n.doubleValue }
    if let str = raw as? String, let d = Double(str) { return d }
    return 0.0
  }

  /// Reset PTZ to initial position (`std_reset_ptz`, ref 203700).
  public func ptzReset(deviceId: String, productId: String) async throws {
    try await withRelogin {
      try await self._ptzReset(deviceId: deviceId, productId: productId)
    }
  }

  private func _ptzReset(deviceId: String, productId: String) async throws {
    let auth = SaaSClient.uuidAuth(uuidUser: session.uuidUser,
                                    token: session.uuidKey,
                                    sessionId: session.sessionId)
    let r = try await saas.call(
      host: session.regionalHost,
      methodPath: "iot.control.SetIotService",
      data: [
        "deviceId": deviceId, "productId": productId, "channelId": "0",
        "service": "203700",
        "inputData": [:] as [String: Any],
      ],
      auth: auth
    )
    if (r["code"] as? Int) != 10000 {
      throw SaaSError.server(code: (r["code"] as? Int) ?? 0,
                             desc: (r["desc"] as? String) ?? "", raw: r)
    }
  }

  public func verifyPassword(deviceId: String, productId: String) async throws {
    try await withRelogin {
      try await self._verifyPassword(deviceId: deviceId, productId: productId)
    }
  }

  private func _verifyPassword(deviceId: String, productId: String) async throws {
    let creds = try await devicePassword(deviceId: deviceId, productId: productId)
    let key = CryptoCore.deviceAesKey(devSn: deviceId)
    let encU = aesB64(creds.user, key: key)
    let encP = aesB64(creds.pwd, key: key)
    let auth = SaaSClient.uuidAuth(uuidUser: session.uuidUser,
                                    token: session.uuidKey,
                                    sessionId: session.sessionId)
    _ = try await saas.call(
      host: session.regionalHost,
      methodPath: "iot.control.SetIotService",
      data: [
        "deviceId": deviceId, "productId": productId, "channelId": "0",
        "service": "94400",
        "inputData": ["94401": encU, "94402": encP, "94403": "0"],
      ],
      auth: auth
    )
  }

  public func playbackUrl(deviceId: String, productId: String,
                          begin: String, end: String,
                          encrypt: Int = 2, fileType: Int = 1,
                          verifyPwd: Bool = true) async throws -> String {
    try await withRelogin {
      try await self._playbackUrl(deviceId: deviceId, productId: productId,
                                   begin: begin, end: end,
                                   encrypt: encrypt, fileType: fileType,
                                   verifyPwd: verifyPwd)
    }
  }

  private func _playbackUrl(deviceId: String, productId: String,
                            begin: String, end: String,
                            encrypt: Int = 2, fileType: Int = 1,
                            verifyPwd: Bool = true) async throws -> String {
    if verifyPwd {
      try await verifyPassword(deviceId: deviceId, productId: productId)
    }
    let fmtTime = { (s: String) -> String in
      // 20260601T092142 → 2026_06_01_09_21_42
      guard s.count == 15 else { return s }
      let chars = Array(s)
      return "\(String(chars[0..<4]))_\(String(chars[4..<6]))_\(String(chars[6..<8]))_\(String(chars[9..<11]))_\(String(chars[11..<13]))_\(String(chars[13..<15]))"
    }
    let auth = SaaSClient.uuidAuth(uuidUser: session.uuidUser,
                                    token: session.uuidKey,
                                    sessionId: session.sessionId)
    let r = try await saas.call(
      host: session.regionalHost,
      methodPath: "iot.control.SetIotService",
      data: [
        "deviceId": deviceId, "productId": productId, "channelId": "0",
        "service": "96600",
        "inputData": [
          "96601": "0",
          "96602": fmtTime(begin),
          "96603": fmtTime(end),
          "96604": encrypt,
          "96605": "PBSV1",
          "96608": "0",
          "96609": fileType,
        ],
      ],
      auth: auth
    )
    let pbCode = (r["code"] as? Int) ?? 0
    if pbCode != 10000 {
      throw SaaSError.server(code: pbCode, desc: (r["desc"] as? String) ?? "", raw: r)
    }
    let data = r["data"] as? [String: Any] ?? [:]
    let out = data["outputData"] as? [String: Any] ?? data
    guard var url = (out["96621"] as? String) ?? (out["resource"] as? String) else {
      throw SaaSError.malformed("no playback URL")
    }
    // Server escapes `&` as `&amp;` — decode
    url = url.replacingOccurrences(of: "&amp;", with: "&")
    if !url.lowercased().hasPrefix("rtsp://") && !url.lowercased().hasPrefix("http://") {
      url = "rtsp://" + url.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }
    return url
  }

  public func devicePassword(deviceId: String, productId: String)
        async throws -> (user: String, pwd: String) {
    try await withRelogin {
      try await self._devicePassword(deviceId: deviceId, productId: productId)
    }
  }

  private func _devicePassword(deviceId: String, productId: String)
      async throws -> (user: String, pwd: String) {
    if let cached = devicePasswordCache[deviceId] { return cached }
    let auth = SaaSClient.uuidAuth(uuidUser: session.uuidUser,
                                    token: session.uuidKey,
                                    sessionId: session.sessionId)
    let r = try await saas.call(
      host: session.regionalHost,
      methodPath: "iot.control.DevicePasswordGet",
      data: [
        "deviceId": deviceId, "productId": productId, "channelId": "0",
      ],
      auth: auth
    )
    let dpCode = (r["code"] as? Int) ?? 0
    if dpCode != 10000 {
      throw SaaSError.server(code: dpCode, desc: (r["desc"] as? String) ?? "", raw: r)
    }
    guard let data = r["data"] as? [String: Any],
          let encUser = data["deviceUsername"] as? String,
          let encPwd = data["devicePassword"] as? String else {
      throw SaaSError.malformed("DevicePasswordGet missing cred fields: \(r)")
    }
    let key = CryptoCore.deviceAesKey(devSn: deviceId)
    let user = aesDecB64(encUser, key: key)
    let pwd = aesDecB64(encPwd, key: key)
    let pair = (user, pwd)
    devicePasswordCache[deviceId] = pair
    return pair
  }

  // MARK: – Crypto helpers

  private func aesB64(_ plain: String, key: Data) -> String {
    let ct = CryptoCore.aesCbcEncrypt(Data(plain.utf8), key: key, iv: CryptoCore.DEVICE_AES_IV)
    return ct.base64EncodedString()
  }

  private func aesDecB64(_ b64: String, key: Data) -> String {
    guard let ct = Data(base64Encoded: b64) else { return "" }
    let pt = CryptoCore.aesCbcDecrypt(ct, key: key, iv: CryptoCore.DEVICE_AES_IV)
    return String(data: pt, encoding: .utf8) ?? ""
  }
}

// aesCbcEncrypt/Decrypt live in CryptoCore.swift
