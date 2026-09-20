"""
Browser-based Geetest v4 solver (Playwright + 2captcha CoordinatesTask).

WHY: Imou binds each captcha to a server-issued verifyToken/requestId and
validates the solved lot_number against Geetest from the *requesting* client.
A 2captcha *proxyless* solve happens on 2captcha's own IP/session, so Imou's
CheckGeeTest4 rejects it (code 12000). The fix is a hybrid:

    * Run the real Geetest widget in a local headless browser → the challenge
      lot is created on OUR IP.
    * The puzzle Imou serves is a Geetest v4 "icon/shape-match" (drag the
      translucent piece onto the matching shape among distractors). Pure
      heuristics can't pick the right shape, so we screenshot the puzzle and
      ask 2captcha's CoordinatesTask where the matching shape is.
    * Drag the slider in OUR browser to that x with a human-like trajectory.
    * Geetest validates in-browser (our IP) → the returned token validates
      against Imou.

Public API:
    solve_geetest4_browser(captcha_id, two_captcha_key, headless=True) -> dict
        returns {captcha_id, lot_number, pass_token, gen_time, captcha_output}
"""

from __future__ import annotations

import contextlib
import functools
import io
import math
import random
import socket
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .captcha import IMOU_CAPTCHA_ID

_HARNESS_DIR = Path(__file__).parent
_HARNESS_NAME = "_geetest_harness.html"


@contextlib.contextmanager
def _serve_harness():
    """Serve the harness over HTTP so Geetest's protocol-relative URLs
    (//gcaptcha4.geetest.com/...) resolve to https, not file://."""
    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass

    srv = ThreadingHTTPServer(("127.0.0.1", 0),
                              functools.partial(Quiet, directory=str(_HARNESS_DIR)))
    port = srv.server_address[1]
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    try:
        yield f"http://127.0.0.1:{port}/{_HARNESS_NAME}"
    finally:
        srv.shutdown()


class GeetestSolveError(Exception):
    pass


# ───────────────────────────────────────────────────────────────────────────
# 2captcha CoordinatesTask — recognise the matching shape in our screenshot
# ───────────────────────────────────────────────────────────────────────────
_COORD_COMMENT = (
    "Geetest slider puzzle. A translucent puzzle piece (a star/shape) sits at "
    "the far LEFT. Click the location in the image where that SAME shape "
    "appears among the other objects (ignore differently-shaped distractors). "
    "Return the centre of the matching shape."
)


def _solve_coordinates(api_key: str, png_bytes: bytes, comment: str = _COORD_COMMENT,
                       timeout: float = 120.0) -> tuple[int, int]:
    import base64
    import requests

    b64 = base64.b64encode(png_bytes).decode()
    body = {"clientKey": api_key,
            "task": {"type": "CoordinatesTask", "body": b64, "comment": comment}}
    r = requests.post("https://api.2captcha.com/createTask", json=body, timeout=30).json()
    if r.get("errorId") != 0:
        raise GeetestSolveError(f"2captcha createTask: {r.get('errorDescription')}")
    tid = r["taskId"]
    deadline = time.time() + timeout
    time.sleep(5)
    while time.time() < deadline:
        rr = requests.post("https://api.2captcha.com/getTaskResult",
                           json={"clientKey": api_key, "taskId": tid}, timeout=30).json()
        if rr.get("errorId") != 0:
            raise GeetestSolveError(f"2captcha getTaskResult: {rr.get('errorDescription')}")
        if rr.get("status") == "ready":
            coords = rr["solution"]["coordinates"]
            if not coords:
                raise GeetestSolveError("2captcha returned no coordinates")
            return int(coords[0]["x"]), int(coords[0]["y"])
        time.sleep(4)
    raise GeetestSolveError("2captcha coordinates timed out")


# ───────────────────────────────────────────────────────────────────────────
# Human-like drag trajectory
# ───────────────────────────────────────────────────────────────────────────
def _trajectory(distance: float) -> list[tuple[float, float]]:
    """Generate (dx, dt) steps approximating a human slide: accelerate, slow,
    small overshoot + correction, with jitter."""
    steps = []
    current = 0.0
    # ease-out toward ~distance*1.06 (overshoot), then settle back
    target = distance * (1.0 + random.uniform(0.03, 0.09))
    v = 0.0
    while current < target:
        # acceleration decreases as we approach target
        remaining = target - current
        a = max(0.6, remaining * 0.18) + random.uniform(-0.4, 0.4)
        v = v * 0.85 + a
        current += v
        dt = random.uniform(0.008, 0.020)
        steps.append((min(current, target), dt))
    # settle back from overshoot to exact distance
    back = target
    while back > distance:
        back -= random.uniform(0.5, 1.5)
        steps.append((max(back, distance), random.uniform(0.01, 0.025)))
    steps.append((distance, random.uniform(0.03, 0.06)))
    return steps


