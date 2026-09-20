"""High-level Client + Camera object."""

from __future__ import annotations

import html
import os
import subprocess
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional, Union

from ._http import call
from .auth import load_session, uuid_auth, AuthError
from .dh_rtsp import DhRtspSession, DhHttpSession, decrypt_dhav_stream

TimeLike = Union[datetime, str, int, float]


def _fmt_playback_time(t: TimeLike) -> str:
    """Format time as the cloud's playback parameter expects: yyyy_MM_dd_HH_mm_ss
    (UNDERSCORES — verified by MITM of the real app). Accepts datetime, an
    already-formatted string, or epoch seconds."""
    if isinstance(t, str):
        if "_" in t and len(t) == 19:
            return t
        if "T" in t:
            t = datetime.fromisoformat(t)
        else:
            t = datetime.fromisoformat(t.replace(" ", "T"))
    if isinstance(t, (int, float)):
        t = datetime.fromtimestamp(t)
    return t.strftime("%Y_%m_%d_%H_%M_%S")


def _fmt_records_time(t: TimeLike) -> str:
    """Format time for GetLocalRecords: yyyyMMddTHHmmss."""
    if isinstance(t, str):
        if "T" in t and len(t) == 15 and t.count("T") == 1:
            return t
        if "T" in t:
            t = datetime.fromisoformat(t)
        else:
            t = datetime.fromisoformat(t.replace(" ", "T"))
    if isinstance(t, (int, float)):
        t = datetime.fromtimestamp(t)
    return t.strftime("%Y%m%dT%H%M%S")


