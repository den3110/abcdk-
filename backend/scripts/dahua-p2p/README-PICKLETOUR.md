# dh-p2p (PickleTour fork) — lấy cam đầu thu Dahua/DMSS TỪ XA qua P2P

Bản vá của [khoanguyen-3fc/dh-p2p](https://github.com/khoanguyen-3fc/dh-p2p): mở
một **RTSP tunnel** tới đầu thu Dahua/DMSS **khác mạng** (sau NAT nhà) chỉ bằng
**serial + mật khẩu**, KHÔNG cần port-forward / VPN. Dùng làm nguồn cho auto-live
(overlay + FB/YouTube) và cắt clip trong PickleTour.

Đã kiểm chứng thật: từ VPS (IP public), kênh 1 đầu thu `AH0FC62PAZ30620` cho
**60s liên tục, 1498 frame = 25fps, 16.4MB (~2.2Mbps) HEVC 1080p, ~0.97× realtime**.

## Ba bản vá so với upstream (đều nằm ở `src/`)

1. **Auth kênh P2P** (`dh.rs`): upstream chỉ hole-punch, thiếu DevAuth nên đầu thu
   đời mới trả `403 DevPwd_InvalidSalt`. Đã port DevAuth:
   - `GET /info/device/{serial}` → field `Info` (base64) → AES-256-OFB
     (`INFO_KEY`/`INFO_IV`) → JSON `randsalt`.
   - `key = MD5("admin:Login to {randsalt}:{pwd}").hex().upper()`.
   - Body p2p-channel + relay-channel kèm `<CreateDate><DevAuth><Nonce><RandSalt><UserName>`;
     `DevAuth = base64(HMAC_SHA256(key, "{nonce}{curdate}{payload}"))`.
   - LocalAddr client mã hoá `<IpEncrptV2>` bằng AES-256-OFB(dk, `AUTH_IV`),
     `dk = PBKDF2-HMAC-SHA256(key, str(nonce), 20000, 32)`.
2. **Giải mã LocalAddr đầu thu trả về** (`dh.rs`): đầu thu trả LocalAddr đã mã hoá
   (IpEncrptV2); nếu không giải mã bằng cùng `dk` → `ip_to_bytes` panic
   `AddrParseError`. **DIRECT hole-punch (KHÔNG `--relay`)** mới có media; relay chỉ
   bắc control (media 0 byte).
3. **Reliable reassembly PTCP** (`ptcp.rs` + `process.rs`, MẤU CHỐT media): PoC gốc
   forward gói UDP theo thứ tự tới → mất gói là đầu thu treo window sau ~2s/500KB.
   `Reassembler` sắp xếp theo `packet.sent` (byte-offset), chỉ advance `recv` qua
   đoạn LIỀN MẠCH, ACK tại mốc liền mạch → đầu thu **retransmit** gói mất.

Deps thêm trong `Cargo.toml`: `md-5, hmac, sha2, pbkdf2, aes, ofb`.
CLI thêm: `-u/--username`, `-w/--password` (`-p` đã là port).

## Build

```bash
bash scripts/dahua-p2p/build.sh      # → target/release/dh-p2p
```

Chỉ commit **source** (`src/`, `Cargo.toml`, `Cargo.lock`); `target/` bị gitignore.
Trên VPS: build một lần, binary được auto-live worker gọi lại.

## Chạy thủ công (test)

```bash
./target/release/dh-p2p -u admin -w '<mật-khẩu>' -p 127.0.0.1:8554:554 <SERIAL>
# → rtsp://admin:<pass>@127.0.0.1:8554/cam/realmonitor?channel=1&subtype=0
```

- **KHÔNG dùng `--relay`** (relay không có media).
- Đổi kênh 1..8 ở `channel=N` trong URL. `subtype=0` (chính) / `1` (phụ nhẹ).

## GIỚI HẠN quan trọng — 1 cam/lúc

Đầu thu chỉ cho **~1 phiên P2P đồng thời**: tunnel P2P thứ 2 song song KHÔNG lên
(kẹt ở probe). Vậy P2P lấy được **1 camera tại một thời điểm** (đổi kênh trong URL
được, nhưng không 8 cam cùng lúc qua 8 tunnel). Muốn nhiều cam đồng thời: multiplex
nhiều kênh trên MỘT phiên P2P (R&D sâu) hoặc thiết bị tại sân (Tailscale/RTSP LAN).

## Tích hợp auto-live

Worker `scripts/autoLive/worker.py` đọc env `AUTOLIVE_DAHUA_P2P_JSON`
(`{serial, username, password, channel, subtype, bin}`), tự spawn binary này trên
một cổng local rảnh, chờ "Ready to connect!", rồi đặt `AUTOLIVE_SOURCE_URL` =
`rtsp://user:pass@127.0.0.1:<port>/cam/realmonitor?channel=N&subtype=M`. Tunnel là
tiến trình con của worker (detached) → chết/khởi động lại theo worker, sống qua
pm2 restart.

## GOTCHA vận hành

- Kill theo PID; `pkill -f dh-p2p` có thể tự giết shell (cmdline chứa "dh-p2p").
- Đầu thu rate-limit phiên khi test dồn dập, hoặc khi DMSS đang mở cùng lúc.
- Bật log chi tiết: env `DH_DEBUG=1` (chỉ khi debug; flood ở 1080p làm nghẽn).
- **Bảo mật:** serial + mật khẩu là chìa khoá truy cập từ xa. Lưu mật khẩu mã hoá
  (venue.dahuaNvr.credCipher). Đổi mật khẩu đầu thu nếu từng lộ.