# ───────────────────────────────────────────────────────────────────────────
# Main solve
# ───────────────────────────────────────────────────────────────────────────
def solve_geetest4_browser(captcha_id: str = IMOU_CAPTCHA_ID,
                           two_captcha_key: str | None = None,
                           headless: bool = True,
                           timeout: float = 60.0,
                           max_attempts: int = 4) -> dict:
    if not two_captcha_key:
        raise GeetestSolveError("two_captcha_key is required (CoordinatesTask)")
    from playwright.sync_api import sync_playwright

    last_err = None
    with _serve_harness() as harness_url, sync_playwright() as p:
        browser = p.chromium.launch(headless=headless, args=[
            "--disable-blink-features=AutomationControlled",
        ])
        ctx = browser.new_context(
            viewport={"width": 420, "height": 720},
            user_agent=("Mozilla/5.0 (Linux; Android 13; sdk_gphone64_arm64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/120.0 Mobile Safari/537.36"),
            locale="en-US",
        )
        page = ctx.new_page()
        try:
            page.goto(harness_url, wait_until="domcontentloaded")
            page.wait_for_function("typeof initGeetest4 === 'function'", timeout=15000)

            for attempt in range(1, max_attempts + 1):
                try:
                    res = _one_attempt(page, captcha_id, two_captcha_key, timeout)
                    if res:
                        return res
                except GeetestSolveError as e:
                    last_err = e
                time.sleep(1.0)
            raise GeetestSolveError(f"failed after {max_attempts} attempts: {last_err}")
        finally:
            ctx.close()
            browser.close()


def _one_attempt(page, captcha_id: str, two_captcha_key: str, timeout: float) -> dict | None:
    from PIL import Image

    # (Re)boot a fresh captcha object
    page.evaluate("(cid) => { window.__gt={ready:false,result:null,error:null,captchaObj:null}; boot(cid); }", captcha_id)
    page.wait_for_function("window.__gt && window.__gt.ready === true", timeout=15000)

    # Show the puzzle popup
    page.evaluate("window.__gt.captchaObj.showCaptcha()")
    page.wait_for_selector(".geetest_bg", timeout=10000)
    time.sleep(1.0)

    bg = page.query_selector(".geetest_bg")
    btn = page.query_selector(".geetest_btn")
    slice_el = page.query_selector(".geetest_slice")
    if not bg or not btn:
        raise GeetestSolveError("slide elements not found")
    bg_box = bg.bounding_box()
    btn_box = btn.bounding_box()
    slice_box = slice_el.bounding_box() if slice_el else None
    if not bg_box or not btn_box:
        raise GeetestSolveError("no bounding boxes")

    # Ask 2captcha where the matching shape is (in screenshot pixel space)
    bg_png = bg.screenshot()
    shot_w = Image.open(io.BytesIO(bg_png)).width
    coord_x, coord_y = _solve_coordinates(two_captcha_key, bg_png)
    scale = bg_box["width"] / shot_w

    # Distance to drag = (target shape centre) − (slice piece centre)
    slice_center = ((slice_box["x"] - bg_box["x"]) + slice_box["width"] / 2) if slice_box else 40.0
    target_dx = coord_x * scale - slice_center
    target_dx = max(8.0, min(target_dx, bg_box["width"] - btn_box["width"]))

    # Human-like drag of the slider button
    start_x = btn_box["x"] + btn_box["width"] / 2
    start_y = btn_box["y"] + btn_box["height"] / 2
    page.mouse.move(start_x, start_y)
    page.mouse.down()
    page.mouse.move(start_x + random.uniform(-1, 1), start_y + random.uniform(-1, 1))
    for dx, dt in _trajectory(target_dx):
        jitter_y = random.uniform(-1.2, 1.2)
        page.mouse.move(start_x + dx, start_y + jitter_y)
        time.sleep(dt)
    time.sleep(random.uniform(0.05, 0.12))
    page.mouse.up()

    # Wait for success (validate result) or error
    deadline = time.time() + timeout
    while time.time() < deadline:
        res = page.evaluate("window.__gt.result")
        if res:
            return {
                "captcha_id": captcha_id,
                "lot_number": res["lot_number"],
                "pass_token": res["pass_token"],
                "gen_time": res["gen_time"],
                "captcha_output": res["captcha_output"],
            }
        err = page.evaluate("window.__gt.error")
        if err:
            raise GeetestSolveError(f"geetest error: {err}")
        time.sleep(0.3)
    raise GeetestSolveError("timed out waiting for validate")
