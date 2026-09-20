"""
Swagger-like API tester for the Imou consumer protocol.

Serves an interactive page where each endpoint has a ready-made payload + the
REAL signed headers, and a Send button that actually calls easy4ipcloud
(signed + forwarded server-side, so no browser CORS issues).

Run:
    python -m imou test            # → http://127.0.0.1:8777
    (or)  .venv/bin/python -c "from imou.api_tester import main; main()"
"""

from __future__ import annotations

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import crypto as C
from ._http import call, AuthCtx, USER_AGENT
from .auth import load_session, ENTRY_HOST

# ── Demo defaults ───────────────────────────────────────────────────────────
DEMO = {
    "phone": "869941629",
    "areaCode": "84",
    "password": "HoangHuyen@0810",
    "deviceId": "5858CBDPSF15233",
    "productId": "SC58X9BD",
}


def _sess():
    return load_session() or {}


# ── Endpoint catalog (the login flow + camera calls) ────────────────────────
def endpoints():
    s = _sess()
    uuid_user = s.get("uuid_user", "<login first>")
    rhost = s.get("regional_host", "app-sg-hw.easy4ipcloud.com")
    return [
        {
            "group": "Auth", "id": "country",
            "title": "1. GetCountryList", "host": ENTRY_HOST,
            "method": "user.account.GetCountryList", "auth": "app", "apiver": "56906",
            "desc": "Màn login lấy danh sách quốc gia. Auth: default\\AppKey.",
            "body": {"countryListHash": "", "enableMultiLanguage": 1},
        },
        {
            "group": "Auth", "id": "gettoken",
            "title": "2. GetToken (probe → 12114 captcha hoặc session)",
            "host": ENTRY_HOST, "method": "user.account.GetToken",
            "auth": "account", "apiver": "56906",
            "desc": "Auth: account\\<phone>, key=password. Trả 12114 nếu cần captcha, "
                    "hoặc {sessionId,token,username,entryUrlV2} nếu terminal tin cậy.",
            "body": {"areaCode": DEMO["areaCode"], "gpsInfo": {"latitude": 0, "longitude": 0}},
        },
        {
            "group": "Auth", "id": "checkgt4",
            "title": "4. CheckGeeTest4 (nộp lời giải captcha)",
            "host": ENTRY_HOST, "method": "common.validcode.CheckGeeTest4",
            "auth": "app", "apiver": "152485",
            "desc": "Auth: default\\AppKey. Dán 5 field từ native Geetest SDK "
                    "(client_type=android). Trả {token}.",
            "body": {
                "account": DEMO["areaCode"] + DEMO["phone"], "usage": "Login",
                "captchaId": "525e9a21b667c698f924520f48669462", "captchaMetaData": "",
                "captchaOutput": "<từ SDK>", "genTime": "<từ SDK>",
                "lotNumber": "<từ SDK>", "passToken": "<từ SDK>",
            },
        },
        {
            "group": "Auth", "id": "login",
            "title": "6. Login (kích hoạt + MQTT/profile)",
            "host": rhost, "method": "user.account.Login",
            "auth": "session_raw", "apiver": "56906",
            "desc": "Auth: uuid\\<user>, key=RAW token, + x-pcs-session-id. "
                    "Trả mqttAk/mqttToken/mqttServer/profile.",
            "body": {"timezoneOffset": 25200},
        },
        {
            "group": "Camera", "id": "devlist",
            "title": "device.list.BasicList", "host": rhost,
            "method": "device.list.BasicList", "auth": "session", "apiver": "191204",
            "desc": "Liệt kê camera. Auth: uuid\\<user>, key=md5(token).",
            "body": {"familyId": "-1", "limit": 128, "offset": 0, "roomId": "-1", "transferStr": ""},
        },
        {
            "group": "Camera", "id": "livestream",
            "title": "things.media.GetRealTransferStreamUrl (LIVE)",
            "host": rhost, "method": "things.media.GetRealTransferStreamUrl",
            "auth": "session", "apiver": "197891",
            "desc": "Lấy RTSP URL live (DH/RTP transport).",
            "body": {
                "deviceId": DEMO["deviceId"], "productId": DEMO["productId"],
                "channelId": "0", "streamId": "0", "type": "0", "encrypt": "0",
                "assistStream": "0", "quic": "0", "design": "live", "skipAuth": "0",
                "videoLimit": 0, "imageSize": 0, "talkType": "0",
                "owner": uuid_user, "ownerType": "0", "windowNum": "1", "timeLimit": False,
            },
        },
        {
            "group": "Camera", "id": "localrecords",
            "title": "iot.control.SetIotService → GetLocalRecords (timeline SD)",
            "host": rhost, "method": "iot.control.SetIotService",
            "auth": "session", "apiver": "191204",
            "desc": "Query danh sách recording trên thẻ SD. service=24100, "
                    "inputData dùng numeric ref. Time = yyyyMMddTHHmmss.",
            "body": {
                "deviceId": DEMO["deviceId"], "productId": DEMO["productId"], "channelId": "0",
                "service": "24100",
                "inputData": {
                    "24101": "0", "24102": "20260601T000000", "24103": "20260601T235959",
                    "24105": 100, "24106": "1",
                    "24107": DEMO["productId"], "24108": DEMO["deviceId"], "24109": 0,
                },
            },
        },
        {
            "group": "Camera", "id": "playback",
            "title": "things.media.GetPlaybackTransferStreamUrlByTime (SD playback)",
            "host": rhost, "method": "things.media.GetPlaybackTransferStreamUrlByTime",
            "auth": "session", "apiver": "197891",
            "desc": "Lấy RTSP URL xem lại SD. startTime/endTime = EPOCH giây.",
            "body": {
                "deviceId": DEMO["deviceId"], "productId": DEMO["productId"],
                "channelId": "0", "streamId": "0",
                "startTime": "<epoch>", "endTime": "<epoch>",
                "type": "0", "encrypt": "0", "quic": "0",
                "owner": uuid_user, "ownerType": "0",
            },
        },
    ]


