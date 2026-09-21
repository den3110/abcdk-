// CryptoCore.swift — port of imou/crypto.py
//
// Reference: imou-pkg/imou/crypto.py
// Verified vectors (vodFrameKey, vodFrameKeyEnc3, WSSE digest) live in
// ios/Tests/CryptoCoreTests.swift.

import Foundation
import CommonCrypto

public enum CryptoCore {

  // MARK: – constants (per oem_config_server.xml, Imou Life Android v8+)
  public static let APP_ID = "easy4ipbaseapp"
  public static let PROJECT_ID = "Base"
  public static let APP_KEY = "2QnTkhG3^t!rKXNP"
  public static let APP_SECRET = "%^k#1DI2gI#hdNK%eb#JPk@nJIxGXV1U"
  public static let DEVICE_AES_IV = Data("0a52uuEvqlOLc5TO".utf8)
  public static let AES_KEY = Data("zl001b8bsas14escmxhxixk62ffs2a8m".utf8)

  // MARK: – hash + KDF primitives

  public static func md5HexLower(_ data: Data) -> String {
    var out = [UInt8](repeating: 0, count: Int(CC_MD5_DIGEST_LENGTH))
    data.withUnsafeBytes { _ = CC_MD5($0.baseAddress, CC_LONG(data.count), &out) }
    return out.map { String(format: "%02x", $0) }.joined()
  }

  public static func md5HexUpper(_ data: Data) -> String {
    return md5HexLower(data).uppercased()
  }

  public static func sha1B64(_ data: Data) -> String {
    var out = [UInt8](repeating: 0, count: Int(CC_SHA1_DIGEST_LENGTH))
    data.withUnsafeBytes { _ = CC_SHA1($0.baseAddress, CC_LONG(data.count), &out) }
    return Data(out).base64EncodedString()
  }

  public static func hmacSha256B64(key: String, msg: String) -> String {
    var mac = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
    let keyBytes = Array(key.utf8); let msgBytes = Array(msg.utf8)
    CCHmac(CCHmacAlgorithm(kCCHmacAlgSHA256),
           keyBytes, keyBytes.count,
           msgBytes, msgBytes.count, &mac)
    return Data(mac).base64EncodedString()
  }

  /// PBKDF2-HMAC-SHA256
  public static func pbkdf2Sha256(_ password: Data, salt: Data,
                                   iterations: Int, dklen: Int) -> Data {
    var out = Data(count: dklen)
    let result = out.withUnsafeMutableBytes { outPtr -> Int32 in
      password.withUnsafeBytes { pwPtr -> Int32 in
        salt.withUnsafeBytes { saltPtr -> Int32 in
          CCKeyDerivationPBKDF(
            CCPBKDFAlgorithm(kCCPBKDF2),
            pwPtr.bindMemory(to: Int8.self).baseAddress, password.count,
            saltPtr.bindMemory(to: UInt8.self).baseAddress, salt.count,
            CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
            UInt32(iterations),
            outPtr.bindMemory(to: UInt8.self).baseAddress, dklen
          )
        }
      }
    }
    precondition(result == kCCSuccess, "PBKDF2 failed: \(result)")
    return out
  }

  // MARK: – key derivations (1:1 with imou.crypto)

  /// 16-byte AES-128 key for encrypt=2 SD playback I-frame.
  public static func vodFrameKey(devSn: String, devPwd: String) -> Data {
    let loginStr = "admin:Login to \(devSn):\(devPwd)"
    let pwdMd5Upper = md5HexUpper(Data(loginStr.utf8))
    let full = pbkdf2Sha256(Data(pwdMd5Upper.utf8), salt: Data(devSn.utf8),
                            iterations: 20000, dklen: 32)
    return full.prefix(16)
  }

  /// 32-byte AES-256 key for encrypt=3 SD playback I-frame.
  public static func vodFrameKeyEnc3(devSn: String, devPwd: String) -> Data {
    let loginStr = "admin:Login to \(devSn):\(devPwd)"
    let pwdMd5Upper = md5HexUpper(Data(loginStr.utf8))
    return pbkdf2Sha256(Data(pwdMd5Upper.utf8), salt: Data(devSn.utf8),
                        iterations: 20000, dklen: 32)
  }

  /// Per-device AES-256 key for deviceUsername/devicePassword crypto.
  public static func deviceAesKey(devSn: String) -> Data {
    let s = devSn.uppercased() + "DAHUAKEY"
    return Data(md5HexLower(Data(s.utf8)).utf8)
  }

  // MARK: – AES (CommonCrypto one-shot)

  /// AES-128-ECB decrypt (no padding). Used for encrypt=2 frame head.
  public static func aesEcbDecrypt(_ ct: Data, key: Data) -> Data {
    return ccCryptOneShot(op: kCCDecrypt, mode: nil, opts: kCCOptionECBMode,
                          key: key, iv: nil, input: ct)
  }

  /// AES-256-OFB decrypt (OFB is symmetric — encrypt == decrypt).
  /// Used for encrypt=3 frame head.
  public static func aesOfbDecrypt(_ ct: Data, key: Data, iv: Data) -> Data {
    return ccCryptOFB(input: ct, key: key, iv: iv)
  }

  /// AES-256-CBC decrypt, PKCS7. Used for deviceUsername/devicePassword.
  public static func aesCbcDecrypt(_ ct: Data, key: Data, iv: Data) -> Data {
    return ccCryptOneShot(op: kCCDecrypt, mode: nil, opts: kCCOptionPKCS7Padding,
                          key: key, iv: iv, input: ct)
  }

