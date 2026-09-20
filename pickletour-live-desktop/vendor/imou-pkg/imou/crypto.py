"""HMAC-SHA256 SaaS signing + AES-CBC helpers used by Imou SaaS API.

Two flavours of HMAC key, verified by reproducing a captured signature:
    * HTTPS auth       — key = MD5_hex_lowercase(token)
    * MQTT CONNECT     — key = raw token (NOT MD5)

The string-to-sign canonicalisation differs too — see docstrings below.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import string
import time


# Master secrets pulled from oem_config_server.xml (Imou Life Android v10.0.0)
APP_ID = "easy4ipbaseapp"
PROJECT_ID = "Base"
APP_KEY = "2QnTkhG3^t!rKXNP"
APP_SECRET = "%^k#1DI2gI#hdNK%eb#JPk@nJIxGXV1U"

# AES-256-CBC IV for device-credential field crypto (deviceUsername /
# devicePassword inside DevicePasswordGet, and the IOTVerifyPasswordRequest
# payload). IV = `encrypt_iv` from oem_config_server.xml.
DEVICE_AES_IV = b"0a52uuEvqlOLc5TO"

# Legacy / catch-all 32-byte key (originally suspected as a global AES key —
# turned out to be the per-session `token`, see SECRETS.md). Kept for any
# call-site that needs the literal constant.
AES_KEY = b"zl001b8bsas14escmxhxixk62ffs2a8m"
AES_IV = DEVICE_AES_IV


def device_aes_key(dev_sn: str) -> bytes:
    """Per-device AES-256 key for deviceUsername / devicePassword crypto.

    Matches `com.lc.stl.util.s.c.d()` in the official Android app:
        KEY = md5_hex_lower(devSn.upper() + "DAHUAKEY").lower().getBytes()  → 32 bytes
    IV is the global `DEVICE_AES_IV`.
    Mode: AES-256-CBC, PKCS7. Verified live on cam 5858CBDPSF15233.
    """
    return hashlib.md5((dev_sn.upper() + "DAHUAKEY").encode()).hexdigest().lower().encode()


def vod_frame_key(dev_sn: str, dev_pwd: str) -> bytes:
    """AES-128 key that decrypts the protected header bytes of each DHAV frame
    in SD-card VOD playback (encrypttype_aes256_gdpr2 path).

    Verified live on cam 5858CBDPSF15233 (admin / L28F4128) by Frida-hooking
    `FUN_002d7470` (`generatePKCS5_PBKDF2_Key`) inside libCommonSDK.so during
    real playback — captured KEY exactly matches this derivation.

    Formula::
        login_str = f"admin:Login to {dev_sn}:{dev_pwd}"
        password  = MD5_hex(login_str).upper()         # 32 chars
        salt      = dev_sn                              # NOT dev_pwd
        full32    = PBKDF2_HMAC_SHA256(password, salt, 20000, 32)
        key128    = full32[:16]                         # only first 16 bytes used

    Despite the cipher being tagged ``aes256_gdpr2`` server-side, the
    on-the-wire scope is selective: AES-128-ECB applied to the **first 256
    bytes** of each frame's payload (VPS/SPS/PPS + slice header). Everything
    past byte 256 is plaintext H.265 NAL data.
    """
    login_str = f"admin:Login to {dev_sn}:{dev_pwd}"
    md5_upper = hashlib.md5(login_str.encode()).hexdigest().upper()
    return hashlib.pbkdf2_hmac("sha256", md5_upper.encode(),
                                dev_sn.encode(), 20000, 32)[:16]


VOD_FRAME_ENC_PREFIX_BYTES = 256
VOD_FRAME_ENC3_PREFIX_BYTES = 256


def vod_frame_key_enc3(dev_sn: str, dev_pwd: str) -> bytes:
    """AES-256 key for encrypt=3 (aes256_gdpr2 / WSSE-authed) SD playback.

    Same PBKDF2-SHA256 derivation as :func:`vod_frame_key`, but the FULL 32-byte
    output is used (encrypt=2 keeps only the first 16). Verified against a Frida
    capture of ``FUN_0028cb04(ctx, key32, iv16)`` during live encrypt=3 playback —
    the dumped 32-byte key matched this formula exactly.
    """
    login_str = f"admin:Login to {dev_sn}:{dev_pwd}"
    md5_upper = hashlib.md5(login_str.encode()).hexdigest().upper()
    return hashlib.pbkdf2_hmac("sha256", md5_upper.encode(),
                                dev_sn.encode(), 20000, 32)


def _walk_ext(ext: bytes):
    """Iterate over DHAV ext_hdr TLV entries. Yields (type, full_entry_bytes).

    Recording-specific stamps (timestamp, sequence-id, etc.) use varying type
    codes — we've observed 0x35, 0x26, 0x36, … — but all are 2-byte entries
    (type + 1 byte payload). When we hit an unknown byte, assume the same
    layout rather than aborting the walk; that lets us still find the 0x95/
    0xb5 encryption markers further down the ext_hdr.
    """
    FIXED = {0x82: 8, 0x81: 4, 0xa0: 2,
             0x95: 8, 0xb3: 8, 0x88: 4}
    i = 0
    while i < len(ext):
        t = ext[i]
        if t == 0xb5:
            # Corrupt/truncated entry: length byte thiếu hoặc < 2 → không thể
            # tiến con trỏ → INFINITE LOOP (đã gặp trên frame SD lỗi của cam
            # thật, PickleBook 2026-07-08). Dừng walk là an toàn — caller chỉ
            # cần biết có/không marker encryption ở phần ext đã đọc được.
            if i + 1 >= len(ext):
                break
            l = ext[i + 1]
            if l < 2:
                break
            yield t, ext[i : i + l]
            i += l
            continue
        sz = FIXED.get(t, 2)   # unknown types → assume 2-byte entry
        yield t, ext[i : i + sz]
        i += sz


def _find_b5_ext(ext: bytes) -> bytes | None:
    """Return the 0xb5 data portion (after type+length header), or None."""
    for t, entry in _walk_ext(ext):
        if t == 0xb5:
            return entry[2:]
    return None


def _has_ext_type(ext: bytes, target: int) -> bool:
    """True iff a TLV entry of the given type appears in ext_hdr."""
    for t, _ in _walk_ext(ext):
        if t == target:
            return True
    return False


def decrypt_vod_frame(frame: bytes, key: bytes) -> bytes:
    """Decrypt one DHAV frame using either the encrypt=2 or encrypt=3 path.

    Auto-detects from the frame's ext_hdr TLVs:
      * 0xb5 present → encrypt=3 I-frame, AES-256-OFB on first 256B,
        ``key`` must be the 32-byte key from :func:`vod_frame_key_enc3`,
        IV = 16-byte session id at offset 25 of the 0xb5 data.
      * 0x95 present → encrypt=2 I-frame, AES-128-ECB on first 256B,
        ``key`` must be the 16-byte key from :func:`vod_frame_key`.
      * neither present → P-frame, returned unchanged (P-frames are plaintext
        in both encrypt=2 and encrypt=3 streams — decrypting them would
        corrupt the NAL header and cause ffmpeg to drop them, leading to
        "1 frame per keyframe interval" stuttering on playback).

    Pass the full DHAV frame (magic 'DHAV' through trailing 'dhav' marker).
    """
    if frame[:4] != b"DHAV":
        return frame
    import struct as _st
    size = _st.unpack_from("<I", frame, 12)[0]
    if size != len(frame):
        return frame
    ext_hdr_len = frame[0x16]
    p_start = 0x18 + ext_hdr_len
    p_end = size - 8
    payload = frame[p_start:p_end]
    if not payload:
        return frame

    from Cryptodome.Cipher import AES

    ext = frame[0x18 : 0x18 + ext_hdr_len]
    b5_data = _find_b5_ext(ext)
    has_95 = _has_ext_type(ext, 0x95)

    if b5_data is not None:
        # encrypt=3 (server-side tag: aes256_gdpr2):
        #   AES-256-OFB on the first 256 bytes of payload.
        #   IV  = 16-byte ASCII session-id at b5_data[25:41]
        #   key = full 32 bytes of PBKDF2_SHA256(md5_upper(login), salt=devSn)
        # OFB keystream chains by re-encrypting the previous block output, so
        # CTR (which increments a counter) only produces a valid first block.
        # The encrypted prefix is the same length as encrypt=2 (256B covers
        # VPS+SPS+PPS+IDR slice header); the rest of the payload is plaintext.
        if len(key) != 32:
            return frame  # wrong key class for enc3
        iv = b5_data[25:41]
        if len(iv) != 16:
            return frame
        n_enc = min(VOD_FRAME_ENC3_PREFIX_BYTES, len(payload)) // 16 * 16
        if n_enc <= 0:
            return frame
        cipher = AES.new(key, AES.MODE_OFB, iv)
        head = cipher.decrypt(payload[:n_enc])
    elif has_95:
        # encrypt=2 I-frame: AES-128-ECB over first 256B
        if len(key) != 16:
            return frame  # wrong key class for enc2
        n_enc = min(VOD_FRAME_ENC_PREFIX_BYTES, len(payload)) // 16 * 16
        if n_enc <= 0:
            return frame
        head = AES.new(key, AES.MODE_ECB).decrypt(payload[:n_enc])
    else:
        # P-frame (or any frame without an encryption marker) — plaintext.
        return frame

    return frame[:p_start] + head + payload[n_enc:] + frame[p_end:]


# Default client-UA blob — mimics the Imou Life Android emulator capture.
# Field order matters because it is part of the signature.
CLIENT_UA = {
    "appid": APP_ID,
    "clientOS": "Android",
    "clientOV": "Android 13",
    "clientProtocolVersion": "V9.1.0",
    "clientType": "phone",
    "clientVersion": "V8.3.0",
    "country": "VN",
    "language": "en_US",
    "project": PROJECT_ID,
    "terminalBrand": "google",
    "terminalId": "47ab948c5a73d7e9",
    "terminalModel": "sdk_gphone64_arm64",
    "terminalName": "google sdk_gphone64_arm64",
    "timezoneOffset": "25200",
    "ttid": "0af2eb063170424a8122467ie56f1e22",
}


def md5_b64(data: bytes) -> str:
    return base64.b64encode(hashlib.md5(data).digest()).decode()


def md5_hex(text: str) -> str:
    return hashlib.md5(text.encode()).hexdigest()


def hmac_sha256_b64(key: str, msg: str) -> str:
    return base64.b64encode(
        hmac.new(key.encode(), msg.encode(), hashlib.sha256).digest()
    ).decode()


def rand_nonce(n: int = 32) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(n))


def iso_utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def client_ua_b64(ua: dict | None = None) -> str:
    return base64.b64encode(
        json.dumps(ua or CLIENT_UA, separators=(",", ":")).encode()
    ).decode()


def aes_cbc_decrypt(b64_ciphertext: str,
                    key: bytes = AES_KEY, iv: bytes = AES_IV) -> str:
    """Decrypt base64-encoded AES-256-CBC, PKCS7-padded (used for device creds)."""
    from Cryptodome.Cipher import AES
    from Cryptodome.Util.Padding import unpad
    raw = base64.b64decode(b64_ciphertext)
    cipher = AES.new(key, AES.MODE_CBC, iv)
    return unpad(cipher.decrypt(raw), AES.block_size).decode("utf-8")


def aes_cbc_encrypt(plaintext: str,
                    key: bytes = AES_KEY, iv: bytes = AES_IV) -> str:
    """Encrypt to base64 AES-256-CBC, PKCS7-padded — counterpart to aes_cbc_decrypt.
    Used to re-encrypt the device password before sending it back to the cloud
    in VerifyPassword (94400) / similar services."""
    from Cryptodome.Cipher import AES
    from Cryptodome.Util.Padding import pad
    cipher = AES.new(key, AES.MODE_CBC, iv)
    ct = cipher.encrypt(pad(plaintext.encode("utf-8"), AES.block_size))
    return base64.b64encode(ct).decode()


def sign_saas_string(method: str, uri: str, content_md5: str,
                     content_type: str, apiver: str, ua_b64: str,
                     date: str, nonce: str, username: str,
                     session_id: str | None = None) -> str:
    """Build the canonical string-to-sign for /pcs/v1/* HTTPS requests."""
    s = (
        f"{method}\n"
        f"{uri}\n"
        f"{content_md5}\n"
        f"{content_type}\n"
        f"x-pcs-apiver:{apiver}\n"
        f"x-pcs-client-ua:{ua_b64}\n"
        f"x-pcs-date:{date}\n"
        f"x-pcs-nonce:{nonce}\n"
    )
    if session_id:
        s += f"x-pcs-session-id:{session_id}\n"
    s += f"x-pcs-username:{username}\n"
    return s


def sign_mqtt_string(ua_b64: str, date: str, nonce: str, username: str) -> str:
    """Build the canonical string-to-sign for MQTT CONNECT auth."""
    return (
        f"x-pcs-client-ua:{ua_b64}\n"
        f"x-pcs-date:{date}\n"
        f"x-pcs-nonce:{nonce}\n"
        f"x-pcs-username:{username}\n"
    )
