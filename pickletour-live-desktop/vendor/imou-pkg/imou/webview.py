"""
Bundled HTTP server: HLS web viewer for both LIVE and SD-card PLAYBACK.

Pipeline (live):
    DH-RTSP socket (Python) → DHAV stream → ffmpeg (hwaccel HEVC→H.264 + AAC)
      → HLS segments under /tmp/imou-hls/<deviceId>/
      → hls.js + <video> in the browser

Pipeline (SD playback):
    96600 cloud URL → DH-HTTP tunnel (DhHttpSession) → decrypt_dhav_stream
      (AES-128-ECB on first 256B of each frame; verified PBKDF2-SHA256 key)
      → ffmpeg → HLS under /tmp/imou-hls/<deviceId>__pb__<begin>_<end>/
      → same hls.js viewer

Run:
    python -m imou web [--port 8765] [--encoder h264_videotoolbox|libx264]
"""

from __future__ import annotations

import html
import json as _json
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .api import Client
from .dh_rtsp import DhRtspSession, DhHttpSession, decrypt_dhav_stream
from . import crypto as C


HLS_ROOT = Path("/tmp/imou-hls")
IDLE_TIMEOUT_LIVE = 30.0
IDLE_TIMEOUT_PB = 300.0


# ───────────────────────────────────────────────────────────────────────────
# Shared ffmpeg HLS launcher
# ───────────────────────────────────────────────────────────────────────────
def _ffmpeg_hls(out_dir: Path, encoder: str,
                 with_audio: bool = True,
                 probesize: str = "32M",
                 analyzeduration: str = "10M",
                 vod: bool = False) -> subprocess.Popen:
    """Spawn an ffmpeg that reads DHAV on stdin and writes a rolling HLS playlist
    to ``out_dir``. Returns the Popen object whose ``.stdin`` you feed.

    ``vod=True`` is for SD playback: the relay bursts the whole segment as
    fast as it can (>5× realtime), and the source PTS jumps around. We do
    NOT pace ffmpeg with ``-re`` (it relies on input PTS and stalls for
    tens of seconds when PTS gaps appear) — instead we let ffmpeg burn
    through input fast and DON'T delete past segments, so the browser
    fetches a growing VOD playlist at its own playback rate.
    """
    playlist = str(out_dir / "playlist.m3u8")
    seg_pat = str(out_dir / "seg%03d.ts")
    # Transcode HEVC → H.264 so the browser-side player works without HEVC
    # native support (most Chrome installs lack it). The DHAV stream from the
    # camera decodes cleanly NOW that decrypt_vod_frame's ext walker is robust
    # against unknown TLV bytes (was the root cause of "1-frame-per-keyframe"
    # stuttering in earlier sessions).
    if encoder == "h264_videotoolbox":
        v = ["-c:v", "h264_videotoolbox", "-b:v", "2500k",
             "-allow_sw", "1", "-profile:v", "main"]
    else:
        v = ["-c:v", "libx264", "-preset", "veryfast",
             "-tune", "zerolatency", "-b:v", "2500k"]
    map_args = ["-map", "0:v:0"]
    audio_args = []
    if with_audio:
        map_args += ["-map", "0:a:0?"]
        audio_args = ["-c:a", "aac", "-b:a", "64k", "-ac", "1", "-ar", "16000"]
    if vod:
        # VOD: keep every segment so the browser can scrub, finalise the
        # playlist with ENDLIST when the producer is done (let ffmpeg write
        # it — don't pass omit_endlist).
        hls_flags = "independent_segments+append_list"
        hls_list_size = "0"
    else:
        # LIVE: rolling window with segment deletion.
        hls_flags = "delete_segments+independent_segments+omit_endlist"
        hls_list_size = "10"
    cmd = [
        "ffmpeg", "-loglevel", "error", "-fflags", "+genpts+igndts",
        "-err_detect", "ignore_err",
        "-probesize", probesize, "-analyzeduration", analyzeduration,
        "-f", "dhav", "-i", "pipe:0",
        *map_args,
        "-vf", "scale=1280:-2",
        *v,
        "-g", "30", "-keyint_min", "30",
        *audio_args,
        "-f", "hls",
        "-hls_time", "2",
        "-hls_list_size", hls_list_size,
        "-hls_flags", hls_flags,
        "-hls_segment_filename", seg_pat,
        playlist,
    ]
    return subprocess.Popen(cmd, stdin=subprocess.PIPE,
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.PIPE, bufsize=0)


