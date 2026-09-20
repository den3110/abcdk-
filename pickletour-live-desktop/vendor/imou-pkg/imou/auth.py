"""
Auth pipeline (4 steps) + session persistence.

Login flow (per app's reverse-engineered behaviour):

    Step 1: user.account.GetToken   (account\\{phone}, key=password)
            ↳ may return code 12114 → need OTP credit (continue to step 2-3)
            ↳ may return code 12112 → first-time login (continue to step 2-3)
            ↳ may return code 10000 with sessionId → already granted, skip 2-3

    Step 2: common.validcode.GetValidCode  (default\\AppKey, key=AppSecret)
            ↳ sends SMS OTP to phone

    Step 3: user.account.GrantingCredit    (default\\AppKey, key=AppSecret)
            ↳ exchanges OTP for credit grant

    Step 4: user.account.GetToken  (account\\{phone}, key=password) — again
            ↳ now returns {username (uuid), token, sessionId, entryUrlV2}

    Step 5: user.account.Login (regional host, key=raw token, apiver 56906)
            ↳ returns MQTT credentials, push tokens, etc.

⚠ KNOWN LIMITATION — captcha gate
    On some regions/accounts the very first GetToken returns code 12114
    "need geetest4 captcha". The Imou Life Android app solves this via its
    embedded Geetest SDK, then completes step 4 normally. To bootstrap a
    session for this library without an Android emulator, you may need to
    capture a fresh GetToken response via mitmproxy from the app once; after
    that the OTP-based flow works headless from Python until session expiry.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict
from pathlib import Path

from . import crypto as C
from ._http import call, AuthCtx

ENTRY_HOST = "app-v2.easy4ipcloud.com"
DEFAULT_SESSION_PATH = Path(
    os.environ.get("IMOU_SESSION", "~/.imou-session.json")
).expanduser()


class AuthError(Exception):
    pass


# ───────────────────────────────────────────────────────────────────────────
# Pipeline primitives
# ───────────────────────────────────────────────────────────────────────────
def _get_token(phone: str, area_code: str, password: str) -> dict:
    # Verified by MITM of the real app: username=account\<phone>, apiver=56906,
    # body carries areaCode + gpsInfo. After a successful CheckGeeTest4 the
    # server marks this terminal as captcha-passed and a repeat GetToken
    # returns {username, token, sessionId, entryUrlV2} with no token echoed
    # in the request.
    # account\ key = md5_hex(md5_hex(password))  (double MD5) — verified vs captured sig.
    return call(ENTRY_HOST, "user.account.GetToken", {
        "areaCode": area_code,
        "gpsInfo": {"latitude": 0, "longitude": 0},
    }, AuthCtx(username=f"account\\{phone}",
               key=C.md5_hex(C.md5_hex(password)), apiver="56906"))


def _send_otp(phone: str, area_code: str, access_token: str = "") -> dict:
    body = {
        "account": phone, "areaCode": area_code,
        "extraSendOptions": [], "isUserSelected": False,
        "type": "phone", "usage": "GrantingCredit",
    }
    if access_token:
        body["accessToken"] = access_token
    return call(ENTRY_HOST, "common.validcode.GetValidCode", body,
                AuthCtx(username=f"default\\{C.APP_KEY}",
                        key=C.md5_hex(C.APP_SECRET), apiver="56906"))


def _check_geetest4(phone: str, usage: str, solution: dict,
                    captcha_meta_data: str = "") -> dict:
    """POST common.validcode.CheckGeeTest4 with the Geetest v4 solution.
    Returns the parsed response. On success, `data.token` is the accessToken
    you should pass to the next GetValidCode call.

    `captcha_meta_data` should be the JSON string Imou returned in the
    GetToken 12114 response (data.captchaMetaData)."""
    body = {
        "account": phone,
        "usage": usage,
        "captchaId": solution["captcha_id"],
        "captchaMetaData": captcha_meta_data,
        "captchaOutput": solution["captcha_output"],
        "genTime": solution["gen_time"],
        "lotNumber": solution["lot_number"],
        "passToken": solution["pass_token"],
    }
    return call(ENTRY_HOST, "common.validcode.CheckGeeTest4", body,
                AuthCtx(username=f"default\\{C.APP_KEY}",
                        key=C.md5_hex(C.APP_SECRET), apiver="152485"))


def _grant(phone: str, area_code: str, otp: str) -> dict:
    return call(ENTRY_HOST, "user.account.GrantingCredit", {
        "account": phone, "areaCode": area_code,
        "type": "phone", "validCode": otp,
    }, AuthCtx(username=f"default\\{C.APP_KEY}",
               key=C.md5_hex(C.APP_SECRET), apiver="185612"))


def _regional_login(regional_host: str, uuid: str, token: str,
                    session_id: str) -> dict:
    """Stage-5 ping that returns MQTT keys + push tokens etc."""
    auth = AuthCtx(username=f"uuid\\{uuid}", key=token,
                   apiver="56906", session_id=session_id)
    return call(regional_host, "user.account.Login",
                {"timezoneOffset": 25200}, auth)


# ───────────────────────────────────────────────────────────────────────────
# Public API
# ───────────────────────────────────────────────────────────────────────────
def _normalize_phone(phone: str, area_code: str) -> str:
    """Strip leading 0 when an area code is supplied (Imou expects 84+824… not 84+0824…)."""
    if area_code and phone.startswith("0"):
        return phone.lstrip("0")
    return phone


_BOOTSTRAP_HINT = (
    "\n\nBOOTSTRAP via Android app required (one-time):\n"
    "  1. Install Imou Life on a phone/emulator and log in (it solves the\n"
    "     captcha via its embedded Geetest SDK).\n"
    "  2. Capture the response of POST /pcs/v1/user.account.GetToken with\n"
    "     mitmproxy/Frida.\n"
    "  3. Run `imou import-session ./capture.json` (the JSON should contain\n"
    "     username, token, sessionId, entryUrlV2 — top-level or nested under\n"
    "     `data:`)."
)


def _solve_and_check_captcha(phone: str, area_code: str, two_captcha_key: str,
                             solver: str = "proxyless") -> None:
    """Solve Geetest v4 (2captcha) and pass CheckGeeTest4 to mark this terminal
    captcha-verified. account = areaCode+phone, captchaMetaData = "".

    solver="proxyless" (default) = 2captcha proxyless solve (fast, h5 — ACCEPTED
    by Imou once signed with the correct md5(AppSecret) key). solver="browser"
    runs the widget locally + 2captcha CoordinatesTask.
    """
    if solver == "browser":
        from .geetest_solver import solve_geetest4_browser
        sol = solve_geetest4_browser(two_captcha_key=two_captcha_key, headless=True)
    else:
        from .captcha import solve_geetest4
        sol = solve_geetest4(two_captcha_key)

    r = _check_geetest4(area_code + phone, "Login", sol, "")
    if r.get("code") != 10000 or not r.get("data", {}).get("token"):
        raise AuthError(f"CheckGeeTest4 failed: code={r.get('code')} desc={r.get('desc')}")


def login(phone: str, area_code: str, password: str,
          session_path: Path | None = None,
          two_captcha_key: str | None = None,
          solver: str = "proxyless", max_captcha_tries: int = 3) -> dict:
    """Full HEADLESS login → persist + return session.

    Flow (verified against the real app):
        GetToken → 12114 → solve captcha → CheckGeeTest4 → GetToken → session → Login

    `two_captcha_key`: 2captcha.com API key to auto-solve the Geetest v4 gate.
    Without it, captcha-gated accounts raise AuthError. No OTP/SMS needed.

    Signing keys (all reverse-engineered):
        account\\<phone>  → md5(md5(password))
        default\\<AppKey> → md5(AppSecret)
        uuid\\<id>        → raw token (Login) / md5(token) (data APIs)
    """
    phone = _normalize_phone(phone, area_code)

    r = _get_token(phone, area_code, password)
    code = r.get("code")
    if code == 12000:
        raise AuthError(
            f"GetToken 12000 (invalid phone format?). account='{phone}' "
            f"areaCode='{area_code}'. Bỏ số 0 đầu khi có area-code.")

    tries = 0
    # GetToken may return 12114 (captcha) or 10000+{failNum} (soft) until the
    # terminal is captcha-verified. Loop solving until we get a session.
    while not r.get("data", {}).get("sessionId"):
        if not two_captcha_key:
            raise AuthError("GetToken needs Geetest captcha. Pass two_captcha_key=..."
                            + _BOOTSTRAP_HINT)
        if tries >= max_captcha_tries:
            raise AuthError(f"No session after {tries} captcha solves "
                            f"(last code={r.get('code')} data={r.get('data')}). "
                            "Wrong password? (failNum increments on bad password).")
        tries += 1
        _solve_and_check_captcha(phone, area_code, two_captcha_key, solver)
        r = _get_token(phone, area_code, password)

    token_data = r["data"]

    uuid_user = token_data["username"]
    uuid_key = token_data["token"]
    session_id = token_data["sessionId"]
    regional_host = (token_data["entryUrlV2"]
                     .replace("https://", "").replace(":443", "").rstrip("/"))

    r5 = _regional_login(regional_host, uuid_user, uuid_key, session_id)

    sess = {
        "uuid_user": uuid_user,
        "uuid_key": uuid_key,
        "session_id": session_id,
        "regional_host": regional_host,
        "login_response": r5.get("data", {}),
    }
    save_session(sess, session_path)
    return sess


def save_session(sess: dict, path: Path | None = None) -> None:
    (path or DEFAULT_SESSION_PATH).write_text(json.dumps(sess, indent=2))


def import_session(raw: dict, session_path: Path | None = None) -> dict:
    """Build & persist a session from a captured `user.account.GetToken`
    response (or any dict that contains the same keys).

    Accepts either:
      - the full envelope:    {"code": 10000, "data": {username, token, ...}}
      - the inner data:       {username, token, sessionId, entryUrlV2}
      - or the already-built shape used by this library
        {uuid_user, uuid_key, session_id, regional_host}
    """
    if "data" in raw and isinstance(raw["data"], dict):
        raw = raw["data"]

    uuid_user = raw.get("uuid_user") or raw.get("username")
    uuid_key = raw.get("uuid_key") or raw.get("token")
    session_id = raw.get("session_id") or raw.get("sessionId")
    host = raw.get("regional_host") or raw.get("entryUrlV2")

    missing = [k for k, v in (("username", uuid_user), ("token", uuid_key),
                              ("sessionId", session_id),
                              ("entryUrlV2", host)) if not v]
    if missing:
        raise AuthError(f"missing fields in captured session: {', '.join(missing)}")

    host = host.replace("https://", "").replace(":443", "").rstrip("/")
    sess = {
        "uuid_user": uuid_user,
        "uuid_key": uuid_key,
        "session_id": session_id,
        "regional_host": host,
        "login_response": raw.get("login_response", {}),
    }
    save_session(sess, session_path)
    return sess


def load_session(path: Path | None = None) -> dict | None:
    p = path or DEFAULT_SESSION_PATH
    if not p.exists():
        return None
    return json.loads(p.read_text())


def uuid_auth(sess: dict, apiver: str = "191204") -> AuthCtx:
    """Build AuthCtx for `uuid\\<id>` HTTPS calls — HMAC key = MD5_hex(token)."""
    return AuthCtx(
        username=f"uuid\\{sess['uuid_user']}",
        key=C.md5_hex(sess["uuid_key"]),
        apiver=apiver,
        session_id=sess.get("session_id"),
    )
