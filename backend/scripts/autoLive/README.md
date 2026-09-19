# Auto-live worker (Python)

Cầu nối Imou DHAV stream → ffmpeg → RTMP (FB/YT/custom) cho mỗi court trong
1 giải đấu. Được orchestrator Node spawn qua `child_process` với env vars.

## Deploy VPS

```bash
# 1. Cài Python 3.10+ và pip
apt install -y python3 python3-pip

# 2. Cài imou-pkg
pip3 install ImouPkg requests

# 3. Cài ffmpeg và verify có dhav demuxer
apt install -y ffmpeg
ffmpeg -hide_banner -demuxers 2>&1 | grep dhav
# → phải thấy dòng "D dhav Dahua HuffYUV Video"; nếu không có, build ffmpeg từ
#   source với --enable-demuxer=dhav (bản apt Ubuntu 22.04 đã có sẵn).

# 4. Set env trong .env backend PickleTour:
PYTHON_BIN=/usr/bin/python3
AUTOLIVE_WORKER_TOKEN=<random 32 chars>
PUBLIC_BACKEND_URL=https://api.pickletour.vn

# 5. pm2 restart pickletour-backend
```

## Test thủ công 1 session

```bash
export AUTOLIVE_SESSION_ID=test123
export AUTOLIVE_WORKER_TOKEN=changeme
export AUTOLIVE_OVERLAY_URL=https://api.pickletour.vn/api/tournament-auto-live/overlay/test123.png
export AUTOLIVE_HEARTBEAT_URL=https://api.pickletour.vn/api/tournament-auto-live/internal/heartbeat
export AUTOLIVE_IMOU_PHONE=0987xxx
export AUTOLIVE_IMOU_PASSWORD=xxx
export AUTOLIVE_IMOU_AREA_CODE=84
export AUTOLIVE_IMOU_DEVICE_ID=8Cxxxx
export AUTOLIVE_DESTINATIONS='[{"type":"rtmp","streamUrl":"rtmp://a.rtmp.youtube.com/live2","streamKey":"xxxx-xxxx-xxxx-xxxx"}]'
python3 worker.py
```

## Kiến trúc

- **Input 0**: `imou-pkg` client login qua LC OpenAPI (SaaS), gọi
  `things.media.GetRealTransferStreamUrl` → nhận URL trả DHAV chunks. Client
  parse HTTP header + yield bytes. Feed thẳng vào ffmpeg `-f dhav -i pipe:0`.
- **Input 1**: overlay PNG 1920x1080 alpha do backend Node render bằng
  node-canvas. `image2 -loop 1 -framerate 1 -reload 1` cho ffmpeg re-fetch
  mỗi giây → điểm số thay đổi phản ánh lên stream trong ~1s.
- **Output tee**: 1 encode → nhiều RTMP destination song song. `onfail=ignore`
  để 1 dest chết (Facebook đứt) không phá stream YouTube.

## Auto next-match

Không xử lý bên worker — do orchestrator Node poll `courtStation.currentMatch`
mỗi 5s, khi đổi thì bump `overlayVersion` → PNG mới → ffmpeg reload tự động.
Pipeline giữ nguyên, viewer thấy transition mượt (chỉ overlay đổi).