def _clean_dir(d: Path) -> None:
    d.mkdir(parents=True, exist_ok=True)
    for f in d.iterdir():
        try: f.unlink()
        except OSError: pass


# ───────────────────────────────────────────────────────────────────────────
# Per-camera LIVE session
# ───────────────────────────────────────────────────────────────────────────
class _HLSLive:
    def __init__(self, camera, encoder: str):
        self.cam = camera
        self.encoder = encoder
        self.dir = HLS_ROOT / camera.device_id
        self.stop = threading.Event()
        self.last_hit = time.time()
        self._rtsp: DhRtspSession | None = None
        self._ff: subprocess.Popen | None = None

    def start(self) -> None:
        _clean_dir(self.dir)
        self._rtsp = self.cam.open_rtsp(with_audio=True)
        self._rtsp.__enter__()
        self._ff = _ffmpeg_hls(self.dir, self.encoder)

        def feeder():
            try:
                for chunk in self._rtsp:
                    if self.stop.is_set(): break
                    try: self._ff.stdin.write(chunk)
                    except (BrokenPipeError, OSError): break
            finally:
                try: self._ff.stdin.close()
                except OSError: pass
        threading.Thread(target=feeder, daemon=True).start()

    def touch(self): self.last_hit = time.time()
    def is_idle(self): return time.time() - self.last_hit > IDLE_TIMEOUT_LIVE

    def teardown(self):
        self.stop.set()
        if self._ff:
            try: self._ff.kill()
            except OSError: pass
        if self._rtsp:
            try: self._rtsp.close()
            except OSError: pass


# ───────────────────────────────────────────────────────────────────────────
# Per-segment SD PLAYBACK session
# ───────────────────────────────────────────────────────────────────────────
class _HLSPlayback:
    """One ffmpeg+HLS pipeline for one SD recording segment."""
    def __init__(self, camera, begin: str, end: str, encoder: str,
                 dev_pwd: str):
        self.cam = camera
        self.begin = begin
        self.end = end
        self.encoder = encoder
        self.dev_pwd = dev_pwd
        # subdir uniquely identifies (camera, segment) so multiple PBs coexist
        safe = re.sub(r"[^0-9]", "", begin + end)
        self.key = f"{camera.device_id}__pb__{safe}"
        self.dir = HLS_ROOT / self.key
        self.stop = threading.Event()
        self.last_hit = time.time()
        self._sess: DhHttpSession | None = None
        self._ff: subprocess.Popen | None = None
        self.error: str | None = None

    def start(self) -> None:
        _clean_dir(self.dir)
        key128 = C.vod_frame_key(self.cam.device_id, self.dev_pwd)
        self._ff = _ffmpeg_hls(self.dir, self.encoder, with_audio=True, vod=True)

        def drain_stderr():
            try:
                for line in iter(self._ff.stderr.readline, b''):
                    if not line: break
                    sys.stderr.write(f"[pb ffmpeg] {line.decode(errors='replace').rstrip()}\n")
            except Exception: pass

        def producer():
            """Open the DH-HTTP VOD, decrypt frames as they arrive, push to
            ffmpeg. The relay sends the full segment burst then closes — we
            just consume + relay everything we get."""
            n_out = 0
            try:
                url = self.cam.playback_url(self.begin, self.end)
            except Exception as e:
                sys.stderr.write(f"[pb] playback_url failed: {e}\n")
                try: self._ff.stdin.close()
                except OSError: pass
                return
            from .dh_rtsp import DhHttpSession as _DH
            try:
                with _DH(url, audio=True, read_timeout=60.0) as sess:
                    self._sess = sess
                    for frame in decrypt_dhav_stream(sess, key128):
                        n_out += 1
                        if self.stop.is_set(): break
                        try: self._ff.stdin.write(frame)
                        except (BrokenPipeError, OSError) as e:
                            sys.stderr.write(f"[pb] ffmpeg pipe broken after {n_out} frames: {e}\n")
                            break
            except Exception as e:
                sys.stderr.write(f"[pb] producer crashed: {e}\n")
            finally:
                sys.stderr.write(f"[pb] producer done, {n_out} frames written\n")
                # Keep ffmpeg alive a little — let it flush HLS segments
                try: self._ff.stdin.close()
                except OSError: pass

        threading.Thread(target=producer, daemon=True).start()
        threading.Thread(target=drain_stderr, daemon=True).start()

    def touch(self): self.last_hit = time.time()
    def is_idle(self): return time.time() - self.last_hit > IDLE_TIMEOUT_PB

    def teardown(self):
        self.stop.set()
        if self._ff:
            try: self._ff.kill()
            except OSError: pass
        if self._sess:
            try: self._sess.close()
            except OSError: pass