  /// AES-256-CBC encrypt, PKCS7. Counterpart for verifyPassword payload.
  public static func aesCbcEncrypt(_ pt: Data, key: Data, iv: Data) -> Data {
    return ccCryptOneShot(op: kCCEncrypt, mode: nil, opts: kCCOptionPKCS7Padding,
                          key: key, iv: iv, input: pt)
  }

  // MARK: – CC wrappers

  /// One-shot CCCrypt — works for ECB (with kCCOptionECBMode) and CBC (with
  /// kCCOptionPKCS7Padding + IV).
  private static func ccCryptOneShot(op: Int, mode: Int?, opts: Int,
                                      key: Data, iv: Data?, input: Data) -> Data {
    let outCapacity = input.count + kCCBlockSizeAES128
    var out = Data(count: outCapacity)
    var dataOutMoved = 0
    let status = out.withUnsafeMutableBytes { outPtr -> CCCryptorStatus in
      input.withUnsafeBytes { inPtr -> CCCryptorStatus in
        key.withUnsafeBytes { keyPtr -> CCCryptorStatus in
          if let iv = iv {
            return iv.withUnsafeBytes { ivPtr -> CCCryptorStatus in
              CCCrypt(CCOperation(op),
                      CCAlgorithm(kCCAlgorithmAES),
                      CCOptions(opts),
                      keyPtr.baseAddress, key.count,
                      ivPtr.baseAddress,
                      inPtr.baseAddress, input.count,
                      outPtr.baseAddress, outCapacity,
                      &dataOutMoved)
            }
          } else {
            return CCCrypt(CCOperation(op),
                           CCAlgorithm(kCCAlgorithmAES),
                           CCOptions(opts),
                           keyPtr.baseAddress, key.count,
                           nil,
                           inPtr.baseAddress, input.count,
                           outPtr.baseAddress, outCapacity,
                           &dataOutMoved)
          }
        }
      }
    }
    precondition(status == kCCSuccess, "CCCrypt failed: \(status)")
    out.count = dataOutMoved
    return out
  }

  /// AES-OFB via CCCryptorCreateWithMode (one-shot is fine for our ≤256B
  /// usage). PKCS padding intentionally off — OFB is a stream cipher.
  private static func ccCryptOFB(input: Data, key: Data, iv: Data) -> Data {
    var cryptor: CCCryptorRef?
    let createStatus = key.withUnsafeBytes { keyPtr -> CCCryptorStatus in
      iv.withUnsafeBytes { ivPtr -> CCCryptorStatus in
        CCCryptorCreateWithMode(
          CCOperation(kCCEncrypt),    // OFB symmetric → encrypt == decrypt
          CCMode(kCCModeOFB),
          CCAlgorithm(kCCAlgorithmAES),
          CCPadding(ccNoPadding),
          ivPtr.baseAddress,
          keyPtr.baseAddress, key.count,
          nil, 0, 0,
          CCModeOptions(0),
          &cryptor
        )
      }
    }
    precondition(createStatus == kCCSuccess,
                 "CCCryptorCreateWithMode failed: \(createStatus)")
    defer { CCCryptorRelease(cryptor) }

    let outLen = input.count + kCCBlockSizeAES128
    var out = Data(count: outLen)
    var produced = 0
    var finalProduced = 0
    let r1 = input.withUnsafeBytes { inPtr -> CCCryptorStatus in
      out.withUnsafeMutableBytes { outPtr -> CCCryptorStatus in
        CCCryptorUpdate(cryptor,
                        inPtr.baseAddress, input.count,
                        outPtr.baseAddress, outLen,
                        &produced)
      }
    }
    precondition(r1 == kCCSuccess, "CCCryptorUpdate failed: \(r1)")
    let r2 = out.withUnsafeMutableBytes { outPtr -> CCCryptorStatus in
      CCCryptorFinal(cryptor,
                     outPtr.baseAddress!.advanced(by: produced),
                     outLen - produced,
                     &finalProduced)
    }
    precondition(r2 == kCCSuccess, "CCCryptorFinal failed: \(r2)")
    out.count = produced + finalProduced
    return out
  }

  // MARK: – WSSE token (for encrypt=3 playback authorization)

  public struct WsseToken {
    public let username: String
    public let passwordDigest: String    // base64(SHA1(nonceHex + iso8601 + devPwd))
    public let nonceHex: String          // 32-hex random
    public let created: String           // ISO8601 UTC, "Z" suffix, no fractional seconds
  }

  public static func makeWsseToken(devPwd: String,
                                    username: String = "admin",
                                    nonceBytes: Data? = nil,
                                    now: Date = Date()) -> WsseToken {
    let nonce = nonceBytes ?? randomBytes(16)
    let nonceHex = nonce.map { String(format: "%02x", $0) }.joined()
    let fmt = ISO8601DateFormatter()
    fmt.formatOptions = [.withInternetDateTime]
    fmt.timeZone = TimeZone(secondsFromGMT: 0)
    let created = fmt.string(from: now)
    let toHash = Data((nonceHex + created + devPwd).utf8)
    return WsseToken(username: username,
                     passwordDigest: sha1B64(toHash),
                     nonceHex: nonceHex,
                     created: created)
  }

  public static func randomBytes(_ n: Int) -> Data {
    var data = Data(count: n)
    _ = data.withUnsafeMutableBytes {
      SecRandomCopyBytes(kSecRandomDefault, n, $0.baseAddress!)
    }
    return data
  }
}
