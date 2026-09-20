"""
Geetest v4 solver via 2captcha.com.

Imou uses a hard-coded captcha_id (extracted from the Android app's
`CommonGT4GeetestManager`):

    525e9a21b667c698f924520f48669462

2captcha takes ~10-30 s to return a solution, costs ~$0.003 per solve.

Usage:
    from imou.captcha import solve_geetest4
    sol = solve_geetest4(api_key="...your 2captcha key...")
    # sol = {"captcha_id": ..., "lot_number": ..., "pass_token": ...,
    #        "gen_time": ..., "captcha_output": ...}
"""

from __future__ import annotations

import time
import requests


# Imou's Geetest v4 captcha_id (from CommonGT4GeetestManager.java)
IMOU_CAPTCHA_ID = "525e9a21b667c698f924520f48669462"
WEBSITE_URL = "https://www.easy4ipcloud.com"

API_BASE = "https://api.2captcha.com"


class CaptchaError(Exception):
    pass


def _create_task(api_key: str, captcha_id: str) -> int:
    body = {
        "clientKey": api_key,
        "task": {
            "type": "GeeTestTaskProxyless",
            "websiteURL": WEBSITE_URL,
            "version": 4,
            "initParameters": {"captcha_id": captcha_id},
        },
    }
    r = requests.post(f"{API_BASE}/createTask", json=body, timeout=30).json()
    if r.get("errorId") != 0:
        raise CaptchaError(f"createTask: {r.get('errorCode')} — {r.get('errorDescription')}")
    return r["taskId"]


def _get_result(api_key: str, task_id: int,
                poll_interval: float = 5.0, timeout: float = 180.0) -> dict:
    body = {"clientKey": api_key, "taskId": task_id}
    deadline = time.time() + timeout
    # First wait ~10 s — Geetest v4 rarely finishes earlier
    time.sleep(min(10.0, poll_interval * 2))
    while time.time() < deadline:
        r = requests.post(f"{API_BASE}/getTaskResult", json=body, timeout=30).json()
        if r.get("errorId") != 0:
            raise CaptchaError(f"getTaskResult: {r.get('errorCode')} — {r.get('errorDescription')}")
        if r.get("status") == "ready":
            return r["solution"]
        time.sleep(poll_interval)
    raise CaptchaError("timed out waiting for 2captcha solution")


def solve_geetest4(api_key: str, captcha_id: str = IMOU_CAPTCHA_ID,
                   timeout: float = 180.0) -> dict:
    """Block until 2captcha returns a Geetest v4 solution. ~10-30 s typical.

    Returns a dict with keys:
        captcha_id, lot_number, pass_token, gen_time, captcha_output
    """
    task_id = _create_task(api_key, captcha_id)
    return _get_result(api_key, task_id, timeout=timeout)
