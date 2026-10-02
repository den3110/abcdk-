#!/usr/bin/env python3
"""PickleTour auto-live worker — cầu nối Imou DHAV → ffmpeg → RTMP.

Env do Node orchestrator set:
    AUTOLIVE_SESSION_ID
    AUTOLIVE_WORKER_TOKEN
    AUTOLIVE_OVERLAY_URL         (backend serve PNG 1920x1080 alpha)
    AUTOLIVE_HEARTBEAT_URL
    AUTOLIVE_SESSION_POST_URL    (backend nhận session Imou mới sau relogin)
    AUTOLIVE_IMOU_SESSION_JSON   ({uuid_user,uuid_key,session_id,regional_host}) — có thể rỗng
    AUTOLIVE_IMOU_PHONE / AUTOLIVE_IMOU_PASSWORD / AUTOLIVE_IMOU_AREA_CODE — để relogin
    AUTOLIVE_IMOU_DEVICE_ID
    AUTOLIVE_DESTINATIONS        (JSON [{type,streamUrl,streamKey}])

Pipeline:
    imou Camera.open_rtsp()  → DHAV bytes (1 kết nối duy nhất tới relay Imou)
      ↓ đệm ~3s đầu → ffprobe xem có audio không
      ↓ stdin
    ffmpeg -f dhav -i pipe:0
           [-f image2 -loop 1 -i overlay.png]      (file local, thay mỗi 1s)
           scale 1080p → overlay → libx264 → aac (anullsrc nếu cam không mic)
           → tee nhiều RTMP

Bền bỉ:
  - Imou chỉ cho 1 phiên/tài khoản: app mobile login → phiên server bị đá
    (code 12002). Gặp 12002 → login lại bằng creds → báo session mới về
    backend → chạy tiếp.
  - Relay đứt / ffmpeg chết → mở lại stream + ffmpeg mới (backoff), tối đa
    MAX_ATTEMPTS lần liên tiếp; stream ổn định >60s thì reset đếm.

Auto next-match KHÔNG ở đây: Node poll court.currentMatch → bump
overlayVersion → PNG mới → worker tải về → image2 mở lại file mỗi frame.
"""
import json
import os
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

# Windows console mặc định cp1252/cp936 → log tiếng Việt (ả, ầ, …) sẽ
# UnicodeEncodeError khi print. Env PYTHONIOENCODING KHÔNG có tác dụng với
# binary PyInstaller (frozen). Ép UTF-8 ngay tại runtime cho stdout/stderr.
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

PREBUFFER_BYTES = 1_500_000   # ~3s ở 4Mbps — đủ cho ffprobe thấy audio
PREBUFFER_MAX_S = 6.0
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
MAX_ATTEMPTS = 12
ENCODER = "libx264"  # set trong main() bằng detect_encoder()
OUT_FPS = 25         # set trong main() = fps nguồn (khớp để không nhân đôi frame)
# Cấu hình nâng cao (env, có default) — chỉnh từ app desktop.
VID_KBPS = int(os.environ.get("AUTOLIVE_VIDEO_BITRATE") or 4500)
MAX_KBPS = int(os.environ.get("AUTOLIVE_MAX_BITRATE") or round(VID_KBPS * 1.15))
RES_H = int(os.environ.get("AUTOLIVE_RES_H") or 1080)           # 1080/720/480
AUD_KBPS = int(os.environ.get("AUTOLIVE_AUDIO_BITRATE") or 128)
FPS_OVERRIDE = int(os.environ.get("AUTOLIVE_FPS") or 0)         # 0 = khớp nguồn
# ── Chống rò rỉ RAM (mục tiêu: live cả ngày, nhiều luồng) ─────────────────
# 1) Overlay ghi LIÊN TỤC ở fps thấp (điểm số cập nhật ~mỗi 0.5s). QUAN TRỌNG:
#    PHẢI ghi đều, KHÔNG dedup/thưa — nếu overlay input ngừng tiến PTS thì
#    filter `overlay` (framesync) sẽ CHẶN, kéo cả luồng chậm lại (speed<<1 →
#    FB quay loading). Việc chống rò rỉ RAM do BACKPRESSURE (thread_queue nhỏ)
#    lo, không phải do ghi thưa.
OVERLAY_FPS = float(os.environ.get("AUTOLIVE_OVERLAY_FPS") or 2.0)
# 2) x264 mặc định dùng HẾT core (VPS 12-core → ~600-700MB/luồng chỉ để encode)
#    + rc-lookahead/B-frame ăn thêm nhiều buffer 1080p. Giới hạn lại → base RAM
#    ~390MB/luồng (đo thực tế) mà chất lượng 4500k/1080p vẫn tốt.
X264_THREADS = int(os.environ.get("AUTOLIVE_X264_THREADS") or min(4, (os.cpu_count() or 4)))
X264_LOOKAHEAD = int(os.environ.get("AUTOLIVE_X264_LOOKAHEAD") or 10)
# 3) Watchdog cứng: ffmpeg vượt ngưỡng RSS → kill để vòng chính restart. Đảm bảo
#    1 luồng KHÔNG BAO GIỜ ngốn hết RAM máy chủ (trước đây 1 luồng lên 19.6GB).
#    0 = tắt. Restart hiếm khi xảy ra nếu creep đã được khống chế.
MAX_RSS_MB = int(os.environ.get("AUTOLIVE_MAX_RSS_MB") or 1800)
# Nguồn video: rỗng = cam Imou (DHAV qua stdin); có = link tuỳ chỉnh
# (m3u8/RTSP/RTMP/http) → ffmpeg đọc thẳng URL.
SOURCE_URL = (os.environ.get("AUTOLIVE_SOURCE_URL") or "").strip()
# Browser overlay (tuỳ chọn): tcp://127.0.0.1:PORT do main.js (Electron) render
# trang web transparent → capturePage PNG → feed image2pipe. Lớp DƯỚI scoreboard.
BROWSER_OVERLAY = (os.environ.get("AUTOLIVE_BROWSER_OVERLAY") or "").strip()
# PREVIEW-ONLY: xem thử nguồn TRƯỚC khi live (RTSP/m3u8/RTMP/HTTP hoặc Imou). Chỉ
# xuất HLS cục bộ (AUTOLIVE_PREVIEW_HLS_DIR), KHÔNG overlay/heartbeat/destinations
# FB-YT. Tái dùng nguyên đường đọc nguồn (URL + Imou DHAV) của worker.
PREVIEW_ONLY = (os.environ.get("AUTOLIVE_PREVIEW_ONLY") or "").strip() in ("1", "true", "yes")
# Cam Imou: mặc định KÉO CHỈ VIDEO (bỏ audio cam). Lý do: live thể thao overlay
# không cần tiếng cam; audio DHAV của Imou hay lỗi timestamp (hàng loạt "timestamp
# discontinuity" trên aac) làm A/V lệch + kéo speed xuống. Bỏ audio → relay tải
# NHẸ hơn (nhanh hơn) + hết discontinuity audio → mượt hơn. Đặt AUTOLIVE_IMOU_AUDIO=1
# để lấy lại tiếng cam.
IMOU_AUDIO = (os.environ.get("AUTOLIVE_IMOU_AUDIO") or "0").strip().lower() not in ("0", "false", "no", "")
# Chọn luồng cam Imou: "0" = luồng chính (HD, hay 2K H.265 → NẶNG, relay cloud
# đẩy < realtime → trễ dồn); "1" = luồng phụ (SD/H.264, NHẸ → relay kịp realtime,
# mượt). Với cam 2K nặng, dùng "1" mượt hơn hẳn. ImouPkg đọc qua env IMOU_STREAM_ID.
IMOU_STREAM_ID = (os.environ.get("AUTOLIVE_IMOU_STREAM_ID") or "0").strip()
os.environ["IMOU_STREAM_ID"] = IMOU_STREAM_ID
# Thử nghiệm: dùng GetLiveStreamUrl (live cloud RTMP/RTSP/HLS) thay DHAV relay —
# đường CDN, có thể mượt như app xem cam. "" = tắt (dùng DHAV). "rtmp"/"rtsp"/"hls".
IMOU_LIVE_STREAM = (os.environ.get("AUTOLIVE_IMOU_LIVE_STREAM") or "").strip().lower()
# Re-sync định kỳ (chỉ Imou): relay cloud đẩy ~0.85x realtime → trễ dồn dần khi
# live dài. Cứ RESYNC_S giây, worker ĐÓNG + MỞ LẠI nguồn Imou ở MÉP LIVE (relay
# đang giữ backlog cũ → phiên mới bỏ backlog, nhảy về hiện tại) mà KHÔNG restart
# ffmpeg (giữ kết nối FB, không tạo video FB mới). setpts=RTCTIME xử lý mượt bước
# nhảy timestamp. 0 = tắt. Mặc định 600s (trễ tối đa ~1.5 phút rồi reset).
RESYNC_S = int(os.environ.get("AUTOLIVE_RESYNC_SEC") or 600)
# Preview HLS local cho app desktop (Electron) hiển thị — env là thư mục.
PREVIEW_DIR = os.environ.get("AUTOLIVE_PREVIEW_HLS_DIR", "").strip()
HEALTHY_AFTER_S = 60

