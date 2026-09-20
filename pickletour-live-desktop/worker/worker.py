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
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

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
# Preview HLS local cho app desktop (Electron) hiển thị — env là thư mục.
PREVIEW_DIR = os.environ.get("AUTOLIVE_PREVIEW_HLS_DIR", "").strip()
HEALTHY_AFTER_S = 60


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
            seg = os.path.join(PREVIEW_DIR, "seg_%03d.ts")
            m3u8 = os.path.join(PREVIEW_DIR, "index.m3u8")
            # list_size lớn hơn + segment 2s → player có đệm, đỡ "loading" liên tục.
            parts.append(
                f"[f=hls:onfail=ignore:hls_time=2:hls_list_size=8:"
                f"hls_flags=delete_segments+omit_endlist:hls_segment_filename={seg}]{m3u8}")
        except OSError:
            pass
    return "|".join(parts)


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


def overlay_writer(url, fifo_path, stop_event, done_event, fps=None):
    """Ghi LIÊN TỤC PNG overlay vào FIFO cho ffmpeg image2pipe → điểm số cập nhật
    thật. Ghi ĐỀU mỗi frame (kể cả trùng) để overlay-framesync luôn có nhịp,
    KHÔNG kéo chậm luồng (nếu overlay ngừng tiến PTS thì framesync CHẶN → speed
    tụt → FB quay loading). Chống rò rỉ RAM đã do thread_queue nhỏ (backpressure):
    nguồn video đứng → ffmpeg ngừng đọc → writer bị chặn ở f.write → frame không
    dồn vô hạn. open() chặn tới khi ffmpeg mở đầu đọc; ffmpeg chết → BrokenPipe."""
    fps = fps or OVERLAY_FPS
    interval = 1.0 / max(0.5, fps)
    last = None
    try:
        with open(fifo_path, "wb") as f:
            while not stop_event.is_set():
                data = fetch_overlay_bytes(url)
                if data:
                    last = data
                if last:
                    try:
                        f.write(last); f.flush()
                    except BrokenPipeError:
                        break
                slept = 0.0
                while slept < interval and not stop_event.is_set():
                    time.sleep(0.1); slept += 0.1
    except OSError:
        pass
    finally:
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


def build_ffmpeg_args(overlay_fifo, has_audio, tee):
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
    args = ["ffmpeg", "-hide_banner", "-loglevel", "warning", "-nostdin"]
    if SOURCE_URL:
        # Link tự có timestamp chuẩn → dùng genpts giữ đồng hồ liên tục.
        args += ["-fflags", "+genpts", "-thread_queue_size", "1024"]
        # Cờ input theo scheme (nếu áp sai scheme ffmpeg báo "Option not found").
        u = SOURCE_URL.lower()
        if u.startswith("rtsp://"):
            args += ["-rtsp_transport", "tcp"]
        elif u.startswith("http://") or u.startswith("https://"):
            args += ["-reconnect", "1", "-reconnect_at_eof", "1",
                     "-reconnect_streamed", "1", "-reconnect_delay_max", "5"]
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
    fc = base
    if overlay_fifo:
        # thread_queue NHỎ = backpressure: khi nguồn video ĐỨNG (relay Imou cap /
        # link 5XX) mà overlay vẫn ghi, frame KHÔNG dồn vô hạn (writer bị chặn) →
        # tránh RAM bùng lên (trước đây 1 luồng lên 19.6GB do nguồn chập chờn).
        # KHÔNG thêm filter fps ở đây: framesync theo nhịp input CHÍNH (video),
        # overlay chỉ cần cấp frame đều; ép fps làm framesync chặn → luồng chậm.
        ov_fps = max(1, round(OVERLAY_FPS))
        args += ["-thread_queue_size", "8", "-f", "image2pipe",
                 "-framerate", str(ov_fps), "-i", overlay_fifo]
        fc += "[base];[base][1:v]overlay=0:0:eof_action=pass[comp]"
    else:
        fc += "[comp]"
    if RES_H and RES_H != 1080:
        fc += f";[comp]scale=-2:{RES_H}:flags=bicubic[vout]"
    else:
        fc += ";[comp]null[vout]"
    if has_audio:
        fc += ";[0:a:0]aresample=async=1000:first_pts=0,aformat=sample_rates=44100:channel_layouts=stereo[aout]"
    else:
        fc += ";anullsrc=channel_layout=stereo:sample_rate=44100[aout]"
    args += ["-filter_complex", fc, "-map", "[vout]", "-map", "[aout]"]
    args += encoder_args(ENCODER)
    args += [
        "-c:a", "aac", "-b:a", f"{AUD_KBPS}k", "-ar", "44100", "-ac", "2",
        # Progress ra stdout để worker đo bitrate/fps/speed (tốc độ live).
        "-stats_period", "2", "-progress", "pipe:1",
        "-shortest", "-f", "tee", tee,
    ]
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
        try:
            with dev.open_rtsp(with_audio=IMOU_AUDIO) as rtsp:
                for chunk in rtsp:
                    if stop_event.is_set():
                        return "stop"
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
        if _sleep_stop(stop_event, 1): return "stop"
    return "stop"


