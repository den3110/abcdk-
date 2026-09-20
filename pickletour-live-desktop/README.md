# PickleTour Live — App desktop (PC/Mac, GPU)

Chạy livestream giải đấu từ camera Imou **ngay trên máy của bạn** (dùng GPU
encode), giảm tải cho server. Bật nhiều máy = live nhiều luồng song song.

Chỉ cần: **mở app → đăng nhập admin → chọn giải, sân, camera → Bắt đầu**. Overlay
(bảng điểm, logo PickleTour, tài trợ) và Facebook live do server lo; máy bạn chỉ
kéo cam Imou, chồng overlay, encode (GPU) và đẩy RTMP.

## Yêu cầu 1 lần
- **Node.js 18+** (để chạy/build app)
- **Python 3.10+** + **ffmpeg** (encode). GPU tốt nhất:
  - Windows + NVIDIA → NVENC
  - Mac (Apple Silicon/Intel) → VideoToolbox
  - Intel iGPU → QuickSync

### Cài phụ thuộc
```bash
# macOS / Linux
brew install python ffmpeg        # hoặc apt trên Ubuntu
bash scripts/setup.sh

# Windows (PowerShell)
#  - Cài Python (tick Add to PATH) + ffmpeg (thêm vào PATH)
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
```
`setup` sẽ cài **ImouPkg** (kèm sẵn trong `vendor/imou-pkg`) + kiểm ffmpeg/GPU.

## Chạy app
```bash
npm install
npm start
```
Hoặc build cài đặt:
```bash
npm run dist:mac    # .dmg
npm run dist:win    # .exe (NSIS + portable)
```

## Cách dùng
1. **Đăng nhập**: nhập Backend URL (mặc định `https://pickletour.vn`), email/mật khẩu admin, tên máy.
2. **Chọn giải → sân → camera Imou**, encoder (để *Tự động* là ưu tiên GPU), vị trí overlay.
3. **Thêm điểm đến**: Facebook Page (từ pool admin) hoặc RTMP tuỳ chỉnh (YouTube/TikTok…).
4. **Bắt đầu Live** → xem **preview** ngay trong app; link xem hiện ở panel trạng thái.
5. Trận kết thúc, sân được gán trận mới → overlay tự đổi, không đứt live.
6. **Dừng** trong app, hoặc admin bấm Dừng trên web → máy tự tắt luồng.

## Kiến trúc
- App tạo phiên `runner:"client"` trên backend (backend vẫn tạo FB live + render
  overlay PNG động + poll trận kế). App lấy `worker-config` (session Imou đã giải
  mã, deviceId, destinations, URL overlay/heartbeat) rồi chạy `worker/worker.py`
  với `AUTOLIVE_ENCODER=auto` + `AUTOLIVE_PREVIEW_HLS_DIR` (preview HLS local).
- Worker giữ **1 ffmpeg sống xuyên suốt**, mở lại nguồn Imou khi relay cap (không
  đứt FB), overlay cập nhật điểm real-time qua FIFO image2pipe.
- Heartbeat báo CPU/RAM/encoder/tên máy → hiện trên dashboard admin.

## Xử lý sự cố
- "Python/Imou ✗": chạy lại `scripts/setup`.
- "ffmpeg ✗": cài ffmpeg, thêm vào PATH.
- Preview không lên: đợi ~5s (chờ segment đầu); bấm **Xem log** để xem worker.
- FB báo lỗi publish: page đang bận (đã live ở nơi khác) → chọn page khác.
