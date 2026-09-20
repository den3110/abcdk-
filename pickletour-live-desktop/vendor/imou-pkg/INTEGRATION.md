# imou-pkg — Tài liệu tích hợp cho React Native

> Mục tiêu: xem **live view** và **SD-card playback** của camera Imou Life trong app React Native, dùng đúng protocol nội bộ của app gốc (không phải Open API).

---

## 1. Kiến trúc tổng quan

`imou-pkg` là một **Python client** nói chuyện với cloud Imou Life qua protocol private (HTTPS + DH-RTSP + MQTT). RN app không gọi Python trực tiếp được — phải có một **HTTP bridge** ở giữa.

```
┌──────────────────┐   HTTP/JSON   ┌──────────────────┐   protocol     ┌──────────────────┐
│  React Native    │ ◄───────────► │  imou-pkg HTTP   │ ◄───────────► │  Imou Cloud      │
│  app             │   HLS m3u8    │  bridge (Python) │   DH-RTSP      │  + camera relay  │
└──────────────────┘               └──────────────────┘                └──────────────────┘
       ▲                                    │
       │                                    ▼
       └─── WebView/HLS player ──── ffmpeg → HLS .ts segments ──┘
```

**Có sẵn 2 lựa chọn bridge** trong repo:

| Lựa chọn | Path | Phù hợp khi |
|---|---|---|
| **Web viewer của imou-pkg** (khuyến nghị MVP) | `imou-pkg/imou/webview.py` | App render HLS qua WebView/`react-native-video`; chỉ cần URL playlist. |
| **Custom backend riêng** | tự viết, dùng `imou.api.Client` làm SDK | Cần fine-grained control: login flow tự xử captcha, ghi lại lịch sử, multi-tenant, v.v. |

Tài liệu này hướng dẫn cả 2.

---

## 2. Setup backend (Python)

### 2.1. Yêu cầu hệ thống

- Python ≥ 3.10
- `ffmpeg` (cần `dhav` demuxer — bản 6.0+)
- `pycryptodomex`, `requests`, `paho-mqtt` (cài tự động qua `pip install -e .`)

```bash
cd imou-pkg
python3.13 -m venv .venv
source .venv/bin/activate
pip install -e .
ffmpeg -version  # phải có "demuxers: ... dhav ..."
```

### 2.2. Đăng nhập tài khoản Imou

Imou cloud yêu cầu **Geetest v4 captcha** khi login. Có 3 cách giải:

**A. 2captcha (tự động, ~$0.005/lần, khuyến nghị cho server-side)**

```bash
.venv/bin/python -m imou login <phone> '<password>' \
    --area-code 84 \
    --2captcha <2captcha_api_key>
```

Session lưu vào `~/.imou-session.json`, valid vài giờ.

**B. WebView (user tự bấm captcha)**

Xem `imou-rn-webview/` — RN component dùng `react-native-webview` để user solve Geetest trong app, gửi token về backend, backend complete login.

**C. Bypass nếu terminal đã trust**

Nếu device đã login gần đây, cloud không hỏi captcha. App chỉ cần `--2captcha` cho lần đầu, các lần sau (cùng `terminalId` trong client-UA) sẽ pass-through.

### 2.3. Verify login

```bash
.venv/bin/python -m imou devices
```

Phải list ra cameras của tài khoản. Nếu lỗi `12002 BasicList` → có client khác đang chiếm session, xem **§ 6 Session contention**.

### 2.4. Chạy HTTP bridge

```bash
.venv/bin/python -m imou web --port 8765 --encoder h264_videotoolbox
```

(Linux/Windows dùng `--encoder libx264`.) Bridge serve HTTP trên `http://0.0.0.0:8765/`.

**Production:**
- Chạy sau reverse proxy (nginx) với HTTPS
- Tăng timeout cho HLS segment (≥ 30s) vì initial frame fetch có thể chậm
- Lưu `~/.imou-session.json` ở volume persistent

---

## 3. HTTP API endpoints

Tất cả endpoints có `Access-Control-Allow-Origin: *` để RN/web gọi được CORS.

### 3.1. `GET /devices.json`

Danh sách camera của tài khoản.

**Response:**
```json
[
  {
    "device_id": "5858CBDPSF15233",
    "name": "Cam pick 2",
    "model": "TP9C",
    "product_id": "SC58X9BD"
  },
  ...
]
```

