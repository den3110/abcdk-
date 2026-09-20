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
    if want in alias and (alias[want] == "libx264" or have(alias[want])):
        return alias[want]
    for cand in ("h264_nvenc", "h264_videotoolbox", "h264_qsv", "h264_vaapi"):
        if have(cand):
            return cand
    return "libx264"


def encoder_args(enc):
    """Args tối ưu theo từng encoder — GPU giảm tải CPU mạnh (nhiều luồng)."""
    common_rate = ["-b:v", "3000k", "-maxrate", "3500k", "-bufsize", "6000k",
                   "-r", "25", "-g", "50", "-keyint_min", "50", "-pix_fmt", "yuv420p"]
    if enc == "h264_nvenc":
        return ["-c:v", "h264_nvenc", "-preset", "p4", "-tune", "ll",
                "-rc", "cbr", "-profile:v", "high", *common_rate]
    if enc == "h264_videotoolbox":
        return ["-c:v", "h264_videotoolbox", "-realtime", "1",
                "-profile:v", "high", *common_rate]
    if enc == "h264_qsv":
        return ["-c:v", "h264_qsv", "-preset", "veryfast", "-profile:v", "high", *common_rate]
    if enc == "h264_vaapi":
        return ["-vf", "format=nv12,hwupload", "-c:v", "h264_vaapi",
                "-profile:v", "high", *common_rate]
    return ["-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
            "-profile:v", "high", *common_rate]


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
            parts.append(
                f"[f=hls:onfail=ignore:hls_time=1:hls_list_size=4:"
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


def overlay_writer(url, fifo_path, stop_event, done_event, fps=2.0):
    """Ghi liên tiếp PNG mới vào FIFO cho ffmpeg image2pipe decode → overlay
    (điểm số) cập nhật thật. open() chặn tới khi ffmpeg mở đầu đọc; ffmpeg chết
    → BrokenPipe → thoát để attempt sau tạo writer mới. done_event báo kết thúc."""
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
                for _ in range(int(interval * 10)):
                    if stop_event.is_set():
                        break
                    time.sleep(0.1)
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
            post_json(url, token, {"sessionId": session_id, **(extra or {})})
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
def probe_has_audio(buf):
    """ffprobe đoạn DHAV đã đệm. Không chắc chắn → KHÔNG audio (anullsrc)."""
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-f", "dhav", "-i", "pipe:0",
             "-show_entries", "stream=codec_type", "-of", "csv=p=0"],
            input=buf, capture_output=True, timeout=20,
        )
        kinds = r.stdout.decode(errors="ignore").split()
        log(f"probe streams={kinds}")
        return "audio" in kinds
    except Exception as e:  # noqa: BLE001
        log(f"probe fail: {e}", err=True)
        return False


def build_ffmpeg_args(overlay_fifo, has_audio, tee):
    # Cam Imou có thể xuất 2K (2560x1440@20fps): scale về 1080p TRƯỚC khi
    # chồng overlay (PNG vẽ theo 1920x1080). -r 25 + GOP 50 = keyframe 2s.
    # PTS gốc của DHAV (không wallclock) — prebuffer ghi dồn sẽ không bị dồn
    # timestamp. Audio im lặng tạo TRONG filter_complex để cùng đồng hồ graph.
    #
    # OVERLAY LIVE: image2 -loop KHÔNG đọc lại file khi ghi đè (ffmpeg cache
    # frame đã decode) → điểm số đứng yên. Dùng FIFO + image2pipe: worker ghi
    # PNG mới ~2fps vào pipe, ffmpeg decode từng frame → điểm cập nhật thật.
    base = ("[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,"
            "pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p")
    args = [
        "ffmpeg", "-hide_banner", "-loglevel", "warning", "-nostdin",
        # Đóng dấu thời gian theo wallclock để ĐỒNG HỒ liên tục khi mở lại
        # nguồn Imou giữa chừng (relay cap ~18-35p) mà KHÔNG restart ffmpeg →
        # kết nối FB không đứt. Đã kiểm chứng: 2 phiên rtsp nối vào 1 ffmpeg ra
        # output liền mạch, monotonic.
        "-use_wallclock_as_timestamps", "1", "-fflags", "+genpts",
        "-thread_queue_size", "512", "-f", "dhav", "-i", "pipe:0",
    ]
    fc = base
    if overlay_fifo:
        args += ["-thread_queue_size", "512", "-f", "image2pipe",
                 "-framerate", "2", "-i", overlay_fifo]
        fc += "[base];[base][1:v]overlay=0:0:eof_action=pass[vout]"
    else:
        fc += "[vout]"
    if has_audio:
        fc += ";[0:a:0]aresample=async=1000:first_pts=0,aformat=sample_rates=44100:channel_layouts=stereo[aout]"
    else:
        fc += ";anullsrc=channel_layout=stereo:sample_rate=44100[aout]"
    args += ["-filter_complex", fc, "-map", "[vout]", "-map", "[aout]"]
    args += encoder_args(ENCODER)
    args += [
        "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
        "-shortest", "-f", "tee", tee,
    ]
    return args


