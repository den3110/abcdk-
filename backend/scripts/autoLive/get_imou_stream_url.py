#!/usr/bin/env python3
# get_imou_stream_url.py — trả relay URL DHAV (GetRealTransferStreamUrl) cho 1 cam.
# App live Android gọi qua endpoint backend rồi tự kết nối relay (DhRtspClient Kotlin)
# → khỏi phải port crypto/SaaS sang Kotlin.
#
# Input (stdin JSON): {session:{uuid_user,uuid_key,session_id,regional_host},
#                      deviceId, creds:{phone,password,area_code}?, streamId:"0"|"1"}
# Output (stdout JSON): {url, session}  |  {error}
import sys, json, os


def build(session, device_id):
    from imou.api import Client
    c = Client(session=session)
    cam = c.device(device_id)          # resolve product_id qua BasicList
    return cam.stream_url()             # GetRealTransferStreamUrl → relay URL (ký sẵn)


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"error": f"bad input: {e}"})); return
    session = payload.get("session") or {}
    device_id = payload.get("deviceId") or ""
    creds = payload.get("creds") or {}
    os.environ["IMOU_STREAM_ID"] = str(payload.get("streamId", "1"))
    if not device_id:
        print(json.dumps({"error": "missing deviceId"})); return

    used_session = session
    try:
        url = build(session, device_id)
    except Exception as e:  # noqa: BLE001 — session hết hạn (12002) → relogin từ creds
        if creds.get("phone") and creds.get("password"):
            try:
                from imou.auth import login
                used_session = login(creds["phone"], creds.get("area_code", "84"),
                                     creds["password"])
                url = build(used_session, device_id)
            except Exception as e2:  # noqa: BLE001
                print(json.dumps({"error": f"relogin failed: {e2}"})); return
        else:
            print(json.dumps({"error": f"stream_url failed: {e}"})); return

    print(json.dumps({"url": url, "session": used_session}))


if __name__ == "__main__":
    main()
