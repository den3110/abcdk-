#!/usr/bin/env python3
"""clip_grab.py — kéo 1 đoạn playback SD từ relay Imou → MP4 (không transcode).

Port từ PickleBook (đã qua 4 vòng debug) — dùng cho PickleTour. Được spawn bởi
worker Node (services/clip/clipWorker.service.js). Tham số qua STDIN (JSON) để
session token KHÔNG lộ trong `ps aux`:

  {
    "session":   { "uuid_user", "uuid_key", "session_id", "regional_host" },
    "creds":     { "phone", "password", "area_code" } | null,  # relogin khi 12002
    "deviceId":  "5858CBDPSF15233",
    "productId": "",                       # '' với cam legacy
    "begin":     "2026_07_08_19_05_00",    # LOCAL time cam, underscore format
    "end":       "2026_07_08_19_30_00",
    "maxSeconds": 1502,
    "out":       "/tmp/clip-xxx.mp4",
    "pkgPath":   "/opt/ImouPkg/imou-pkg"   # optional; bỏ nếu imou đã cài sẵn
  }

KIẾN TRÚC:
 1. list_recordings (SetService 24100) → biết CHÍNH XÁC khoảng nào trên SD có bản
    ghi trong range (SD ghi theo motion — range user chọn có thể chỉ vài mảnh).
 2. Mỗi khoảng: mở stream ở đầu khoảng. Relay ĐÓNG TCP sau mỗi FILE ghi →
    reconnect tại (đầu khoảng + số giây đã lấy) cho tới hết khoảng.
 3. 555 "Create stream source failed" = cam bận (giới hạn stream đồng thời) →
    retry 8s×5.
 4. Feed chung 1 ffmpeg stdin: -f dhav -c:v copy (không transcode) + audio AAC.
 5. HEVC retag hev1→hvc1 (iOS không play hev1).

Exit 0 = OK; 3 = không có data; ≠0 khác = lỗi (555 busy → worker requeue).
"""

import faulthandler
import json
import os
import struct
import subprocess
import sys
import time
from datetime import datetime, timedelta

faulthandler.dump_traceback_later(
    int(os.environ.get("CLIP_HARD_TIMEOUT", "3600")), exit=True)

ASSUMED_FPS = 15.0  # fallback khi KHÔNG đọc được timestamp thật trong frame
TIME_FMT_US = "%Y_%m_%d_%H_%M_%S"
TIME_FMT_T = "%Y%m%dT%H%M%S"


def frame_epoch(frame: bytes):
    """Đọc timestamp THẬT (epoch giây) từ header DHAV (offset 16, uint32 LE).

    Header DHAV 24 byte: size@12, ext_hdr_len@0x16; 6 byte 16..21 = timestamp(4)+ms(2).
    Trả epoch nếu hợp lệ (2020..2035), else None → caller fallback sang ước lượng FPS.
    Dùng để nối các đoạn SD CHÍNH XÁC theo thời gian thật (không phụ thuộc FPS)."""
    if len(frame) < 22 or frame[:4] != b"DHAV":
        return None
    try:
        ts = struct.unpack_from("<I", frame, 16)[0]
    except struct.error:
        return None
    # 1577836800 = 2020-01-01, 2051222400 = 2035-01-01 (UTC) — chỉ nhận epoch hợp lý.
    if 1577836800 <= ts <= 2051222400:
        return ts
    return None


def _resolve_cam(params):
    """Dựng Camera; relogin từ creds nếu session hết hạn (12002)."""
    from imou.api import Client, Camera  # noqa: E402

    session = params.get("session") or {}
    creds = params.get("creds") or {}
    device_id = params["deviceId"]
    product_id = params.get("productId", "") or ""

    def build(sess):
        client = Client(session=sess)
        return Camera(device_id=device_id, product_id=product_id,
                      name="", model="", _client=client)

    used = session
    cam = build(session) if session else None
    # Verify session sống bằng 1 call nhẹ (device_password) — nếu 12002 thì relogin.
    try:
        if cam is None:
            raise RuntimeError("no session")
        cam._dev_pwd()  # ép resolve device password (cần cho vod_frame_key)
        return cam, used
    except Exception as e:  # noqa: BLE001
        if creds.get("phone") and creds.get("password"):
            from imou.auth import login  # noqa: E402
            print(f"session lỗi ({str(e)[:80]}) → relogin từ creds", flush=True)
            used = login(creds["phone"], creds.get("area_code", "84"),
                         creds["password"])
            cam = build(used)
            cam._dev_pwd()
            return cam, used
        raise