# Ghi recording để cắt clip TỪNG TRẬN (live xuyên suốt). Segment MPEG-TS ghi vào
# thư mục con "rec" của PREVIEW_DIR — dùng TÊN TƯƠNG ĐỐI + cwd=PREVIEW_DIR để né
# `C:` trong tee spec (Windows). Bật bằng env AUTOLIVE_RECORD=1 (main.js đặt khi
# session.recordClips). main.js chịu trách nhiệm đẩy segment về server + dọn dẹp.
RECORD_CLIPS = os.environ.get("AUTOLIVE_RECORD", "").strip().lower() in ("1", "true", "yes", "on")
RECORD_SUBDIR = "rec"
RECORD_SEGMENT_SEC = int(os.environ.get("AUTOLIVE_RECORD_SEGMENT_SEC") or 300)

# Ẩn ngày/giờ (OSD) của camera TRÊN LUỒNG LIVE bằng filter `delogo` (nội suy pixel
# quanh vùng → timestamp "biến mất"). KHÔNG đụng tới camera nên chủ cam xem trên
# DMSS vẫn thấy đủ. Toạ độ tính theo khung ĐÍCH 1920x1080 (sau scale+pad). Mặc
# định phủ góc TRÊN-PHẢI (vị trí OSD phổ biến của Dahua). Chỉnh bằng env nếu lệch.
# Ràng buộc delogo: hộp phải nằm TRONG khung và cách mép ≥1px (nó nội suy từ viền).
DELOGO = os.environ.get("AUTOLIVE_DELOGO", "").strip().lower() in ("1", "true", "yes", "on")
DELOGO_X = int(os.environ.get("AUTOLIVE_DELOGO_X") or 1360)
DELOGO_Y = int(os.environ.get("AUTOLIVE_DELOGO_Y") or 46)
DELOGO_W = int(os.environ.get("AUTOLIVE_DELOGO_W") or 544)
DELOGO_H = int(os.environ.get("AUTOLIVE_DELOGO_H") or 72)


# ── Bình luận viên (mic điện thoại trộn vào luồng live) ───────────────────────
# Nhận PCM từ main.js (relay từ VPS aiortc) qua TCP cục bộ, bơm realtime vào 1
# input audio của ffmpeg rồi amix với tiếng camera. Mặc định phát IM LẶNG → khi
# có BLV nói mới có tiếng → bật/tắt KHÔNG cần restart luồng. Có ducking (hạ tiếng
# camera khi BLV nói) qua sidechaincompress. Định dạng PCM cố định: s16le 48k mono.
COMMENTARY = os.environ.get("AUTOLIVE_COMMENTARY", "").strip().lower() in ("1", "true", "yes", "on")
COMMENTARY_SR = 48000
COMMENTARY_CH = 1
COMMENTARY_FRAME_MS = 20
COMMENTARY_BYTES_PER_FRAME = COMMENTARY_SR * 2 * COMMENTARY_CH * COMMENTARY_FRAME_MS // 1000
# Ducking: hạ tiếng camera khi có tiếng bình luận. Tắt bằng AUTOLIVE_COMMENTARY_DUCK=0.
COMMENTARY_DUCK = os.environ.get("AUTOLIVE_COMMENTARY_DUCK", "1").strip().lower() not in ("0", "false", "no", "")
# Hệ số khuếch tiếng bình luận trước khi trộn (1.0 = giữ nguyên).
COMMENTARY_GAIN = float(os.environ.get("AUTOLIVE_COMMENTARY_GAIN") or 1.0)
# Preview 360p độ trễ thấp cho BLV XEM luồng khi bình luận: ffmpeg xuất thêm 1 bản
# 360p MPEG-TS ra UDP nội bộ (không chặn luồng chính) → worker fan-out TCP → control
# -server → aiortc gắn làm video track gửi về trình duyệt. Mặc định bật cùng commentary.
PREVIEW360 = COMMENTARY and os.environ.get("AUTOLIVE_PREVIEW360", "1").strip().lower() not in ("0", "false", "no", "")
PREVIEW360_H = int(os.environ.get("AUTOLIVE_PREVIEW360_H") or 360)
PREVIEW360_KBPS = int(os.environ.get("AUTOLIVE_PREVIEW360_KBPS") or 600)


def _delogo_filter():
    """Trả về đoạn filter delogo (đã kẹp toạ độ vào trong 1920x1080, cách mép ≥1px)
    hoặc chuỗi rỗng nếu không bật. delogo lỗi nếu hộp chạm mép/tràn khung."""
    if not DELOGO:
        return ""
    W, H = 1920, 1080
    w = max(8, min(DELOGO_W, W - 4))
    h = max(8, min(DELOGO_H, H - 4))
    x = max(1, min(DELOGO_X, W - w - 1))
    y = max(1, min(DELOGO_Y, H - h - 1))
    return f",delogo=x={x}:y={y}:w={w}:h={h}"


def _find_stream_url(data):
    """Dò URL stream (rtmp/rtsp/http/hls) trong dict/list trả về từ GetLiveStreamUrl
    (tên field không rõ ràng nên tìm đệ quy giá trị dạng URL)."""
    def looks(u):
        return isinstance(u, str) and (
            u.startswith(("rtmp://", "rtmps://", "rtsp://")) or
            (u.startswith(("http://", "https://")) and (".m3u8" in u or "/live" in u or "hls" in u)))
    def walk(o):
        if isinstance(o, str):
            return o if looks(o) else None
        if isinstance(o, dict):
            for v in o.values():
                r = walk(v)
                if r: return r
        if isinstance(o, list):
            for v in o:
                r = walk(v)
                if r: return r
        return None
    return walk(data)


def env(name, default=None, required=False):
    v = os.environ.get(name, default)
    if required and not v:
        print(f"[worker] missing env {name}", file=sys.stderr, flush=True)
        sys.exit(2)
    return v


def log(msg, err=False):
    print(f"[worker {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr if err else sys.stdout, flush=True)


def detect_encoder():
    """Chọn encoder: env AUTOLIVE_ENCODER (nvenc|videotoolbox|qsv|vaapi|x264|auto).
    auto → dò encoder ffmpeg hỗ trợ, ưu tiên GPU (NVENC > VideoToolbox > QSV >
    VAAPI > x264). Trả tên h264 encoder."""
    want = (os.environ.get("AUTOLIVE_ENCODER") or "auto").strip().lower()
    alias = {"nvenc": "h264_nvenc", "videotoolbox": "h264_videotoolbox",
             "qsv": "h264_qsv", "vaapi": "h264_vaapi", "x264": "libx264"}
    try:
        out = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"],
                             capture_output=True, timeout=15).stdout.decode("utf-8", "ignore")
    except Exception:
        out = ""
    have = lambda name: (" " + name) in out
    # Chỉ LIỆT KÊ trong -encoders chưa đủ (VPS không GPU vẫn có h264_nvenc →
    # "Cannot load libcuda.so.1" khi chạy). Phải TEST-ENCODE thật mới dùng.
    def works(name):
        if name == "libx264":
            return True
        if not have(name):
            return False
        try:
            r = subprocess.run(
                ["ffmpeg", "-hide_banner", "-loglevel", "error",
                 "-f", "lavfi", "-i", "color=c=black:s=256x144:r=5", "-t", "0.2",
                 "-c:v", name, "-f", "null", "-"],
                capture_output=True, timeout=15)
            return r.returncode == 0
        except Exception:
            return False
    if want in alias and works(alias[want]):
        return alias[want]
    for cand in ("h264_nvenc", "h264_videotoolbox", "h264_qsv", "h264_vaapi", "libx264"):
        if works(cand):
            if cand != "libx264":
                log(f"GPU encoder khả dụng: {cand}")
            return cand
    return "libx264"


def encoder_args(enc):
    """Args tối ưu theo từng encoder — GPU giảm tải CPU mạnh (nhiều luồng).
    CFR 25fps đều (-vsync cfr) + bitrate cao hơn cho 1080p mượt/nét."""
    fps = OUT_FPS or 25
    gop = fps * 2
    buf = int(MAX_KBPS * 1.5)  # bufsize gọn hơn (trước *2) — đỡ RAM VBV, vẫn mượt
    common_rate = ["-vsync", "cfr", "-r", str(fps), "-g", str(gop), "-keyint_min", str(gop),
                   "-b:v", f"{VID_KBPS}k", "-maxrate", f"{MAX_KBPS}k", "-bufsize", f"{buf}k",
                   "-pix_fmt", "yuv420p"]
    if enc == "h264_nvenc":
        # Cấu hình y hệt backend (đang chạy trơn). KHÔNG thêm -tune/-rc-lookahead/
        # -spatial-aq/-b_ref_mode ở đây — chúng thêm latency + backpressure ở
        # pipeline (lookahead giữ 8 khung, AQ tăng thời gian encode/khung) →
        # ffmpeg thiếu frame → -vsync cfr duplicate → GIẬT nhìn thấy trên player.
        return ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "cbr",
                "-profile:v", "high", "-bf", "2", *common_rate]
    if enc == "h264_videotoolbox":
        return ["-c:v", "h264_videotoolbox", "-realtime", "1",
                "-profile:v", "high", *common_rate]
    if enc == "h264_qsv":
        return ["-c:v", "h264_qsv", "-preset", "faster", "-profile:v", "high", *common_rate]
    if enc == "h264_vaapi":
        return ["-vf", "format=nv12,hwupload", "-c:v", "h264_vaapi",
                "-profile:v", "high", *common_rate]
    # x264: GIỚI HẠN threads + rc-lookahead → base RAM ~390MB/luồng thay vì
    # ~700MB (12-core mặc định x264 mở ~18 thread, mỗi thread giữ frame 1080p).
    # bf 0 cho live (B-frame gần như không cải thiện độ mượt, chỉ nén; bỏ đi
    # giảm buffer reorder). sync-lookahead=0 tắt buffer lookahead theo thread.
    return ["-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high",
            "-threads", str(X264_THREADS), "-bf", "0",
            "-x264-params", f"rc-lookahead={X264_LOOKAHEAD}:sync-lookahead=0:threads={X264_THREADS}",
            *common_rate]


