"""Send a controlled MSG91 OTP probe from the deployed backend environment.

This is an operational diagnostic, not part of the user auth flow. It exercises
the same MSG91 adapter used by /v1/auth/otp/send, but it does not store an OTP
in Redis and it does not create a login session.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import secrets
from collections.abc import Sequence
from dataclasses import asdict

from app.core.settings import settings
from app.modules.identity_auth.sms_adapter import (
    _Msg91SMSAdapter,
    _missing_msg91_value,
    _normalise_msg91_mobile,
)


def generate_probe_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def mask_mobile(mobile: str) -> str:
    digits = _normalise_msg91_mobile(mobile)
    if not digits:
        return ""
    if len(digits) <= 4:
        return "*" * len(digits)
    return f"{'*' * (len(digits) - 4)}{digits[-4:]}"


def validate_probe_inputs(phone: str, otp: str | None, confirm_send: bool) -> list[str]:
    errors: list[str] = []
    provider = (settings.sms_provider or "").strip().lower()
    mobile = _normalise_msg91_mobile(phone)

    if provider not in {"msg91", "msg-91"}:
        errors.append("SMS_PROVIDER must be msg91 for this probe.")
    if _missing_msg91_value(settings.sms_api_key):
        errors.append("SMS_API_KEY must be set to a real MSG91 authkey.")
    if _missing_msg91_value(settings.sms_template_id):
        errors.append("SMS_TEMPLATE_ID must be set to the MSG91 OTP template id.")
    if not (10 <= len(mobile) <= 15):
        errors.append("Phone must contain 10 to 15 digits, preferably E.164 with country code.")
    if otp is not None and (not otp.isdigit() or len(otp) != 6):
        errors.append("--otp must be exactly 6 digits.")
    if not confirm_send:
        errors.append("Add --confirm-send to send a real OTP through MSG91.")

    return errors


def probe_payload(
    *,
    success: bool,
    phone: str,
    otp: str,
    show_otp: bool,
    provider_message_id: str = "",
    error: str | None = None,
) -> dict:
    payload = {
        "success": success,
        "provider": "msg91",
        "phone": mask_mobile(phone),
        "provider_message_id": provider_message_id,
        "stores_redis_otp": False,
        "error": error,
    }
    if show_otp:
        payload["otp"] = otp
    return payload


async def run_probe(args: argparse.Namespace) -> int:
    otp = args.otp or generate_probe_otp()
    errors = validate_probe_inputs(args.phone, args.otp, args.confirm_send)
    if errors:
        print(json.dumps({
            "success": False,
            "provider": "msg91",
            "phone": mask_mobile(args.phone),
            "errors": errors,
        }, indent=2, sort_keys=True))
        return 2

    result = await _Msg91SMSAdapter().send_otp(args.phone, otp)
    payload = probe_payload(
        success=result.success,
        phone=args.phone,
        otp=otp,
        show_otp=args.show_otp,
        provider_message_id=result.provider_message_id,
        error=result.error,
    )
    payload["raw_result"] = asdict(result)
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0 if result.success else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Send a real MSG91 OTP probe using the deployed Owmee SMS settings. "
            "This does not store a Redis OTP and cannot be used to log in."
        )
    )
    parser.add_argument(
        "--phone",
        required=True,
        help="Destination phone, preferably E.164, for example +919876543210",
    )
    parser.add_argument(
        "--otp",
        help="Optional 6-digit OTP to send. Defaults to a random probe OTP.",
    )
    parser.add_argument(
        "--confirm-send",
        action="store_true",
        help="Required safety flag before a real SMS is sent.",
    )
    parser.add_argument(
        "--show-otp",
        action="store_true",
        help="Print the probe OTP in stdout. Off by default.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return asyncio.run(run_probe(args))


if __name__ == "__main__":
    raise SystemExit(main())
