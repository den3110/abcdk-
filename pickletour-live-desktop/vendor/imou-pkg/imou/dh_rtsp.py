"""
DH-RTSP client — speaks Dahua's `Transport: DH/RTP/TCP` profile.

Why this exists: the cloud relay (`MTS/1.0` server, port 9132/9133) silently
accepts the standard `Transport: RTP/AVP/TCP` (returns 200 OK on every step)
but never pushes RTP packets. The native Imou SDK uses `Transport: DH/RTP/TCP`
and `DH/AVP/DHTP` (Dahua packetization), which is what makes the server push
data.

Output: DHAV-wrapped H.265 (Annex-B inside) + AAC. ffmpeg has a built-in
`dhav` demuxer that recognises the container automatically.
"""

from __future__ import annotations

import socket
import threading
import time
import urllib.parse
from contextlib import contextmanager


class DhRtspError(Exception):
    pass


# ───────────────────────────────────────────────────────────────────────────
# Wire helpers
# ───────────────────────────────────────────────────────────────────────────
def _send(sock, method: str, url: str, cseq: int, hdrs: dict | None = None) -> None:
    lines = [f"{method} {url} RTSP/1.0", f"CSeq: {cseq}",
             "User-Agent: imou-py/0.1"]
    if hdrs:
        for k, v in hdrs.items():
            lines.append(f"{k}: {v}")
    sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())


def _recv_resp(sock) -> tuple[list[str], bytes, bytes]:
    """Read one RTSP response. Returns (header-lines, body, leftover-bytes)."""
    buf = b""
    while b"\r\n\r\n" not in buf:
        chunk = sock.recv(4096)
        if not chunk:
            raise DhRtspError("RTSP server closed during response")
        buf += chunk
    head, _, rest = buf.partition(b"\r\n\r\n")
    headers = head.decode(errors="replace").split("\r\n")
    cl = 0
    for h in headers:
        if h.lower().startswith("content-length:"):
            cl = int(h.split(":", 1)[1].strip())
    while len(rest) < cl:
        rest += sock.recv(4096)
    return headers, rest[:cl], rest[cl:]


def _session_id(headers: list[str]) -> str | None:
    for h in headers:
        if h.lower().startswith("session:"):
            return h.split(":", 1)[1].split(";")[0].strip()
    return None


