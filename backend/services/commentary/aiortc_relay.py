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

    await pc.setRemoteDescription(RTCSessionDescription(sdp=sdp, type=typ))

    # Gửi video 360p của luồng về trình duyệt BLV (độ trễ thấp) nếu có. PHẢI gắn SAU
    # setRemoteDescription để aiortc gắn track vào m-line video (recvonly) của offer.
    if preview_url:
        try:
            player = MediaPlayer(preview_url, format="mpegts",
                                 options={"fflags": "nobuffer", "flags": "low_delay",
                                          "analyzeduration": "1000000", "probesize": "500000"})
            if player.video:
                pc.addTrack(player.video)
                pc._preview_player = player  # giữ ref tránh bị GC đóng
        except Exception as e:  # noqa: BLE001
            print(f"[relay] preview360 lỗi: {e!r}", flush=True)

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
