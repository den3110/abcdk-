#!/usr/bin/env bash
# Cài phụ thuộc cho PickleTour Live (macOS/Linux): Python deps (ImouPkg) + kiểm ffmpeg.
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "== PickleTour Live setup =="

PY=""
for c in python3 python; do command -v "$c" >/dev/null 2>&1 && { PY="$c"; break; }; done
if [ -z "$PY" ]; then
  echo "❌ Chưa có Python 3. Cài: macOS 'brew install python', Ubuntu 'apt install python3 python3-pip'"; exit 1
fi
echo "✓ Python: $($PY --version)"

echo "→ Cài ImouPkg + deps…"
$PY -m pip install --user --upgrade pip >/dev/null 2>&1 || true
$PY -m pip install --user "$DIR/vendor/imou-pkg" requests pycryptodomex 2>&1 | tail -2 \
  || $PY -m pip install --break-system-packages "$DIR/vendor/imou-pkg" requests pycryptodomex 2>&1 | tail -2

$PY -c "import imou; print('✓ ImouPkg OK')" || { echo "❌ ImouPkg cài lỗi"; exit 1; }

if command -v ffmpeg >/dev/null 2>&1; then
  echo "✓ ffmpeg: $(ffmpeg -version | head -1)"
  ffmpeg -hide_banner -encoders 2>/dev/null | grep -E "h264_videotoolbox|h264_nvenc|h264_qsv|h264_vaapi" | sed 's/^/   GPU: /' || echo "   (chỉ có x264 CPU)"
else
  echo "⚠ Chưa có ffmpeg. macOS: 'brew install ffmpeg'; Ubuntu: 'apt install ffmpeg'"
fi
echo "== Xong. Chạy app: npm start (hoặc mở PickleTour Live) =="
