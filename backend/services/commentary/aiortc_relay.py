#!/usr/bin/env python3
"""Sidecar aiortc: nhận WebRTC audio (Opus) từ trình duyệt bình luận viên → giải mã
+ resample về PCM s16le 48k mono → STREAM (chunked POST) tới control-server desktop
qua Tailscale (relayUrl do backend Node cấp, đã gắn PIN). Worker ffmpeg amix vào luồng.

Chạy cục bộ trên VPS (chỉ nghe 127.0.0.1). Backend Node gọi POST /offer.

ENV:
  COMMENTARY_RELAY_PORT   cổng lắng nghe (mặc định 8790)
  COMMENTARY_RELAY_HOST   host (mặc định 127.0.0.1)

Cài: pip install -r requirements.txt   (aiortc, aiohttp, av)
"""
import asyncio
import json
import os

import av
from aiohttp import web, ClientSession, ClientTimeout
from aiortc import RTCPeerConnection, RTCSessionDescription
from aiortc.contrib.media import MediaPlayer

HOST = os.environ.get("COMMENTARY_RELAY_HOST", "127.0.0.1")
PORT = int(os.environ.get("COMMENTARY_RELAY_PORT") or 8790)

# PCM đích khớp worker.py: s16le 48k mono.
OUT_RATE = 48000
OUT_LAYOUT = "mono"
OUT_FORMAT = "s16"

pcs = set()


async def _relay_audio(track, relay_url):
    """Đọc frame audio → resample s16le 48k mono → đẩy vào queue; song song chunked
    POST queue → relay_url (control-server desktop). Kết thúc khi track ngừng."""
    queue: asyncio.Queue = asyncio.Queue(maxsize=200)
    resampler = av.AudioResampler(format=OUT_FORMAT, layout=OUT_LAYOUT, rate=OUT_RATE)

    async def body_gen():
        while True:
            chunk = await queue.get()
            if chunk is None:
                return
            yield chunk

    async def uploader():
        try:
            async with ClientSession(timeout=ClientTimeout(total=None, sock_connect=10)) as sess:
                async with sess.post(relay_url, data=body_gen(),
                                     headers={"Content-Type": "application/octet-stream"}) as resp:
                    await resp.read()
        except Exception as e:  # noqa: BLE001
            print(f"[relay] uploader lỗi: {e!r}", flush=True)

    up_task = asyncio.ensure_future(uploader())
    try:
        while True:
            frame = await track.recv()  # av.AudioFrame
            out = resampler.resample(frame)
            if out is None:
                continue
            if not isinstance(out, (list, tuple)):
                out = [out]
            for rf in out:
                try:
                    n = rf.samples * 2  # s16 mono = 2 bytes/sample
                    data = bytes(rf.planes[0])[:n]
                except Exception:  # noqa: BLE001
                    continue
                if data:
                    try:
                        queue.put_nowait(data)
                    except asyncio.QueueFull:
                        # Bỏ khung cũ nếu nghẽn (ưu tiên realtime, không dồn trễ).
                        try: queue.get_nowait()
                        except Exception: pass
                        try: queue.put_nowait(data)
                        except Exception: pass
    except Exception:
        pass
    finally:
        await queue.put(None)
        try:
            await asyncio.wait_for(up_task, timeout=5)
        except Exception:
            up_task.cancel()


