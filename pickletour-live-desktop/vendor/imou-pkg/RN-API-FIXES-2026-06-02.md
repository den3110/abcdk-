# Imou — API fixes & tính năng mới cho team RN (2026-06-02)

> Doc này dành cho team làm **native module RN** (`imou-rn-native`). Tất cả spec
> dưới đây **verify live** bằng MITM app gốc (ImouLife) trên Android emulator +
> đối chiếu lại bằng `imou-pkg` Python. Mỗi mục ghi rõ: **method, service, input
> refs, output refs** để implement thẳng vào lớp HTTP native (Swift/Kotlin).

Tất cả call đều POST tới `https://<regionalHost>/pcs/v1/<method>` với body
`{"data": {...}}`, ký bằng uuid-auth (HMAC-SHA256, key=`md5(token)`) — y hệt các
call hiện có (streamUrl, devicePassword…). `<regionalHost>` lấy từ session.

`<TIME>` = format **`yyyyMMddTHHmmss`** (vd `20260602T235959`).

---

## ⚠️ Điểm mấu chốt: `SetService` vs `SetIotService`

Có **hai** method điều khiển device, chọn theo loại device:

| Method | Dùng cho | Ví dụ |
|---|---|---|
| `iot.control.SetIotService` | device "things" (có `productId`) | xuantran, Cam pick 2 |
| `iot.control.SetService` | **device legacy LeChange (`productId == ''`)** + record/event query | **hồ phải** |

Record list (24100, 90800) của legacy device **bắt buộc** dùng `SetService`.
Đây là lý do `listRecordings` cũ trả **10003** trên hồ phải.

Body chung cho `SetService`:
```json
{ "data": {
  "channelId": 0, "deviceId": "<id>", "productId": "<productId|''>",
  "groupControlFlg": "", "service": "<svc>", "inputData": { ... },
  "keepAlive": false, "qos": 1, "timeout": 0
}}
```

---

## 1. 🐛 FIX: List record SD — liên tục (timeline)

**method** `iot.control.SetService` · **service** `24100`

### Request `inputData`
| ref | nghĩa | ví dụ |
|---|---|---|
| `24101` | record type (**số nguyên**) | `0` = tất cả |
| `24102` | **END** time ⚠️ | `"20260602T235959"` |
| `24103` | **BEGIN** time ⚠️ | `"20260602T000000"` |
| `24104` | cursor phân trang | `""` lần đầu |
| `24105` | limit / page | `300` |

> ⚠️ Bug lib cũ: dùng `SetIotService`, **đảo 24102/24103** (begin↔end), và gửi thừa
> `24106`–`24109`. Bản đúng KHÔNG gửi 24106-24109.

### Response `data.outputData`
| ref | nghĩa |
|---|---|
| `24124` | **mảng record** (newest-first) |
| `24121` | cursor trang sau → truyền vào `24104` lần gọi kế |

Mỗi item trong `24124`:
| ref | nghĩa | ví dụ |
|---|---|---|
| `24161` | file path trên SD | `/mnt/sd/2026-06-02/001/dav/22/22.25.00-22.26.33[M][0@0][0].dav` |
| `24162` | size (bytes) | `1065216` |
| `24163` | type | `2` (motion) |
| `24165` | begin time | `20260602T222500` |
| `24166` | end time | `20260602T222633` |

### Phân trang
Lặp: gọi với `24104=""`, đọc `24124` + `24121`; gọi tiếp với `24104=<24121 trước>`.
Dừng khi: page rỗng, `len(page) < limit`, hoặc cursor trống/lặp lại.
**Verified:** hồ phải 1 ngày → **374 record** (nhiều trang).

### Playback 1 record liên tục
Dùng service playback theo **time** đã có (`cm_getPlaybackTransferStreamUrlByTime`,
96600) với `begin`/`end` của record. (Đường playback hiện tại của lib giữ nguyên.)

---

## 2. ✨ MỚI: List record SD — sự kiện/alarm (clip motion + thumbnail)

**method** `iot.control.SetService` · **service** `90800`

### Request `inputData`
| ref | nghĩa | ví dụ |
|---|---|---|
| `90801` | BEGIN time | `"20260602T000000"` |
| `90802` | END time | `"20260602T235959"` |
| `90803` | cursor (alarmId) | `-1` lần đầu |
| `90804` | (giữ) | `-1` |
| `90805` | limit | `100` |
| `90809` | cursor time | `""` lần đầu |