def encoder360_args(enc):
    """Encoder nhẹ, GOP ngắn (keyframe ~1s) cho bản 360p xem bình luận (video-only)."""
    fps = OUT_FPS or 25
    gop = fps
    rate = ["-r", str(fps), "-g", str(gop), "-keyint_min", str(gop),
            "-b:v", f"{PREVIEW360_KBPS}k", "-maxrate", f"{PREVIEW360_KBPS}k",
            "-bufsize", f"{PREVIEW360_KBPS}k", "-pix_fmt", "yuv420p"]
    if enc == "h264_nvenc":
        return ["-c:v", "h264_nvenc", "-preset", "p1", "-tune", "ll", "-rc", "cbr", *rate]
    if enc == "h264_videotoolbox":
        return ["-c:v", "h264_videotoolbox", "-realtime", "1", *rate]
    if enc == "h264_qsv":
        return ["-c:v", "h264_qsv", "-preset", "veryfast", *rate]
    return ["-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-bf", "0", *rate]


def build_tee_output(destinations):
    parts = []
    for d in destinations:
        url = d.get("streamUrl", "").strip()
        key = d.get("streamKey", "").strip()
        if not url:
            continue
        full = url if not key else (url.rstrip("/") + "/" + key)
        parts.append(f"[f=flv:onfail=ignore]{full}")
    # Preview HLS local (app desktop) — slave riêng, onfail=ignore để không phá RTMP.
    if PREVIEW_DIR:
        try:
            os.makedirs(PREVIEW_DIR, exist_ok=True)
            # WINDOWS: đường dẫn tuyệt đối có `C:` phá parser của tee muxer (`:` là
            # dấu tách option; escape `\:` không hoạt động ổn định) → slave preview
            # báo "No option found near ...". Dùng TÊN FILE TƯƠNG ĐỐI + spawn ffmpeg
            # với cwd=PREVIEW_DIR (đặt ở vòng spawn) → không có `:` trong tee spec.
            seg_opt = "seg_%03d.ts"
            m3u8_out = "index.m3u8"
            # list_size lớn hơn + segment 2s → player có đệm, đỡ "loading" liên tục.
            parts.append(
                f"[f=hls:onfail=ignore:hls_time=2:hls_list_size=8:"
                f"hls_flags=delete_segments+omit_endlist:hls_segment_filename={seg_opt}]{m3u8_out}")
        except OSError:
            pass
    return "|".join(parts)


def record_slave(run_epoch):
    """Tee slave ghi segment MPEG-TS (tên TƯƠNG ĐỐI theo cwd=PREVIEW_DIR) để server
    cắt clip từng trận. run_epoch (epoch giây, lúc ffmpeg spawn) làm prefix → mỗi lần
    spawn 1 prefix mới, KHÔNG ghi đè segment lần chạy trước. TS: chống hỏng khi crash,
    concat -c copy dễ. onfail=ignore để lỗi ghi đĩa KHÔNG phá luồng live."""
    if not (RECORD_CLIPS and PREVIEW_DIR):
        return ""
    try:
        os.makedirs(os.path.join(PREVIEW_DIR, RECORD_SUBDIR), exist_ok=True)
    except OSError:
        return ""
    name = f"{RECORD_SUBDIR}/rec-{run_epoch}-%03d.ts"
    return (f"[f=segment:onfail=ignore:segment_time={RECORD_SEGMENT_SEC}:"
            f"segment_format=mpegts:reset_timestamps=1]{name}")


# ── overlay / heartbeat ─────────────────────────────────────────────────
def fetch_overlay_bytes(url):
    """Tải PNG overlay → trả bytes (hoặc None)."""
    try:
        req = urllib.request.Request(url, headers={"Cache-Control": "no-cache"})
        data = urllib.request.urlopen(req, timeout=8).read()
        if not data or data[:8] != PNG_MAGIC:
            return None
        return data
    except Exception as e:  # noqa: BLE001
        log(f"overlay fetch fail: {e}", err=True)
        return None


def start_overlay_fetcher(url, stop_event, fps=None, extra_stop=None):
    """Tải PNG overlay LIÊN TỤC trong thread RIÊNG → cập nhật holder['png'].
    TÁCH khỏi vòng feed (FIFO/TCP): 1 lần fetch chậm/timeout (backend quá tải)
    KHÔNG được chặn việc cấp frame cho ffmpeg — nếu overlay input ngừng tiến PTS
    thì filter `overlay` (framesync) CHẶN cả luồng video → GIẬT/đơ. Feeder chỉ đẩy
    holder['png'] hiện có ở nhịp đều; fetch chậm chỉ làm điểm số 'đứng' tạm thời,
    video vẫn mượt. Trả (holder, thread)."""
    fps = fps or OVERLAY_FPS
    interval = 1.0 / max(0.5, fps)
    holder = {"png": None}

    def loop():
        while not stop_event.is_set() and not (extra_stop and extra_stop.is_set()):
            data = fetch_overlay_bytes(url)
            if data:
                holder["png"] = data
            slept = 0.0
            while slept < interval and not stop_event.is_set() \
                    and not (extra_stop and extra_stop.is_set()):
                time.sleep(0.1); slept += 0.1

    th = threading.Thread(target=loop, daemon=True)
    th.start()
    return holder, th


def overlay_writer(url, fifo_path, stop_event, done_event, fps=None):
    """Ghi LIÊN TỤC PNG overlay vào FIFO cho ffmpeg image2pipe → điểm số cập nhật
    thật. Ghi ĐỀU mỗi frame (kể cả trùng) để overlay-framesync luôn có nhịp,
    KHÔNG kéo chậm luồng (nếu overlay ngừng tiến PTS thì framesync CHẶN → speed
    tụt → FB quay loading). Fetch PNG chạy ở thread RIÊNG (start_overlay_fetcher)
    nên fetch timeout KHÔNG chặn f.write → video luôn mượt. Chống rò rỉ RAM đã do
    thread_queue nhỏ (backpressure): nguồn video đứng → ffmpeg ngừng đọc → writer
    bị chặn ở f.write → frame không dồn vô hạn. open() chặn tới khi ffmpeg mở đầu
    đọc; ffmpeg chết → BrokenPipe."""
    fps = fps or OVERLAY_FPS
    interval = 1.0 / max(0.5, fps)
    local_stop = threading.Event()
    holder, _ = start_overlay_fetcher(url, stop_event, fps, extra_stop=local_stop)
    try:
        with open(fifo_path, "wb") as f:
            while not stop_event.is_set():
                png = holder["png"]
                if png:
                    try:
                        f.write(png); f.flush()
                    except BrokenPipeError:
                        break
                slept = 0.0
                while slept < interval and not stop_event.is_set():
                    time.sleep(0.1); slept += 0.1
    except OSError:
        pass
    finally:
        local_stop.set()
        done_event.set()


def post_json(url, token, payload, timeout=8):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-worker-token": token}, method="POST",
    )
    return urllib.request.urlopen(req, timeout=timeout).read()


def heartbeat_loop(url, token, session_id, stop_event, extra=None):
    while not stop_event.is_set():
        try:
            live = {"bitrateKbps": STATS.get("bitrateKbps", 0),
                    "fps": STATS.get("fps", 0), "speed": STATS.get("speed", 0.0)}
            body = post_json(url, token, {"sessionId": session_id, **(extra or {}), **live})
            # Admin bấm Dừng → backend trả stop=true → worker tự tắt.
            try:
                if json.loads(body or b"{}").get("stop"):
                    log("backend báo stop → dừng worker")
                    stop_event.set(); return
            except Exception:
                pass
        except Exception as e:  # noqa: BLE001
            log(f"heartbeat fail: {e}", err=True)
        for _ in range(150):  # 15s
            if stop_event.is_set():
                return
            time.sleep(0.1)


# ── imou session ─────────────────────────────────────────────────────────
def is_auth_error(e):
    s = str(e)
    return "12002" in s or "AuthError" in type(e).__name__ or "session" in s.lower() and "expired" in s.lower()


