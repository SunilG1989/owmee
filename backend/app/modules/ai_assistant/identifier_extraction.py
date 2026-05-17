"""Deterministic cleanup for AI-read device identifiers.

The vision model does the OCR. This module decides whether the text is safe
enough to use as an IMEI or serial/service-tag candidate. Keeping this logic
outside the vendor adapter makes it testable and portable if we switch AI
providers later.
"""
from __future__ import annotations

import re
import unicodedata


_IMEI_NUMBER = r"(?<!\d)((?:\d[\s\-\.]*){15})(?!\d)"
_SERIAL_STOP_LABEL = re.compile(
    r"(?i)\b("
    r"model|model\s+number|m/?n|part\s+number|p/?n|product\s+number|"
    r"sku|upc|ean|fcc|iccid|eid|imei|meid|mac|wi[-\s]?fi|bluetooth|"
    r"order|invoice|receipt|express\s+service\s+code"
    r")\b"
)
_SERIAL_BAD_TOKENS = {
    "SERIAL",
    "NUMBER",
    "NO",
    "SN",
    "S",
    "N",
    "SERVICE",
    "TAG",
    "MODEL",
    "PRODUCT",
    "DEVICE",
    "ABOUT",
    "ANDROID",
    "APPLE",
    "WARRANTY",
}


def _normalize_text(value: str | None) -> str:
    if not value:
        return ""
    text = unicodedata.normalize("NFKC", value)
    return text.replace("\u00a0", " ").replace("\u2010", "-").replace("\u2011", "-")


def digits_only(value: str | None) -> str:
    return re.sub(r"\D", "", _normalize_text(value))


def _serial_from_token(token: str | None) -> str | None:
    if not token:
        return None
    token = _normalize_text(token).upper().strip(" \t\r\n:;,#()[]{}")
    token = re.sub(r"\s+", "", token)
    token = token.strip("-._")
    if not (4 <= len(token) <= 50):
        return None
    if not re.fullmatch(r"[A-Z0-9][A-Z0-9._-]{2,48}[A-Z0-9]", token):
        return None
    compact = re.sub(r"[^A-Z0-9]", "", token)
    if len(compact) < 4:
        return None
    if compact in _SERIAL_BAD_TOKENS:
        return None
    if compact.isdigit() and len(compact) < 6:
        return None
    return token


def normalize_serial_number(value: str | None) -> str | None:
    return _serial_from_token(value)


def _serial_candidates_from_fragment(fragment: str) -> list[str]:
    fragment = _SERIAL_STOP_LABEL.split(fragment, maxsplit=1)[0]
    candidates: list[str] = []
    for token in re.findall(r"[A-Z0-9][A-Z0-9._\-\s]{2,58}[A-Z0-9]", fragment.upper()):
        serial = _serial_from_token(token)
        if serial and serial not in candidates:
            candidates.append(serial)
    return candidates


def extract_imei_candidate(*values: str | None) -> str | None:
    """Extract exactly one 15-digit IMEI from OCR text.

    Supports common iPhone/Android formats:
    - IMEI: 490154203237518
    - IMEI 1 / IMEI 2
    - IMEI (SIM slot 1)
    - Primary IMEI / Digital SIM IMEI
    - MEID/IMEI
    - grouped with spaces, dots, or hyphens
    """
    text = "\n".join(_normalize_text(v) for v in values if v)
    if not text.strip():
        return None

    direct_digits = digits_only(values[0] if values else None)
    if len(direct_digits) == 15:
        return direct_digits

    labelled_patterns = (
        r"(?i)\bimei\s*(?:1|one|sim\s*(?:slot\s*)?1|slot\s*1|\(\s*sim\s*slot\s*1\s*\)|\(\s*slot\s*1\s*\)|\(\s*slot\s*one\s*\))[^\d]{0,60}"
        + _IMEI_NUMBER,
        r"(?i)\bimei1\b[^\d]{0,60}" + _IMEI_NUMBER,
        r"(?i)\bprimary\s+imei\b[^\d]{0,45}" + _IMEI_NUMBER,
        r"(?i)\b(?:physical|digital|device)\s+(?:sim\s+)?imei\b[^\d]{0,60}" + _IMEI_NUMBER,
        r"(?i)\b(?:meid\s*/\s*imei|imei\s*/\s*sn)\b[^\d]{0,45}" + _IMEI_NUMBER,
        r"(?i)\bimei\s*(?:number|no\.?|#)?\s*(?:\([^)]+\))?(?:\b|(?=\W))[^\d]{0,45}"
        + _IMEI_NUMBER,
        r"(?i)\b(?:phone|sim)\s*1\s+imei\b[^\d]{0,60}" + _IMEI_NUMBER,
    )
    for pattern in labelled_patterns:
        for match in re.finditer(pattern, text):
            digits = digits_only(match.group(1))
            if len(digits) == 15:
                return digits

    candidates: list[str] = []
    for match in re.finditer(_IMEI_NUMBER, text):
        digits = digits_only(match.group(1))
        if len(digits) == 15 and digits not in candidates:
            candidates.append(digits)

    return candidates[0] if len(candidates) == 1 else None


def extract_serial_candidate(*values: str | None) -> str | None:
    """Extract a laptop/tablet serial number or service tag from OCR text.

    This intentionally prefers labelled values over broad guessing. Laptops
    and tablets use many vendor formats: Apple "Serial Number", Dell "Service
    Tag", Lenovo/HP/Samsung "S/N" or "SN". If a label is not visible, we only
    accept one unambiguous alphanumeric candidate.
    """
    text = "\n".join(_normalize_text(v) for v in values if v)
    if not text.strip():
        return None

    direct = _serial_from_token(values[0])
    if direct:
        return direct

    labelled_patterns = (
        r"(?i)\bserial\s*(?:number|no\.?|#)?(?:\b|(?=\W))[^\n\rA-Z0-9]{0,12}([^\n\r]{4,80})",
        r"(?i)\b(?:s\s*/\s*n|s\.?\s*n\.?|sn)(?:\b|(?=\W))[^\n\rA-Z0-9]{0,12}([^\n\r]{4,80})",
        r"(?i)\bservice\s+tag\b[^\n\rA-Z0-9]{0,12}([^\n\r]{4,80})",
    )
    for pattern in labelled_patterns:
        for match in re.finditer(pattern, text):
            candidates = _serial_candidates_from_fragment(match.group(1))
            if candidates:
                return candidates[0]

    if _SERIAL_STOP_LABEL.search(text):
        return None

    candidates: list[str] = []
    for token in re.findall(r"\b(?=[A-Z0-9._-]{7,24}\b)(?=[A-Z0-9._-]*[A-Z])(?=[A-Z0-9._-]*\d)[A-Z0-9][A-Z0-9._-]{5,22}[A-Z0-9]\b", text.upper()):
        serial = _serial_from_token(token)
        if serial and serial not in candidates:
            candidates.append(serial)

    return candidates[0] if len(candidates) == 1 else None