# ───────────────────────────────────────────────────────────────────────────
# UI template
# ───────────────────────────────────────────────────────────────────────────
INDEX_HTML = r"""<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>Imou viewer</title>
<style>
 html,body{margin:0;background:#111;color:#ddd;font-family:system-ui,sans-serif}
 header{padding:12px 20px;background:#1a1a1a;border-bottom:1px solid #333;position:sticky;top:0;z-index:5}
 .cams{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
 a.cam{padding:6px 12px;background:#2a2a2a;color:#9cf;text-decoration:none;border-radius:4px;font-size:13px}
 a.cam.active{background:#3a5;color:#fff}
 .modes{display:flex;gap:8px;margin-top:8px}
 a.mode{padding:6px 14px;background:#2a2a2a;color:#ccc;text-decoration:none;border-radius:4px;font-size:13px;font-weight:600}
 a.mode.active{background:#a85;color:#fff}
 .main{padding:18px 20px;display:grid;grid-template-columns:1fr 320px;gap:16px;align-items:start}
 .viewer{text-align:center}
 video{width:100%;max-height:75vh;background:#000;border:1px solid #333}
 .meta{font-size:12px;opacity:.6;margin-top:8px}
 .err{color:#f88;font-size:13px;margin-top:8px}
 aside{background:#181818;border:1px solid #2a2a2a;border-radius:6px;padding:12px;max-height:80vh;overflow:auto}
 aside h3{margin:0 0 10px;font-size:13px;font-weight:600;color:#9cf;text-transform:uppercase;letter-spacing:.5px}
 .daterow{display:flex;gap:6px;align-items:center;margin-bottom:10px}
 .daterow input[type=date]{flex:1;background:#0d0d0d;color:#ddd;border:1px solid #333;padding:4px 6px;border-radius:4px}
 .daterow button{background:#3a5;color:#fff;border:0;padding:4px 10px;border-radius:4px;cursor:pointer}
 ul.recs{list-style:none;margin:0;padding:0}
 ul.recs li{padding:8px 10px;margin-bottom:4px;background:#222;border-radius:4px;cursor:pointer;font-size:12px;font-family:ui-monospace,Menlo,monospace;border-left:3px solid #444}
 ul.recs li:hover{background:#2a2a2a;border-left-color:#3a5}
 ul.recs li.active{background:#2a4030;border-left-color:#5d8}
 .rec-time{color:#fff;font-weight:600}
 .rec-dur{color:#aaa;margin-left:6px}
 .rec-type{color:#888;float:right;font-size:11px}
 .empty{color:#666;font-style:italic;font-size:12px;text-align:center;padding:20px 0}
 .loading{color:#999;font-size:12px;text-align:center;padding:10px}
 @media (max-width:720px){.main{grid-template-columns:1fr}aside{order:2}}
</style></head><body>
<header>
 <strong style="font-size:14px">📹 Imou viewer</strong>
 <div class="cams">__CAMS__</div>
 <div class="modes">__MODES__</div>
</header>
<div class="main">
 <div class="viewer">__VIEWER__<div class="meta">__META__</div></div>
 __SIDEBAR__
</div>
__PLAYER__
</body></html>"""