def open_segment(cam, DhHttpSession, seg_begin_str, end_str, deadline):
    """Mở 1 connection playback với retry 555 (cam bận / slot chưa nhả)."""
    open_err = None
    for att in range(6):
        if time.time() > deadline:
            break
        tmp = None
        try:
            url = cam.playback_url(seg_begin_str, end_str, encrypt=2)
            tmp = DhHttpSession(url, audio=True, read_timeout=30.0)
            tmp.__enter__()
            return tmp
        except Exception as e:  # noqa: BLE001
            if tmp is not None:
                try:
                    tmp.close()
                except Exception:
                    pass
            open_err = e
            if "555" in str(e) and att < 5:
                print(f"OPEN 555 (cam bận) — retry {att + 1}/5 sau 8s", flush=True)
                time.sleep(8)
                continue
            break
    raise open_err if open_err else RuntimeError("segment open failed")


def main() -> int:
    params = json.load(sys.stdin)
    if params.get("pkgPath"):
        sys.path.insert(0, params["pkgPath"])

    from imou import crypto as C  # noqa: E402
    from imou.dh_rtsp import DhHttpSession, decrypt_dhav_stream  # noqa: E402

    cam, _used = _resolve_cam(params)

    out = params["out"]
    max_seconds = int(params.get("maxSeconds", 1800))
    begin_dt = datetime.strptime(params["begin"], TIME_FMT_US)
    end_dt = datetime.strptime(params["end"], TIME_FMT_US)
    end_str = params["end"]
    deadline = time.time() + max_seconds * 2 + 120

    key = C.vod_frame_key(cam.device_id, cam._dev_pwd())

    # ── 1. Danh sách bản ghi thật trên SD trong range ──────────────────────
    try:
        recs = cam.list_recordings(begin_dt - timedelta(hours=2),
                                   end_dt + timedelta(hours=2))
        raw_iv = []
        for r in recs:
            try:
                rb = datetime.strptime(str(r["begin_time"]), TIME_FMT_T)
                re_ = datetime.strptime(str(r["end_time"]), TIME_FMT_T)
            except (KeyError, ValueError, TypeError):
                continue
            b, e = max(rb, begin_dt), min(re_, end_dt)
            if e > b:
                raw_iv.append((b, e))
        raw_iv.sort(key=lambda x: x[0])
        intervals = []
        for b, e in raw_iv:
            if intervals and (b - intervals[-1][1]).total_seconds() <= 3:
                intervals[-1] = (intervals[-1][0], max(intervals[-1][1], e))
            else:
                intervals.append((b, e))
        total_media = sum((e - b).total_seconds() for b, e in intervals)
        print(f"RECORDINGS {len(intervals)} khoảng, tổng ≈{int(total_media)}s",
              flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"list_recordings failed ({e}) — fallback blind range", flush=True)
        intervals = [(begin_dt, end_dt)]

    if not intervals:
        print("SD không có bản ghi trong khung giờ này", file=sys.stderr)
        return 3

    # ── 2. ffmpeg mux — 1 process, feed nối tiếp mọi khoảng ────────────────
    ff_err_path = out + ".ffmpeg.log"
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-fflags", "+discardcorrupt",
        "-f", "dhav", "-i", "pipe:0",
        "-t", str(max_seconds),
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "64k",
        "-movflags", "+faststart",
        out,
    ]
    with open(ff_err_path, "wb") as ff_err_f:
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, bufsize=0,
                                stderr=ff_err_f)

    total = 0
    video_frames = 0
    last_report = 0.0
    ffmpeg_done = False
    conn_idx = 0
    try:
        for iv_begin, iv_end in intervals:
            if ffmpeg_done or time.time() > deadline:
                break
            iv_target = (iv_end - iv_begin).total_seconds()
            # Điểm nối tiếp theo. Ưu tiên timestamp THẬT trong frame (chính xác,
            # không lệ thuộc FPS); fallback ước lượng FPS nếu cam không kèm ts.
            iv_first_ts = None       # epoch frame đầu tiên của khoảng
            iv_last_ts = None        # epoch frame video mới nhất
            iv_start_frames = video_frames
            empty_conns = 0
            while not ffmpeg_done and time.time() < deadline:
                # Đã lấy đủ khoảng? (theo ts thật nếu có, else theo FPS)
                if iv_first_ts is not None and iv_last_ts is not None:
                    watched = iv_last_ts - iv_first_ts
                else:
                    watched = (video_frames - iv_start_frames) / ASSUMED_FPS
                if watched >= iv_target - 2:
                    break
                # Điểm mở kết nối kế: đầu khoảng + số giây đã lấy (ts thật hoặc FPS).
                seg_begin = iv_begin + timedelta(seconds=int(watched))
                if seg_begin >= iv_end:
                    break
                seg_begin_str = seg_begin.strftime(TIME_FMT_US)
                conn_idx += 1
                print(f"SEGMENT #{conn_idx} begin={seg_begin_str} "
                      f"≈{int(watched)}/{int(iv_target)}s "
                      f"({'ts' if iv_last_ts else 'fps'})", flush=True)
                try:
                    rtsp = open_segment(cam, DhHttpSession, seg_begin_str,
                                        end_str, deadline)
                except Exception as e:  # noqa: BLE001
                    if total > 500_000:
                        print(f"SEGMENT open failed ({e}) — finalize partial",
                              flush=True)
                        ffmpeg_done = True
                        break
                    raise
                frames_before = video_frames
                try:
                    for frame in decrypt_dhav_stream(rtsp, key):
                        try:
                            proc.stdin.write(frame)
                        except (BrokenPipeError, OSError, ValueError) as we:
                            print(f"FFMPEG PIPE CLOSED ({type(we).__name__})",
                                  flush=True)
                            ffmpeg_done = True
                            break
                        total += len(frame)
                        if len(frame) > 4 and frame[4] in (0xFD, 0xFC):
                            video_frames += 1
                            ep = frame_epoch(frame)
                            if ep is not None:
                                if iv_first_ts is None:
                                    iv_first_ts = ep
                                # Chống nhảy lùi (frame lỗi) → chỉ tiến.
                                if iv_last_ts is None or ep >= iv_last_ts:
                                    iv_last_ts = ep
                        now = time.time()
                        if now - last_report >= 2:
                            last_report = now
                            print(f"PROGRESS {total}", flush=True)
                        # Đã tới cuối khoảng theo ts thật → dừng khoảng này.
                        if (iv_first_ts is not None and iv_last_ts is not None
                                and (iv_last_ts - iv_first_ts) >= iv_target - 1):
                            break
                        if proc.poll() is not None:
                            print(f"FFMPEG EXITED rc={proc.returncode}", flush=True)
                            ffmpeg_done = True
                            break
                        if now > deadline:
                            print(f"DEADLINE (bytes={total}) — finalize", flush=True)
                            ffmpeg_done = True
                            break
                finally:
                    try:
                        rtsp.close()
                    except Exception:
                        pass
                if video_frames == frames_before:
                    empty_conns += 1
                    if empty_conns >= 2:
                        print("INTERVAL hết data — sang khoảng kế", flush=True)
                        break
                else:
                    empty_conns = 0
                if not ffmpeg_done:
                    time.sleep(1)
    finally:
        try:
            os.close(proc.stdin.fileno())
        except Exception:
            pass
        try:
            proc.stdin.close()
        except Exception:
            pass
        try:
            proc.wait(timeout=60)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=10)

    if not os.path.exists(out) or os.path.getsize(out) < 50_000:
        err = ""
        try:
            with open(ff_err_path, "rb") as f:
                err = f.read().decode("utf-8", "replace").strip()
        except OSError:
            pass
        print(f"clip quá nhỏ/thiếu (bytes_in={total}). ffmpeg: {err[-400:]}",
              file=sys.stderr)
        return 3
    try:
        os.unlink(ff_err_path)
    except OSError:
        pass

    # ── 3. HEVC tag fix: hev1 → hvc1 ───────────────────────────────────────
    try:
        codec = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=codec_name",
             "-of", "default=noprint_wrappers=1:nokey=1", out],
            capture_output=True, text=True, timeout=30,
        ).stdout.strip()
        if codec == "hevc":
            tagged = out + ".hvc1.mp4"
            r = subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", out,
                 "-c", "copy", "-tag:v", "hvc1",
                 "-movflags", "+faststart", tagged],
                capture_output=True, timeout=120,
            )
            if r.returncode == 0 and os.path.getsize(tagged) > 50_000:
                os.replace(tagged, out)
                print("RETAG hvc1 OK", flush=True)
            else:
                try:
                    os.unlink(tagged)
                except OSError:
                    pass
    except Exception as e:  # noqa: BLE001
        print(f"RETAG hvc1 error (ignored): {e}", flush=True)

    print(f"DONE {os.path.getsize(out)} frames={video_frames} "
          f"≈{int(video_frames / ASSUMED_FPS)}s", flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        print(f"{type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(2)