### Response `data.outputData.90822[]`
| ref | nghĩa | ví dụ |
|---|---|---|
| `90861` | **recordId / token** (để playback by-file) | `1a8323be...._sd_7` |
| `90863`/`90864` | alarmId (số / chuỗi) | `1783090819839600` |
| `90869` | thời gian | `20260602T211457` |
| `90875` | tiêu đề | `"Human Detected"` |
| `90882` | event code | `"32100"` (human) |
| `90868` | duration (giây) | `120` |
| `90873` | thumbnail URL (signed JPEG) | `https://...imoulife.com/...thumb.dav?sig=...` |
| `90881` | playback descriptor | `alarm/videoRecord?...&token=...&alarmId=...` |

### Phân trang
Lần đầu `90803=-1, 90809=""`; lần kế `90803 = 90863 của record cuối`,
`90809 = 90869 của record cuối`. Dừng khi `len(page) < limit`.
**Verified:** hồ phải 1 ngày → **159 event**.

### Playback 1 event record
**method** `iot.control.SetIotService` · **service** `96700`
(`cm_getPlaybackTransferStreamUrlByFile`) — input `96701 = recordId (90861)`,
`96702 = encrypt`. Trả URL relay để kéo qua DH-RTSP/HTTP transport như playback hiện tại.

---

## 3. ✨ MỚI: Đổi Resolution (chất lượng stream)

KHÔNG có API riêng — đổi resolution = **request lại live-stream URL** với mã khác.

**method** `iot.control.SetService` (legacy) / `SetIotService` (things) · **service** `96500`

Field quyết định resolution = **`96505`** (đo live trên hồ phải):

| Resolution | mã `96505` |
|---|---|
| 4MP | `51` |
| 1080P | `18` |
| 480P | `5` |

> Mã `96505` là code device-specific. App lấy danh sách resolution khả dụng +
> code từ device capability rồi gửi code đã chọn. Flow RN: **stop session →
> mở lại stream với `96505` mới**. (Hiện `imou-rn-native` mới có `quality:'hd'|'sd'`
> ở start-time; có thể map: hd→stream chính (96502="0"), sd→sub (96502="1"); hoặc
> nâng cấp nhận thẳng mã 96505 nếu cần 3 mức.)

Input liên quan (tham khảo, từ capture): `96502` stream index, `96503` link
("second"), `96504`, `96511` protocol ("RTSV1"), `mqttHost` cho keying.

---

## 4. ✅ Đã LÀM XONG trong `imou-rn-native` phiên này (recap)

Các fix dưới đây **đã code + verify live trên iOS** session 2026-06-02. Nếu team
maintain bản RN khác thì port theo. Chi tiết: `imou-rn-native/RN-DEV-HANDOFF.md` §PTZ/Zoom.

- **`getZoomLevel` fix (iOS):** ref `22421` server trả **JSON number** (không phải
  string) → code cũ `as? String` luôn ra `0.0`. Đã parse cả number/string. Android
  đổi `optString`→`optDouble`.
- **maxX (zoom ×):** cloud KHÔNG expose → **user tự nhập per cam** (lưu theo deviceId),
  module thêm `setZoomX/getZoomX` + helper `zoomXToNormalized/zoomNormalizedToX`.
  `getZoomLevel/setZoomLevel` vẫn chỉ normalized 0..1.
- **PTZ `ptzMove` cascade:** cam khác nhau dùng service khác — speed-dome=`PtzMoveEight`
  (22100), PT-cam=`PtzMoveFour` (24300, 22100 trả 40999), pan-only=`PtzMoveTwoLR`
  (24500). Module tự **cascade 22100→24300→24500 + cache per-device**.
- **`getPtzCapability(deviceId)`:** probe KHÔNG di chuyển cam (`h=v=zoom=0,dur=1` +
  GetZoomFocus) → `{move:'eight'|'four'|'twoLR'|'none', zoom:bool}`. App dùng để
  render đúng controls cho từng cam.