# ───────────────────────────────────────────────────────────────────────────
# Session class
# ───────────────────────────────────────────────────────────────────────────
class DhRtspSession:
    """Iterable over DHAV-byte chunks pulled from a DH-RTSP session.

    Usage:
        with DhRtspSession(rtsp_url) as sess:
            for chunk in sess:
                ...
    """

    def __init__(self, rtsp_url: str, *, audio: bool = True,
                 connect_timeout: float = 20.0, read_timeout: float = 8.0,
                 play_range: str = "npt=0.000-", keepalive_s: float = 25.0):
        self.url = rtsp_url
        self.audio = audio
        self.play_range = play_range
        self._connect_timeout = connect_timeout
        self._read_timeout = read_timeout
        # Relay Dahua đóng session sau ~60s nếu không có keepalive → gửi
        # GET_PARAMETER định kỳ để giữ luồng sống (0 = tắt).
        self._keepalive_s = keepalive_s
        self._sk: socket.socket | None = None
        self._sid: str | None = None
        self._leftover = b""
        self._cseq = 100
        self._send_lock = threading.Lock()
        self._ka_stop = threading.Event()
        self._ka_thread: threading.Thread | None = None

    def __enter__(self):
        self._open()
        return self

    def __exit__(self, *exc):
        self.close()
        return False

    def _open(self) -> None:
        u = urllib.parse.urlparse(self.url)
        self._sk = socket.create_connection(
            (u.hostname, u.port or 554), timeout=self._connect_timeout)
        self._sk.settimeout(15.0)
        cseq = 1
        _send(self._sk, "OPTIONS", self.url, cseq); _recv_resp(self._sk); cseq += 1
        _send(self._sk, "DESCRIBE", self.url, cseq, {"Accept": "application/sdp"})
        _recv_resp(self._sk); cseq += 1
        _send(self._sk, "SETUP", self.url + "/trackID=0", cseq,
              {"Transport": "DH/RTP/TCP;unicast;interleaved=0-1"})
        hdrs, _, leftover = _recv_resp(self._sk); cseq += 1
        self._sid = _session_id(hdrs)
        if self.audio:
            _send(self._sk, "SETUP", self.url + "/trackID=1", cseq,
                  {"Transport": "DH/RTP/TCP;unicast;interleaved=2-3",
                   "Session": self._sid})
            _hdrs, _, leftover = _recv_resp(self._sk); cseq += 1
        _send(self._sk, "PLAY", self.url + "/", cseq,
              {"Session": self._sid, "Range": self.play_range})
        _hdrs, _, leftover = _recv_resp(self._sk); cseq += 1
        self._leftover = leftover
        self._cseq = cseq
        self._start_keepalive()

    def _start_keepalive(self) -> None:
        if not self._keepalive_s or self._keepalive_s <= 0:
            return
        self._ka_stop.clear()
        self._ka_thread = threading.Thread(target=self._keepalive_loop, daemon=True)
        self._ka_thread.start()

    def _keepalive_loop(self) -> None:
        # Relay Dahua (MTS/1.0) đóng session sau ~60s nếu không có keepalive.
        # GET_PARAMETER bị relay từ chối và đóng luôn kết nối → dùng OPTIONS
        # (đã kiểm chứng giữ luồng sống >90s). Response tới interleaved trong
        # luồng đọc và được __iter__ bỏ qua (không phải khung '$').
        while not self._ka_stop.wait(self._keepalive_s):
            sk = self._sk
            if sk is None:
                return
            try:
                with self._send_lock:
                    self._cseq += 1
                    _send(sk, "OPTIONS", self.url, self._cseq,
                          {"Session": self._sid or ""})
            except OSError:
                return

    def __iter__(self):
        """Yield DHAV byte chunks (RTP payloads with 12-byte header stripped)."""
        keep_channels = {0, 2} if self.audio else {0}
        buf = self._leftover
        self._sk.settimeout(self._read_timeout)
        try:
            while True:
                chunk = self._sk.recv(16384)
                if not chunk:
                    return
                buf += chunk
                # buf xen kẽ: khung RTP '$'-framed + đôi khi response RTSP của
                # keepalive (bắt đầu "RTSP/"). Xử lý cả hai, resync nếu lệch.
                while len(buf) >= 4:
                    if buf[0:1] == b"$":
                        ch = buf[1]
                        ln = int.from_bytes(buf[2:4], "big")
                        if len(buf) < 4 + ln:
                            break
                        pkt = buf[4:4 + ln]
                        buf = buf[4 + ln:]
                        if ch in keep_channels and len(pkt) > 12:
                            yield pkt[12:]
                    elif buf[:5] == b"RTSP/":
                        idx = buf.find(b"\r\n\r\n")
                        if idx < 0:
                            break
                        head = buf[:idx].decode("latin1", "ignore")
                        cl = 0
                        for line in head.split("\r\n"):
                            if line.lower().startswith("content-length:"):
                                try: cl = int(line.split(":", 1)[1].strip() or "0")
                                except ValueError: cl = 0
                        total = idx + 4 + cl
                        if len(buf) < total:
                            break
                        buf = buf[total:]
                    else:
                        d = buf.find(b"$", 1)
                        r = buf.find(b"RTSP/", 1)
                        cands = [i for i in (d, r) if i >= 0]
                        if not cands:
                            buf = buf[-3:]
                            break
                        buf = buf[min(cands):]
        except (socket.timeout, OSError):
            return

    def close(self) -> None:
        self._ka_stop.set()
        if self._sk is None:
            return
        try:
            with self._send_lock:
                _send(self._sk, "TEARDOWN", self.url, 99,
                      {"Session": self._sid or ""})
        except OSError:
            pass
        try:
            self._sk.close()
        except OSError:
            pass
        self._sk = None


