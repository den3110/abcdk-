#!/bin/bash
# Chuẩn bị thư mục bin/ cho bản app TỰ CHỨA (không cần cài Python/ffmpeg):
#   - ffmpeg + ffprobe tĩnh (từ npm ffmpeg-static / ffprobe-static)
#   - worker đóng gói bằng PyInstaller (kèm ImouPkg)
# Chạy TRƯỚC khi `npm run dist:mac` (hoặc dist:win trên máy Windows).
# Binary theo TỪNG HỆ ĐIỀU HÀNH → chạy script này trên đúng OS bạn build.
set -e
cd "$(dirname "$0")/.."   # → thư mục app
ROOT=$(pwd)
BIN="$ROOT/bin"
rm -rf "$BIN"; mkdir -p "$BIN"

echo "==> ffmpeg/ffprobe tĩnh"
node -e "require('fs').copyFileSync(require('ffmpeg-static'), '$BIN/ffmpeg')"
node -e "require('fs').copyFileSync(require('ffprobe-static').path, '$BIN/ffprobe')"

echo "==> Đóng gói worker (PyInstaller + ImouPkg)"
PY=""
for c in python3.13 python3.12 python3.11 python3.10; do command -v "$c" >/dev/null 2>&1 && { PY=$c; break; }; done
[ -z "$PY" ] && { echo "Cần Python 3.10+ để build worker"; exit 1; }
VENV="$ROOT/.buildvenv"
"$PY" -m venv "$VENV"
"$VENV/bin/pip" install -q --upgrade pip
"$VENV/bin/pip" install -q ./vendor/imou-pkg pyinstaller
EXE="ptlive-worker"; [ "$(uname)" = "MINGW"* ] || true
"$VENV/bin/pyinstaller" --onefile --name ptlive-worker \
  --collect-all imou --collect-all Cryptodome \
  --distpath "$ROOT/.builddist" --workpath "$ROOT/.buildwork" \
  worker/worker.py
cp "$ROOT/.builddist/ptlive-worker"* "$BIN/" 2>/dev/null || true
chmod +x "$BIN/"* 2>/dev/null || true
# macOS (Apple Silicon): cp phá chữ ký ad-hoc của PyInstaller → binary bị SIGKILL
# (Killed: 9) khi chạy, KHÔNG log/không frame. Ký lại ad-hoc sau khi copy.
if [ "$(uname)" = "Darwin" ]; then
  codesign --force --sign - "$BIN/ptlive-worker" 2>/dev/null \
    && echo "==> đã ký ad-hoc ptlive-worker" \
    || echo "!! codesign thất bại — nếu binary bị 'Killed: 9', chạy: codesign --force --sign - bin/ptlive-worker"
fi
rm -rf "$ROOT/.buildwork" "$ROOT/.builddist" ptlive-worker.spec 2>/dev/null || true

echo "==> Xong. bin/:"
ls -lah "$BIN"
echo "Giờ chạy: npm run dist:mac  (hoặc dist:win trên Windows)"