def _auth_for(kind: str, apiver: str, extra: dict) -> AuthCtx:
    s = _sess()
    if kind == "app":
        # default\AppKey auth signs with md5_hex(AppSecret), NOT raw AppSecret.
        return AuthCtx(username=f"default\\{C.APP_KEY}", key=C.md5_hex(C.APP_SECRET), apiver=apiver)
    if kind == "account":
        phone = extra.get("phone", DEMO["phone"])
        pw = extra.get("password", DEMO["password"])
        # account\ key = md5(md5(password))
        return AuthCtx(username=f"account\\{phone}",
                       key=C.md5_hex(C.md5_hex(pw)), apiver=apiver)
    if kind == "session_raw":
        return AuthCtx(username=f"uuid\\{s['uuid_user']}", key=s["uuid_key"],
                       apiver=apiver, session_id=s.get("session_id"))
    # default: session (md5 key)
    return AuthCtx(username=f"uuid\\{s['uuid_user']}", key=C.md5_hex(s["uuid_key"]),
                   apiver=apiver, session_id=s.get("session_id"))


def _signed_preview(host, method, data, auth: AuthCtx):
    """Reproduce the exact signed headers (for display)."""
    uri = f"/pcs/v1/{method}"
    body = json.dumps({"data": data}, separators=(",", ":")).encode()
    md5 = C.md5_b64(body)
    date = C.iso_utc_now(); nonce = C.rand_nonce(); ua = C.client_ua_b64()
    sts = C.sign_saas_string("POST", uri, md5, "application/json", auth.apiver, ua,
                             date, nonce, auth.username, session_id=auth.session_id)
    sig = C.hmac_sha256_b64(auth.key, sts)
    headers = {
        "Content-Type": "application/json", "Content-MD5": md5,
        "x-pcs-apiver": auth.apiver, "x-pcs-client-ua": ua, "x-pcs-date": date,
        "x-pcs-nonce": nonce, "x-pcs-username": auth.username,
        "x-pcs-signature": sig, "User-Agent": USER_AGENT,
    }
    if auth.session_id:
        headers["x-pcs-session-id"] = auth.session_id
    return f"https://{host}{uri}", headers, body.decode()


