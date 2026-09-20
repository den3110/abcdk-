"""
Lookup helpers for the bundled `standard_platform.json` thing-model.

When you publish `iot.control.SetIotService` (over MQTT or HTTPS), the server
requires the `service` field to be the NUMERIC ref, not the human identifier.
The mapping is in `assets/standard_platform.json` (62 services) and
`assets/standard_model.json` (132 services), both shipped inside the APK.

Examples (verified live):
    services.ref("GetMediaFunctions")  → 92000
    services.ref("GetPublicLive")      → 94000
    services.ref("VerifyPassword")     → 94400
    services.ref("CallDevAction")      → 94300
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

_ASSETS = Path(__file__).parent / "assets"


@lru_cache(maxsize=2)
def _load(filename: str) -> dict:
    return json.loads((_ASSETS / filename).read_text())


def platform() -> dict:
    return _load("standard_platform.json")


def standard() -> dict:
    return _load("standard_model.json")


def ref(identifier: str) -> int:
    """Return the numeric service ref for an identifier, searching both
    standard_platform.json and standard_model.json. Raises KeyError if absent.
    """
    for src in (platform(), standard()):
        for s in src["services"]:
            if s.get("identifier") == identifier:
                return int(s["ref"])
    raise KeyError(identifier)


def input_field_ref(svc: str, field: str) -> int:
    """Return the numeric ref for an input field of a given service."""
    for src in (platform(), standard()):
        for s in src["services"]:
            if s.get("identifier") == svc:
                for f in s.get("inputData", []) or []:
                    if f.get("identifier") == field:
                        return int(f["ref"])
                raise KeyError(f"field {field} in service {svc}")
    raise KeyError(svc)


def services_grep(keyword: str) -> list[dict]:
    """Return [{identifier, ref, name}] for services whose identifier OR
    Chinese name contains `keyword` (case-insensitive)."""
    keyword = keyword.lower()
    out = []
    for src in (platform(), standard()):
        for s in src["services"]:
            ident = (s.get("identifier") or "").lower()
            name = (s.get("name") or "").lower()
            if keyword in ident or keyword in name:
                out.append({"identifier": s.get("identifier"),
                            "ref": int(s["ref"]),
                            "name": s.get("name")})
    return out


def build_input(svc: str, fields: dict) -> dict[str, object]:
    """Convert {field-name: value} → {numeric-ref-as-str: value} for the
    `inputData` param of `iot.control.SetIotService`."""
    return {str(input_field_ref(svc, k)): v for k, v in fields.items()}