### 3.2. `GET /recordings.json?cam=<device_id>&date=YYYY-MM-DD`

Danh sách SD recordings của camera trong 1 ngày.

**Response:**
```json
[
  {
    "begin": "20260601T092142",
    "end": "20260601T092434",
    "begin_time": "09:21:42",
    "duration_s": 172,
    "type_name": "motion",
    "path": "0x2454400"
  },
  ...
]
```

- `begin`, `end`: format `YYYYMMDDTHHMMSS`, dùng làm tham số cho playback URL.
- `duration_s`: độ dài giây.
- `type_name`: `"motion"` / `"manual"` / `"schedule"` / `"alarm"` / etc.

### 3.3. `GET /hls/<device_id>/playlist.m3u8`

HLS playlist cho **live view**. Trả về **rolling window** (10 segments, mỗi 2s). Tự động:
- Mở DH-RTSP tới camera relay
- Decode HEVC, transcode H.264 + AAC (videotoolbox/libx264 + AAC)
- Sinh segments `.ts`

Session timeout sau 30s idle (không có request).

**Audio:** cả Live VÀ Playback đều có audio (AAC mono 16 kHz từ camera, transcode lại sang AAC stereo cho HLS).

### 3.4. `GET /hls-pb/<key>/playlist.m3u8`

HLS playlist cho **SD playback**.

`<key>` format: `<device_id>__pb__<begin><end>` — cùng format `begin`/`end` từ `/recordings.json`, gộp lại bỏ ký tự `T`.

**Ví dụ:**
```
GET /hls-pb/5858CBDPSF15233__pb__2026060109214220260601092434/playlist.m3u8
```

Lưu ý:
- Session tự spawn khi browser hit URL lần đầu (auto-resurrect từ URL key)
- Playlist được generate progressive (segments xuất hiện dần, ~2s 1 segment)
- Browser phải retry trên 404 đầu (ffmpeg cần ~3-5s warmup)
- Khi ffmpeg xong, playlist có `#EXT-X-ENDLIST` → browser biết hết video

### 3.5. `GET /hls-pb/<key>/seg###.ts`

Segment file (TS container, H.264 + AAC nếu có audio).

### 3.6. `GET /hls/<device_id>/seg###.ts`

Segment file cho live stream (rolling — chỉ 10 segments gần nhất tồn tại).

---

## 4. Tích hợp React Native

### 4.1. Cài đặt RN dependencies

```bash
npm install react-native-video
# iOS: cd ios && pod install
```

`react-native-video` hỗ trợ HLS native trên cả iOS (AVPlayer) và Android (ExoPlayer).

### 4.2. Danh sách camera + recording

```tsx
const BACKEND = 'http://YOUR_SERVER_IP:8765';

async function fetchCameras() {
  const r = await fetch(`${BACKEND}/devices.json`);
  return await r.json();
}

async function fetchRecordings(deviceId: string, date: string) {
  // date format: YYYY-MM-DD
  const r = await fetch(
    `${BACKEND}/recordings.json?cam=${deviceId}&date=${date}`
  );
  return await r.json();
}
```

### 4.3. Live view

```tsx
import Video from 'react-native-video';

function LiveView({ deviceId }) {
  return (
    <Video
      source={{ uri: `${BACKEND}/hls/${deviceId}/playlist.m3u8` }}
      style={{ width: '100%', aspectRatio: 16/9 }}
      controls
      resizeMode="contain"
      onError={(e) => console.warn('live error', e)}
    />
  );
}
```

### 4.4. SD Playback

```tsx
function PlaybackView({ deviceId, begin, end }) {
  // begin/end format: YYYYMMDDTHHMMSS từ /recordings.json
  const key = `${deviceId}__pb__${begin.replace(/T/g, '')}${end.replace(/T/g, '')}`;
  const uri = `${BACKEND}/hls-pb/${key}/playlist.m3u8`;
  
  return (
    <Video
      source={{ uri }}
      style={{ width: '100%', aspectRatio: 16/9 }}
      controls
      resizeMode="contain"
      bufferConfig={{
        // playback cần buffer lớn hơn live vì source bursty
        minBufferMs: 5000,
        maxBufferMs: 30000,
        bufferForPlaybackMs: 2500,
        bufferForPlaybackAfterRebufferMs: 5000,
      }}
      onError={(e) => console.warn('playback error', e)}
    />
  );
}
```

