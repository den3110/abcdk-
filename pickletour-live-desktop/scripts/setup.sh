#!/usr/bin/env bash
# Cài phụ thuộc cho PickleTour Live (macOS/Linux): venv Python 3.10+ + ImouPkg + kiểm ffmpeg.
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "== PickleTour Live setup =="

# Tìm Python >= 3.10 (ImouPkg yêu cầu). Ưu tiên bản mới.
PY=""
for c in python3.13 python3.12 python3.11 python3.10 python3 python; do
  command -v "$c" >/dev/null 2>&1 || continue
  V="$("$c" -c 'import sys;print("%d.%d"%sys.version_info[:2])' 2>/dev/null || echo 0.0)"
  MAJ="${V%%.*}"; MIN="${V##*.}"
  if [ "$MAJ" -eq 3 ] && [ "$MIN" -ge 10 ] 2>/dev/null; then PY="$c"; break; fi
done
if [ -z "$PY" ]; then
  echo "❌ Không tìm thấy Python >= 3.10."
  echo "   macOS:  brew install python@3.12"
  echo "   Ubuntu: sudo apt install python3.12 python3.12-venv"
  exit 1
fi
echo "✓ Python: $("$PY" --version) ($PY)"

# venv riêng cho app (tránh PEP 668 / khỏi đụng Python hệ thống).
VENV="$DIR/.venv"
echo "→ Tạo venv: $VENV"
"$PY" -m venv "$VENV"
VPY="$VENV/bin/python"
"$VPY" -m pip install --upgrade pip >/dev/null
echo "→ Cài ImouPkg + deps vào venv…"
"$VPY" -m pip install "$DIR/vendor/imou-pkg" requests pycryptodomex
"$VPY" -c "import imou; print('✓ ImouPkg OK')"

echo "$VPY" > "$DIR/.python-path"
echo "✓ Đã ghi $DIR/.python-path = $VPY"

if command -v ffmpeg >/dev/null 2>&1; then
  echo "✓ ffmpeg: $(ffmpeg -version | head -1)"
  ffmpeg -hide_banner -encoders 2>/dev/null | grep -E "h264_videotoolbox|h264_nvenc|h264_qsv|h264_vaapi" | sed 's/^/   GPU: /' || echo "   (chỉ có x264 CPU)"
else
  echo "⚠ Chưa có ffmpeg. macOS: 'brew install ffmpeg'; Ubuntu: 'apt install ffmpeg'"
fi
echo "== Xong. Chạy app: npm start =="
