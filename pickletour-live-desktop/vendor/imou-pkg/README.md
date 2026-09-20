# imou — consumer-protocol client for Imou Life cameras

Standalone Python client that talks the **same private cloud protocol** as the
Imou Life Android app — login, list devices, get a live RTSP relay URL, pull
the stream over Dahua's custom transport, demux DHAV, and serve a web viewer
with audio. **Does NOT use the public Open API**: this is the protocol used
by the official mobile app.

## Highlights

- Pure Python (stdlib + `requests` + `pycryptodomex`); `ffmpeg` is the only
  external binary.
- Bundled service-name → numeric-ref mapping (`assets/standard_platform.json`)
  extracted from the APK — no Frida, no on-device hooks needed at runtime.
- Custom RTSP client with `Transport: DH/RTP/TCP` (the cloud relay drops the
  standard `RTP/AVP/TCP` transport silently).
- ffmpeg has a built-in `dhav` demuxer that recognises the Dahua container; no
  custom H.265 depacketiser needed.
- One-command web viewer (HLS + hls.js + hardware H.264 transcode).

## Verified live with

- Camera: IPC-S7XE-M0WED (firmware Imou Life-paired)
- Stream: HEVC 2880×1620 @ 15 fps + AAC 16 kHz mono
- Relay: `MTS/1.0` cloud server, port 9132 / 9133-TLS

---

## A-Z workflow

### 0. Prerequisites

```bash
brew install ffmpeg          # on macOS — needs the `dhav` demuxer (any modern ffmpeg)
python3 -m venv .venv && source .venv/bin/activate
pip install -e .             # installs the `imou` CLI + library
```

### 1. Bootstrap a session

Pick the path that matches your account state.

