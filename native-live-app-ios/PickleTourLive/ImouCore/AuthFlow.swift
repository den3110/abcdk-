// AuthFlow.swift — port of imou/auth.py
//
// Login pipeline (per RE'd app behavior):
//   GetToken (account\<phone>, double-MD5 key, apiver 56906)
//     → if 10000 + sessionId → done (trusted terminal)
//     → if 12114 / 12112 / "captcha needed" → solve Geetest → CheckGeeTest4
//       → GetToken again → session
//     → if 12000 → wrong phone format (strip leading 0)
//   Then: user.account.Login (regional host, raw-token key, apiver 56906)
//     → returns MQTT keys, push tokens, profile metadata

import Foundation

public struct ImouSession: Codable {
  public let uuidUser: String       // stable uuid (e.g. ezpsixb611zxc6l12p05m3nacsre9xf2)
  public let uuidKey: String        // rotating session token
  public let sessionId: String
  public let regionalHost: String   // e.g. app-sg-hw.easy4ipcloud.com
  public let loginResponse: [String: AnyCodable]?

  public init(uuidUser: String, uuidKey: String, sessionId: String,
              regionalHost: String, loginResponse: [String: AnyCodable]? = nil) {
    self.uuidUser = uuidUser; self.uuidKey = uuidKey
    self.sessionId = sessionId; self.regionalHost = regionalHost
    self.loginResponse = loginResponse
  }
}

/// Type-erased Codable wrapper so we can persist heterogeneous login response.
public enum AnyCodable: Codable {
  case string(String), int(Int), double(Double), bool(Bool)
  case array([AnyCodable]), object([String: AnyCodable]), null

  public init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() { self = .null }
    else if let v = try? c.decode(Bool.self) { self = .bool(v) }
    else if let v = try? c.decode(Int.self) { self = .int(v) }
    else if let v = try? c.decode(Double.self) { self = .double(v) }
    else if let v = try? c.decode(String.self) { self = .string(v) }
    else if let v = try? c.decode([AnyCodable].self) { self = .array(v) }
    else if let v = try? c.decode([String: AnyCodable].self) { self = .object(v) }
    else { throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "unsupported")) }
  }
  public func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .null: try c.encodeNil()
    case .bool(let v): try c.encode(v)
    case .int(let v): try c.encode(v)
    case .double(let v): try c.encode(v)
    case .string(let v): try c.encode(v)
    case .array(let v): try c.encode(v)
    case .object(let v): try c.encode(v)
    }
  }
}

public enum AuthError: Error {
  case captchaRequired(captchaMetaData: String, captchaId: String)
  case wrongCredentials(failNum: Int)
  case invalidPhoneFormat
  case serverError(code: Int, desc: String)
  case missingFields(String)
}

public struct CaptchaSolution {
  public let lotNumber: String
  public let captchaOutput: String
  public let passToken: String
  public let genTime: String
  public init(lotNumber: String, captchaOutput: String, passToken: String, genTime: String) {
    self.lotNumber = lotNumber; self.captchaOutput = captchaOutput
    self.passToken = passToken; self.genTime = genTime
  }
}

public final class AuthFlow {

  // Geetest captcha_id is fixed in oem_config (per Imou Life APK)
  public static let GEETEST_CAPTCHA_ID = "525e9a21b667c698f924520f48669462"

  private let saas = SaaSClient()

  // MARK: – Public API

  /// Phase 1: try GetToken. If captcha required → throw .captchaRequired
  /// so caller can prompt user (Geetest WebView in RN), then call
  /// `completeWithCaptcha` to finish.
  public func startLogin(phone rawPhone: String, areaCode: String,
                         password: String) async throws -> ImouSession {
    let phone = Self.normalizePhone(rawPhone, areaCode: areaCode)
    let r = try await getToken(phone: phone, areaCode: areaCode, password: password)
    let code = (r["code"] as? Int) ?? 0
    let data = r["data"] as? [String: Any] ?? [:]

    if let sid = data["sessionId"] as? String {
      // trusted terminal — no captcha
      return try await finishLogin(data: data, sid: sid)
    }

    if code == 12000 { throw AuthError.invalidPhoneFormat }
    if let fn = data["failNum"] as? Int, code == 10000 || code == 12112 {
      // Wrong password indicator (server returns failNum increment)
      if fn > 0 { throw AuthError.wrongCredentials(failNum: fn) }
    }

    // Need captcha
    let meta = (data["captchaMetaData"] as? String) ?? ""
    throw AuthError.captchaRequired(captchaMetaData: meta,
                                    captchaId: Self.GEETEST_CAPTCHA_ID)
  }