SIDEBAR_PB = r"""<aside>
 <h3>SD recordings</h3>
 <div class="daterow">
   <input type="date" id="pbDate" value="__DATE__">
   <button onclick="loadRecs()">Tải</button>
 </div>
 <div id="recsBox"><div class="loading">đang tải…</div></div>
</aside>
<script>
var CAM='__CAM__', CURRENT_BEGIN='__CURRENT__';
async function loadRecs(){
  var date=document.getElementById('pbDate').value;
  var box=document.getElementById('recsBox');
  box.innerHTML='<div class="loading">đang tải…</div>';
  try{
    var r=await fetch('/recordings.json?cam='+CAM+'&date='+date);
    if(!r.ok) throw new Error('HTTP '+r.status);
    var data=await r.json();
    if(!data.length){box.innerHTML='<div class="empty">không có recording</div>';return;}
    var html='<ul class="recs">';
    for(var rec of data){
      var t=rec.begin_time||'?', dur=rec.duration_s?rec.duration_s+'s':'?', typ=rec.type_name||'';
      var cls=(rec.begin===CURRENT_BEGIN)?'active':'';
      html+='<li class="'+cls+'" onclick="playRec(\''+rec.begin+'\',\''+rec.end+'\')">'+
            '<span class="rec-time">'+t+'</span>'+
            '<span class="rec-dur">'+dur+'</span>'+
            '<span class="rec-type">'+typ+'</span></li>';
    }
    html+='</ul>';
    box.innerHTML=html;
  }catch(e){box.innerHTML='<div class="err">lỗi: '+e+'</div>';}
}
function playRec(begin,end){
  var date=document.getElementById('pbDate').value;
  location.href='/?cam='+CAM+'&mode=pb&date='+date+'&begin='+encodeURIComponent(begin)+'&end='+encodeURIComponent(end);
}
loadRecs();
</script>"""

PLAYER_JS = r"""
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js"></script>
<script>(function(){
  var v=document.getElementById('vid');
  if(!v) return;
  var src='__SRC__';
  var err=document.getElementById('err');
  function setErr(t){ if(err) err.textContent=t; }

  // Prefer hls.js when supported — it handles 404 retries during ffmpeg
  // warmup, segment buffering, and player events much better than the
  // raw <video src=playlist.m3u8> path. Some Chrome builds report
  // canPlayType('hls') as 'maybe' which would otherwise pick the broken
  // native path.
  if(window.Hls && Hls.isSupported()){
    var h=new Hls({
      lowLatencyMode: false,
      manifestLoadingMaxRetry: 20,
      manifestLoadingRetryDelay: 800,
      manifestLoadingMaxRetryTimeout: 30000,
      levelLoadingMaxRetry: 20,
      levelLoadingRetryDelay: 800,
      fragLoadingMaxRetry: 6,
    });
    h.loadSource(src); h.attachMedia(v);
    h.on(Hls.Events.ERROR,function(_,d){
      console.warn('hls', d);
      if(d.fatal){
        if(d.type==='networkError'){ setTimeout(function(){h.loadSource(src);},1500); }
        else if(d.details && d.details.indexOf('Codec') !== -1){
          setErr('Browser không decode được codec — kiểm tra console');
        } else {
          setErr('Lỗi HLS: ' + (d.details || d.type));
        }
      }
    });
    return;
  }

  // Fallback: native HLS (Safari iOS/macOS)
  if(v.canPlayType('application/vnd.apple.mpegurl')){
    v.src=src;
    v.addEventListener('error', function(){
      setErr('Lỗi phát video — kiểm tra console (' + (v.error && v.error.message || 'unknown') + ')');
    });
    return;
  }

  setErr('Trình duyệt không hỗ trợ HLS');
})();</script>"""