def probe_audio(dev):
    """Mở 1 phiên rtsp ngắn để phát hiện có audio không (không dùng cho feed)."""
    try:
        with dev.open_rtsp(with_audio=True) as rtsp:
            pre = bytearray()
            t0 = time.monotonic()
            for chunk in rtsp:
                pre += chunk
                if len(pre) >= PREBUFFER_BYTES or time.monotonic() - t0 > PREBUFFER_MAX_S:
                    break
            return probe_has_audio(bytes(pre))
    except Exception as e:  # noqa: BLE001
        log(f"probe_audio fail: {e}", err=True)
        return False


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
            with dev.open_rtsp(with_audio=True) as rtsp:
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
    device_id = env("AUTOLIVE_IMOU_DEVICE_ID", required=True)
    destinations = json.loads(env("AUTOLIVE_DESTINATIONS", "[]"))
    creds = None
    if env("AUTOLIVE_IMOU_PHONE") and env("AUTOLIVE_IMOU_PASSWORD"):
        creds = {"phone": env("AUTOLIVE_IMOU_PHONE"), "password": env("AUTOLIVE_IMOU_PASSWORD"),
                 "area_code": env("AUTOLIVE_IMOU_AREA_CODE", "84")}
    global ENCODER
    ENCODER = detect_encoder()
    log(f"encoder = {ENCODER}")
    tee = build_tee_output(destinations)
    if not tee:
        log("no valid destinations", err=True); sys.exit(3)
    sess_dict = None
    if session_json:
        try:
            sess_dict = json.loads(session_json)
        except json.JSONDecodeError as e:
            log(f"AUTOLIVE_IMOU_SESSION_JSON parse fail: {e}", err=True)
    if not sess_dict and not creds:
        log("không có session lẫn creds Imou", err=True); sys.exit(5)

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

    has_audio = probe_audio(access.device(device_id)) if not stop_event.is_set() else False

    # 1 ffmpeg SỐNG XUYÊN SUỐT (kết nối FB giữ nguyên); chỉ mở lại nguồn Imou
    # khi relay cap. Chỉ restart ffmpeg khi nó thật sự chết → khi đó xin
    # destination FB mới (FB không cho re-publish cùng key sau khi publisher rớt).
    ff_restarts = 0
    while not stop_event.is_set():
        args = build_ffmpeg_args(overlay_fifo, has_audio, tee)
        log(f"spawning ffmpeg (persistent) overlay={bool(overlay_fifo)} audio={has_audio} restart#{ff_restarts}")
        ff = subprocess.Popen(args, stdin=subprocess.PIPE)
        ff_holder[0] = ff
        ow_th, ow_done = start_overlay_writer(overlay_fifo, overlay_url, stop_event)

        reason = feed_imou_into_ffmpeg(access, device_id, ff, stop_event)

        # Dọn ffmpeg + overlay writer của vòng này
        drain_fifo(overlay_fifo)
        try: ff.stdin.close()
        except Exception: pass
        try: rc = ff.wait(timeout=10)
        except subprocess.TimeoutExpired: ff.kill(); rc = ff.wait()
        ff_holder[0] = None
        if ow_done: ow_done.wait(timeout=3)
        log(f"ffmpeg exit rc={rc} reason={reason}")

        if reason == "stop" or stop_event.is_set():
            break

        # ffmpeg chết → xin destination FB mới rồi restart (giữ giải/overlay).
        ff_restarts += 1
        if ff_restarts > MAX_ATTEMPTS:
            log(f"ffmpeg chết quá {MAX_ATTEMPTS} lần → dừng", err=True)
            break
        new_tee = refresh_destinations(session_post_url.replace("/imou-session", "/destinations"),
                                       worker_token, session_id)
        if new_tee:
            tee = new_tee
            log("đã lấy destination FB mới sau khi ffmpeg chết")
        if _sleep_stop(stop_event, min(15, 3 * ff_restarts)): break

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