# ── HTTP server ─────────────────────────────────────────────────────────────
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _json(self, obj, code=200):
        b = json.dumps(obj, ensure_ascii=False, indent=2).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers(); self.wfile.write(b)

    def do_GET(self):
        if self.path == "/" or self.path.startswith("/?"):
            b = PAGE.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers(); self.wfile.write(b); return
        if self.path == "/endpoints.json":
            return self._json({"session": _sess(), "endpoints": endpoints(), "demo": DEMO})
        self.send_error(404)

    def do_POST(self):
        if self.path != "/call":
            self.send_error(404); return
        ln = int(self.headers.get("Content-Length", 0))
        req = json.loads(self.rfile.read(ln) or b"{}")
        host = req["host"]; method = req["method"]; data = req["body"]
        auth = _auth_for(req.get("auth", "session"), req.get("apiver", "191204"),
                         req.get("extra", {}))
        url, headers, body_str = _signed_preview(host, method, data, auth)
        try:
            resp = call(host, method, data, auth)
        except Exception as e:
            resp = {"_error": str(e)}
        # redact the actual signature value length only (still show it — it's real)
        self._json({"url": url, "request_headers": headers,
                    "request_body": body_str, "response": resp})


PAGE = r"""<!doctype html><html lang="vi"><head><meta charset="utf-8">
<title>Imou API Tester</title>
<style>
 *{box-sizing:border-box} body{margin:0;font-family:ui-monospace,Menlo,monospace;background:#0e1116;color:#d8dee9}
 header{padding:14px 20px;background:#161b22;border-bottom:1px solid #30363d;position:sticky;top:0;z-index:5}
 header h1{margin:0;font-size:16px} .sess{font-size:11px;opacity:.6;margin-top:4px}
 .wrap{max-width:1000px;margin:0 auto;padding:16px}
 .ep{border:1px solid #30363d;border-radius:8px;margin:12px 0;overflow:hidden;background:#161b22}
 .ep>summary{cursor:pointer;padding:12px 16px;list-style:none;display:flex;gap:10px;align-items:center}
 .ep>summary::-webkit-details-marker{display:none}
 .badge{font-size:10px;padding:2px 8px;border-radius:10px;font-weight:700}
 .Auth{background:#3b2f12;color:#f0c674} .Camera{background:#13322b;color:#8fd9c0}
 .title{font-size:13px;font-weight:600} .method{font-size:11px;opacity:.6;margin-left:auto}
 .body{padding:0 16px 16px} .desc{font-size:12px;opacity:.7;margin:6px 0 10px}
 textarea{width:100%;min-height:140px;background:#0d1117;color:#9cdcfe;border:1px solid #30363d;
   border-radius:6px;padding:10px;font-family:inherit;font-size:12px}
 .row{display:flex;gap:8px;align-items:center;margin:8px 0;flex-wrap:wrap}
 button{background:#238636;color:#fff;border:0;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:600}
 button.sec{background:#30363d}
 .out{margin-top:10px} .out h4{margin:8px 0 4px;font-size:11px;opacity:.6;text-transform:uppercase}
 pre{background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:10px;overflow:auto;
   font-size:11px;max-height:320px;white-space:pre-wrap;word-break:break-all}
 .ok{color:#8fd9c0} .err{color:#f08f8f}
 input{background:#0d1117;color:#d8dee9;border:1px solid #30363d;border-radius:6px;padding:6px 8px;font-family:inherit;font-size:12px}
 label{font-size:11px;opacity:.7}
</style></head><body>
<header><h1>🔌 Imou API Tester <span style="opacity:.5;font-weight:400">— signed server-side, no CORS</span></h1>
 <div class="sess" id="sess">loading…</div>
 <div class="row" style="margin-top:8px">
   <label>phone <input id="g_phone" size="12"></label>
   <label>password <input id="g_pw" size="16" type="text"></label>
   <span style="font-size:11px;opacity:.5">(dùng cho auth account\\ — GetToken)</span>
 </div>
</header>
<div class="wrap" id="list"></div>
<script>
let DEMO={};
async function boot(){
  const r=await fetch('/endpoints.json'); const d=await r.json();
  DEMO=d.demo||{};
  const s=d.session||{};
  document.getElementById('sess').textContent =
    s.uuid_user ? `session: uuid=${s.uuid_user}  host=${s.regional_host}  sid=${(s.session_id||'').slice(0,12)}…`
                : 'CHƯA có session — chạy đăng nhập trước (camera endpoints sẽ lỗi 12002)';
  document.getElementById('g_phone').value = DEMO.phone||'';
  document.getElementById('g_pw').value = DEMO.password||'';
  const list=document.getElementById('list');
  for(const ep of d.endpoints){
    const el=document.createElement('details'); el.className='ep';
    el.innerHTML=`<summary>
        <span class="badge ${ep.group}">${ep.group}</span>
        <span class="title">${ep.title}</span>
        <span class="method">POST /pcs/v1/${ep.method}</span>
      </summary>
      <div class="body">
        <div class="desc">${ep.desc}</div>
        <div class="row"><label>host</label><input class="host" value="${ep.host}" size="40">
          <label>auth</label><input class="auth" value="${ep.auth}" size="12">
          <label>apiver</label><input class="apiver" value="${ep.apiver}" size="8"></div>
        <textarea class="payload">${JSON.stringify(ep.body,null,2)}</textarea>
        <div class="row"><button class="send">▶ Send</button>
          <button class="sec preview">Xem headers (ký thật)</button></div>
        <div class="out"></div>
      </div>`;
    const send=el.querySelector('.send'), prev=el.querySelector('.preview'), out=el.querySelector('.out');
    function payload(){return {host:el.querySelector('.host').value, method:ep.method,
        auth:el.querySelector('.auth').value, apiver:el.querySelector('.apiver').value,
        body:JSON.parse(el.querySelector('.payload').value),
        extra:{phone:document.getElementById('g_phone').value, password:document.getElementById('g_pw').value}};}
    async function doCall(showResp){
      out.innerHTML='<em style="opacity:.6">đang gọi…</em>';
      try{
        const r=await fetch('/call',{method:'POST',body:JSON.stringify(payload())});
        const d=await r.json();
        const code=(d.response&&d.response.code);
        out.innerHTML=`<h4>Request URL</h4><pre>${d.url}</pre>
          <h4>Request Headers (ký thật)</h4><pre>${Object.entries(d.request_headers).map(([k,v])=>k+': '+v).join('\n')}</pre>
          <h4>Request Body</h4><pre>${d.request_body}</pre>`+
          (showResp?`<h4>Response <span class="${code===10000?'ok':'err'}">code=${code}</span></h4>
            <pre>${JSON.stringify(d.response,null,2)}</pre>`:'');
      }catch(e){out.innerHTML='<pre class="err">'+e+'</pre>';}
    }
    send.onclick=()=>doCall(true); prev.onclick=()=>doCall(false);
    list.appendChild(el);
  }
}
boot();
</script></body></html>"""


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
    srv = ThreadingHTTPServer(("127.0.0.1", port), H)
    print(f"Imou API Tester → http://127.0.0.1:{port}/")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("bye")


if __name__ == "__main__":
    main()
