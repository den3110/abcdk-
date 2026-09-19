#!/usr/bin/env python3
"""PickleTour auto-live worker — cầu nối Imou DHAV → ffmpeg → RTMP.

Env do Node orchestrator set:
    AUTOLIVE_SESSION_ID
    AUTOLIVE_WORKER_TOKEN
    AUTOLIVE_OVERLAY_URL         (backend serve PNG 1920x1080 alpha)
    AUTOLIVE_HEARTBEAT_URL
    AUTOLIVE_IMOU_SESSION_JSON   ({uuid_user,uuid_key,session_id,regional_host})
    AUTOLIVE_IMOU_DEVICE_ID
    AUTOLIVE_DESTINATIONS        (JSON [{type,streamUrl,streamKey}])

Pipeline:
    imou Camera.open_rtsp()  → DHAV bytes (1 kết nối duy nhất tới relay Imou)
      ↓ đệm ~3s đầu → ffprobe xem có audio không
      ↓ stdin
    ffmpeg -f dhav -i pipe:0
           [-f image2 -loop 1 -i overlay.png]      (file local, thay mỗi 1s)
           [-f lavfi -i anullsrc]                   (nếu cam không có audio)
           scale 1080p → overlay → libx264 → aac → tee nhiều RTMP

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

PREBUFFER_BYTES = 1_500_000   # ~3s ở 4Mbps — đủ cho ffprobe thấy audio
PREBUFFER_MAX_S = 6.0
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def env(name, default=None, required=False):
    v = os.environ.get(name, default)
    if required and not v:
        print(f"[worker] missing env {name}", file=sys.stderr, flush=True)
        sys.exit(2)
    return v


def build_tee_output(destinations):
    parts = []
    for d in destinations:
        url = d.get("streamUrl", "").strip()
        key = d.get("streamKey", "").strip()
        if not url:
            continue
        full = url if not key else (url.rstrip("/") + "/" + key)
        parts.append(f"[f=flv:onfail=ignore]{full}")
    return "|".join(parts)


def fetch_overlay(url, dest_path):
    """Tải PNG → ghi .tmp → os.replace (atomic) để ffmpeg không đọc file dở."""
    tmp = dest_path + ".tmp"
    try:
        req = urllib.request.Request(url, headers={"Cache-Control": "no-cache"})
        data = urllib.request.urlopen(req, timeout=8).read()
        if not data or data[:8] != PNG_MAGIC:
            return False
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, dest_path)
        return True
    except Exception as e:  # noqa: BLE001
        print(f"[worker] overlay fetch fail: {e}", file=sys.stderr, flush=True)
        return False


def overlay_loop(url, dest_path, stop_event, interval_s=1.0):
    while not stop_event.is_set():
        fetch_overlay(url, dest_path)
        for _ in range(int(interval_s * 10)):
            if stop_event.is_set():
                return
            time.sleep(0.1)


def heartbeat_loop(url, token, session_id, stop_event):
    while not stop_event.is_set():
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps({"sessionId": session_id}).encode("utf-8"),
                headers={"Content-Type": "application/json", "x-worker-token": token},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=8).read()
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            print(f"[worker] heartbeat fail: {e}", file=sys.stderr, flush=True)
        for _ in range(150):  # 15s
            if stop_event.is_set():
                return
            time.sleep(0.1)


def probe_has_audio(buf):
    """ffprobe đoạn DHAV đã đệm. Không chắc chắn → coi như KHÔNG có audio
    (thêm anullsrc an toàn hơn là thiếu track)."""
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-f", "dhav", "-i", "pipe:0",
             "-show_entries", "stream=codec_type", "-of", "csv=p=0"],
            input=buf, capture_output=True, timeout=20,
        )
        kinds = r.stdout.decode(errors="ignore").split()
        print(f"[worker] probe streams={kinds}", flush=True)
        return "audio" in kinds
    except Exception as e:  # noqa: BLE001
        print(f"[worker] probe fail: {e}", file=sys.stderr, flush=True)
        return False


def build_ffmpeg_args(overlay_path, has_audio, tee):
    # Cam Imou có thể xuất 2K (2560x1440@20fps): scale về 1080p TRƯỚC khi
    # chồng overlay (PNG vẽ theo 1920x1080) và để x264 nhẹ CPU.
    # -r 25 + GOP 50 = keyframe mỗi 2s theo yêu cầu FB/YT.
    base = ("[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,"
            "pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p")
    # Dùng PTS gốc trong DHAV (đơn điệu theo clock cam) — KHÔNG wallclock,
    # vì đoạn prebuffer ghi dồn 1 lúc sẽ bị đóng dấu cùng thời điểm → DTS
    # nhảy. Audio im lặng tạo NGAY TRONG filter_complex để cùng đồng hồ với
    # graph (anullsrc làm input rời sẽ lệch clock → "Non-monotonic DTS").
    args = [
        "ffmpeg", "-hide_banner", "-loglevel", "warning", "-nostdin",
        "-thread_queue_size", "512", "-f", "dhav", "-i", "pipe:0",
    ]
    fc = base
    if overlay_path:
        args += ["-thread_queue_size", "64", "-f", "image2", "-loop", "1",
                 "-framerate", "2", "-i", overlay_path]
        fc += "[base];[base][1:v]overlay=0:0:eof_action=pass[vout]"
    else:
        fc += "[vout]"
    if has_audio:
        fc += ";[0:a:0]aresample=async=1000:first_pts=0,aformat=sample_rates=44100:channel_layouts=stereo[aout]"
    else:
        fc += ";anullsrc=channel_layout=stereo:sample_rate=44100[aout]"
    args += ["-filter_complex", fc, "-map", "[vout]", "-map", "[aout]"]
    args += [
        "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
        "-profile:v", "high", "-r", "25", "-g", "50", "-keyint_min", "50",
        "-b:v", "3000k", "-maxrate", "3500k", "-bufsize", "6000k",
        "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
        "-shortest", "-f", "tee", tee,
    ]
    return args


def main():
    session_id = env("AUTOLIVE_SESSION_ID", required=True)
    worker_token = env("AUTOLIVE_WORKER_TOKEN", required=True)
    overlay_url = env("AUTOLIVE_OVERLAY_URL", required=True)
    heartbeat_url = env("AUTOLIVE_HEARTBEAT_URL", required=True)
    session_json = env("AUTOLIVE_IMOU_SESSION_JSON", required=True)
    device_id = env("AUTOLIVE_IMOU_DEVICE_ID", required=True)
    destinations = json.loads(env("AUTOLIVE_DESTINATIONS", "[]"))
    tee = build_tee_output(destinations)
    if not tee:
        print("[worker] no valid destinations", file=sys.stderr, flush=True)
        sys.exit(3)

    try:
        from imou import Client
    except ImportError:
        print("[worker] imou-pkg chưa cài (pip install /opt/imou-pkg).", file=sys.stderr, flush=True)
        sys.exit(4)
    try:
        sess_dict = json.loads(session_json)
    except json.JSONDecodeError as e:
        print(f"[worker] AUTOLIVE_IMOU_SESSION_JSON parse fail: {e}", file=sys.stderr, flush=True)
        sys.exit(5)
    client = Client(session=sess_dict)
    dev = next((d for d in client.devices() if getattr(d, "device_id", "") == device_id), None)
    if not dev:
        print(f"[worker] device {device_id} not in account", file=sys.stderr, flush=True)
        sys.exit(6)

    # Overlay: tải về file local trước (thử 10 lần). Không được thì vẫn lên
    # sóng không overlay — thà live không điểm còn hơn chết.
    work_dir = f"/tmp/autolive-{session_id}"
    os.makedirs(work_dir, exist_ok=True)
    overlay_path = os.path.join(work_dir, "overlay.png")
    have_overlay = any(fetch_overlay(overlay_url, overlay_path) or time.sleep(1) for _ in range(10))
    if not have_overlay:
        print("[worker] overlay unavailable → stream without overlay", file=sys.stderr, flush=True)

    stop_event = threading.Event()
    ff = None

    def cleanup(*_):
        stop_event.set()
        if ff is not None:
            try: ff.stdin.close()
            except Exception: pass
            try: ff.terminate()
            except Exception: pass

    signal.signal(signal.SIGTERM, cleanup)
    signal.signal(signal.SIGINT, cleanup)

    rc = 1
    try:
        with dev.open_rtsp(with_audio=True) as rtsp:
            # Đệm ~3s đầu để probe audio — dùng chung 1 kết nối relay.
            it = iter(rtsp)
            pre = bytearray()
            t0 = time.monotonic()
            for chunk in it:
                pre += chunk
                if len(pre) >= PREBUFFER_BYTES or time.monotonic() - t0 > PREBUFFER_MAX_S:
                    break
            has_audio = probe_has_audio(bytes(pre))
            args = build_ffmpeg_args(overlay_path if have_overlay else None, has_audio, tee)
            print(f"[worker] spawning ffmpeg sid={session_id} overlay={have_overlay} "
                  f"audio={has_audio} prebuf={len(pre)}B", flush=True)
            ff = subprocess.Popen(args, stdin=subprocess.PIPE)
            if have_overlay:
                threading.Thread(target=overlay_loop,
                                 args=(overlay_url, overlay_path, stop_event), daemon=True).start()
            threading.Thread(target=heartbeat_loop,
                             args=(heartbeat_url, worker_token, session_id, stop_event),
                             daemon=True).start()
            ff.stdin.write(bytes(pre))
            del pre
            for chunk in it:
                if stop_event.is_set():
                    break
                try:
                    ff.stdin.write(chunk)
                except BrokenPipeError:
                    print("[worker] ffmpeg stdin broken → exit", file=sys.stderr, flush=True)
                    break
    finally:
        cleanup()
        if ff is not None:
            try:
                rc = ff.wait(timeout=10)
            except subprocess.TimeoutExpired:
                ff.kill()
                rc = ff.wait()
        print(f"[worker] ffmpeg exit rc={rc}", flush=True)
        sys.exit(0 if rc == 0 else 1)


if __name__ == "__main__":
    main()