@dataclass
class Camera:
    device_id: str
    product_id: str
    name: str
    model: str
    _client: "Client"

    # ── live stream ──────────────────────────────────────────────────────
    def stream_url(self, quic: bool = False) -> str:
        """Return a fresh RTSP relay URL (expires in ~10 min).

        The URL is RTSP but the server REQUIRES `Transport: DH/RTP/TCP`
        on SETUP. Use Camera.open_rtsp() or DhRtspSession to consume it.
        """
        s = self._client.session
        r = call(s["regional_host"], "things.media.GetRealTransferStreamUrl", {
            "deviceId": self.device_id,
            "productId": self.product_id,
            "channelId": "0",
            # streamId 0 = luồng chính (HD, hay 2K H.265 — nặng relay); 1 = luồng
            # phụ (SD/H.264, nhẹ → relay đẩy kịp realtime). Chọn qua env IMOU_STREAM_ID.
            "streamId": os.environ.get("IMOU_STREAM_ID", "0"),
            "type": "0", "encrypt": "0", "assistStream": "0",
            "quic": "1" if quic else "0",
            "design": "live", "skipAuth": "0",
            "videoLimit": 0, "imageSize": 0, "talkType": "0",
            "owner": s["uuid_user"], "ownerType": "0",
            "windowNum": "1", "timeLimit": False,
        }, uuid_auth(s, "197891"))
        if r.get("code") != 10000:
            raise RuntimeError(f"GetRealTransferStreamUrl failed: {r}")
        return r["data"]["resource"]

    def open_rtsp(self, with_audio: bool = True) -> DhRtspSession:
        """Open a DH-RTSP session yielding DHAV byte chunks."""
        return DhRtspSession(self.stream_url(), audio=with_audio)

    # ── convenience helpers built on top ─────────────────────────────────
    def snapshot(self, out_path: str | Path, *, timeout: float = 30.0) -> None:
        """Save a single JPEG snapshot using ffmpeg's dhav demuxer."""
        with self.open_rtsp(with_audio=False) as rtsp:
            cmd = [
                "ffmpeg", "-y", "-loglevel", "error",
                "-f", "dhav", "-i", "pipe:0",
                "-frames:v", "1", "-update", "1",
                str(out_path),
            ]
            proc = subprocess.Popen(cmd, stdin=subprocess.PIPE,
                                     stderr=subprocess.DEVNULL)
            try:
                for chunk in rtsp:
                    try:
                        proc.stdin.write(chunk)
                    except (BrokenPipeError, OSError):
                        break
                    if proc.poll() is not None:
                        break
            finally:
                try: proc.stdin.close()
                except OSError: pass
                proc.wait(timeout=timeout)

    # ── SD-card playback ─────────────────────────────────────────────────
    def list_recordings(self, begin: TimeLike, end: TimeLike, *,
                        rec_type: int = 0, limit: int = 300,
                        max_pages: int = 30) -> list[dict]:
        """List continuous SD-card recording segments between `begin` and `end`.

        Uses **`iot.control.SetService`** → service 24100 — the exact method the
        official Imou app uses (verified by MITM on legacy device hồ phải).

        ⚠️ This replaces the old `SetIotService` call which returned server error
        **10003** on legacy LeChange devices (`productId == ''`). Key fixes vs the
        old version:
          - method `SetService` (NOT `SetIotService`)
          - `24102` = **END** time, `24103` = **BEGIN** time (the old code had them
            swapped)
          - no `24106`–`24109` fields (the app doesn't send them)
          - pagination via `24104` cursor ← `24121` from the previous page

        Time format: yyyyMMddTHHmmss (datetime / epoch / str all accepted).
        Returns newest-first list of dicts:
            {path, begin_time, end_time, size, type, _raw}
        where `path` is the on-SD file e.g.
            /mnt/sd/2026-06-02/001/dav/22/22.25.00-22.26.33[M][0@0][0].dav
        """
        s = self._client.session
        out_records: list[dict] = []
        cursor = ""                      # 24104: empty first; then 24121 of prev page
        seen_cursors: set[str] = set()
        for _ in range(max_pages):
            r = call(s["regional_host"], "iot.control.SetService", {
                "channelId": 0,
                "deviceId": self.device_id,
                "groupControlFlg": "",
                "productId": self.product_id,
                "service": "24100",
                "inputData": {
                    "24101": int(rec_type),                  # 0 = all types
                    "24102": _fmt_records_time(end),         # NOTE: 24102 = END
                    "24103": _fmt_records_time(begin),       #       24103 = BEGIN
                    "24104": cursor,                         # pagination cursor
                    "24105": limit,
                },
                "keepAlive": False, "qos": 1, "timeout": 0,
            }, uuid_auth(s, "191204"))
            if r.get("code") != 10000:
                raise RuntimeError(f"list_recordings (SetService 24100) failed: {r}")
            out = (r.get("data") or {}).get("outputData") or {}
            page = out.get("24124") or []
            for rec in page:
                if not isinstance(rec, dict):
                    continue
                out_records.append({
                    "path": rec.get("24161"),
                    "begin_time": rec.get("24165"),
                    "end_time": rec.get("24166"),
                    "size": rec.get("24162"),      # bytes
                    "type": rec.get("24163"),      # 2 = motion, etc.
                    "_raw": rec,
                })
            cursor = str(out.get("24121") or "")
            # Stop on: empty page, no/duplicate cursor, or short (last) page.
            if not page or len(page) < limit or not cursor or cursor in seen_cursors:
                break
            seen_cursors.add(cursor)
        return out_records

    def list_event_recordings(self, begin: TimeLike, end: TimeLike, *,
                              limit: int = 100, max_pages: int = 30) -> list[dict]:
        """List SD-card **event/alarm** recordings (motion clips with thumbnails)
        between `begin` and `end`.

        Uses `iot.control.SetService` → service 90800 (verified by MITM on hồ
        phải). Returns newest-first list of dicts:
            {record_id, alarm_id, time, title, event_code, duration, thumbnail, _raw}
        `record_id` (e.g. ``1a8323be...._sd_7``) is the token you pass to a
        by-file playback (service 96700). `thumbnail` is a signed JPEG URL.
        """
        s = self._client.session
        events: list[dict] = []
        cursor = -1                       # 90803: -1 first; then last alarmId
        cursor_time = ""                  # 90809: last record's time
        for _ in range(max_pages):
            r = call(s["regional_host"], "iot.control.SetService", {
                "channelId": 0,
                "deviceId": self.device_id,
                "groupControlFlg": "",
                "productId": self.product_id,
                "service": "90800",
                "inputData": {
                    "90801": _fmt_records_time(begin),
                    "90802": _fmt_records_time(end),
                    "90803": cursor,
                    "90804": -1,
                    "90805": limit,
                    "90809": cursor_time,
                },
                "keepAlive": False, "qos": 1, "timeout": 0,
            }, uuid_auth(s, "191204"))
            if r.get("code") != 10000:
                raise RuntimeError(f"list_event_recordings (SetService 90800) failed: {r}")
            out = (r.get("data") or {}).get("outputData") or {}
            page = out.get("90822") or []
            for rec in page:
                if not isinstance(rec, dict):
                    continue
                events.append({
                    "record_id": rec.get("90861"),          # token for by-file playback
                    "alarm_id": rec.get("90863") or rec.get("90864"),
                    "time": rec.get("90869"),
                    "title": rec.get("90875"),              # e.g. "Human Detected"
                    "event_code": rec.get("90882"),         # e.g. "32100"
                    "duration": rec.get("90868"),           # seconds
                    "thumbnail": rec.get("90873"),          # signed JPEG URL
                    "_raw": rec,
                })
            if not page or len(page) < limit:
                break
            last = page[-1]
            cursor = last.get("90863") or -1
            cursor_time = last.get("90869") or ""
        return events

    def verify_password(self, *, opt_type: str = "0") -> dict:
        """Send device username/password (re-encrypted) via service 94400.

        Required before SD playback (96600) on most firmware — the cloud
        relay rejects the VOD URL with 500 until this is in flight."""
        from . import crypto as C
        creds = self._client.device_password(self.device_id, self.product_id)
        key = C.device_aes_key(self.device_id)
        s = self._client.session
        r = call(s["regional_host"], "iot.control.SetIotService", {
            "deviceId": self.device_id,
            "productId": self.product_id,
            "channelId": "0",
            "service": "94400",
            "inputData": {
                "94401": C.aes_cbc_encrypt(creds["username"], key=key),
                "94402": C.aes_cbc_encrypt(creds["password"], key=key),
                "94403": opt_type,
            },
        }, uuid_auth(s, "191204"))
        if r.get("code") != 10000:
            raise RuntimeError(f"VerifyPassword (94400) failed: {r}")
        return r

    def playback_url(self, begin: TimeLike, end: TimeLike, *,
                     stream_id: str = "0", encrypt: int = 2,
                     file_type: int = 1, quic: bool = False,
                     verify_password: bool = True) -> str:
        """Resolve a playback RTSP URL for an SD-card segment.

        Flow (verified):
            VerifyPassword (94400, if requested)
              → SetIotService service=96600 (cm_getPlaybackTransferStreamUrlByTime)
              → outputData[96621] = relay host + path (no rtsp:// prefix, html-escaped)

        The URL returned is a fully-qualified rtsp:// URL with HTML entities
        decoded; consume it with `DhRtspSession(url, play_range="npt=0.000000-")`.

        ``encrypt``: cipher mode requested from the cloud relay. Valid:
          * 0 — plain (server returns 500 unless WSSE-authed).
          * 2 — light-AES (0x95 ext, AES-128-ECB on first 256B); see
            :func:`imou.crypto.vod_frame_key`. **Default** because the
            relay accepts simple GETs without WSSE.
          * 3 — AES-256-GDPR2 (0xb5 ext carries the per-session-id IV);
            decryptable via :func:`imou.crypto.vod_frame_key_enc3` +
            AES-256-CTR on first 512B. The relay typically rejects this
            stream without WSSE auth (PasswordDigest from devPwd) — see
            :class:`imou.dh_rtsp.DhHttpSession` ``wsse_password``.
        """
        if verify_password:
            self.verify_password()

        s = self._client.session
        body = {
            "deviceId": self.device_id,
            "productId": self.product_id,
            "channelId": "0",
            "service": "96600",
            "inputData": {
                "96601": stream_id,
                "96602": _fmt_playback_time(begin),
                "96603": _fmt_playback_time(end),
                "96604": encrypt,
                "96605": "PBSV1",
                "96608": "1" if quic else "0",
                "96609": file_type,
            },
        }
        r = call(s["regional_host"], "iot.control.SetIotService", body,
                 uuid_auth(s, "191204"))
        if r.get("code") != 10000:
            raise RuntimeError(f"GetPlaybackTransferStreamUrlByTime (96600) failed: {r}")
        out = (r.get("data") or {}).get("outputData") or r.get("data") or {}
        raw = out.get("96621") or out.get("resource")
        if not raw:
            raise RuntimeError(f"96600 returned no resource URL: {r}")
        # Server escapes `&` as `&amp;` in the JSON — decode before use.
        url = html.unescape(raw)
        if not url.startswith("rtsp://"):
            url = "rtsp://" + url.lstrip("/")
        return url

    def open_playback(self, begin: TimeLike, end: TimeLike, *,
                      with_audio: bool = True, **kw) -> DhHttpSession:
        """Open a DH-HTTP session for an SD-card playback segment.

        The SD-card relay (`AEDA HTTP Server/1.0` on port 9132) only serves
        playback over HTTP-tunnel — `GET … HTTP/1.0` with
        `Accept: application/x-rtsp-tunnelled` — even though the URL the
        cloud returns is prefixed with `rtsp://`. We hand the URL to
        `DhHttpSession` which strips the scheme and speaks HTTP.

        For ``encrypt=3``, a WSSE UsernameToken header is required; we attach
        the device password automatically."""
        encrypt = int(kw.get("encrypt", 2))
        url = self.playback_url(begin, end, **kw)
        wsse_pwd = self._dev_pwd() if encrypt == 3 else None
        return DhHttpSession(url, audio=with_audio, wsse_password=wsse_pwd)

    def save_playback(self, out_path: str | Path, begin: TimeLike, end: TimeLike,
                      *, with_audio: bool = True, max_seconds: int = 600,
                      decrypt: bool = True, **kw) -> None:
        """Pipe a playback segment through ffmpeg (dhav demuxer) to a file.

        ``decrypt`` (default True) decrypts the encrypted header bytes of each
        DHAV frame. The key class (encrypt=2 vs encrypt=3) is derived from the
        ``encrypt`` kwarg passed through to :meth:`playback_url`:
          * encrypt=2 → 16-byte AES-128 key, ECB on first 256B (default)
          * encrypt=3 → 32-byte AES-256 key, CTR on first 512B
        """
        from . import crypto as C
        encrypt = int(kw.get("encrypt", 2))
        if encrypt == 3:
            key = C.vod_frame_key_enc3(self.device_id, self._dev_pwd())
        else:
            key = C.vod_frame_key(self.device_id, self._dev_pwd())
        with self.open_playback(begin, end, with_audio=with_audio, **kw) as rtsp:
            stream = decrypt_dhav_stream(rtsp, key) if decrypt else rtsp
            cmd = [
                "ffmpeg", "-y", "-loglevel", "error",
                "-f", "dhav", "-i", "pipe:0",
                "-t", str(max_seconds),
                "-c", "copy",
                str(out_path),
            ]
            proc = subprocess.Popen(cmd, stdin=subprocess.PIPE,
                                     stderr=subprocess.DEVNULL)
            try:
                for chunk in stream:
                    try:
                        proc.stdin.write(chunk)
                    except (BrokenPipeError, OSError):
                        break
                    if proc.poll() is not None:
                        break
            finally:
                try: proc.stdin.close()
                except OSError: pass
                proc.wait()

    def _dev_pwd(self) -> str:
        """Cached decrypted device password for this cam."""
        if not hasattr(self, "_cached_pwd"):
            self._cached_pwd = self._client.device_password(
                self.device_id, self.product_id)["password"]
        return self._cached_pwd

    def record(self, out_path: str | Path, *, seconds: int = 10,
               with_audio: bool = True) -> None:
        """Record `seconds` of stream into a file (mp4/mkv/ts inferred from ext)."""
        with self.open_rtsp(with_audio=with_audio) as rtsp:
            cmd = [
                "ffmpeg", "-y", "-loglevel", "error",
                "-f", "dhav", "-i", "pipe:0",
                "-t", str(seconds),
                "-c", "copy",
                str(out_path),
            ]
            proc = subprocess.Popen(cmd, stdin=subprocess.PIPE,
                                     stderr=subprocess.DEVNULL)
            try:
                for chunk in rtsp:
                    try:
                        proc.stdin.write(chunk)
                    except (BrokenPipeError, OSError):
                        break
                    if proc.poll() is not None:
                        break
            finally:
                try: proc.stdin.close()
                except OSError: pass
                proc.wait()