class ImouAccess:
    """Giữ Client hiện tại. Khi 12002: LẤY session mới nhất từ backend trước
    (app chủ sân có thể vừa login/upload — dùng chung phiên, không đá nhau);
    không có gì mới hơn thì mới login lại bằng creds."""

    def __init__(self, session_dict, creds, work_dir, post_session, get_session):
        from imou import Client  # noqa: WPS433 — import muộn để báo lỗi rõ
        self._Client = Client
        self.creds = creds
        self.work_dir = work_dir
        self.post_session = post_session
        self.get_session = get_session
        self.current_sid = (session_dict or {}).get("session_id")
        self.client = Client(session=session_dict) if session_dict else None
        if self.client is None:
            self.relogin("no stored session")

    def _adopt_backend_session(self):
        try:
            sess = self.get_session()
        except Exception as e:  # noqa: BLE001
            log(f"get backend session fail: {e}", err=True)
            return False
        if not sess or not sess.get("session_id") or sess.get("session_id") == self.current_sid:
            return False
        self.client = self._Client(session={k: sess.get(k) for k in
                                            ("uuid_user", "uuid_key", "session_id", "regional_host")})
        self.current_sid = sess["session_id"]
        log("dùng session mới từ backend (app chủ sân đã login)")
        return True

    def relogin(self, reason):
        if self._adopt_backend_session():
            return
        if not self.creds:
            raise RuntimeError(f"Imou session invalid ({reason}) và không có creds để login lại")
        from imou.auth import login
        log(f"relogin Imou ({reason})…")
        sess = login(self.creds["phone"], self.creds["area_code"], self.creds["password"],
                     session_path=Path(self.work_dir) / "imou-session.json")
        self.client = self._Client(session=sess)
        self.current_sid = sess.get("session_id")
        try:
            self.post_session({k: sess.get(k) for k in
                               ("uuid_user", "uuid_key", "session_id", "regional_host")})
            log("session mới đã báo về backend")
        except Exception as e:  # noqa: BLE001
            log(f"post session fail: {e}", err=True)

    def device(self, device_id):
        try:
            devs = self.client.devices()
        except Exception as e:  # noqa: BLE001
            if is_auth_error(e):
                self.relogin(str(e))
                devs = self.client.devices()
            else:
                raise
        dev = next((d for d in devs if getattr(d, "device_id", "") == device_id), None)
        if not dev:
            raise RuntimeError(f"device {device_id} not in account")
        return dev


# ── ffmpeg ───────────────────────────────────────────────────────────────
def probe_stream(buf):
    """ffprobe đoạn DHAV đã đệm → (has_audio, fps). DHAV báo r_frame_rate=0/0
    nên fps đo bằng SPAN của pts_time các frame video (chính xác). fps nguồn để
    đặt -r output KHỚP nguồn → tránh nhân đôi/rớt frame (giật khi ép 25 từ 20)."""
    has_audio = False
    fps = 0
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-f", "dhav", "-i", "pipe:0",
             "-show_entries", "stream=codec_type", "-of", "csv=p=0"],
            input=buf, capture_output=True, timeout=20,
        )
        has_audio = "audio" in r.stdout.decode("utf-8", "ignore").split()
    except Exception as e:  # noqa: BLE001
        log(f"probe audio fail: {e}", err=True)
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-f", "dhav", "-i", "pipe:0",
             "-select_streams", "v", "-show_entries", "frame=pts_time", "-of", "csv=p=0"],
            input=buf, capture_output=True, timeout=25,
        )
        ts = [float(x) for x in r.stdout.decode("utf-8", "ignore").split() if x and x != "N/A"]
        ts = [t for t in ts if t == t]  # loại NaN
        if len(ts) >= 10:
            ts.sort()
            span = ts[-1] - ts[0]
            if span > 0.5:
                fps = round((len(ts) - 1) / span)
    except Exception as e:  # noqa: BLE001
        log(f"probe fps fail: {e}", err=True)
    log(f"probe audio={has_audio} fps={fps}")
    return has_audio, fps


def probe_has_audio(buf):
    return probe_stream(buf)[0]


def probe_url(url):
    """ffprobe link tuỳ chỉnh (m3u8/rtsp/rtmp/http) → (has_audio, fps)."""
    has_audio = False
    fps = 0
    try:
        pre = ["-rtsp_transport", "tcp"] if url.lower().startswith("rtsp://") else []
        r = subprocess.run(
            ["ffprobe", "-v", "error", *pre,
             "-show_entries", "stream=codec_type,avg_frame_rate,r_frame_rate",
             "-of", "json", url],
            capture_output=True, timeout=25)
        data = json.loads(r.stdout.decode("utf-8", "ignore") or "{}")
        for s in data.get("streams", []):
            if s.get("codec_type") == "audio":
                has_audio = True
            if s.get("codec_type") == "video":
                for key in ("avg_frame_rate", "r_frame_rate"):
                    v = s.get(key) or ""
                    if "/" in v:
                        num, den = v.split("/")
                        try:
                            f = float(num) / float(den) if float(den) else 0
                            if 1 < f < 121:
                                fps = round(f); break
                        except (ValueError, ZeroDivisionError):
                            pass
    except Exception as e:  # noqa: BLE001
        log(f"probe_url fail: {e}", err=True)
    log(f"probe URL audio={has_audio} fps={fps}")
    return has_audio, fps


def build_ffmpeg_args(overlay_fifo, has_audio, tee, browser_fifo=None, commentary_src=None,
                      preview360_udp=None):
    # Cam Imou có thể xuất 2K (2560x1440@20fps): scale về 1080p TRƯỚC khi
    # chồng overlay (PNG vẽ theo 1920x1080). -r 25 + GOP 50 = keyframe 2s.
    # PTS gốc của DHAV (không wallclock) — prebuffer ghi dồn sẽ không bị dồn
    # timestamp. Audio im lặng tạo TRONG filter_complex để cùng đồng hồ graph.
    #
    # OVERLAY LIVE: image2 -loop KHÔNG đọc lại file khi ghi đè (ffmpeg cache
    # frame đã decode) → điểm số đứng yên. Dùng FIFO + image2pipe: worker ghi
    # PNG mới ~2fps vào pipe, ffmpeg decode từng frame → điểm cập nhật thật.
    # Cam Imou (DHAV): PTS nguồn chạy nhanh hơn thực tế (~0.87x = 13/15) →
    # out_time tụt → trễ tăng dần. -use_wallclock KHÔNG ăn với demuxer dhav, nên
    # RE-STAMP ngay trong filtergraph bằng RTCTIME (đồng hồ thực lúc xử lý khung)
    # → out_time bám thời gian thực, speed ~1.0, hết trễ dồn. Link URL có PTS
    # chuẩn nên KHÔNG cần (giữ nguyên).
    retime = "" if SOURCE_URL else "setpts=(RTCTIME-RTCSTART)/(TB*1000000),"
    base = (f"[0:v]{retime}scale=1920:1080:force_original_aspect_ratio=decrease,"
            "pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p")
    # Ẩn ngày/giờ camera trên luồng live (nội suy vùng OSD). Chèn TRƯỚC khi chồng
    # overlay để scoreboard/logo native không bị delogo làm nhoè.
    base += _delogo_filter()
    args = ["ffmpeg", "-hide_banner", "-loglevel", "warning", "-nostdin"]
    if SOURCE_URL:
        # Cấu hình y hệt backend đang chạy trơn — thread_queue_size 1024 là đủ,
        # KHÔNG đặt -max_delay/analyzeduration lớn: max_delay lớn khiến RTSP
        # demuxer chờ gói reorder tới X giây (mất gói → treo cả X giây) → output
        # stall → vsync cfr duplicate → GIẬT. Default (~0.5s) đi tiếp nhanh khi
        # mất gói, chỉ một khung bị mất chứ không phải cả block.
        args += ["-fflags", "+genpts", "-thread_queue_size", "1024"]
        # Cờ input theo scheme (nếu áp sai scheme ffmpeg báo "Option not found").
        u = SOURCE_URL.lower()
        if u.startswith("rtsp://"):
            # -timeout (microsecond) chỉ kick khi socket TCP treo thực sự (>10s
            # không có byte) → ffmpeg exit sớm cho vòng ngoài restart. Không
            # ảnh hưởng flow lúc mạng bình thường.
            args += ["-rtsp_transport", "tcp", "-timeout", "10000000"]
        elif u.startswith("http://") or u.startswith("https://"):
            # KHÔNG dùng -reconnect_at_eof với HLS: playlist HTTP trả EOF sau mỗi
            # lần đọc là bình thường (hls demuxer tự refresh), reconnect_at_eof
            # gây VÒNG LẶP reconnect 0s vô hạn (ffmpeg 6.x) → không đọc được video.
            args += ["-reconnect", "1", "-reconnect_streamed", "1",
                     "-reconnect_delay_max", "5"]
        args += ["-i", SOURCE_URL]
    else:
        # Cam Imou (DHAV qua relay đám mây): timestamp nguồn LOẠN (hàng nghìn
        # "timestamp discontinuity", HEVC) → nếu theo PTS nguồn (+genpts) thì
        # output tụt < realtime, backlog DỒN → trễ tăng dần tới vài PHÚT khi live
        # lâu. Đóng dấu WALLCLOCK: mỗi khung lấy mốc "thời điểm nhận" → nhịp ra
        # bám thời gian thực, frame cũ bị bỏ thay vì xếp hàng → KHÔNG tụt hậu.
        # +igndts bỏ DTS rác của DHAV. thread_queue nhỏ hơn (256) để backlog input
        # không phình khi nguồn dồn cụm.
        # +igndts bỏ DTS rác của DHAV; re-time thực hiện ở filtergraph (setpts
        # RTCTIME) nên KHÔNG dùng -use_wallclock (vô tác dụng với dhav). queue 512
        # đủ đệm cụm mà không dồn trễ nhiều.
        args += ["-fflags", "+igndts",
                 "-thread_queue_size", "512", "-f", "dhav", "-i", "pipe:0"]
    # Ghép overlay ở canvas 1080 (PNG overlay 1920x1080), sau đó scale xuống độ
    # phân giải mục tiêu (RES_H) nếu khác 1080 → logo/chữ co đúng tỉ lệ.
    # Chồng nhiều lớp overlay: DƯỚI = browser (tuỳ chọn), TRÊN CÙNG = scoreboard
    # native (để điểm số luôn đọc được). thread_queue NHỎ = backpressure: nguồn
    # video ĐỨNG mà overlay vẫn ghi → frame KHÔNG dồn vô hạn (tránh phình RAM).
    fc = base
    ov_fps = max(1, round(OVERLAY_FPS))
    overlay_inputs = []
    if browser_fifo:
        overlay_inputs.append(browser_fifo)   # lớp DƯỚI
    if overlay_fifo:
        overlay_inputs.append(overlay_fifo)   # scoreboard native — TRÊN CÙNG
    if overlay_inputs:
        fc += "[base]"
        prev = "base"
        idx = 1
        n = len(overlay_inputs)
        for ov in overlay_inputs:
            args += ["-thread_queue_size", "8", "-f", "image2pipe",
                     "-framerate", str(ov_fps), "-i", ov]
            lbl = "comp" if idx == n else f"ov{idx}"
            fc += f";[{prev}][{idx}:v]overlay=0:0:eof_action=pass[{lbl}]"
            prev = lbl
            idx += 1
    else:
        fc += "[comp]"
    # Nếu có preview360: tách [comp] làm 2 (luồng chính + bản 360p).
    main_label = "comp"
    if preview360_udp:
        fc += ";[comp]split=2[compmain][comp360]"
        main_label = "compmain"
    if RES_H and RES_H != 1080:
        fc += f";[{main_label}]scale=-2:{RES_H}:flags=bicubic[vout]"
    else:
        fc += f";[{main_label}]null[vout]"
    if preview360_udp:
        fc += f";[comp360]scale=-2:{PREVIEW360_H}:flags=bilinear[v360]"
    # Audio nền (camera hoặc im lặng) → nhãn [acam] ở 44100 stereo.
    if has_audio:
        fc += ";[0:a:0]aresample=async=1000:first_pts=0,aformat=sample_rates=44100:channel_layouts=stereo[acam]"
    else:
        fc += ";anullsrc=channel_layout=stereo:sample_rate=44100[acam]"
    # Bình luận viên: thêm 1 input PCM (s16le 48k mono) làm input cuối cùng, trộn
    # (amix) với tiếng nền. Có ducking (hạ tiếng nền khi BLV nói) bằng sidechain.
    if commentary_src:
        cm_idx = 1 + len(overlay_inputs)  # sau video(0) + các overlay(1..n)
        args += ["-thread_queue_size", "64", "-f", "s16le",
                 "-ar", str(COMMENTARY_SR), "-ac", str(COMMENTARY_CH), "-i", commentary_src]
        gain = "" if abs(COMMENTARY_GAIN - 1.0) < 1e-3 else f",volume={COMMENTARY_GAIN:.3f}"
        fc += (f";[{cm_idx}:a]aresample=async=1:first_pts=0,"
               f"aformat=sample_rates=44100:channel_layouts=stereo{gain}[acomm]")
        if COMMENTARY_DUCK:
            # Tách tiếng BLV: 1 nhánh để trộn, 1 nhánh làm "chìa khoá" nén tiếng nền.
            fc += ";[acomm]asplit=2[acomm_mix][acomm_key]"
            fc += (";[acam][acomm_key]sidechaincompress="
                   "threshold=0.03:ratio=8:attack=5:release=250:makeup=1[acam_d]")
            fc += ";[acam_d][acomm_mix]amix=inputs=2:normalize=0:dropout_transition=0[aout]"
        else:
            fc += ";[acam][acomm]amix=inputs=2:normalize=0:dropout_transition=0[aout]"
    else:
        fc += ";[acam]anull[aout]"
    args += ["-filter_complex", fc, "-map", "[vout]", "-map", "[aout]"]
    args += encoder_args(ENCODER)
    args += [
        "-c:a", "aac", "-b:a", f"{AUD_KBPS}k", "-ar", "44100", "-ac", "2",
        # Progress ra stdout để worker đo bitrate/fps/speed (tốc độ live).
        "-stats_period", "2", "-progress", "pipe:1",
        "-shortest", "-f", "tee", tee,
    ]
    # Output phụ: bản 360p (video-only) ra UDP nội bộ cho BLV xem (độ trễ thấp).
    if preview360_udp:
        args += ["-map", "[v360]", *encoder360_args(ENCODER), "-an",
                 "-f", "mpegts", preview360_udp]
    return args


