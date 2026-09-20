"""Low-level signed HTTPS POST helper for the SaaS API (/pcs/v1/*)."""

from __future__ import annotations

import json
from dataclasses import dataclass

import requests

from . import crypto as C


@dataclass
class AuthCtx:
    username: str            # e.g. "uuid\\<id>" or "account\\<phone>"
    key: str                 # HMAC key (raw token for some calls, md5(token) for uuid auth)
    apiver: str = "191204"
    session_id: str | None = None


USER_AGENT = "Dalvik/2.1.0 (Linux; U; Android 13; sdk_gphone64_arm64 Build/TE1A.240213.009)"


def call(host: str, method_path: str, data: dict, auth: AuthCtx,
         timeout: float = 30.0) -> dict:
    """One signed POST. Returns parsed JSON response."""
    uri = f"/pcs/v1/{method_path}"
    url = f"https://{host}{uri}"

    body_text = json.dumps({"data": data}, separators=(",", ":"))
    body = body_text.encode()
    content_md5 = C.md5_b64(body)
    content_type = "application/json"
    date = C.iso_utc_now()
    nonce = C.rand_nonce()
    ua = C.client_ua_b64()

    string_to_sign = C.sign_saas_string(
        "POST", uri, content_md5, content_type, auth.apiver, ua, date, nonce,
        auth.username, session_id=auth.session_id,
    )
    sig = C.hmac_sha256_b64(auth.key, string_to_sign)

    headers = {
        "Content-Type": content_type,
        "Content-MD5": content_md5,
        "x-pcs-apiver": auth.apiver,
        "x-pcs-client-ua": ua,
        "x-pcs-date": date,
        "x-pcs-nonce": nonce,
        "x-pcs-username": auth.username,
        "x-pcs-signature": sig,
        "User-Agent": USER_AGENT,
    }
    if auth.session_id:
        headers["x-pcs-session-id"] = auth.session_id

    r = requests.post(url, data=body, headers=headers, timeout=timeout)
    return r.json()