async def offer(request):
    try:
        params = await request.json()
    except Exception:
        return web.json_response({"error": "JSON không hợp lệ"}, status=400)
    sdp = params.get("sdp")
    typ = params.get("type")
    relay_url = params.get("relayUrl")
    preview_url = params.get("previewUrl")
    rtsp_url = params.get("rtspUrl")
    if not sdp or not typ or not relay_url:
        return web.json_response({"error": "Thiếu sdp/type/relayUrl"}, status=400)

    pc = RTCPeerConnection()
    pcs.add(pc)

    @pc.on("track")
    def on_track(track):  # noqa: ANN001
        if track.kind == "audio":
            asyncio.ensure_future(_relay_audio(track, relay_url))

    @pc.on("connectionstatechange")
    async def on_state():
        if pc.connectionState in ("failed", "closed", "disconnected"):
            await _close_pc(pc)

    print("[relay] offer m-lines:", [l for l in sdp.splitlines() if l.startswith("m=")], flush=True)
    await pc.setRemoteDescription(RTCSessionDescription(sdp=sdp, type=typ))

    # Gửi video 360p của luồng về trình duyệt BLV (độ trễ thấp) nếu có. PHẢI gắn SAU
    # setRemoteDescription để aiortc gắn track vào m-line video (recvonly) của offer.
    # av.open (MediaPlayer.__init__) là ĐỒNG BỘ → chạy trong executor + timeout để
    # KHÔNG bao giờ treo event loop (nếu nguồn chậm/treo thì bỏ video, vẫn có audio).
    loop = asyncio.get_event_loop()

    def _open_rtsp(url):
        # VPS kéo RTSP full-res (cùng Tailscale). TCP + đệm nhỏ cho độ trễ thấp.
        return MediaPlayer(url, options={
            "rtsp_transport": "tcp", "fflags": "nobuffer", "flags": "low_delay",
            "max_delay": "500000", "timeout": "5000000", "stimeout": "5000000"})

    def _open_preview(url):
        return MediaPlayer(url, format="mpegts", options={
            "fflags": "nobuffer", "flags": "low_delay",
            "analyzeduration": "1000000", "probesize": "500000",
            "timeout": "5000000", "rw_timeout": "5000000"})

    async def _open(url, opener):
        return await asyncio.wait_for(loop.run_in_executor(None, lambda: opener(url)), timeout=8)

    # CHỈ xử lý video khi offer CÓ m-line video (recvonly). Nếu offer audio-only
    # (app dùng VLC xem RTSP phía điện thoại) → KHÔNG mở nguồn gì cả → VPS khỏi tốn
    # tài nguyên (kéo RTSP/encode). VPS chỉ làm cầu khi app thật sự xin video.
    vtrans = next((t for t in pc.getTransceivers() if t.kind == "video"), None)
    if vtrans is None:
        print("[relay] offer audio-only → VPS chỉ relay mic, KHÔNG kéo video", flush=True)
    else:
        # Nguồn video: ƯU TIÊN RTSP full-res (VPS kéo), lỗi/không có → preview360 (PC).
        player = None
        src = ""
        if rtsp_url:
            try:
                player = await _open(rtsp_url, _open_rtsp)
                if not (player and player.video):
                    player = None
                else:
                    src = "rtsp-fullres"
            except Exception as e:  # noqa: BLE001
                print(f"[relay] RTSP full-res lỗi → fallback 360p: {e!r}", flush=True)
                player = None
        if player is None and preview_url:
            try:
                player = await _open(preview_url, _open_preview)
                if player and player.video:
                    src = "preview360"
            except Exception as e:  # noqa: BLE001
                print(f"[relay] preview360 lỗi (bỏ video, vẫn có audio): {e!r}", flush=True)
                player = None
        if player and player.video:
            vtrans.sender.replaceTrack(player.video)
            vtrans.direction = "sendonly"
            pc._preview_player = player  # giữ ref tránh bị GC đóng
            print(f"[relay] video OK ({src}) → gắn track", flush=True)

    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    return web.json_response({
        "sdp": pc.localDescription.sdp,
        "type": pc.localDescription.type,
    })


async def _close_pc(pc):
    if pc in pcs:
        pcs.discard(pc)
        player = getattr(pc, "_preview_player", None)
        if player is not None:
            try:
                if player.video:
                    player.video.stop()
            except Exception:
                pass
        try:
            await pc.close()
        except Exception:
            pass


async def health(_request):
    return web.json_response({"ok": True, "pcs": len(pcs)})


async def on_shutdown(_app):
    await asyncio.gather(*[_close_pc(pc) for pc in list(pcs)])


def main():
    app = web.Application()
    app.router.add_post("/offer", offer)
    app.router.add_get("/health", health)
    app.on_shutdown.append(on_shutdown)
    print(f"[commentary-relay] listening http://{HOST}:{PORT}", flush=True)
    web.run_app(app, host=HOST, port=PORT, print=None)


if __name__ == "__main__":
    main()