# Chỉ số live hiện tại (đọc từ ffmpeg -progress) để báo lên app/dashboard.
STATS = {"bitrateKbps": 0, "fps": 0, "speed": 0.0}
def progress_reader(ff, stop_event):
    try:
        for raw in iter(ff.stdout.readline, b""):
            if stop_event.is_set():
                break
            line = raw.decode("utf-8", "ignore").strip()
            if line.startswith("bitrate="):
                v = line.split("=", 1)[1].replace("kbits/s", "").strip()
                try: STATS["bitrateKbps"] = int(float(v)) if v not in ("N/A", "") else 0
                except ValueError: pass
            elif line.startswith("fps="):
                try: STATS["fps"] = int(float(line.split("=", 1)[1] or 0))
                except ValueError: pass
            elif line.startswith("speed="):
                v = line.split("=", 1)[1].replace("x", "").strip()
                try: STATS["speed"] = float(v) if v not in ("N/A", "") else 0.0
                except ValueError: pass
    except Exception:
        pass


def _rss_mb(pid):
    """RSS (MB) của 1 PID — dùng ps (chạy được cả Linux VPS lẫn macOS client)."""
    try:
        out = subprocess.run(["ps", "-o", "rss=", "-p", str(pid)],
                             capture_output=True, timeout=5).stdout.decode("utf-8", "ignore").strip()
        return int(out) / 1024.0 if out else 0.0
    except Exception:
        return 0.0


def rss_watchdog(ff, stop_event):
    """LƯỚI AN TOÀN CỨNG: ffmpeg vượt MAX_RSS_MB → kill để vòng chính restart.
    Bảo đảm 1 luồng live KHÔNG BAO GIỜ ngốn hết RAM máy chủ dù có rò rỉ ẩn nào
    còn sót. Kiểm mỗi 15s. Nếu creep đã được khống chế thì gần như không bao giờ
    chạm ngưỡng này."""
    if not MAX_RSS_MB or MAX_RSS_MB <= 0:
        return
    while not stop_event.is_set() and ff.poll() is None:
        for _ in range(150):  # 15s
            if stop_event.is_set() or ff.poll() is not None:
                return
            time.sleep(0.1)
        mb = _rss_mb(ff.pid)
        if mb and mb > MAX_RSS_MB:
            log(f"ffmpeg RSS {mb:.0f}MB > ngưỡng {MAX_RSS_MB}MB → kill để restart "
                f"(chống rò rỉ RAM)", err=True)
            try:
                ff.kill()
            except Exception:
                pass
            return


def probe_audio(dev):
    """Mở 1 phiên rtsp ngắn để dò audio + fps nguồn. Trả (has_audio, fps)."""
    try:
        with dev.open_rtsp(with_audio=IMOU_AUDIO) as rtsp:
            pre = bytearray()
            t0 = time.monotonic()
            for chunk in rtsp:
                pre += chunk
                if len(pre) >= PREBUFFER_BYTES or time.monotonic() - t0 > PREBUFFER_MAX_S:
                    break
            return probe_stream(bytes(pre))
    except Exception as e:  # noqa: BLE001
        log(f"probe_audio fail: {e}", err=True)
        return False, 0


def feed_imou_into_ffmpeg(access, device_id, ff, stop_event):
    """Bơm DHAV vào ff.stdin. Relay Imou cap phiên (~18-35p) → mở LẠI nguồn và
    tiếp tục bơm vào CÙNG ffmpeg (FB không đứt). Trả:
      "stop"        – user dừng
      "ffmpeg_dead" – ffmpeg chết (BrokenPipe) → cần restart ffmpeg
    """
    idle_reopens = 0
    while not stop_event.is_set():
        try:
            dev = access.device(device_id)
        except Exception as e:  # noqa: BLE001
            if is_auth_error(e):
                try: access.relogin(str(e))
                except Exception as e2: log(f"relogin fail: {e2!r}", err=True)
            else:
                log(f"device fail: {e!r}", err=True)
            if _sleep_stop(stop_event, 3): return "stop"
            continue
        got = 0
        open_t = time.monotonic()
        resynced = False
        try:
            with dev.open_rtsp(with_audio=IMOU_AUDIO) as rtsp:
                for chunk in rtsp:
                    if stop_event.is_set():
                        return "stop"
                    # Re-sync định kỳ: mở lại nguồn ở mép live để xoá trễ tích luỹ.
                    if RESYNC_S > 0 and got > 1000 and time.monotonic() - open_t > RESYNC_S:
                        log(f"re-sync định kỳ ({RESYNC_S}s) → mở lại nguồn ở mép live (xoá trễ dồn)")
                        resynced = True
                        break
                    try:
                        ff.stdin.write(chunk)
                    except BrokenPipeError:
                        log("ffmpeg stdin broken", err=True)
                        return "ffmpeg_dead"
                    got += len(chunk)
        except Exception as e:  # noqa: BLE001
            if is_auth_error(e):
                log("Imou 12002 giữa stream → relogin + mở lại")
                try: access.relogin(str(e))
                except Exception as e2: log(f"relogin fail: {e2!r}", err=True)
            else:
                log(f"rtsp error: {e!r} → mở lại", err=True)
        # Nguồn Imou vừa kết thúc/đứt — mở lại NGAY, giữ nguyên ffmpeg.
        if got < 1000:
            idle_reopens += 1
            if idle_reopens > 20:
                log("mở lại nhiều lần không có dữ liệu → coi như ffmpeg cần restart", err=True)
                return "ffmpeg_dead"
        else:
            idle_reopens = 0
        # Re-sync: mở lại NGAY (blip tối thiểu); đứt thật thì chờ 1s tránh spam.
        if _sleep_stop(stop_event, 0 if resynced else 1): return "stop"
    return "stop"