# ───────────────────────────────────────────────────────────────────────────
# HTTP server
# ───────────────────────────────────────────────────────────────────────────
class _Handler(BaseHTTPRequestHandler):
    server_obj: "WebViewServer" = None

    def log_message(self, fmt, *args):
        sys.stderr.write(f"[{self.log_date_time_string()}] {fmt % args}\n")

    def do_GET(self):
        path = self.path
        if path == "/" or path.startswith("/?"):
            return self._serve_index()
        if path.startswith("/hls/"):
            return self._serve_hls_live(path[5:])
        if path.startswith("/hls-pb/"):
            return self._serve_hls_pb(path[8:])
        if path.startswith("/recordings.json"):
            return self._serve_recordings()
        if path == "/devices.json":
            return self._serve_json([
                {"device_id": c.device_id, "name": c.name,
                 "model": c.model, "product_id": c.product_id}
                for c in self.server_obj.cameras
            ])
        self.send_error(404)

    def _send_bytes(self, body: bytes, ctype: str, status: int = 200,
                    extra: dict | None = None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        if extra:
            for k, v in extra.items():
                self.send_header(k, v)
        self.end_headers(); self.wfile.write(body)

    def _serve_json(self, obj):
        self._send_bytes(_json.dumps(obj).encode(), "application/json")

    # ── Index page ──────────────────────────────────────────────────────
    def _serve_index(self):
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        active = q.get("cam")
        mode = q.get("mode", "live")   # 'live' | 'pb'
        date = q.get("date") or datetime.now().strftime("%Y-%m-%d")
        begin = q.get("begin"); end = q.get("end")

        cams_html = ""
        for c in self.server_obj.cameras:
            cls = "cam active" if c.device_id == active else "cam"
            link = f"/?cam={c.device_id}&mode={mode}"
            cams_html += f'<a class="{cls}" href="{link}">{html.escape(c.name)}</a>'

        modes_html = ""
        if active:
            for m, label in [("live", "🔴 Live"), ("pb", "📼 SD Playback")]:
                cls = "mode active" if m == mode else "mode"
                modes_html += (f'<a class="{cls}" '
                               f'href="/?cam={active}&mode={m}&date={date}">{label}</a>')

        viewer = '<p>Chọn 1 camera ở trên.</p>'
        meta = ""
        sidebar = ""
        player = ""

        if active:
            cam = next((c for c in self.server_obj.cameras
                        if c.device_id == active), None)
            if cam:
                if mode == "live":
                    self.server_obj._touch_live(active)
                    viewer = ('<video id="vid" controls autoplay muted '
                              'playsinline></video><div id="err" class="err"></div>')
                    meta = (f'{html.escape(cam.name)} ({cam.device_id}) — '
                            f'productId {cam.product_id} — model {html.escape(cam.model)} '
                            f'— LIVE')
                    player = PLAYER_JS.replace(
                        "__SRC__", f"/hls/{active}/playlist.m3u8")
                else:  # mode == 'pb'
                    if begin and end:
                        try:
                            self.server_obj._touch_pb(cam, begin, end)
                        except Exception as e:
                            viewer = (f'<div class="err">Không mở được playback: '
                                      f'{html.escape(str(e))}</div>')
                        else:
                            viewer = ('<video id="vid" controls autoplay '
                                      'playsinline></video>'
                                      '<div id="err" class="err"></div>')
                            meta = (f'{html.escape(cam.name)} — playback '
                                    f'{begin} → {end}')
                            safe = re.sub(r"[^0-9]", "", begin + end)
                            player = PLAYER_JS.replace(
                                "__SRC__",
                                f"/hls-pb/{cam.device_id}__pb__{safe}/playlist.m3u8")
                    else:
                        viewer = ('<p style="color:#aaa">'
                                  'Chọn 1 recording bên phải để xem.</p>')
                    sidebar = (SIDEBAR_PB
                               .replace("__CAM__", html.escape(active))
                               .replace("__DATE__", html.escape(date))
                               .replace("__CURRENT__",
                                        html.escape(begin or "")))

        body = (INDEX_HTML
                .replace("__CAMS__", cams_html)
                .replace("__MODES__", modes_html)
                .replace("__VIEWER__", viewer)
                .replace("__META__", meta)
                .replace("__SIDEBAR__", sidebar)
                .replace("__PLAYER__", player)).encode()
        self._send_bytes(body, "text/html; charset=utf-8")

    # ── Live HLS files ──────────────────────────────────────────────────
    def _serve_hls_live(self, sub):
        if "/" not in sub:
            self.send_error(404); return
        dev, name = sub.split("/", 1)
        name = name.split("?", 1)[0]
        sess = self.server_obj._touch_live(dev)
        if sess is None:
            self.send_error(404, "unknown device"); return
        self._serve_hls_file(sess.dir, name)

    # ── Playback HLS files ──────────────────────────────────────────────
    def _serve_hls_pb(self, sub):
        # sub = "<key>/<filename>" where key = "<devId>__pb__<14digit><14digit>"
        if "/" not in sub:
            self.send_error(404); return
        key, name = sub.split("/", 1)
        name = name.split("?", 1)[0]
        sess = self.server_obj.pb_sessions.get(key)
        if sess is None:
            # Auto-resurrect: parse key to (cam, begin, end) and spin up session
            try:
                dev, _, ts = key.partition("__pb__")
                if len(ts) == 28 and ts.isdigit():
                    # ts = "YYYYmmddHHMMSS" * 2
                    def _fmt(s): return f"{s[:4]}{s[4:6]}{s[6:8]}T{s[8:10]}{s[10:12]}{s[12:14]}"
                    begin = _fmt(ts[:14]); end = _fmt(ts[14:])
                    cam = next((c for c in self.server_obj.cameras
                                if c.device_id == dev), None)
                    if cam:
                        sess = self.server_obj._touch_pb(cam, begin, end)
            except Exception as e:
                self.send_error(500, f"resurrect failed: {e}"); return
        if sess is None:
            self.send_error(404, "unknown playback session"); return
        sess.touch()
        self._serve_hls_file(sess.dir, name)

    def _serve_hls_file(self, base: Path, name: str):
        target = base / name
        if name == "playlist.m3u8":
            deadline = time.time() + 12
            while not target.exists() and time.time() < deadline:
                time.sleep(0.2)
        if not target.exists():
            self.send_error(404, "segment not ready"); return
        if name.endswith(".m3u8"):
            ctype = "application/vnd.apple.mpegurl"
        elif name.endswith(".m4s") or name.endswith(".mp4"):
            ctype = "video/mp4"
        else:
            ctype = "video/mp2t"
        try: data = target.read_bytes()
        except FileNotFoundError:
            self.send_error(404); return
        self._send_bytes(data, ctype, extra={
            "Cache-Control": "no-cache, no-store",
            "Access-Control-Allow-Origin": "*",
        })

    # ── Recordings list JSON ────────────────────────────────────────────
    def _serve_recordings(self):
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        cam_id = q.get("cam")
        date = q.get("date") or datetime.now().strftime("%Y-%m-%d")
        if not cam_id:
            return self._serve_json({"error": "cam= required"})
        cam = next((c for c in self.server_obj.cameras
                    if c.device_id == cam_id), None)
        if not cam:
            return self._serve_json({"error": "unknown cam"})
        try:
            d0 = datetime.strptime(date, "%Y-%m-%d")
        except ValueError:
            return self._serve_json({"error": "bad date"})
        d1 = d0 + timedelta(days=1) - timedelta(seconds=1)
        try:
            recs = cam.list_recordings(d0, d1, limit=300)
        except Exception as e:
            return self._serve_json({"error": str(e)})
        out = []
        for r in recs:
            b, e = r.get("begin_time"), r.get("end_time")
            if not b or not e:
                continue
            try:
                t0 = datetime.strptime(b, "%Y%m%dT%H%M%S")
                t1 = datetime.strptime(e, "%Y%m%dT%H%M%S")
                dur = int((t1 - t0).total_seconds())
            except ValueError:
                dur = None
            out.append({
                "begin": b,
                "end": e,
                "begin_time": (t0.strftime("%H:%M:%S") if dur is not None
                               else b),
                "duration_s": dur,
                "type_name": _type_name(r.get("type")),
                "path": r.get("path"),
            })
        out.sort(key=lambda r: r["begin"])
        self._serve_json(out)


def _type_name(t):
    # Bitmask of detection events — show a short label if recognizable
    if t is None: return ""
    try: t = int(t)
    except (TypeError, ValueError): return str(t)[:12]
    bits = []
    if t & 0x01: bits.append("normal")
    if t & 0x02: bits.append("motion")
    if t & 0x04: bits.append("human")
    if t & 0x08: bits.append("face")
    return "·".join(bits) if bits else f"0x{t:x}"


# ───────────────────────────────────────────────────────────────────────────
# Server orchestrator
# ───────────────────────────────────────────────────────────────────────────
class WebViewServer:
    def __init__(self, client: Client, port: int = 8765,
                 encoder: str = "h264_videotoolbox"):
        self.client = client
        try:
            self.cameras = client.devices()
        except Exception as e:
            print(f"[!] device list failed: {e}", file=sys.stderr)
            print("[!] starting with empty camera list — fix session "
                  "(`imou login …`) and restart", file=sys.stderr)
            self.cameras = []
        self.port = port
        self.encoder = encoder
        self.live_sessions: dict[str, _HLSLive] = {}
        self.pb_sessions: dict[str, _HLSPlayback] = {}
        self._dev_pwd_cache: dict[str, str] = {}
        self.lock = threading.Lock()

    def _touch_live(self, device_id: str) -> _HLSLive | None:
        with self.lock:
            cam = next((c for c in self.cameras
                        if c.device_id == device_id), None)
            if not cam:
                return None
            sess = self.live_sessions.get(device_id)
            if sess is None or sess.stop.is_set():
                sess = _HLSLive(cam, self.encoder)
                sess.start()
                self.live_sessions[device_id] = sess
            sess.touch()
            return sess

    def _dev_pwd(self, cam) -> str:
        if cam.device_id in self._dev_pwd_cache:
            return self._dev_pwd_cache[cam.device_id]
        info = self.client.device_password(cam.device_id, cam.product_id)
        self._dev_pwd_cache[cam.device_id] = info["password"]
        return info["password"]

    def _touch_pb(self, cam, begin: str, end: str) -> _HLSPlayback:
        safe = re.sub(r"[^0-9]", "", begin + end)
        key = f"{cam.device_id}__pb__{safe}"
        with self.lock:
            sess = self.pb_sessions.get(key)
            if sess is None or sess.stop.is_set():
                pwd = self._dev_pwd(cam)
                # VerifyPassword (94400) is REQUIRED before 96600 URL becomes
                # routable. Do it once per (cam, session) — harmless to repeat.
                try: cam.verify_password()
                except Exception: pass
                sess = _HLSPlayback(cam, begin, end, self.encoder, pwd)
                sess.start()
                if sess.error:
                    raise RuntimeError(sess.error)
                self.pb_sessions[key] = sess
            sess.touch()
            return sess

    def _janitor(self):
        while True:
            time.sleep(10)
            with self.lock:
                for dev, sess in list(self.live_sessions.items()):
                    if sess.is_idle():
                        sess.teardown()
                        del self.live_sessions[dev]
                for key, sess in list(self.pb_sessions.items()):
                    if sess.is_idle():
                        sess.teardown()
                        del self.pb_sessions[key]

    def serve_forever(self):
        HLS_ROOT.mkdir(parents=True, exist_ok=True)
        _Handler.server_obj = self
        srv = ThreadingHTTPServer(("127.0.0.1", self.port), _Handler)
        print(f"Found {len(self.cameras)} camera(s):")
        for c in self.cameras:
            print(f"  · {c.name:24s}  {c.device_id}  ({c.model})")
        print(f"\nServing http://127.0.0.1:{self.port}/  — Ctrl-C to stop")
        threading.Thread(target=self._janitor, daemon=True).start()
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print("\nbye")
        finally:
            with self.lock:
                for s in self.live_sessions.values():
                    s.teardown()
                for s in self.pb_sessions.values():
                    s.teardown()