### 4.5. Date picker cho recordings

```tsx
import DateTimePicker from '@react-native-community/datetimepicker';

function RecordingsList({ deviceId }) {
  const [date, setDate] = useState(new Date());
  const [recs, setRecs] = useState([]);
  
  useEffect(() => {
    const dStr = date.toISOString().slice(0, 10);  // YYYY-MM-DD
    fetchRecordings(deviceId, dStr).then(setRecs);
  }, [deviceId, date]);
  
  return (
    <>
      <DateTimePicker value={date} mode="date" onChange={(_, d) => d && setDate(d)} />
      <FlatList
        data={recs}
        renderItem={({ item }) => (
          <Pressable onPress={() => openPlayback(item)}>
            <Text>{item.begin_time} — {item.duration_s}s</Text>
          </Pressable>
        )}
        keyExtractor={(r) => r.begin}
      />
    </>
  );
}
```

---

## 5. Auth flow chi tiết (nếu tự viết backend)

Nếu không dùng web viewer mà tự build backend, dùng `imou.api.Client` làm SDK.

### 5.1. Login lần đầu (server-side 2captcha)

```python
from imou.auth import login, save_session

session = login(
    phone="869941629",       # bỏ số 0 đầu khi đã có area_code
    password="HoangHuyen@0810",
    area_code="84",
    captcha_api_key="<2captcha_key>",
)
save_session(session)  # → ~/.imou-session.json
```

### 5.2. Login với WebView (user solve captcha)

App RN mở Geetest trong `react-native-webview`, sau khi user solve được token, gửi về backend:

```python
from imou.auth import login_with_captcha

session = login(
    phone="869941629",
    password="HoangHuyen@0810",
    area_code="84",
    captcha_token={
        "lot_number": "...",
        "captcha_output": "...",
        "pass_token": "...",
        "gen_time": "...",
    },
)
```

Xem `imou-rn-webview/` cho RN component đầy đủ.

### 5.3. Resume session

```python
from imou.api import Client
client = Client()   # tự load ~/.imou-session.json
cams = client.devices()
```

### 5.4. List recordings

**Hai loại record SD** (cả 2 đã verify live, kể cả device legacy `productId=''` như "hồ phải"):

```python
from datetime import datetime

cam = next(c for c in cams if c.device_id == "8H080FCPBVE52B7")  # hồ phải

# (a) Record LIÊN TỤC (timeline) — service 24100, tự phân trang
recs = cam.list_recordings(
    begin=datetime(2026, 6, 2, 0, 0),
    end=datetime(2026, 6, 2, 23, 59),
    limit=300,
)
# recs (newest-first): [{"begin_time": "20260602T222500", "end_time": "20260602T222633",
#   "size": 1065216, "type": 2,
#   "path": "/mnt/sd/2026-06-02/001/dav/22/22.25.00-22.26.33[M][0@0][0].dav"}, ...]

# (b) Record SỰ KIỆN/alarm (clip motion + thumbnail) — service 90800
evs = cam.list_event_recordings(begin=..., end=..., limit=100)
# evs: [{"record_id": "1a8323be..._sd_7", "alarm_id": 1783090819839600,
#   "time": "20260602T211457", "title": "Human Detected", "event_code": "32100",
#   "duration": 120, "thumbnail": "https://...signed.jpg"}, ...]
```

> 🐛 **FIX quan trọng (2026-06-02):** `list_recordings` trước đây trả server error
> **10003** trên device legacy LeChange (`productId=''`). Nguyên nhân: dùng method
> `iot.control.SetIotService` + đảo begin/end + thừa field. Đã sửa dùng đúng
> method **`iot.control.SetService`** (verified MITM app gốc). Xem spec raw API +
> các tính năng mới khác (resolution…) cho team RN ở **`RN-API-FIXES-2026-06-02.md`**.

### 5.5. Live URL

```python
url = cam.stream_url()
# rtsp://relay.example.com:9132/<hash>?expire=...&digest=...
# Cần kéo qua DhRtspSession (DH-RTSP transport, không phải standard RTSP)
```

### 5.6. SD playback