def _sleep_stop(stop_event, seconds):
    for _ in range(int(seconds * 10)):
        if stop_event.is_set(): return True
        time.sleep(0.1)
    return stop_event.is_set()


def start_overlay_writer(overlay_fifo, overlay_url, stop_event):
    # TCP overlay (Windows) tự có thread server → không cần FIFO writer.
    if not (overlay_fifo and overlay_url) or str(overlay_fifo).startswith("tcp://"):
        return None, None
    ow_done = threading.Event()
    th = threading.Thread(target=overlay_writer,
                          args=(overlay_url, overlay_fifo, stop_event, ow_done), daemon=True)
    th.start()
    return th, ow_done


def start_overlay_tcp(overlay_url, stop_event, fps=None):
    """Cross-platform (đặc biệt Windows KHÔNG có mkfifo): phục vụ PNG overlay qua
    TCP cho ffmpeg image2pipe. ffmpeg `-i tcp://127.0.0.1:PORT` (client) kết nối,
    worker (server) stream PNG liên tục ~OVERLAY_FPS → điểm số cập nhật thật.
    Trả về (port, thread). Chấp nhận reconnect khi ffmpeg restart."""
    fps = fps or OVERLAY_FPS
    interval = 1.0 / max(0.5, fps)
    # Fetch PNG ở thread RIÊNG → holder['png']; vòng gửi TCP chỉ đẩy frame mới
    # nhất ở nhịp đều, KHÔNG bao giờ chặn ở fetch. Trước đây fetch (timeout 8s)
    # nằm TRONG vòng gửi: backend chậm/timeout → không gửi PNG suốt tới 8s →
    # ffmpeg overlay input đứng → framesync CHẶN cả video → GIẬT. Giờ tách ra.
    holder, _ = start_overlay_fetcher(overlay_url, stop_event, fps)
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", 0))
    srv.listen(1)
    port = srv.getsockname()[1]

    def serve():
        srv.settimeout(1.0)
        while not stop_event.is_set():
            try:
                conn, _ = srv.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            try:
                while not stop_event.is_set():
                    png = holder["png"]
                    if png:
                        try:
                            conn.sendall(png)
                        except OSError:
                            break  # ffmpeg đóng kết nối → chờ accept lại
                    slept = 0.0
                    while slept < interval and not stop_event.is_set():
                        time.sleep(0.1); slept += 0.1
            finally:
                try: conn.close()
                except OSError: pass
        try: srv.close()
        except OSError: pass

    th = threading.Thread(target=serve, daemon=True)
    th.start()
    return port, th


SILENCE_FRAME = b"\x00" * COMMENTARY_BYTES_PER_FRAME


class CommentaryBuffer:
    """Hàng đợi PCM (s16le 48k mono) nhận từ main.js. Giữ tối đa max_ms để tránh
    trễ dồn (nếu bơm vào nhanh hơn tiêu thụ thì bỏ phần cũ nhất)."""
    def __init__(self, max_ms=1500):
        self.buf = bytearray()
        self.lock = threading.Lock()
        self.max_bytes = COMMENTARY_SR * 2 * COMMENTARY_CH * max_ms // 1000

    def push(self, data):
        with self.lock:
            self.buf.extend(data)
            extra = len(self.buf) - self.max_bytes
            if extra > 0:
                del self.buf[:extra]

    def pull(self, n):
        with self.lock:
            if len(self.buf) >= n:
                out = bytes(self.buf[:n]); del self.buf[:n]; return out
            if self.buf:
                out = bytes(self.buf) + b"\x00" * (n - len(self.buf))
                self.buf.clear(); return out
        return SILENCE_FRAME


def start_commentary_ingest(buf, stop_event):
    """TCP server cục bộ nhận PCM từ main.js (relay từ VPS aiortc). Trả về port."""
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", 0))
    srv.listen(1)
    port = srv.getsockname()[1]

    def serve():
        srv.settimeout(1.0)
        while not stop_event.is_set():
            try:
                conn, _ = srv.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            log("commentary: BLV đã kết nối")
            conn.settimeout(1.0)
            try:
                while not stop_event.is_set():
                    try:
                        data = conn.recv(8192)
                    except socket.timeout:
                        continue
                    except OSError:
                        break
                    if not data:
                        break
                    buf.push(data)
            finally:
                try: conn.close()
                except OSError: pass
                log("commentary: BLV ngắt kết nối")
        try: srv.close()
        except OSError: pass

    threading.Thread(target=serve, daemon=True).start()
    return port


def _commentary_pace(write_frame, buf, stop_event):
    """Vòng bơm realtime: mỗi 20ms ghi 1 khung (PCM thật hoặc im lặng)."""
    next_t = time.monotonic()
    while not stop_event.is_set():
        frame = buf.pull(COMMENTARY_BYTES_PER_FRAME)
        try:
            write_frame(frame)
        except (BrokenPipeError, OSError):
            return  # ffmpeg restart → vòng ngoài mở lại
        next_t += COMMENTARY_FRAME_MS / 1000.0
        delay = next_t - time.monotonic()
        if delay > 0:
            time.sleep(delay)
        elif delay < -0.5:
            next_t = time.monotonic()  # tụt quá xa → đồng bộ lại nhịp


def start_commentary_pump_fifo(fifo_path, buf, stop_event):
    """Unix: mở FIFO ghi (chặn tới khi ffmpeg mở đọc) rồi bơm realtime. ffmpeg
    restart → reopen."""
    def run():
        while not stop_event.is_set():
            try:
                f = open(fifo_path, "wb")
            except OSError:
                if _sleep_stop(stop_event, 0.2):
                    return
                continue
            try:
                _commentary_pace(lambda fr: (f.write(fr), f.flush()), buf, stop_event)
            finally:
                try: f.close()
                except OSError: pass
    threading.Thread(target=run, daemon=True).start()


def start_commentary_source_tcp(buf, stop_event):
    """Windows (không mkfifo): TCP server, ffmpeg nối vào (client) → worker bơm
    PCM paced. Trả về port."""
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", 0))
    srv.listen(1)
    port = srv.getsockname()[1]

    def serve():
        srv.settimeout(1.0)
        while not stop_event.is_set():
            try:
                conn, _ = srv.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            try:
                _commentary_pace(conn.sendall, buf, stop_event)
            finally:
                try: conn.close()
                except OSError: pass
        try: srv.close()
        except OSError: pass

    threading.Thread(target=serve, daemon=True).start()
    return port


def setup_commentary(work_dir, stop_event):
    """Chuẩn bị đường vào audio bình luận cho ffmpeg. Trả về commentary_src
    (đường FIFO hoặc tcp://…) hoặc None nếu tắt/lỗi."""
    if not COMMENTARY:
        return None
    buf = CommentaryBuffer()
    ingest_port = start_commentary_ingest(buf, stop_event)
    commentary_src = None
    if hasattr(os, "mkfifo"):
        commentary_src = os.path.join(work_dir, "commentary.pcm")
        try:
            if os.path.exists(commentary_src):
                os.unlink(commentary_src)
            os.mkfifo(commentary_src)
            start_commentary_pump_fifo(commentary_src, buf, stop_event)
        except OSError as e:
            log(f"commentary mkfifo fail: {e} → thử TCP", err=True)
            commentary_src = None
    if not commentary_src:
        try:
            cm_port = start_commentary_source_tcp(buf, stop_event)
            commentary_src = f"tcp://127.0.0.1:{cm_port}"
        except Exception as e:  # noqa: BLE001
            log(f"commentary TCP fail: {e} → tắt bình luận", err=True)
            return None
    # Ghi cổng nhận PCM ra file để main.js (cùng máy) kết nối + relay từ VPS.
    try:
        with open(os.path.join(work_dir, "commentary.port"), "w") as pf:
            pf.write(str(ingest_port))
    except OSError:
        pass
    log(f"commentary: nhận PCM ở 127.0.0.1:{ingest_port} · nguồn ffmpeg {commentary_src} · duck={COMMENTARY_DUCK}")
    return commentary_src