  /// Phase 2: complete login with a Geetest solution.
  public func completeWithCaptcha(phone rawPhone: String, areaCode: String,
                                   password: String,
                                   solution: CaptchaSolution,
                                   captchaMetaData: String = "") async throws
                                   -> ImouSession {
    let phone = Self.normalizePhone(rawPhone, areaCode: areaCode)
    // CheckGeeTest4 — account = areaCode + phone
    try await checkGeeTest4(account: areaCode + phone,
                            usage: "Login",
                            solution: solution,
                            captchaMetaData: captchaMetaData)
    // Re-issue GetToken — now should return sessionId
    let r = try await getToken(phone: phone, areaCode: areaCode,
                                password: password)
    let data = r["data"] as? [String: Any] ?? [:]
    guard let sid = data["sessionId"] as? String else {
      let code = (r["code"] as? Int) ?? 0
      let desc = (r["desc"] as? String) ?? "no sessionId after captcha"
      throw AuthError.serverError(code: code, desc: desc)
    }
    return try await finishLogin(data: data, sid: sid)
  }

  // MARK: – Pipeline primitives

  private func getToken(phone: String, areaCode: String,
                        password: String) async throws -> [String: Any] {
    let auth = SaaSClient.accountAuth(phone: phone, password: password)
    return try await saas.call(
      host: SaaSClient.ENTRY_HOST,
      methodPath: "user.account.GetToken",
      data: [
        "areaCode": areaCode,
        "gpsInfo": ["latitude": 0, "longitude": 0],
      ],
      auth: auth
    )
  }

  private func checkGeeTest4(account: String, usage: String,
                              solution: CaptchaSolution,
                              captchaMetaData: String) async throws {
    let auth = SaaSClient.defaultAppAuth(apiver: "152485")
    let r = try await saas.call(
      host: SaaSClient.ENTRY_HOST,
      methodPath: "common.validcode.CheckGeeTest4",
      data: [
        "account": account,
        "usage": usage,
        "captchaId": Self.GEETEST_CAPTCHA_ID,
        "captchaMetaData": captchaMetaData,
        "captchaOutput": solution.captchaOutput,
        "genTime": solution.genTime,
        "lotNumber": solution.lotNumber,
        "passToken": solution.passToken,
      ],
      auth: auth
    )
    let code = (r["code"] as? Int) ?? 0
    let data = r["data"] as? [String: Any] ?? [:]
    guard code == 10000, data["token"] != nil else {
      let desc = (r["desc"] as? String) ?? "CheckGeeTest4 failed"
      throw AuthError.serverError(code: code, desc: desc)
    }
  }

  private func finishLogin(data: [String: Any], sid: String) async throws
                          -> ImouSession {
    guard let uuid = data["username"] as? String,
          let token = data["token"] as? String,
          let entry = data["entryUrlV2"] as? String else {
      throw AuthError.missingFields("username/token/entryUrlV2")
    }
    let host = entry
      .replacingOccurrences(of: "https://", with: "")
      .replacingOccurrences(of: ":443", with: "")
      .trimmingCharacters(in: CharacterSet(charactersIn: "/"))

    // Stage 5: regional Login — HMAC key is RAW token here
    let auth = SaaSClient.uuidRawAuth(uuidUser: uuid, rawToken: token,
                                       sessionId: sid)
    let r5 = try await saas.call(
      host: host,
      methodPath: "user.account.Login",
      data: ["timezoneOffset": 25200],
      auth: auth
    )
    let loginData = r5["data"] as? [String: Any] ?? [:]
    return ImouSession(uuidUser: uuid, uuidKey: token,
                       sessionId: sid, regionalHost: host,
                       loginResponse: Self.toAnyCodable(loginData))
  }

  // MARK: – Helpers

  static func normalizePhone(_ phone: String, areaCode: String) -> String {
    if !areaCode.isEmpty && phone.hasPrefix("0") {
      return String(phone.drop(while: { $0 == "0" }))
    }
    return phone
  }