# ───────────────────────────────────────────────────────────────────────────
# DH-HTTP tunnel client (SD-card playback)
# ───────────────────────────────────────────────────────────────────────────
class DhHttpSession:
    """Iterable over DHAV-byte chunks pulled from an HTTP-tunnelled DH stream.

    Why this exists: the SD-card playback URL returned by service 96600
    (`cm_getPlaybackTransferStreamUrlByTime`) — `…/vod/playback.rtpxav?…` —
    is NOT served over RTSP. The relay (`AEDA HTTP Server/1.0` on the SAME
    port 9132 as live RTSP) responds only to `GET … HTTP/1.0` with header
    `Accept: application/x-rtsp-tunnelled`.

    Wire format:
        HTTP/1.1 200 OK
        Content-Type: video/e-rtpxav
        Private-Length: <sdp-len>   ← SDP byte count after blank line
        Private-Type: application/sdp
        Range: npt=-0.001000-<end>
        Session-Id: <decimal>
        User-Agent: AEDA HTTP Server/1.0
        \r\n\r\n
        <SDP plaintext, Private-Length bytes>
        <interleaved binary frames>:
            $<channel:u8><length:u16-BE><RTP-12-byte-header><DHAV…>

    The chunk framing is identical to RTSP-over-TCP interleaved binary, so
    the same chunk yielder used by `DhRtspSession` applies."""

    def __init__(self, http_url: str, *, audio: bool = True,
                 connect_timeout: float = 20.0, read_timeout: float = 8.0,
                 user_agent: str = "EASY4IP",
                 wsse_user: str = "admin",
                 wsse_password: str | None = None):
        # Accept either rtsp://… or http://… URLs — the relay listens for an
        # HTTP request line regardless of what the cloud printed in front.
        self.url = http_url
        self.audio = audio
        self._connect_timeout = connect_timeout
        self._read_timeout = read_timeout
        self._ua = user_agent
        # WSSE UsernameToken — required by the relay for encrypt=3 streams.
        # `wsse_password` is the plaintext device password (admin creds).
        self._wsse_user = wsse_user
        self._wsse_pwd = wsse_password
        self._sk: socket.socket | None = None
        self._leftover = b""
        self.sdp: str = ""
        self.session_id: str | None = None

    def __enter__(self):
        self._open()
        return self

    def __exit__(self, *exc):
        self.close()
        return False

    def _open(self) -> None:
        u = urllib.parse.urlparse(self.url)
        host = u.hostname; port = u.port or 80
        path = u.path + (("?" + u.query) if u.query else "")
        self._sk = socket.create_connection(
            (host, port), timeout=self._connect_timeout)
        self._sk.settimeout(15.0)
        extra = ""
        if self._wsse_pwd:
            # WSSE UsernameToken — PasswordDigest = base64(SHA1(nonce + created + pwd))
            import base64 as _b64, hashlib as _h, secrets as _sec, time as _t
            nonce_hex = _sec.token_hex(16)              # 32 hex chars, like app
            created = _t.strftime("%Y-%m-%dT%H:%M:%SZ", _t.gmtime())
            digest = _b64.b64encode(
                _h.sha1((nonce_hex + created + self._wsse_pwd).encode()).digest()
            ).decode()
            extra = (
                f"Authorization: WSSE profile=\"UsernameToken\"\r\n"
                f"WSSE: UsernameToken Username=\"{self._wsse_user}\", "
                f"PasswordDigest=\"{digest}\", "
                f"Nonce=\"{nonce_hex}\", "
                f"Created=\"{created}\"\r\n"
            )
        req = (
            f"GET {path} HTTP/1.0\r\n"
            f"Host: {host}:{port}\r\n"
            f"User-Agent: {self._ua}\r\n"
            f"Accept: application/x-rtsp-tunnelled\r\n"
            f"Cache-Control: no-store\r\n"
            f"{extra}"
            f"\r\n"
        )
        self._sk.sendall(req.encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            c = self._sk.recv(4096)
            if not c:
                raise DhRtspError("relay closed before HTTP response complete")
            buf += c
        head, _, rest = buf.partition(b"\r\n\r\n")
        head_lines = head.decode(errors="replace").split("\r\n")
        status = head_lines[0] if head_lines else ""
        if " 200" not in status:
            raise DhRtspError(f"relay rejected playback request: {status!r}")
        sdp_len = 0
        for h in head_lines[1:]:
            if h.lower().startswith("private-length:"):
                sdp_len = int(h.split(":", 1)[1].strip())
            elif h.lower().startswith("session-id:"):
                self.session_id = h.split(":", 1)[1].strip()
        while len(rest) < sdp_len:
            c = self._sk.recv(4096)
            if not c:
                raise DhRtspError("relay closed before SDP complete")
            rest += c
        self.sdp = rest[:sdp_len].decode(errors="replace")
        self._leftover = rest[sdp_len:]

    def __iter__(self):
        """Yield DHAV byte chunks (RTP payloads with 12-byte header stripped)."""
        keep_channels = {0, 2} if self.audio else {0}
        buf = self._leftover
        self._sk.settimeout(self._read_timeout)
        try:
            while True:
                chunk = self._sk.recv(16384)
                if not chunk:
                    return
                buf += chunk
                while len(buf) >= 4 and buf[0:1] == b"$":
                    ch = buf[1]
                    ln = int.from_bytes(buf[2:4], "big")
                    if len(buf) < 4 + ln:
                        break
                    pkt = buf[4:4 + ln]
                    buf = buf[4 + ln:]
                    if ch in keep_channels and len(pkt) > 12:
                        yield pkt[12:]
        except (socket.timeout, OSError):
            return

    def close(self) -> None:
        if self._sk is None:
            return
        try:
            self._sk.close()
        except OSError:
            pass
        self._sk = None


# ───────────────────────────────────────────────────────────────────────────
# DHAV frame assembler + per-frame VOD decryptor
# ───────────────────────────────────────────────────────────────────────────
def decrypt_dhav_stream(chunks, key):
    """Take an iterable of DHAV-byte fragments (e.g. from DhHttpSession),
    assemble them into whole DHAV frames, decrypt each via
    `crypto.decrypt_vod_frame`, then yield the plaintext frames concatenated.

    ``key`` must match the stream's encryption mode:
      * 16-byte key (from ``vod_frame_key``)        → encrypt=2 frames
      * 32-byte key (from ``vod_frame_key_enc3``)   → encrypt=3 frames

    ``decrypt_vod_frame`` auto-detects the mode per frame from the ext_hdr.

    Designed to be plugged in between DhHttpSession iteration and ffmpeg stdin:
        with cam.open_playback(...) as sess:
            for chunk in decrypt_dhav_stream(sess, key):
                ffmpeg_proc.stdin.write(chunk)
    """
    import struct as _st
    from . import crypto as _C
    buf = b""
    for chunk in chunks:
        buf += chunk
        # Try to assemble whole frames from buf
        while True:
            i = buf.find(b"DHAV")
            if i < 0:
                # No magic yet — keep buffering (drop garbage prefix to bound mem)
                if len(buf) > 64:
                    buf = buf[-4:]
                break
            if i > 0:
                buf = buf[i:]    # drop pre-magic bytes
            if len(buf) < 24:
                break            # need at least header
            size = _st.unpack_from("<I", buf, 12)[0]
            if size < 32 or size > 64 * 1024 * 1024:
                # bogus size — skip past magic and try again
                buf = buf[4:]
                continue
            if len(buf) < size:
                break            # incomplete frame
            frame = buf[:size]
            buf = buf[size:]
            yield _C.decrypt_vod_frame(frame, key)
