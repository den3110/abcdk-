#!/usr/bin/env python3
"""PickleTour auto-live worker — cầu nối Imou DHAV → ffmpeg → RTMP.

Đọc credentials + destinations từ env do Node orchestrator set:
    AUTOLIVE_SESSION_ID
    AUTOLIVE_WORKER_TOKEN
    AUTOLIVE_OVERLAY_URL         (backend serve PNG động 1920x1080)
    AUTOLIVE_HEARTBEAT_URL
    AUTOLIVE_IMOU_PHONE
    AUTOLIVE_IMOU_PASSWORD
    AUTOLIVE_IMOU_AREA_CODE
    AUTOLIVE_IMOU_DEVICE_ID
    AUTOLIVE_DESTINATIONS        (JSON [{type,streamUrl,streamKey}])

Pipeline:
    imou.Client().open_rtsp()   -> yield DHAV bytes
        ↓ stdin
    ffmpeg -f dhav -i pipe:0
           -f image2 -loop 1 -reload 1 -i AUTOLIVE_OVERLAY_URL
           -filter_complex "[0:v][1:v]overlay=0:0"
           -c:v libx264 -preset veryfast -tune zerolatency -b:v 3000k -g 60
           -c:a aac -b:a 128k -ar 44100
           -f tee "[f=flv:onfail=ignore]rtmp://.../key1|[f=flv:onfail=ignore]rtmp://.../key2"

Heartbeat gửi mỗi 15s cho backend để orchestrator biết còn sống.
Đọc DHAV chunk nào bị BrokenPipeError → break loop → exit != 0 → Node auto
mark error, admin quyết định start lại.
"""
import json
import os
import signal
import subprocess
import sys
import threading
import time
import urllib.request
import urllib.error


def env(name, default=None, required=False):
    v = os.environ.get(name, default)
    if required and not v:
        print(f"[worker] missing env {name}", file=sys.stderr, flush=True)
        sys.exit(2)
    return v


def build_tee_output(destinations):
    """destinations: [{type,streamUrl,streamKey}]. Trả string đưa vào `-f tee`.

    Nếu streamKey trống hoặc streamUrl đã có key inline → dùng nguyên URL.
    Nếu tách rời → nối "{url}/{key}".
    """
    parts = []
    for d in destinations:
        url = d.get("streamUrl", "").strip()
        key = d.get("streamKey", "").strip()
        if not url:
            continue
        full = url if not key else (url.rstrip("/") + "/" + key)
        parts.append(f"[f=flv:onfail=ignore]{full}")
    return "|".join(parts)


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


def main():
    session_id = env("AUTOLIVE_SESSION_ID", required=True)
    worker_token = env("AUTOLIVE_WORKER_TOKEN", required=True)
    overlay_url = env("AUTOLIVE_OVERLAY_URL", required=True)
    heartbeat_url = env("AUTOLIVE_HEARTBEAT_URL", required=True)
    phone = env("AUTOLIVE_IMOU_PHONE", required=True)
    password = env("AUTOLIVE_IMOU_PASSWORD", required=True)
    area_code = env("AUTOLIVE_IMOU_AREA_CODE", "84")
    device_id = env("AUTOLIVE_IMOU_DEVICE_ID", required=True)
    destinations = json.loads(env("AUTOLIVE_DESTINATIONS", "[]"))
    tee = build_tee_output(destinations)
    if not tee:
        print("[worker] no valid destinations", file=sys.stderr, flush=True)
        sys.exit(3)

    # Import imou pkg (installed via pip on VPS).
    try:
        from imou import Client
    except ImportError:
        print("[worker] imou-pkg chưa cài. pip install ImouPkg trên VPS.", file=sys.stderr, flush=True)
        sys.exit(4)

    # Login → find device.
    client = Client(phone=phone, password=password, area_code=area_code)
    dev = next((d for d in client.devices() if getattr(d, "device_id", "") == device_id), None)
    if not dev:
        print(f"[worker] device {device_id} not in account", file=sys.stderr, flush=True)
        sys.exit(5)

    # ffmpeg pipeline: input 0 = dhav from stdin, input 1 = overlay PNG (reload 1Hz).
    # -reload 1 chỉ hoạt động với image2/movie khi filename thay đổi/timestamp
    # đổi; ta bump overlayVersion server-side + return no-cache header → ffmpeg
    # re-fetch mỗi frame. Nếu chậm quá, giảm frame rate PNG bằng fps filter.
    ffmpeg_args = [
        "ffmpeg", "-hide_banner", "-loglevel", "warning",
        "-fflags", "+genpts", "-use_wallclock_as_timestamps", "1",
        "-f", "dhav", "-i", "pipe:0",
        "-f", "image2", "-loop", "1", "-framerate", "1", "-reconnect", "1",
        "-reconnect_streamed", "1", "-reconnect_delay_max", "2", "-i", overlay_url,
        "-filter_complex", "[0:v][1:v]overlay=0:0:shortest=0",
        "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
        "-pix_fmt", "yuv420p", "-b:v", "3000k", "-maxrate", "3500k",
        "-bufsize", "6000k", "-g", "60", "-keyint_min", "60",
        "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
        "-f", "tee", tee,
    ]
    print(f"[worker] spawning ffmpeg for session {session_id}", flush=True)
    ff = subprocess.Popen(ffmpeg_args, stdin=subprocess.PIPE)

    stop_event = threading.Event()
    hb_thread = threading.Thread(
        target=heartbeat_loop, args=(heartbeat_url, worker_token, session_id, stop_event),
        daemon=True,
    )
    hb_thread.start()

    def cleanup(*_):
        stop_event.set()
        try: ff.stdin.close()
        except Exception: pass
        try: ff.terminate()
        except Exception: pass

    signal.signal(signal.SIGTERM, cleanup)
    signal.signal(signal.SIGINT, cleanup)

    try:
        with dev.open_rtsp(with_audio=True) as rtsp:
            for chunk in rtsp:
                if stop_event.is_set():
                    break
                try:
                    ff.stdin.write(chunk)
                except BrokenPipeError:
                    print("[worker] ffmpeg stdin broken → exit", file=sys.stderr, flush=True)
                    break
    finally:
        cleanup()
        rc = ff.wait(timeout=10) if ff.poll() is None else ff.returncode
        print(f"[worker] ffmpeg exit rc={rc}", flush=True)
        sys.exit(0 if rc == 0 else 1)


if __name__ == "__main__":
    main()