```python
# Save full playback to file
cam.save_playback(
    "/tmp/out.mp4",
    begin="20260601T092142",
    end="20260601T092434",
    encrypt=2,           # 2 = AES-128-ECB (default), 3 = AES-256-OFB+WSSE
    with_audio=False,
)

# Hoặc stream chunks
from imou.dh_rtsp import decrypt_dhav_stream
from imou.crypto import vod_frame_key

key = vod_frame_key(cam.device_id, cam._dev_pwd())
with cam.open_playback(begin, end, encrypt=2) as sess:
    for frame in decrypt_dhav_stream(sess, key):
        # frame là DHAV-wrapped HEVC, feed cho ffmpeg
        ffmpeg_proc.stdin.write(frame)
```

---

## 6. Gotchas / Lưu ý quan trọng

### 6.1. Single session per account

Imou cloud chỉ cho **1 session active/tài khoản**. Khi login mới, sessions cũ sẽ bị invalidate (return code `12002`).

**Hệ quả cho RN app:**
- User mở app official Imou cùng lúc → session backend bị kill
- Backend re-login nhiều lần → SMS rate-limit của Imou (~5 lần/giờ)

**Khuyến nghị:**
- Backend dùng 1 session shared, không re-login mỗi request
- Catch error `12002`, tự re-login với `--2captcha` và retry
- Có UI cảnh báo user nếu họ đang dùng app official

### 6.2. Encrypt mode

| Mode | Cipher | Cần WSSE auth | Khi dùng |
|---|---|---|---|
| `encrypt=2` | AES-128-ECB (256B đầu I-frame) | Không | **Default** — relay accept GET đơn giản |
| `encrypt=3` | AES-256-OFB (256B đầu I-frame) | Có (PasswordDigest) | App official dùng; backend tự attach WSSE khi gọi `encrypt=3` |

Đề xuất: cứ `encrypt=2` cho đơn giản. Cả 2 cho output H.264/HEVC giống nhau sau decrypt.

### 6.3. HLS playlist warmup

ffmpeg cần ~3-5 giây từ lúc browser hit URL đến lúc segment đầu xuất hiện. Player phải **retry trên 404** trong 15-20s.

Với `react-native-video` thường tự retry. Nếu dùng player khác, set retry:
- iOS AVPlayer: `AVPlayerItem.preferredForwardBufferDuration`
- Android ExoPlayer: `LoadControl.setBufferDurationsMs`

### 6.4. ffmpeg phải có DHAV demuxer

Build ffmpeg phải bao gồm `--enable-demuxer=dhav`. Kiểm tra:
```bash
ffmpeg -demuxers | grep dhav
```

Trên macOS Homebrew: ffmpeg 6.0+ có sẵn.
Trên Docker (Linux): dùng `jrottenberg/ffmpeg:6.0` hoặc tự build.

### 6.5. Session token rotation

`~/.imou-session.json` lưu token (rotate vài giờ). Khi expired (`code: 12114` lúc API call), tự re-login.

Code mẫu wrap auto-retry:

```python
from imou.api import Client
from imou.auth import login, save_session

def get_client():
    try:
        c = Client()
        c.devices()  # ping
        return c
    except Exception:
        sess = login(phone, pwd, area_code, captcha_api_key=KEY)
        save_session(sess)
        return Client()
```

### 6.6. Camera offline

Camera offline → `stream_url()` trả về URL nhưng kéo stream sẽ timeout. Catch `DhRtspError`:

```python
from imou.dh_rtsp import DhRtspSession, DhRtspError
try:
    with DhRtspSession(url, audio=True) as sess:
        for chunk in sess:
            ...
except DhRtspError as e:
    # camera offline / relay timeout
    ...
```

### 6.7. CORS

Web viewer endpoints đã set `Access-Control-Allow-Origin: *`. Nếu tự viết backend, **PHẢI** set CORS để RN fetch được.

### 6.8. HEVC trên Android cũ

Một số Android < 8.0 không decode HEVC HLS. Web viewer hiện đã **transcode HEVC → H.264** trong ffmpeg, nên Android nào cũng chạy được. KHÔNG đổi pipeline về `-c copy` nếu cần support Android cũ.

---

## 7. Production deployment recommendations

### 7.1. Docker

```dockerfile
FROM python:3.13-slim

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY imou-pkg /app/imou-pkg
RUN cd /app/imou-pkg && pip install -e .

EXPOSE 8765
CMD ["python", "-m", "imou", "web", "--port", "8765", "--encoder", "libx264"]
```

Mount volume cho session persistent:
```bash
docker run -v ~/.imou-session.json:/root/.imou-session.json -p 8765:8765 imou-bridge
```

