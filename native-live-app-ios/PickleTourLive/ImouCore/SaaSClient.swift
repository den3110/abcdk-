// SaaSClient.swift — port of imou/_http.py + imou/api.py
//
// Signed POST helper for /pcs/v1/<method>. Returns parsed JSON.
// HMAC-SHA256(b64) signature over a canonical string of headers.

import Foundation

public struct AuthCtx {
  public let username: String       // e.g. "uuid\\<id>", "account\\<phone>", "default\\<APP_KEY>"
  public let key: String            // HMAC key (varies per username scheme)
  public let apiver: String         // e.g. "56906", "152485", "191204"
  public let sessionId: String?

  public init(username: String, key: String,
              apiver: String = "191204", sessionId: String? = nil) {
    self.username = username; self.key = key
    self.apiver = apiver; self.sessionId = sessionId
  }
}

public enum SaaSError: Error {
  case http(status: Int, body: String)
  case server(code: Int, desc: String, raw: [String: Any])
  case malformed(String)
}

public final class SaaSClient {

  public init() {}

  public static let ENTRY_HOST = "app-v2.easy4ipcloud.com"
  public static let USER_AGENT =
    "Dalvik/2.1.0 (Linux; U; Android 13; sdk_gphone64_arm64 Build/TE1A.240213.009)"

  // Mimics Imou Life v8.3.0 client_ua. **Field order matters** — JSON
  // serialization preserves insertion order, and the b64-encoded UA goes into
  // the signature. Use a Dictionary<String, String> + manual ordering helper.
  static let CLIENT_UA_FIELDS: [(String, String)] = [
    ("appid", CryptoCore.APP_ID),
    ("clientOS", "Android"),
    ("clientOV", "Android 13"),
    ("clientProtocolVersion", "V9.1.0"),
    ("clientType", "phone"),
    ("clientVersion", "V8.3.0"),
    ("country", "VN"),
    ("language", "en_US"),
    ("project", CryptoCore.PROJECT_ID),
    ("terminalBrand", "google"),
    ("terminalId", "47ab948c5a73d7e9"),
    ("terminalModel", "sdk_gphone64_arm64"),
    ("terminalName", "google sdk_gphone64_arm64"),
    ("timezoneOffset", "25200"),
    ("ttid", "0af2eb063170424a8122467ie56f1e22"),
  ]

