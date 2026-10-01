# Commentary relay (aiortc sidecar)

Bình luận viên nói qua mic điện thoại → WebRTC tới VPS → PCM → luồng live (amix).

```
Trình duyệt BLV (getUserMedia/WebRTC)
  → POST /api/commentary/offer (backend Node, token-gated)
  → aiortc_relay.py (sidecar, 127.0.0.1:8790) giải mã Opus → PCM s16le 48k mono
  → POST stream tới control-server desktop qua Tailscale: /api/commentary?sid=&k=PIN
  → worker.py (ffmpeg amix + ducking) → FB/YouTube
```

## Cài đặt trên VPS (một lần)

```bash
cd /abcdk-/backend/services/commentary
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt   # aiortc kéo theo av/pyav (cần ffmpeg/libav trên máy)
```

> Nếu `pip install av` lỗi thiếu thư viện: `apt-get install -y ffmpeg libavdevice-dev libavfilter-dev libavformat-dev libavcodec-dev libavutil-dev pkg-config` rồi cài lại.

## Chạy (pm2)

```bash
pm2 start /abcdk-/backend/services/commentary/.venv/bin/python \
  --name commentary-relay -- /abcdk-/backend/services/commentary/aiortc_relay.py
pm2 save
```

Kiểm tra: `curl http://127.0.0.1:8790/health` → `{"ok":true,...}`.

## Env (tuỳ chọn)

- `COMMENTARY_RELAY_PORT` (mặc định 8790) — khớp `COMMENTARY_AIORTC_URL` ở backend Node (mặc định `http://127.0.0.1:8790`).
- Backend Node: `PUBLIC_WEB_BASE` (mặc định `https://pickletour.vn`) để tạo link `/commentary/<token>`.

## Ghi chú

- Sidecar chỉ nghe 127.0.0.1 → không lộ ra ngoài; chỉ backend Node gọi `/offer`.
- Mỗi BLV = 1 RTCPeerConnection + 1 chunked POST tới đúng máy live (relayUrl chứa PIN, do backend gắn — trình duyệt không thấy).
- Desktop phải: `AUTOLIVE_COMMENTARY=1` (mặc định bật ở main.js) + bật control server + cùng Tailscale.