**Path A — 2captcha headless login (RECOMMENDED — fully automated).**
No app, no emulator, no SMS/OTP. Imou guards `GetToken` behind Geetest v4
(code 12114); the library auto-solves via [2captcha.com](https://2captcha.com)
(captcha_id is hard-coded from the APK). Phone must omit the leading 0 when an
area code is given (`869941629`, not `0869941629`):

```bash
imou login 869941629 'YourPassword' --area-code 84 --2captcha YOUR_2CAPTCHA_KEY
# (or export TWO_CAPTCHA_KEY=... once)
# ✓ Session saved.  uuid=<...>  host=app-sg-hw.easy4ipcloud.com
```

Verified working flow (≈20–30 s, ~$0.003 per solve):

```
GetToken (account\<phone>)          → 12114 need geetest4
solve_geetest4 (2captcha proxyless, h5)
CheckGeeTest4 (account=<areaCode><phone>, captchaMetaData="", usage=Login)
                                    → 10000 + {token}   (marks terminal verified)
GetToken (identical)                → 10000 + {sessionId, token, username, entryUrlV2}
user.account.Login (regional)       → mqtt keys + profile
```

### The signing keys (this was the whole puzzle)

Earlier attempts hit `code 12000` / `failNum` because the HMAC **key
derivation** differs per username scheme — NOT because of captcha client_type
(an h5/2captcha solution is accepted fine). Correct keys:

| username | HMAC key |
|---|---|
| `account\<phone>` | **`md5_hex(md5_hex(password))`** (double MD5) |
| `default\<AppKey>` | **`md5_hex(AppSecret)`** |
| `uuid\<id>` (Login) | **raw token** |
| `uuid\<id>` (data APIs) | **`md5_hex(token)`** |

`account` and `default` calls DO validate the signature server-side (wrong key
→ 12000); `uuid` data APIs too. Get the key wrong and you get 12000/failNum;
get it right and h5 captcha sails through. The native Geetest SDK is **not**
required — `login(..., solver="browser")` (local widget + 2captcha
CoordinatesTask) also works, but `proxyless` (default) is faster.

**Path B — import from mitm/Frida (fallback for any account).** Install the
Imou Life app on a phone or Android emulator and log in once. Capture the
response of `POST /pcs/v1/user.account.GetToken` (apiver 3421) with
mitmproxy or Frida. Save the JSON to a file, then:

```bash
imou import-session ./captured-get-token.json
# Accepts either the full envelope ({code, data:{...}})
# or just the inner data object.
imou devices              # confirms it worked
```

After bootstrap, all other calls work headless until session expiry (hours
to days). Session is stored at `~/.imou-session.json` (override with
`IMOU_SESSION` env var).

### 2. List your cameras

```bash
imou devices
#   5858CBDPSF15233        Cam pick 2                IPC-S7XE-M0WED  productId=SC58X9BD
#   028AFBCPSFBB79F        Cam Pick 1                IPC-S7X-10M0WED productId=P7PRWGSG
#   65982BBPSF8E25D        Su Bon                    IPC-S2VB        productId=BYEN4LHC
```

Or programmatically:

```python
from imou import Client
for cam in Client().devices():
    print(cam.device_id, cam.name, cam.product_id)
```

### 3. Get a live RTSP relay URL

```bash
imou url 5858CBDPSF15233
# rtsp://202.47.135.70:9132/4ee...?expire=1780207073&digest=...&X-LC-TransID=...
```

The URL is short-lived (~10 minutes). Call again for a fresh one.

Important: this is RTSP **but you cannot play it with ffmpeg / VLC directly**.
The cloud relay accepts a SETUP with the standard `RTP/AVP/TCP` transport,
returns 200 OK, then never pushes data. You must use the DH transport.

### 4. Snapshot + record (single command)

```bash
imou snap 5858CBDPSF15233 /tmp/snap.jpg
imou rec  5858CBDPSF15233 /tmp/clip.mp4 --seconds 10
```

These wrap the DH-RTSP client + ffmpeg's `dhav` demuxer.

```python
from imou import Client
cam = Client().devices()[0]
cam.snapshot("/tmp/snap.jpg")
cam.record("/tmp/clip.mp4", seconds=10, with_audio=True)
```

### 5. Live web viewer (HLS + audio)

```bash
imou web --port 8765
# Open http://127.0.0.1:8765/
```

What happens:
1. Page lists every camera as a chip.
2. Clicking a camera spawns a `DhRtspSession` and an ffmpeg that:
   * Demuxes DHAV from stdin,
   * Transcodes HEVC → H.264 via `h264_videotoolbox` (macOS) or `libx264`,
   * Re-encodes audio to AAC,
   * Writes 1-second `.ts` segments + `playlist.m3u8` into
     `/tmp/imou-hls/<deviceId>/`.
3. The browser uses **hls.js** (from jsdelivr CDN) + an HTML `<video>` tag.
4. The session is torn down 30 s after the playlist stops being polled.

`--encoder libx264` if you don't have VideoToolbox.

### 6. Custom processing — raw DHAV bytes

For pipelines like object detection, you want the raw decoded frames. Hand
the DHAV stream directly to a separate ffmpeg or PyAV:

```python
import subprocess
from imou import Client

cam = Client().devices()[0]
ff = subprocess.Popen(
    ["ffmpeg", "-f", "dhav", "-i", "pipe:0",
     "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE,
)
with cam.open_rtsp() as rtsp:
    for chunk in rtsp:
        ff.stdin.write(chunk)
        # ... read ff.stdout for raw RGB frames ...
```

### 7. (Optional) Call any IoT service over MQTT

The mapping `service-name → numeric ref` (which the cloud server requires) is
bundled. You can drive any service shown in the app's UI:

```python
from imou import services
print(services.ref("GetMediaFunctions"))           # → 92000
print(services.services_grep("live"))              # fuzzy search
print(services.build_input("VerifyPassword",       # numeric-keyed inputData
                           {"username": "admin", "password": ""}))
```

The full list of services + their `inputData` schemas is in
`imou/assets/standard_platform.json` (62 platform services) and
`standard_model.json` (132 product services).

---

## Architecture & references

```
                        ┌─────────────────────────────┐
                        │  app-v2.easy4ipcloud.com    │
        login pipeline  │  app-sg-hw.easy4ipcloud.com │
        (signSaas hmac) │  /pcs/v1/user.account.*     │
                        │  /pcs/v1/device.list.*      │
                        │  /pcs/v1/things.media.*     │
                        └──────────────┬──────────────┘
                                       │
                              RTSP URL (resource)
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │  MTS/1.0 cloud relay          │
                       │  rtsp://<ip>:9132/<hash>?...  │
                       │  Transport: DH/RTP/TCP        │  ← Dahua custom!
                       └───────────────┬───────────────┘
                                       │
                                       ▼  interleaved RTP frames
                                       │  (12-byte RTP header + DHAV payload)
                                       ▼
                            ┌────────────────────┐
                            │  ffmpeg dhav demux │  ← built-in
                            └─────────┬──────────┘
                                      │
                          ┌───────────┴────────────┐
                          ▼                        ▼
                  Stream 0: HEVC          Stream 1: AAC 16 kHz mono
                  2880×1620 @ 15 fps
```

### Signing (HTTPS `signSaas` scheme)

```
POST /pcs/v1/<method>
Headers:
  Content-Type:     application/json
  Content-MD5:      base64(MD5(body))
  x-pcs-username:   <type>\\<id>            (e.g. "uuid\\abc123")
  x-pcs-apiver:     <varies per method>
  x-pcs-client-ua:  base64(JSON device profile — field ORDER matters)
  x-pcs-date:       ISO8601 UTC
  x-pcs-nonce:      32 random chars
  x-pcs-signature:  base64(HMAC-SHA256(stringToSign, key))
  x-pcs-session-id: (only after login)
```

String-to-sign and HMAC key depend on call:

| Call | Username | HMAC key | apiver |
|---|---|---|---|
| `user.account.GetToken` | `account\\<phone>` | account password | `3421` |
| `common.validcode.GetValidCode` | `default\\<AppKey>` | `AppSecret` | `56906` |
| `user.account.GrantingCredit` | `default\\<AppKey>` | `AppSecret` | `185612` |
| `user.account.Login` | `uuid\\<id>` | `token` (raw) | `56906` |
| `device.list.BasicList` | `uuid\\<id>` | `md5_hex(token)` | `191204` |
| `things.media.GetRealTransferStreamUrl` | `uuid\\<id>` | `md5_hex(token)` | `197891` |

### DH-RTSP

```python
# Setup track 0 (video):
SETUP <url>/trackID=0 RTSP/1.0
Transport: DH/RTP/TCP;unicast;interleaved=0-1

# Setup track 1 (audio):
SETUP <url>/trackID=1 RTSP/1.0
Transport: DH/RTP/TCP;unicast;interleaved=2-3
Session: <sid>

PLAY <url>/ RTSP/1.0
Session: <sid>
Range: npt=0.000-
```

Server then emits standard RFC 2326 interleaved framing (`$|ch|len16|data`)
over the same TCP socket. RTP payloads (after stripping 12-byte RTP header)
are DHAV-wrapped Annex-B H.265.

---

## Library layout

```
imou/
  __init__.py          # public API (login, Client, Camera, DhRtspSession)
  crypto.py            # signing, AES helpers, master secrets
  _http.py             # signed POST /pcs/v1/<method>
  auth.py              # 4-step login + session persistence
  api.py               # Client.devices() / Camera.snapshot/record/open_rtsp
  dh_rtsp.py           # DH-RTSP client (Transport: DH/RTP/TCP)
  services.py          # name ↔ numeric-ref mapping from bundled assets
  webview.py           # HLS web server with audio
  cli.py               # `imou` command
  assets/
    standard_platform.json
    standard_model.json
```

---

## Caveats

- **Captcha gate (code 12114).** Some regions/accounts require Geetest v4
  before the very first `GetToken`. Bootstrap once via the mobile app (see
  §1, Path B), then OTP-only flow works headless until session expiry.
- **Session lifetime.** A few hours to a few days. When SaaS calls start
  returning code 12002 / 12010, re-run `imou login` (or re-capture).
- **RTSP URL lifetime.** ~10 minutes (`expire` query param). Always call
  `Camera.stream_url()` immediately before a stream — don't cache.
- **HEVC in HLS.** Chrome / Firefox don't reliably play HEVC inside HLS;
  `imou web` transcodes to H.264 (via VideoToolbox on macOS). Direct ffmpeg
  consumers can use `-c copy` and skip the transcode.
- **No P2P / no LAN-direct yet.** The cloud relay is the only path
  implemented. LAN-direct (P2P UDP NAT-traversal) would need Ghidra work on
  `libCommonSDK.so` — out of scope unless you specifically need <1 s
  latency.
- **One account at a time per `~/.imou-session.json`.** Use `IMOU_SESSION=...`
  env var to swap.

## License

For personal use with cameras you own and have authorisation to access.