def _sleep_stop(stop_event, seconds):
    for _ in range(int(seconds * 10)):
        if stop_event.is_set(): return True
        time.sleep(0.1)
    return stop_event.is_set()


def start_overlay_writer(overlay_fifo, overlay_url, stop_event):
    if not (overlay_fifo and overlay_url):
        return None, None
    ow_done = threading.Event()
    th = threading.Thread(target=overlay_writer,
                          args=(overlay_url, overlay_fifo, stop_event, ow_done), daemon=True)
    th.start()
    return th, ow_done


def drain_fifo(overlay_fifo):
    # Mở FIFO đọc-nonblock để writer đang chặn open()/write() thoát ra.
    if not overlay_fifo:
        return
    try:
        fd = os.open(overlay_fifo, os.O_RDONLY | os.O_NONBLOCK)
        try: os.read(fd, 65536)
        except OSError: pass
        os.close(fd)
    except OSError:
        pass


def main():
    session_id = env("AUTOLIVE_SESSION_ID", required=True)
    worker_token = env("AUTOLIVE_WORKER_TOKEN", required=True)
    overlay_url = env("AUTOLIVE_OVERLAY_URL", required=True)
    heartbeat_url = env("AUTOLIVE_HEARTBEAT_URL", required=True)
    session_post_url = env("AUTOLIVE_SESSION_POST_URL", "")
    session_json = env("AUTOLIVE_IMOU_SESSION_JSON", "")
    device_id = env("AUTOLIVE_IMOU_DEVICE_ID", required=not SOURCE_URL)
    destinations = json.loads(env("AUTOLIVE_DESTINATIONS", "[]"))
    creds = None
    if env("AUTOLIVE_IMOU_PHONE") and env("AUTOLIVE_IMOU_PASSWORD"):
        creds = {"phone": env("AUTOLIVE_IMOU_PHONE"), "password": env("AUTOLIVE_IMOU_PASSWORD"),
                 "area_code": env("AUTOLIVE_IMOU_AREA_CODE", "84")}
    global ENCODER
    ENCODER = detect_encoder()
    log(f"encoder = {ENCODER}" + (f" · source URL={SOURCE_URL}" if SOURCE_URL else ""))
    tee = build_tee_output(destinations)
    if not tee:
        log("no valid destinations", err=True); sys.exit(3)

    work_dir = f"/tmp/autolive-{session_id}"
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

    # Overlay: kiểm tra tải được không (thử 10 lần). FIFO cho ffmpeg image2pipe
    # → điểm số cập nhật live (image2 -loop cache frame, không đọc lại file).
    have_overlay = False
    for _ in range(10):
        if fetch_overlay_bytes(overlay_url):
            have_overlay = True
            break
        time.sleep(1)
    overlay_fifo = os.path.join(work_dir, "overlay.pipe") if have_overlay else None
    if overlay_fifo:
        try:
            if os.path.exists(overlay_fifo):
                os.unlink(overlay_fifo)
            os.mkfifo(overlay_fifo)
        except OSError as e:
            log(f"mkfifo fail: {e} → stream không overlay", err=True)
            overlay_fifo = None
    if not have_overlay:
        log("overlay unavailable → stream without overlay", err=True)

    stop_event = threading.Event()
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
    threading.Thread(target=heartbeat_loop,
                     args=(heartbeat_url, worker_token, session_id, stop_event, hb_extra),
                     daemon=True).start()

    if SOURCE_URL:
        has_audio, src_fps = probe_url(SOURCE_URL)
    else:
        has_audio, src_fps = probe_audio(access.device(device_id)) if not stop_event.is_set() else (False, 0)
    global OUT_FPS
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
        args = build_ffmpeg_args(overlay_fifo, has_audio, tee)
        log(f"spawning ffmpeg (persistent) overlay={bool(overlay_fifo)} audio={has_audio} restart#{ff_restarts}")
        ff_spawn_t = time.monotonic()
        # URL mode: ffmpeg tự đọc URL (stdin không dùng). Imou mode: feed DHAV.
        ff = subprocess.Popen(
            args,
            stdin=(subprocess.DEVNULL if SOURCE_URL else subprocess.PIPE),
            stdout=subprocess.PIPE)
        ff_holder[0] = ff
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
        # ffmpeg chết NHANH (<20s) = lỗi cấu hình (encoder/bitrate/res) chứ
        # không phải đứt mạng → KHÔNG tạo lại FB live (tránh spam video mới),
        # chỉ retry; quá nhiều lần fast-fail → dừng hẳn.
        if ran_s < 20:
            fast_fails += 1
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