  /// `base64(json({field: value, ...}))` — field order = CLIENT_UA_FIELDS
  public static func clientUaB64() -> String {
    // Manual JSON build to preserve field order. All values are strings, no
    // special escapes needed for current values.
    var parts: [String] = []
    for (k, v) in CLIENT_UA_FIELDS {
      let key = "\"\(k)\""
      let val = "\"\(v.replacingOccurrences(of: "\"", with: "\\\""))\""
      parts.append("\(key):\(val)")
    }
    let json = "{" + parts.joined(separator: ",") + "}"
    return Data(json.utf8).base64EncodedString()
  }

  // MARK: – string-to-sign

  static func signStringToSign(method: String, uri: String,
                                contentMd5: String, contentType: String,
                                apiver: String, uaB64: String,
                                date: String, nonce: String,
                                username: String, sessionId: String?) -> String {
    var s = "\(method)\n\(uri)\n\(contentMd5)\n\(contentType)\n"
    s += "x-pcs-apiver:\(apiver)\n"
    s += "x-pcs-client-ua:\(uaB64)\n"
    s += "x-pcs-date:\(date)\n"
    s += "x-pcs-nonce:\(nonce)\n"
    if let sid = sessionId {
      s += "x-pcs-session-id:\(sid)\n"
    }
    s += "x-pcs-username:\(username)\n"
    return s
  }

  // MARK: – body helpers

  static func md5B64(_ data: Data) -> String {
    // MD5 raw 16 bytes → base64
    var out = [UInt8](repeating: 0, count: Int(CC_MD5_DIGEST_LENGTH))
    data.withUnsafeBytes { _ = CC_MD5($0.baseAddress, CC_LONG(data.count), &out) }
    return Data(out).base64EncodedString()
  }

  static func isoUtcNow(_ now: Date = Date()) -> String {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss'Z'"
    f.timeZone = TimeZone(secondsFromGMT: 0)
    f.locale = Locale(identifier: "en_US_POSIX")
    return f.string(from: now)
  }

  static func randNonce(_ n: Int = 32) -> String {
    let alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    var out = ""
    for _ in 0..<n {
      out.append(alphabet.randomElement()!)
    }
    return out
  }

  // MARK: – one signed POST

  /// `methodPath` like "user.account.GetToken". `data` is the inner payload
  /// (will be wrapped in `{"data": data}`).
  public func call(host: String, methodPath: String, data: [String: Any],
                   auth: AuthCtx, timeout: TimeInterval = 30) async throws
                  -> [String: Any] {
    let uri = "/pcs/v1/\(methodPath)"
    guard let url = URL(string: "https://\(host)\(uri)") else {
      throw SaaSError.malformed("bad URL")
    }
    // Canonical JSON: {"data": {...}}  with NO whitespace.
    let envelope: [String: Any] = ["data": data]
    let body = try JSONSerialization.data(withJSONObject: envelope,
                                          options: [.sortedKeys])
    let contentMd5 = Self.md5B64(body)
    let contentType = "application/json"
    let date = Self.isoUtcNow()
    let nonce = Self.randNonce()
    let ua = Self.clientUaB64()

    let toSign = Self.signStringToSign(
      method: "POST", uri: uri, contentMd5: contentMd5,
      contentType: contentType, apiver: auth.apiver, uaB64: ua,
      date: date, nonce: nonce, username: auth.username,
      sessionId: auth.sessionId
    )
    let sig = CryptoCore.hmacSha256B64(key: auth.key, msg: toSign)

    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.timeoutInterval = timeout
    req.setValue(contentType,    forHTTPHeaderField: "Content-Type")
    req.setValue(contentMd5,     forHTTPHeaderField: "Content-MD5")
    req.setValue(auth.apiver,    forHTTPHeaderField: "x-pcs-apiver")
    req.setValue(ua,             forHTTPHeaderField: "x-pcs-client-ua")
    req.setValue(date,           forHTTPHeaderField: "x-pcs-date")
    req.setValue(nonce,          forHTTPHeaderField: "x-pcs-nonce")
    req.setValue(auth.username,  forHTTPHeaderField: "x-pcs-username")
    req.setValue(sig,            forHTTPHeaderField: "x-pcs-signature")
    req.setValue(Self.USER_AGENT, forHTTPHeaderField: "User-Agent")
    if let sid = auth.sessionId {
      req.setValue(sid, forHTTPHeaderField: "x-pcs-session-id")
    }
    req.httpBody = body

    let (respData, resp) = try await URLSession.shared.data(for: req)
    guard let httpResp = resp as? HTTPURLResponse else {
      throw SaaSError.malformed("not HTTP response")
    }
    guard (200..<300).contains(httpResp.statusCode) else {
      throw SaaSError.http(status: httpResp.statusCode,
                           body: String(data: respData, encoding: .utf8) ?? "")
    }
    guard let json = try JSONSerialization.jsonObject(with: respData) as? [String: Any] else {
      throw SaaSError.malformed("response not JSON object")
    }
    return json
  }

  // MARK: – Auth context builders

  public static func accountAuth(phone: String, password: String) -> AuthCtx {
    // account\<phone> uses double-MD5 of password as HMAC key.
    let pwMd5 = CryptoCore.md5HexLower(Data(password.utf8))
    let key = CryptoCore.md5HexLower(Data(pwMd5.utf8))
    return AuthCtx(username: "account\\\(phone)", key: key, apiver: "56906")
  }

  public static func defaultAppAuth(apiver: String = "152485") -> AuthCtx {
    let key = CryptoCore.md5HexLower(Data(CryptoCore.APP_SECRET.utf8))
    return AuthCtx(username: "default\\\(CryptoCore.APP_KEY)",
                   key: key, apiver: apiver)
  }

  public static func uuidAuth(uuidUser: String, token: String, sessionId: String,
                               apiver: String = "191204") -> AuthCtx {
    // uuid\<id> data-API key = md5(token)
    let key = CryptoCore.md5HexLower(Data(token.utf8))
    return AuthCtx(username: "uuid\\\(uuidUser)", key: key,
                   apiver: apiver, sessionId: sessionId)
  }

  /// Used only for the regional `user.account.Login` call right after auth —
  /// HMAC key here is the raw token (not MD5).
  public static func uuidRawAuth(uuidUser: String, rawToken: String,
                                  sessionId: String) -> AuthCtx {
    return AuthCtx(username: "uuid\\\(uuidUser)", key: rawToken,
                   apiver: "56906", sessionId: sessionId)
  }
}

// Bridge to CommonCrypto's CC_MD5 (needed for md5B64 above)
import CommonCrypto
