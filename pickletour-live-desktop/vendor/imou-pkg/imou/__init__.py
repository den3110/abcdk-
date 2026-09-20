"""
imou — consumer-protocol client for Imou Life cameras.

End-to-end pipeline (see README.md for full details):

    1. Auth        — Phone + OTP → session token (signSaas HMAC-SHA256)
    2. Devices     — HTTPS device.list.BasicList → list of cameras
    3. Stream URL  — HTTPS things.media.GetRealTransferStreamUrl → RTSP relay URL
    4. DH-RTSP     — TCP RTSP w/ `Transport: DH/RTP/TCP` (Dahua packetization)
    5. DHAV demux  — ffmpeg's built-in `dhav` demuxer (HEVC + AAC)
    6. Output      — snapshot, mp4 record, HLS web view (with audio)

Quick start:

    from imou import login, Client

    # First time only — captures session into ~/.imou-session.json
    login(phone="869941629", area_code="84", password="...")

    # Subsequent calls reuse session
    c = Client()
    for cam in c.devices():
        print(cam.name, cam.device_id)
    cam = c.devices()[0]
    cam.snapshot("/tmp/snap.jpg")
    cam.record("/tmp/clip.mp4", seconds=10)
"""

from .auth import login, load_session, import_session, AuthError
from .api import Client, Camera
from .dh_rtsp import DhRtspSession

__all__ = ["login", "load_session", "import_session", "AuthError",
           "Client", "Camera", "DhRtspSession"]
__version__ = "0.1.0"