class Client:
    """Top-level API wrapper. Loads the persisted session by default."""

    def __init__(self, session: dict | None = None):
        self.session = session or load_session()
        if self.session is None:
            raise AuthError("No session — run imou.login() or `imou login` first.")

    # ── devices ──────────────────────────────────────────────────────────
    def _device_list_raw(self) -> dict:
        return call(self.session["regional_host"], "device.list.BasicList", {
            "familyId": "-1", "limit": 128, "offset": 0,
            "roomId": "-1", "transferStr": "",
        }, uuid_auth(self.session, "191204"))

    def devices(self) -> list[Camera]:
        """List cameras. Skips entries that don't expose a `productId` in the
        BasicList response (older firmware shapes). Use `device(id, product_id=...)`
        if you have a known mapping for those."""
        r = self._device_list_raw()
        if r.get("code") != 10000:
            raise RuntimeError(f"BasicList failed: {r.get('desc')}")
        cams = []
        for d in r["data"]["deviceList"]:
            if not d.get("channelList"):
                continue
            ch0 = d["channelList"][0]
            # Legacy (lechange-brand) devices expose no productId — the cloud
            # relay accepts an EMPTY productId for them, so keep them with "".
            pid = ch0.get("productId") or ""
            cams.append(Camera(
                device_id=d["deviceId"],
                product_id=pid,
                name=d.get("deviceName") or ch0.get("channelName", d["deviceId"]),
                model=d.get("deviceModel") or d.get("productModel", ""),
                _client=self,
            ))
        return cams

    def device(self, device_id: str) -> Camera:
        for cam in self.devices():
            if cam.device_id == device_id:
                return cam
        raise KeyError(f"device {device_id} not in this account")

    # ── device credential decrypt (optional) ─────────────────────────────
    def device_password(self, device_id: str, product_id: str) -> dict:
        """Return decrypted {username, password} for direct local SDK access.

        Crypto: AES-256-CBC, PKCS7, IV = DEVICE_AES_IV, KEY =
        md5_hex_lower(devSn.upper() + "DAHUAKEY") — verified live on cam
        5858CBDPSF15233 (admin / L28F4128)."""
        from . import crypto as C
        r = call(self.session["regional_host"], "iot.control.DevicePasswordGet", {
            "deviceId": device_id, "productId": product_id, "channelId": "0",
        }, uuid_auth(self.session, "191204"))
        if r.get("code") != 10000:
            raise RuntimeError(f"DevicePasswordGet: {r.get('desc')}")
        key = C.device_aes_key(device_id)
        return {
            "username": C.aes_cbc_decrypt(r["data"]["deviceUsername"], key=key),
            "password": C.aes_cbc_decrypt(r["data"]["devicePassword"], key=key),
        }