- **✨ MỚI `onPlaybackProgress` event** (cho thanh tua): emit `{sessionId, positionSec, durationSec}` ~1/s trong playback. App vẽ slider từ `positionSec/durationSec`; **tua = `stopSession` + `startPlayback` ở mốc mới** (relay 1 chiều, không scrub mượt frame). iOS verified live, Android mirror.
- **✨ MỚI `startRecording/stopRecording` (như nút record của Imou):** quay lại ĐOẠN ĐANG XEM (live hoặc playback) từ lúc bấm tới khi stop → file `.mp4` (`saveToGallery` tuỳ chọn lưu Photos). Native remux DHAV→MP4 (AVAssetWriter passthrough, codec-aware HEVC/H.264). KHÔNG có "download" — đúng cách Imou làm. iOS verified live: 8s playback → MP4 1920×1080 H.264, ảnh thật xem được.
- **🐛 Playback nhiễu/lag/màn xám FIX:** relay bơm cả clip dạng burst → renderer quá tải, hàng đợi phình → display drop frame trễ → nhiễu/giật. Đã thêm **flow-control playback** (semaphore backpressure + pace realtime). `produced` giờ chạy ~25fps thay vì burst tới 2890. Verified live trên iOS.
- **🐛 LIVE green-screen FIX:** khi `AVSampleBufferDisplayLayer.status == .failed` (rớt gói/lỗi decode), code cũ chỉ `flush()` rồi nhồi luôn P-frame → đứng xanh tới IDR tự nhiên. Đã sửa: failed → flush + **bắt buộc chờ keyframe** → re-anchor sạch ở IDR kế (như Imou app). iOS only — Android `MediaCodec` xử lý khác.
- **🐛 Snapshot H.264 (iOS) FIX:** `Snapshot.swift` trước **chỉ HEVC** →
  trên cam H.264 (vd hồ phải) luôn ném **`noKeyframe`** ("Lỗi snapshot"). Nguyên
  nhân: `buildFormatDesc` đòi VPS (HEVC) trong khi H.264 không có VPS. Đã sửa
  codec-aware (HEVC: `...FromHEVCParameterSets` VPS+SPS+PPS; H.264:
  `CMVideoFormatDescriptionCreateFromH264ParameterSets` SPS+PPS) + sticky codec
  detect — giống Android `Snapshot.kt` (đã đúng từ trước). **Verified live:** hồ phải
  (H.264) → JPEG 1920×1080 OK; xuantran (HEVC) không regression.

---

## 4b. ✨ MỚI: Pinch-to-zoom điều khiển OPTICAL zoom (ống kính)

Pinch 2 ngón để zoom **ống kính thật** (cam có optical zoom). **KHÔNG cần sửa
native module** — chỉ là cử chỉ JS + gọi `setZoomLevel` (API đã có). Đây là việc
**bên app RN** làm.

**Sample sẵn sàng copy:** [`ImouTestApp/PinchZoomVideo.tsx`](../ImouTestApp/PinchZoomVideo.tsx)
(dùng `PanResponder` của RN core — không cần `react-native-gesture-handler`).
```tsx
<PinchZoomVideo deviceId={cam.deviceId} sessionId={session.sessionId}
                maxX={30} style={{ width:'100%', aspectRatio:16/9 }} />
```

**4 lưu ý BẮT BUỘC** (optical zoom chậm + rời rạc 1-3s/bước, khác hẳn digital):
1. **Throttle** `setZoomLevel` (~700ms) khi đang pinch + **apply lần cuối khi thả** —
   KHÔNG gọi mỗi frame (spam cloud + mòn motor → lỗi 40999/giật).
2. Làm việc thẳng ở **normalized 0..1** (pinch-out→1, pinch-in→0). KHÔNG cần maxX
   để điều khiển; maxX chỉ để hiện "×".
3. Ảnh KHÔNG zoom tức thì → **hiện badge mức target ngay** khi pinch; sau khi thả
   + optics settle (~3.5s) thì **đọc lại `getZoomLevel`** để sync vị trí thật.
4. **Gate bằng `getPtzCapability(deviceId).zoom`** — chỉ bật pinch khi cam có optical.

> Digital zoom (phóng to ảnh local, không đụng ống kính) thì KHÁC: trên Android
> SurfaceView không transform được từ RN → phải native. Hiện chưa làm (không yêu cầu).

---

## 5. Checklist port cho team RN

- [ ] Sửa `listRecordings` → `iot.control.SetService` svc 24100, input `{24101:0,
      24102:END, 24103:BEGIN, 24104:cursor, 24105:limit}`, parse `24124[]` + phân
      trang qua `24121`. (Bỏ `SetIotService` + bỏ 24106-24109 + đổi END/BEGIN.)
- [ ] Thêm `listEventRecordings` → svc 90800 (mục 2) cho UI grid thumbnail.
- [ ] Playback event record → svc 96700 by-file (recordId = `90861`).
- [ ] (Tuỳ chọn) Resolution picker → re-open stream với `96505` (mục 3).
- [ ] (Tuỳ chọn) Pinch-to-zoom optical → copy `PinchZoomVideo.tsx` (mục 4b), nhớ
      throttle + apply-on-release + gate `getPtzCapability().zoom`.
- [ ] Thanh tua playback: `onPlaybackProgress` event → slider; tua = stop +
      startPlayback ở mốc mới (không scrub mượt — relay 1 chiều).
- [ ] Nút Record (như Imou): `startRecording(sessionId)` / `stopRecording(sessionId, {saveToGallery:true})`
      khi đang xem live/playback. KHÔNG có "download" — record session đang xem.

> Reference implementation Python: `imou-pkg/imou/api.py` →
> `Camera.list_recordings()` + `Camera.list_event_recordings()` (đã verify live).