def start_preview360_relay(work_dir, stop_event):
    """Nhận MPEG-TS 360p từ ffmpeg qua UDP nội bộ (không chặn), fan-out tới các
    consumer TCP (control-server kéo khi có BLV). Trả (udp_port, consumer_port)."""
    udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try: udp.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1 << 21)
    except OSError: pass
    udp.bind(("127.0.0.1", 0))
    udp_port = udp.getsockname()[1]
    tcp = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    tcp.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    tcp.bind(("127.0.0.1", 0))
    tcp.listen(5)
    cons_port = tcp.getsockname()[1]
    consumers = set()
    lock = threading.Lock()

    def accept_loop():
        tcp.settimeout(1.0)
        while not stop_event.is_set():
            try:
                conn, _ = tcp.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            with lock:
                consumers.add(conn)
            log("preview360: consumer kết nối")
        try: tcp.close()
        except OSError: pass

    def recv_loop():
        udp.settimeout(1.0)
        while not stop_event.is_set():
            try:
                data, _ = udp.recvfrom(65536)
            except socket.timeout:
                continue
            except OSError:
                break
            if not data:
                continue
            with lock:
                targets = list(consumers)
            dead = []
            for c in targets:
                try:
                    c.sendall(data)
                except OSError:
                    dead.append(c)
            if dead:
                with lock:
                    for c in dead:
                        consumers.discard(c)
                        try: c.close()
                        except OSError: pass
        try: udp.close()
        except OSError: pass

    threading.Thread(target=accept_loop, daemon=True).start()
    threading.Thread(target=recv_loop, daemon=True).start()
    try:
        with open(os.path.join(work_dir, "preview360.port"), "w") as f:
            f.write(str(cons_port))
    except OSError:
        pass
    return udp_port, cons_port


def drain_fifo(overlay_fifo):
    # Mở FIFO đọc-nonblock để writer đang chặn open()/write() thoát ra.
    if not overlay_fifo or str(overlay_fifo).startswith("tcp://"):
        return  # TCP overlay: server tự dừng theo stop_event, không cần drain
    try:
        fd = os.open(overlay_fifo, os.O_RDONLY | os.O_NONBLOCK)
        try: os.read(fd, 65536)
        except OSError: pass
        os.close(fd)
    except OSError:
        pass


