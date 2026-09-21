# Plan A (iOS) — Live cam Imou qua app (nguồn P2P/DHAV mượt) → FB

Mục tiêu: dùng luồng cam Imou (đường DHAV như app xem, hiển thị mượt) làm NGUỒN
cho HaishinKit → overlay → đẩy Facebook. Vì HaishinKit encode ở nhịp cố định từ
mixer (frame Imou tới lúc nào append lúc đó, thiếu thì Screen giữ frame cuối) nên
FB luôn nhận realtime — KHÔNG lộ 0.85x như server re-encode CFR.

## Đã làm (trong session này — code, CHƯA build/test)
- `PickleTourLive/ImouCore/` — copy 11 file decoder core Imou (sạch, không React):
  ApiClient, AuthFlow, CryptoCore, DHAVParser, DhHttpClient, DhRtspClient,
  HEVCNalExtractor, HEVCRenderer, AACRenderer, Snapshot, ImouPiPPlaybackDelegate.
- `HEVCRenderer.swift` (bản copy): thêm `onDecodedPixelBuffer` + VTDecompression
  tap (`decodeForLive`) — tái dùng toàn bộ logic parse/format-desc/keyframe đã test.
- `ImouLiveSource.swift` — bridge: pull DHAV → HEVCRenderer → CVPixelBuffer →
  bọc CMSampleBuffer (PTS wallclock) → `onSampleBuffer`.

## ✅ Đã thêm tiếp: LiveStreamingService.preparePreviewImou(...)
- Property `imouSource` + method `preparePreviewImou(session:deviceId:streamId:)`
  (tái dùng applyQuality/offscreen/overlay/mic, bỏ camera, `stream.append(sb)`)
  + dọn `imouSource` trong teardown. Đường camera cũ KHÔNG đổi.
- ⚠️ File này giờ THAM CHIẾU ImouLiveSource/ImouSession (trong ImouCore) → BẮT
  BUỘC làm bước 1 (thêm ImouCore vào target) trước, nếu không sẽ lỗi compile.

## Còn lại (cần môi trường Xcode/CI + iPhone + cam online + FB)
1. **Xcode project (BẮT BUỘC TRƯỚC)**: thêm nhóm `ImouCore/*.swift` +
   `ImouLiveSource.swift` vào target PickleTourLive (kéo-thả trong Xcode / sửa
   .pbxproj). Chưa làm được bằng tay ở đây (dễ hỏng project) — làm trong Xcode.
   Nếu `stream.append(_:)` sai tên ở HaishinKit 1.9.9 → sửa theo API thật lúc build.
2. **LiveStreamingService**: thêm chế độ nguồn Imou (KHÔNG sửa phá đường camera cũ):
   - Không `attachCamera(camera)` — thay bằng `stream.attachCamera(nil)`.
   - Tạo `ImouLiveSource(session:deviceId:productId:)`; set
     `imouSource.onSampleBuffer = { [weak self] sb in self?.stream.append(sb) }`
     (HaishinKit 1.9.9: `IOStream.append(_ sampleBuffer:)` — đã xác nhận là API
     bơm CMSampleBuffer ngoài vào mixer; SecondaryRTMPOutput cũng dùng
     IOStreamObserver.didOutput). `imouSource.start()`.
   - GIỮ `videoMixerSettings.mode = .offscreen` + `registerVideoEffect(overlayEffect)`
     → overlay chồng lên frame Imou như với camera.
   - Pixel format: ImouLiveSource xuất 420 biplanar (video range) — khớp mixer.
   - Audio: `attachAudio(nil)` + để anullsrc (cam bỏ tiếng — như server), hoặc mic.
   - Stop: `imouSource.stop()`.
3. **Session Imou cho app**: TÁI DÙNG flow client-runner có sẵn (như app desktop):
   POST `/api/tournament-auto-live/start` (runner:"client") → GET `/:id/worker-config`
   → trả `imouSession` (đã giải mã) + `imouDeviceId` + destinations + overlayUrl.
   `productId` không có trong config → ImouLiveSource tự gọi `ApiClient.devices()`
   tìm theo deviceId (như imou-rn-native làm). ⇒ KHÔNG cần endpoint backend mới.
4. **UI + luồng session** (hook cụ thể — `LiveAppStore.startLive()` ~line 604):
   - Thêm state: `useImouSource: Bool` + `selectedImouDeviceId: String?` (chọn cam
     Imou của sân).
   - Lấy `ImouSession`: TÁI DÙNG flow client-runner — gọi backend
     POST `/api/tournament-auto-live/start` (runner:"client", tournamentId,
     courtStationId, imouDeviceId, destinations FB) → GET `/:id/worker-config`
     → `imouSession` (map sang `ImouSession` Swift) + `imouDeviceId`. (Thêm 2
     hàm vào LiveAppAPI: startAutoLive, getWorkerConfig.)
   - Trong `startLive()`: nếu `useImouSource` → gọi
     `streamingService.preparePreviewImou(session:deviceId:)` THAY cho
     `preparePreview(...)`; phần `startPublishing(to:)` giữ nguyên (FB dest lấy
     từ worker-config/destinations).
   - Overlay điểm số: backend đã render overlay PNG cho session client-runner;
     iOS có thể dùng overlay effect sẵn (LiveScoreboardVideoEffect) như camera.
5. **Build/Test**: CI `ios-live-beta.yml` → TestFlight → iPhone thật, cam ONLINE,
   FB page thật. Verify: mượt, đúng giờ, overlay đúng, không rớt.

## Rủi ro cần kiểm khi test thiết bị
- VTDecompression HEVC trên device OK (simulator hạn chế).
- HaishinKit nhận CMSampleBuffer ngoài đúng định dạng pixel (420 biplanar) + PTS.
- Nhịp: nếu cam ~0.85x, Screen offscreen giữ frame cuối → FB vẫn 30fps đều.

## Vì sao Android khó hơn (tham khảo)
`imou-rn-native/android` = RỖNG (chỉ build.gradle). Decoder Imou chỉ có Swift
(iOS). Android phải viết lại toàn bộ Kotlin → chọn iOS trước là hợp lý.