### 7.2. Reverse proxy với HTTPS (nginx)

```nginx
location /imou/ {
    proxy_pass http://127.0.0.1:8765/;
    proxy_buffering off;          # HLS segments stream real-time
    proxy_read_timeout 60s;
    add_header Access-Control-Allow-Origin *;
}
```

### 7.3. Multi-account

Hiện tại 1 instance = 1 account. Multi-tenant:
- Spawn 1 process Python per account, mỗi process có session file riêng
- Hoặc patch `imou.auth.load_session()` để nhận account_id param và load `~/.imou-sessions/<account>.json`

### 7.4. Storage cho HLS segments

Mặc định lưu `/tmp/imou-hls/`. Cho production:
- Mount tmpfs (RAM) để giảm disk I/O
- Janitor tự clean idle sessions (live 30s, pb 5min) — đã có sẵn trong web viewer

---

## 8. API reference (Python SDK)

| Module | Class/Func | Use case |
|---|---|---|
| `imou.api.Client` | `.devices()`, `.device(id)` | List/fetch cameras |
| `imou.api.Camera` | `.stream_url()` | Live RTSP URL |
| `imou.api.Camera` | `.snapshot(path)` | JPEG snapshot |
| `imou.api.Camera` | `.list_recordings(begin, end)` | SD recordings |
| `imou.api.Camera` | `.playback_url(begin, end)` | SD playback URL |
| `imou.api.Camera` | `.open_playback(...)` | Open `DhHttpSession` |
| `imou.api.Camera` | `.save_playback(path, ...)` | Save MP4 |
| `imou.auth.login` | `(phone, pwd, area_code, ...)` | Login flow |
| `imou.auth.load_session()` | | Load `~/.imou-session.json` |
| `imou.dh_rtsp.DhRtspSession` | `(url, audio=True)` | Live stream iterator |
| `imou.dh_rtsp.DhHttpSession` | `(url, wsse_password=None)` | Playback stream iterator |
| `imou.dh_rtsp.decrypt_dhav_stream` | `(chunks, key)` | Decrypt + frame-assemble |
| `imou.crypto.vod_frame_key` | `(dev_sn, dev_pwd)` | 16B key cho encrypt=2 |
| `imou.crypto.vod_frame_key_enc3` | `(dev_sn, dev_pwd)` | 32B key cho encrypt=3 |

---

## 9. Troubleshooting

| Triệu chứng | Nguyên nhân | Fix |
|---|---|---|
| `12002` API error | Session bị account khác chiếm | Re-login với `--2captcha` |
| `12114` API error | Token expired hoặc cần captcha | Re-login |
| Playlist 404 mãi | ffmpeg crash / DHAV không decode | Check log; verify `ffmpeg -demuxers | grep dhav` |
| Video giật từng giây | I-frame không decrypt được | Đã fix Session 7 (walker robust unknown TLV); upgrade |
| Audio không ra | (đã fix) | Playback đã bật audio mặc định trong webview; nếu tự dùng SDK, gọi `cam.save_playback(..., with_audio=True)` |
| Stream timeout sau 8s | DH-RTSP read_timeout default | Tăng `DhHttpSession(read_timeout=60)` |
| Camera không list | Trong sidebar `8H08...` không có `productId` | Pass `productId=""` (legacy lechange) — đã handle |

---

## 10. Liên hệ + nguồn

- **Repo:** `/Users/admin/Desktop/Projects/BlockRequests/imou-pkg/`
- **CLI tester (Swagger-like, có sẵn):** `imou test --port 8777` → mở `http://127.0.0.1:8777`
- **Web viewer demo:** `imou web --port 8765` → mở `http://127.0.0.1:8765`
- **Examples Python:** `imou-pkg/examples/`
- **RN auth modules có sẵn:**
  - `imou-rn-webview/` — Geetest qua WebView (đã test)
  - `imou-rn-geetest/` — Native Geetest module Android/iOS (chưa test trên device)

---

**TL;DR cho dev RN:**
1. Backend deploy `imou-pkg/imou web` qua Docker.
2. RN gọi `/devices.json` → list cam, `/recordings.json` → list recording, `/hls/<id>/playlist.m3u8` → live, `/hls-pb/<key>/playlist.m3u8` → playback.
3. Render bằng `react-native-video`.
4. Single-session quota của Imou → backend giữ 1 session, app official user mở sẽ kill session backend.