  static func toAnyCodable(_ obj: Any?) -> [String: AnyCodable]? {
    guard let dict = obj as? [String: Any] else { return nil }
    var out: [String: AnyCodable] = [:]
    for (k, v) in dict {
      out[k] = wrap(v)
    }
    return out
  }
  private static func wrap(_ v: Any) -> AnyCodable {
    if v is NSNull { return .null }
    if let s = v as? String { return .string(s) }
    if let b = v as? Bool { return .bool(b) }
    if let i = v as? Int { return .int(i) }
    if let d = v as? Double { return .double(d) }
    if let a = v as? [Any] { return .array(a.map(wrap)) }
    if let o = v as? [String: Any] {
      var dict: [String: AnyCodable] = [:]
      for (k, vv) in o { dict[k] = wrap(vv) }
      return .object(dict)
    }
    return .null
  }
}

// MARK: – Session persistence (Keychain)

/// Login credentials cached cho auto-relogin khi session expire (12002).
public struct LoginCreds: Codable {
  public let phone: String
  public let areaCode: String
  public let password: String
  public init(phone: String, areaCode: String, password: String) {
    self.phone = phone; self.areaCode = areaCode; self.password = password
  }
}

public enum SessionStore {
  static let service = "com.imou.rn.native.session"
  static let account = "default"
  static let credsAccount = "creds"

  /// File-backed fallback when Keychain rejects (simulator without
  /// application-identifier entitlement → -34018).
  private static var fallbackUrl: URL {
    let docs = FileManager.default.urls(for: .applicationSupportDirectory,
                                         in: .userDomainMask).first!
    try? FileManager.default.createDirectory(at: docs,
                                              withIntermediateDirectories: true)
    return docs.appendingPathComponent("imou-rn-session.json")
  }

  public static func save(_ s: ImouSession) throws {
    let data = try JSONEncoder().encode(s)
    let q: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    SecItemDelete(q as CFDictionary)
    var add = q
    add[kSecValueData as String] = data
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    let status = SecItemAdd(add as CFDictionary, nil)
    if status == errSecSuccess { return }

    // Keychain failed — fall back to file storage. Common in simulator
    // builds without provisioning entitlements (error -34018).
    NSLog("[imou-rn-native] Keychain add failed (\(status)) — using file fallback")
    try data.write(to: fallbackUrl, options: .atomic)
  }

  public static func load() throws -> ImouSession? {
    // Try Keychain first
    let q: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &item)
    if status == errSecSuccess, let data = item as? Data {
      return try JSONDecoder().decode(ImouSession.self, from: data)
    }
    // Fall back to file
    if let data = try? Data(contentsOf: fallbackUrl) {
      return try? JSONDecoder().decode(ImouSession.self, from: data)
    }
    return nil
  }

  public static func clear() {
    for acct in [account, credsAccount] {
      let q: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: acct,
      ]
      SecItemDelete(q as CFDictionary)
    }
    try? FileManager.default.removeItem(at: fallbackUrl)
    try? FileManager.default.removeItem(at: credsFallbackUrl)
  }

  // MARK: – Credentials cache (for 12002 auto-relogin)

  private static var credsFallbackUrl: URL {
    let docs = FileManager.default.urls(for: .applicationSupportDirectory,
                                         in: .userDomainMask).first!
    return docs.appendingPathComponent("imou-rn-creds.json")
  }

  public static func saveCreds(_ c: LoginCreds) throws {
    let data = try JSONEncoder().encode(c)
    let q: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: credsAccount,
    ]
    SecItemDelete(q as CFDictionary)
    var add = q
    add[kSecValueData as String] = data
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    let status = SecItemAdd(add as CFDictionary, nil)
    if status == errSecSuccess { return }
    NSLog("[imou-rn-native] Keychain creds add failed (\(status)) — using file fallback")
    try data.write(to: credsFallbackUrl, options: .atomic)
  }

  public static func loadCreds() -> LoginCreds? {
    let q: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: credsAccount,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &item)
    if status == errSecSuccess, let data = item as? Data {
      return try? JSONDecoder().decode(LoginCreds.self, from: data)
    }
    if let data = try? Data(contentsOf: credsFallbackUrl) {
      return try? JSONDecoder().decode(LoginCreds.self, from: data)
    }
    return nil
  }
}
