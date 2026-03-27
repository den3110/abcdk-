import argparse
import asyncio
import json
import re
import sys


def load_edge_tts():
    try:
        import edge_tts  # type: ignore

        return edge_tts
    except Exception as exc:  # pragma: no cover
        sys.stderr.write(f"edge_tts_import_failed:{exc}\n")
        sys.exit(2)


VIETNAMESE_CHAR_RE = re.compile(
    r"[àáảãạăắằẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩị"
    r"òóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]",
    re.IGNORECASE,
)

VOICE_MAP = {
    ("vi", "male"): "vi-VN-NamMinhNeural",
    ("vi", "female"): "vi-VN-HoaiMyNeural",
    ("en", "male"): "en-US-GuyNeural",
    ("en", "female"): "en-US-JennyNeural",
}

FEMALE_HINTS = {"nova", "shimmer", "sage", "coral", "verse", "ballad"}


def guess_language(text: str, instructions: str) -> str:
    haystack = f"{text} {instructions}".strip()
    if VIETNAMESE_CHAR_RE.search(haystack):
        return "vi"
    return "en"


def resolve_voice_name(voice: str, text: str, instructions: str) -> str:
    normalized = (voice or "").strip()
    if normalized and normalized not in {
        "alloy",
        "nova",
        "shimmer",
        "sage",
        "echo",
        "ash",
        "coral",
        "verse",
        "ballad",
    }:
        return normalized

    language = guess_language(text, instructions)
    gender = "female" if normalized in FEMALE_HINTS else "male"
    return VOICE_MAP[(language, gender)]


def rate_from_speed(speed_value: str) -> str:
    try:
        speed = float(speed_value or "1")
    except Exception:
        speed = 1.0
    speed = max(0.5, min(2.0, speed))
    percent = int(round((speed - 1.0) * 100))
    sign = "+" if percent >= 0 else ""
    return f"{sign}{percent}%"


async def run_probe() -> None:
    edge_tts = load_edge_tts()
    payload = {
        "ok": True,
        "provider": "edge-tts",
        "version": getattr(edge_tts, "__version__", "unknown"),
        "models": ["edge-tts", "edge-tts-free"],
    }
    print(json.dumps(payload))


async def synthesize(args) -> None:
    edge_tts = load_edge_tts()
    voice_name = resolve_voice_name(args.voice, args.text, args.instructions)
    communicate = edge_tts.Communicate(
        args.text,
        voice=voice_name,
        rate=rate_from_speed(args.speed),
    )
    await communicate.save(args.output)
    print(
        json.dumps(
            {
                "ok": True,
                "provider": "edge-tts",
                "voice": voice_name,
                "output": args.output,
            }
        )
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--text", default="")
    parser.add_argument("--voice", default="alloy")
    parser.add_argument("--instructions", default="")
    parser.add_argument("--speed", default="1")
    parser.add_argument("--output", default="")
    args = parser.parse_args()

    if args.probe:
        asyncio.run(run_probe())
        return

    if not args.text or not args.output:
        sys.stderr.write("missing_text_or_output\n")
        sys.exit(3)

    asyncio.run(synthesize(args))


if __name__ == "__main__":
    main()
