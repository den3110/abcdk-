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

echo "==> dh-p2p (tunnel Dahua/DMSS P2P) — build từ ../backend/scripts/dahua-p2p"
OS_WIN=0
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) OS_WIN=1;; esac
DHSRC="$ROOT/../backend/scripts/dahua-p2p"
if [ -d "$DHSRC" ]; then
  command -v cargo >/dev/null 2>&1 || . "$HOME/.cargo/env" 2>/dev/null || true
  if command -v cargo >/dev/null 2>&1; then
    ( cd "$DHSRC" && cargo build --release )
    DHEXE="dh-p2p"; [ "$OS_WIN" = "1" ] && DHEXE="dh-p2p.exe"
    if cp "$DHSRC/target/release/$DHEXE" "$BIN/$DHEXE" 2>/dev/null; then
      chmod +x "$BIN/$DHEXE" 2>/dev/null || true
      [ "$(uname)" = "Darwin" ] && codesign --force --sign - "$BIN/dh-p2p" 2>/dev/null || true
      echo "  → bin/$DHEXE"
    else
      echo "  !! không thấy binary sau build ($DHSRC/target/release/$DHEXE)"
    fi
  else
    echo "  !! cargo/rust chưa cài → BỎ QUA dh-p2p (nguồn Dahua P2P sẽ không dùng được ở bản này)"
  fi
else
  echo "  !! không thấy $DHSRC → bỏ qua dh-p2p"
fi

echo "==> Xong. bin/:"
ls -lah "$BIN"
echo "Giờ chạy: npm run dist:mac  (hoặc dist:win trên Windows)"
