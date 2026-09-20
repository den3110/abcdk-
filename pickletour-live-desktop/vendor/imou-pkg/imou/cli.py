"""Command-line entry point: `python -m imou <command>`."""

from __future__ import annotations

import argparse
import os
import sys

import json as _json

from .auth import login, load_session, import_session, AuthError
from .api import Client
from . import services
from .webview import WebViewServer


def cmd_login(args):
    sess = login(args.phone, args.area_code, args.password,
                 two_captcha_key=args.two_captcha)
    print(f"✓ Session saved.  uuid={sess['uuid_user']}  host={sess['regional_host']}")


def cmd_devices(args):
    c = Client()
    for cam in c.devices():
        print(f"  {cam.device_id:22s}  {cam.name:24s}  {cam.model}  productId={cam.product_id}")


def cmd_url(args):
    cam = Client().device(args.device_id)
    print(cam.stream_url(quic=args.quic))


def cmd_snap(args):
    cam = Client().device(args.device_id)
    cam.snapshot(args.out)
    print(f"✓ {args.out}")


def cmd_rec(args):
    cam = Client().device(args.device_id)
    cam.record(args.out, seconds=args.seconds, with_audio=not args.no_audio)
    print(f"✓ {args.out}")


def cmd_records(args):
    cam = Client().device(args.device_id)
    recs = cam.list_recordings(args.begin, args.end,
                               rec_type=args.type, limit=args.limit)
    if not recs:
        print("(no recordings)")
        return
    for r in recs:
        print(f"  {r['begin_time']} → {r['end_time']}  "
              f"type={r['type']}  size={r['size']}  path={r['path']}")


def cmd_playback_url(args):
    cam = Client().device(args.device_id)
    print(cam.playback_url(args.begin, args.end,
                            verify_password=not args.skip_verify,
                            encrypt=args.encrypt, file_type=args.file_type))


def cmd_playback(args):
    cam = Client().device(args.device_id)
    cam.save_playback(args.out, args.begin, args.end,
                       with_audio=not args.no_audio,
                       max_seconds=args.max_seconds,
                       verify_password=not args.skip_verify,
                       encrypt=args.encrypt, file_type=args.file_type)
    print(f"✓ {args.out}")


def cmd_web(args):
    WebViewServer(Client(), port=args.port, encoder=args.encoder).serve_forever()


def cmd_test(args):
    from .api_tester import main as tester_main
    import sys as _s
    _s.argv = ["test", str(args.port)]
    tester_main()


def cmd_creds(args):
    c = Client()
    cam = c.device(args.device_id)
    info = c.device_password(cam.device_id, cam.product_id)
    print(info)


def cmd_grep(args):
    for s in services.services_grep(args.keyword):
        print(f"  {s['identifier']:32s}  ref={s['ref']:>8d}  {s['name']}")


def cmd_import_session(args):
    """Import a session captured from mitm/Frida on the official app.

    Accepts: the full `/pcs/v1/user.account.GetToken` response envelope, or
    just the inner `data` object, or a pre-built session shape.
    """
    raw = _json.loads(open(args.path).read())
    sess = import_session(raw)
    print(f"✓ Session saved.  uuid={sess['uuid_user']}  host={sess['regional_host']}")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="imou",
        description="Imou Life consumer-protocol client")
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("login", help="Phone + OTP → session.json")
    sp.add_argument("phone");  sp.add_argument("password")
    sp.add_argument("--area-code", default="84")
    sp.add_argument("--2captcha", dest="two_captcha", metavar="API_KEY",
                    default=os.environ.get("TWO_CAPTCHA_KEY"),
                    help="2captcha.com API key (or env TWO_CAPTCHA_KEY) to "
                         "auto-solve Geetest v4 on captcha-gated accounts.")
    sp.set_defaults(func=cmd_login)

    sp = sub.add_parser("devices", help="List cameras on the account")
    sp.set_defaults(func=cmd_devices)

    sp = sub.add_parser("url", help="Print a fresh RTSP relay URL")
    sp.add_argument("device_id"); sp.add_argument("--quic", action="store_true")
    sp.set_defaults(func=cmd_url)

    sp = sub.add_parser("snap", help="Save snapshot")
    sp.add_argument("device_id"); sp.add_argument("out")
    sp.set_defaults(func=cmd_snap)

    sp = sub.add_parser("rec", help="Record N seconds (default 10)")
    sp.add_argument("device_id"); sp.add_argument("out")
    sp.add_argument("--seconds", type=int, default=10)
    sp.add_argument("--no-audio", action="store_true")
    sp.set_defaults(func=cmd_rec)

    sp = sub.add_parser("records",
        help="List SD-card recordings between BEGIN..END")
    sp.add_argument("device_id")
    sp.add_argument("begin", help="ISO datetime / epoch / yyyyMMddTHHmmss")
    sp.add_argument("end",   help="ISO datetime / epoch / yyyyMMddTHHmmss")
    sp.add_argument("--type", default="0",
                    help="Record type ref (0=all, 1=normal, 2=motion, …)")
    sp.add_argument("--limit", type=int, default=100)
    sp.set_defaults(func=cmd_records)

    sp = sub.add_parser("playback-url",
        help="Resolve a fresh RTSP URL for an SD-card segment")
    sp.add_argument("device_id")
    sp.add_argument("begin"); sp.add_argument("end")
    sp.add_argument("--encrypt", type=int, default=3)
    sp.add_argument("--file-type", type=int, default=1)
    sp.add_argument("--skip-verify", action="store_true",
                    help="Skip the 94400 VerifyPassword step")
    sp.set_defaults(func=cmd_playback_url)

    sp = sub.add_parser("playback",
        help="Save an SD-card segment to a file via ffmpeg/dhav")
    sp.add_argument("device_id")
    sp.add_argument("begin"); sp.add_argument("end"); sp.add_argument("out")
    sp.add_argument("--max-seconds", type=int, default=600)
    sp.add_argument("--encrypt", type=int, default=3)
    sp.add_argument("--file-type", type=int, default=1)
    sp.add_argument("--no-audio", action="store_true")
    sp.add_argument("--skip-verify", action="store_true")
    sp.set_defaults(func=cmd_playback)

    sp = sub.add_parser("web", help="HLS web viewer at http://localhost:PORT/")
    sp.add_argument("--port", type=int, default=8765)
    sp.add_argument("--encoder",
                    choices=["h264_videotoolbox", "libx264"],
                    default="h264_videotoolbox")
    sp.set_defaults(func=cmd_web)

    sp = sub.add_parser("test", help="Swagger-like API tester at http://localhost:PORT/")
    sp.add_argument("--port", type=int, default=8777)
    sp.set_defaults(func=cmd_test)

    sp = sub.add_parser("creds", help="Decrypt deviceUsername / devicePassword")
    sp.add_argument("device_id")
    sp.set_defaults(func=cmd_creds)

    sp = sub.add_parser("grep", help="Search service identifiers by keyword")
    sp.add_argument("keyword")
    sp.set_defaults(func=cmd_grep)

    sp = sub.add_parser("import-session",
                        help="Bootstrap from a mitm/Frida-captured GetToken response")
    sp.add_argument("path", help="path to JSON file (response envelope or inner data)")
    sp.set_defaults(func=cmd_import_session)

    args = p.parse_args(argv)
    try:
        args.func(args)
        return 0
    except AuthError as e:
        print(f"[auth] {e}", file=sys.stderr); return 2
    except Exception as e:
        print(f"[error] {e}", file=sys.stderr); return 1


if __name__ == "__main__":
    sys.exit(main())
