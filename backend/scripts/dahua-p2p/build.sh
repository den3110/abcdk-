#!/usr/bin/env bash
# Build the patched dh-p2p tunnel binary (PickleTour fork).
#
# Sản phẩm: ./target/release/dh-p2p — dùng bởi auto-live worker (scripts/autoLive/worker.py)
# để mở tunnel P2P tới đầu thu Dahua/DMSS TỪ XA chỉ bằng serial + mật khẩu (không
# port-forward / VPN). Xem README-PICKLETOUR.md.
#
# Yêu cầu: rustc/cargo (>= 1.74). Cài nhanh trên VPS Linux:
#   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
#   source "$HOME/.cargo/env"
#
# Chạy: bash scripts/dahua-p2p/build.sh
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v cargo >/dev/null 2>&1; then
  if [ -f "$HOME/.cargo/env" ]; then
    # shellcheck disable=SC1091
    source "$HOME/.cargo/env"
  fi
fi
if ! command -v cargo >/dev/null 2>&1; then
  echo "[dahua-p2p] cargo/rustc chưa cài. Cài rust rồi chạy lại:" >&2
  echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && source \$HOME/.cargo/env" >&2
  exit 1
fi

echo "[dahua-p2p] cargo build --release …"
cargo build --release
BIN="$(pwd)/target/release/dh-p2p"
if [ ! -x "$BIN" ]; then
  echo "[dahua-p2p] build xong nhưng không thấy binary tại $BIN" >&2
  exit 2
fi
echo "[dahua-p2p] OK → $BIN"
"$BIN" --help | head -20 || true