def main():
    global ENCODER, OUT_FPS, SOURCE_URL
    # PREVIEW-ONLY: không cần session/overlay/heartbeat của backend.
    session_id = env("AUTOLIVE_SESSION_ID", "preview", required=not PREVIEW_ONLY)
    worker_token = env("AUTOLIVE_WORKER_TOKEN", "", required=not PREVIEW_ONLY)
    overlay_url = env("AUTOLIVE_OVERLAY_URL", "", required=not PREVIEW_ONLY)
    heartbeat_url = env("AUTOLIVE_HEARTBEAT_URL", "", required=not PREVIEW_ONLY)
    session_post_url = env("AUTOLIVE_SESSION_POST_URL", "")
    session_json = env("AUTOLIVE_IMOU_SESSION_JSON", "")
    device_id = env("AUTOLIVE_IMOU_DEVICE_ID", required=not SOURCE_URL)
    # PREVIEW_ONLY vẫn đọc destinations từ env: rỗng = chỉ xem thử; có RTMP =
    # "live thẳng" (đẩy RTMP trực tiếp, không qua server pickletour).
    destinations = json.loads(env("AUTOLIVE_DESTINATIONS", "[]"))
    creds = None
    if env("AUTOLIVE_IMOU_PHONE") and env("AUTOLIVE_IMOU_PASSWORD"):
        creds = {"phone": env("AUTOLIVE_IMOU_PHONE"), "password": env("AUTOLIVE_IMOU_PASSWORD"),
                 "area_code": env("AUTOLIVE_IMOU_AREA_CODE", "84")}
    ENCODER = detect_encoder()
    log(f"encoder = {ENCODER}" + (f" · source URL={SOURCE_URL}" if SOURCE_URL else ""))
    tee = build_tee_output(destinations)
    if not tee:
        log("no valid destinations", err=True); sys.exit(3)

    work_dir = os.path.join(tempfile.gettempdir(), f"autolive-{session_id}")
    os.makedirs(work_dir, exist_ok=True)

    def post_session(sess):
        if not session_post_url:
            return
        post_json(session_post_url, worker_token, {"sessionId": session_id, "session": sess})

    def get_session():
        if not session_post_url:
            return None
        req = urllib.request.Request(f"{session_post_url}?sessionId={session_id}",
                                     headers={"x-worker-token": worker_token})
        try:
            body = urllib.request.urlopen(req, timeout=8).read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            raise
        return json.loads(body).get("session")

    access = None
    if not SOURCE_URL:
        sess_dict = None
        if session_json:
            try:
                sess_dict = json.loads(session_json)
            except json.JSONDecodeError as e:
                log(f"AUTOLIVE_IMOU_SESSION_JSON parse fail: {e}", err=True)
        if not sess_dict and not creds:
            log("không có session lẫn creds Imou", err=True); sys.exit(5)
        try:
            access = ImouAccess(sess_dict, creds, work_dir, post_session, get_session)
        except ImportError:
            log("imou-pkg chưa cài (pip install /opt/imou-pkg).", err=True); sys.exit(4)

        # Thử nghiệm: lấy URL live cloud (RTMP/HLS/RTSP) thay DHAV relay → có thể
        # mượt như app. Thành công → chuyển sang chế độ URL (ffmpeg kéo thẳng).
        if IMOU_LIVE_STREAM:
            stype = {"rtmp": "1", "rtsp": "2", "hls": "3"}.get(IMOU_LIVE_STREAM, "1")
            try:
                data = access.device(device_id).live_stream_url(
                    stream_type=stype, channel=IMOU_STREAM_ID or "0")
                url = _find_stream_url(data)
                if url:
                    SOURCE_URL = url
                    log(f"dùng Imou LIVE cloud ({IMOU_LIVE_STREAM}) thay DHAV: {url[:70]}…")
                else:
                    log(f"GetLiveStreamUrl không có URL trong data: {str(data)[:200]}", err=True)
            except Exception as e:  # noqa: BLE001
                log(f"GetLiveStreamUrl lỗi ({e!r}) → quay lại DHAV relay", err=True)

    # Overlay: kiểm tra tải được không (thử 10 lần). FIFO cho ffmpeg image2pipe
    # → điểm số cập nhật live (image2 -loop cache frame, không đọc lại file).
    # Có overlay_url thì luôn thử tải (kể cả PREVIEW_ONLY — dùng cho "trận ngẫu nhiên"
    # standalone có bảng điểm). Preview/direct thuần không truyền overlay_url → bỏ qua.
    have_overlay = False
    for _ in range(10 if overlay_url else 0):
        if fetch_overlay_bytes(overlay_url):
            have_overlay = True
            break
        time.sleep(1)
    stop_event = threading.Event()
    # Overlay input cho ffmpeg: FIFO (Unix) hoặc TCP (Windows/không có mkfifo).
    overlay_fifo = None
    if have_overlay:
        if hasattr(os, "mkfifo"):
            overlay_fifo = os.path.join(work_dir, "overlay.pipe")
            try:
                if os.path.exists(overlay_fifo):
                    os.unlink(overlay_fifo)
                os.mkfifo(overlay_fifo)
            except OSError as e:
                log(f"mkfifo fail: {e} → thử overlay qua TCP", err=True)
                overlay_fifo = None
        if not overlay_fifo and overlay_url:
            # Windows (không có mkfifo) hoặc mkfifo lỗi → overlay qua TCP (image2pipe).
            try:
                _ov_port, _ = start_overlay_tcp(overlay_url, stop_event, OVERLAY_FPS)
                overlay_fifo = f"tcp://127.0.0.1:{_ov_port}"
                log(f"overlay qua TCP 127.0.0.1:{_ov_port} (image2pipe) — có overlay/logo trên Windows")
            except Exception as e:
                log(f"overlay TCP fail: {e} → stream không overlay", err=True)
                overlay_fifo = None
    if not have_overlay:
        log("overlay unavailable → stream without overlay", err=True)
    # Bình luận viên (tuỳ chọn): input audio PCM để amix vào luồng (mặc định im lặng).
    commentary_src = setup_commentary(work_dir, stop_event)
    # Preview 360p cho BLV xem (độ trễ thấp) — UDP nội bộ + fan-out TCP.
    preview360_udp = None
    if PREVIEW360:
        try:
            udp_port, cons_port = start_preview360_relay(work_dir, stop_event)
            preview360_udp = f"udp://127.0.0.1:{udp_port}?pkt_size=1316"
            log(f"preview360: ffmpeg→udp 127.0.0.1:{udp_port} · consumer tcp 127.0.0.1:{cons_port}")
        except Exception as e:  # noqa: BLE001
            log(f"preview360 fail: {e} → tắt xem live BLV", err=True)
            preview360_udp = None
    ff_holder = [None]

    def cleanup(*_):
        stop_event.set()
        ff = ff_holder[0]
        if ff is not None:
            try: ff.stdin.close()
            except Exception: pass
            try: ff.terminate()
            except Exception: pass

    signal.signal(signal.SIGTERM, cleanup)
    signal.signal(signal.SIGINT, cleanup)

    import platform, socket as _sock
    hb_extra = {
        "encoder": ENCODER,
        "runnerLabel": os.environ.get("AUTOLIVE_RUNNER_LABEL", "") or _sock.gethostname(),
        "runnerOs": f"{platform.system()} {platform.machine()}",
    }
    if not PREVIEW_ONLY:
        threading.Thread(target=heartbeat_loop,
                         args=(heartbeat_url, worker_token, session_id, stop_event, hb_extra),
                         daemon=True).start()

    if SOURCE_URL:
        has_audio, src_fps = probe_url(SOURCE_URL)
    else:
        has_audio, src_fps = probe_audio(access.device(device_id)) if not stop_event.is_set() else (False, 0)
    if FPS_OVERRIDE and 10 <= FPS_OVERRIDE <= 60:
        OUT_FPS = FPS_OVERRIDE
    else:
        OUT_FPS = src_fps if (src_fps and 10 <= src_fps <= 60) else 25
    log(f"output fps = {OUT_FPS} (nguồn {src_fps or '?'}, override {FPS_OVERRIDE or 'auto'}) "
        f"bitrate {VID_KBPS}k res {RES_H}p")
    if ENCODER == "libx264":
        log(f"x264 threads={X264_THREADS} lookahead={X264_LOOKAHEAD} bf=0 (giảm RAM)")
    log(f"overlay {OVERLAY_FPS}fps (liên tục) · watchdog RSS {MAX_RSS_MB}MB")

    # 1 ffmpeg SỐNG XUYÊN SUỐT (kết nối FB giữ nguyên); chỉ mở lại nguồn Imou
    # khi relay cap. Chỉ restart ffmpeg khi nó thật sự chết → khi đó xin
    # destination FB mới (FB không cho re-publish cùng key sau khi publisher rớt).
    ff_restarts = 0
    fast_fails = 0
    while not stop_event.is_set():
        # Recording: thêm nhánh tee ghi segment TS với prefix epoch MỚI mỗi lần spawn
        # (né ghi đè khi ffmpeg restart giữa phiên).
        tee_now = tee
        if RECORD_CLIPS:
            rs = record_slave(int(time.time()))
            if rs:
                tee_now = f"{tee}|{rs}" if tee else rs
        args = build_ffmpeg_args(overlay_fifo, has_audio, tee_now,
                                 browser_fifo=(BROWSER_OVERLAY or None),
                                 commentary_src=commentary_src,
                                 preview360_udp=preview360_udp)
        log(f"spawning ffmpeg (persistent) overlay={bool(overlay_fifo)} audio={has_audio} "
            f"commentary={bool(commentary_src)} preview360={bool(preview360_udp)} record={RECORD_CLIPS} restart#{ff_restarts}")
        ff_spawn_t = time.monotonic()
        fb_flag = {"fb": False}  # watcher bật True khi FB huỷ phiên RTMPS (session invalidated)
        # URL mode: ffmpeg tự đọc URL (stdin không dùng). Imou mode: feed DHAV.
        # cwd=PREVIEW_DIR để tee HLS ghi bằng TÊN TƯƠNG ĐỐI (né `:` trong tee spec
        # khi đường dẫn tuyệt đối chứa drive letter Windows).
        ff = subprocess.Popen(
            args,
            stdin=(subprocess.DEVNULL if SOURCE_URL else subprocess.PIPE),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=(PREVIEW_DIR or None))
        ff_holder[0] = ff
        threading.Thread(target=_watch_ffmpeg_stderr, args=(ff, fb_flag, stop_event), daemon=True).start()
        threading.Thread(target=progress_reader, args=(ff, stop_event), daemon=True).start()
        threading.Thread(target=rss_watchdog, args=(ff, stop_event), daemon=True).start()
        ow_th, ow_done = start_overlay_writer(overlay_fifo, overlay_url, stop_event)

        if SOURCE_URL:
            # Chờ ffmpeg (nó tự reconnect URL); kiểm stop định kỳ.
            while ff.poll() is None and not stop_event.is_set():
                time.sleep(0.5)
            reason = "stop" if stop_event.is_set() else "ffmpeg_dead"
        else:
            reason = feed_imou_into_ffmpeg(access, device_id, ff, stop_event)

        # Dọn ffmpeg + overlay writer của vòng này
        drain_fifo(overlay_fifo)
        try:
            if ff.stdin: ff.stdin.close()
        except Exception: pass
        try: rc = ff.wait(timeout=10)
        except subprocess.TimeoutExpired: ff.kill(); rc = ff.wait()
        ff_holder[0] = None
        if ow_done: ow_done.wait(timeout=3)
        log(f"ffmpeg exit rc={rc} reason={reason}")

        if reason == "stop" or stop_event.is_set():
            break

        ran_s = time.monotonic() - ff_spawn_t
        ff_restarts += 1
        # FB huỷ phiên RTMPS ("session has been invalidated") — KHÔNG phải lỗi nguồn/cấu
        # hình. Link FB hiện tại đã chết, retry cùng link sẽ fail mãi (hay gặp khi tách
        # live từng trận: tạo broadcast liên tiếp). → Xin link FB MỚI rồi thử lại NGAY,
        # kể cả khi ffmpeg chết nhanh. (Backend đã có delay cho ingest FB sẵn sàng.)
        if fb_flag.get("fb") and not PREVIEW_ONLY and not stop_event.is_set():
            if ff_restarts > MAX_ATTEMPTS:
                log(f"FB huỷ phiên quá {MAX_ATTEMPTS} lần → dừng", err=True)
                break
            log("FB huỷ phiên (session invalidated) → xin link FB mới rồi thử lại")
            new_tee = refresh_destinations(
                session_post_url.replace("/imou-session", "/destinations"),
                worker_token, session_id)
            if new_tee:
                tee = new_tee
                log("đã lấy link FB mới sau khi FB huỷ phiên")
            if _sleep_stop(stop_event, 3):
                break
            continue
        # ffmpeg chết NHANH (<20s) = lỗi cấu hình (encoder/bitrate/res) chứ
        # không phải đứt mạng → KHÔNG tạo lại FB live (tránh spam video mới),
        # chỉ retry; quá nhiều lần fast-fail → dừng hẳn.
        if ran_s < 20:
            fast_fails += 1
            if SOURCE_URL:
                # Nguồn URL chết nhanh = NGUỒN đang lỗi/đứt (HTTP 5XX/timeout —
                # vd m3u8 tạm down), KHÔNG phải lỗi cấu hình → KIÊN NHẪN retry với
                # backoff, KHÔNG bỏ cuộc (nguồn có thể hồi lại, live tự nối tiếp).
                # Admin bấm Dừng / backend stop mới thật sự dừng.
                back = min(30, 5 + 3 * fast_fails)
                log(f"nguồn URL lỗi/đứt (chết sau {ran_s:.0f}s) → thử lại sau {back}s "
                    f"(lần {fast_fails}); nguồn hồi là live tiếp", err=True)
                if _sleep_stop(stop_event, back): break
                continue
            if fast_fails >= 3:
                log(f"ffmpeg chết nhanh {fast_fails} lần (lỗi cấu hình) → dừng", err=True)
                break
            log(f"ffmpeg chết sau {ran_s:.0f}s (fast-fail {fast_fails}/3) → retry không đổi FB")
        else:
            fast_fails = 0
            if ff_restarts > MAX_ATTEMPTS:
                log(f"ffmpeg chết quá {MAX_ATTEMPTS} lần → dừng", err=True)
                break
            # Chỉ tạo FB mới khi đã chạy ổn 1 lúc rồi mới chết (đứt thật).
            # PREVIEW-ONLY không có destination FB → bỏ qua.
            if not PREVIEW_ONLY:
                new_tee = refresh_destinations(session_post_url.replace("/imou-session", "/destinations"),
                                               worker_token, session_id)
                if new_tee:
                    tee = new_tee
                    log("đã lấy destination FB mới sau khi ffmpeg chết")
        if _sleep_stop(stop_event, min(10, 2 + 2 * fast_fails)): break

    cleanup()
    ok = stop_event.is_set()
    log(f"exit ok={ok}")
    sys.exit(0 if ok else 1)


# Dấu hiệu trong stderr ffmpeg cho biết FACEBOOK huỷ phiên RTMPS (không phải lỗi nguồn).
FB_FAIL_MARKERS = ("has been invalidated",)


def _watch_ffmpeg_stderr(proc, fb_flag, stop_event):
    """Đọc stderr ffmpeg: in lại ra stderr (giữ nguyên log) + bật cờ khi FB huỷ phiên."""
    try:
        for raw in iter(proc.stderr.readline, b""):
            if not raw:
                break
            try:
                line = raw.decode("utf-8", "replace")
            except Exception:  # noqa: BLE001
                line = str(raw)
            try:
                sys.stderr.write(line)
                sys.stderr.flush()
            except Exception:  # noqa: BLE001
                pass
            low = line.lower()
            if any(mk in low for mk in FB_FAIL_MARKERS):
                fb_flag["fb"] = True
            if stop_event.is_set():
                break
    except Exception:  # noqa: BLE001
        pass


def refresh_destinations(url, token, session_id):
    """Xin backend tạo lại FB live_video (key mới) khi phải restart ffmpeg."""
    try:
        req = urllib.request.Request(f"{url}?sessionId={session_id}",
                                     headers={"x-worker-token": token})
        body = urllib.request.urlopen(req, timeout=20).read()
        dests = json.loads(body).get("destinations") or []
        return build_tee_output(dests)
    except Exception as e:  # noqa: BLE001
        log(f"refresh destinations fail: {e}", err=True)
        return None


if __name__ == "__main__":
    main()
