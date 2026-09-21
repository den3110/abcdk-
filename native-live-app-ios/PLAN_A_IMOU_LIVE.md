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

## Còn lại (cần môi trường Xcode/CI + iPhone + cam online + FB)
1. **Xcode project**: thêm nhóm `ImouCore/*.swift` vào target PickleTourLive
   (.pbxproj) — hiện các file ở trên đĩa nhưng CHƯA nằm trong build target.
2. **LiveStreamingService**: thêm chế độ nguồn Imou:
   - Không `attachCamera`. Tạo `ImouLiveSource(session, deviceId, productId)`.
   - `imouSource.onSampleBuffer = { sb in <đưa sb vào HaishinKit mixer> }`.
   - HaishinKit 1.9.9: xác minh API append CMSampleBuffer ngoài vào mixer
     (thường `stream.append(sb)` hoặc qua `MediaMixer`/custom `VideoSource`);
     giữ `videoMixerSettings.mode = .offscreen` + `LiveScoreboardVideoEffect`
     để overlay vẫn chồng lên frame Imou.
   - Audio: dùng anullsrc/mic (cam bỏ audio — như server).
3. **Session Imou cho app**: app đăng nhập admin → chọn giải/sân (có cam Imou) →
   lấy `ImouSession` (uuidUser/uuidKey/sessionId/regionalHost) + deviceId/productId.
   Thêm endpoint backend trả session Imou đã giải mã cho app live (giống
   `/api/tournament-auto-live/:id/worker-config`), hoặc app tự login Imou.
4. **UI**: nút chọn nguồn (Camera điện thoại | Cam Imou) + chọn cam + Start.
5. **Build/Test**: CI `ios-live-beta.yml` → TestFlight → iPhone thật, cam ONLINE,
   FB page thật. Verify: mượt, đúng giờ, overlay đúng, không rớt.

## Rủi ro cần kiểm khi test thiết bị
- VTDecompression HEVC trên device OK (simulator hạn chế).
- HaishinKit nhận CMSampleBuffer ngoài đúng định dạng pixel (420 biplanar) + PTS.
- Nhịp: nếu cam ~0.85x, Screen offscreen giữ frame cuối → FB vẫn 30fps đều.

## Vì sao Android khó hơn (tham khảo)
`imou-rn-native/android` = RỖNG (chỉ build.gradle). Decoder Imou chỉ có Swift
(iOS). Android phải viết lại toàn bộ Kotlin → chọn iOS trước là hợp lý.
