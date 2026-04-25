"""CEIR (Central Equipment Identity Register) client.

The real Indian government CEIR API requires DoT registration (~₹50K,
4-6 weeks). For MVP, this is mocked: every well-formed IMEI returns
'clean'. The adapter shape matches what the real client will look like,
so swapping is mechanical.

Public API:
    luhn_valid(imei: str) -> bool
    check(imei: str) -> dict

The check() function returns:
    {
        "status": "clean" | "blacklisted" | "stolen" | "invalid",
        "checked_at": ISO datetime str,
        "source": "ceir_mock" | "ceir_api",
    }
"""
from datetime import datetime, timezone


def luhn_valid(imei: str) -> bool:
    """Standard Luhn / Mod-10 check used by IMEI numbers.

    Returns True if the 15-digit IMEI passes Luhn validation.
    Returns False for any non-numeric or wrong-length input.
    """
    if not imei or not imei.isdigit() or len(imei) != 15:
        return False

    total = 0
    # Process digits right-to-left. Even-positioned digits (0-indexed
    # from the right starting at 1) are doubled.
    for i, ch in enumerate(reversed(imei)):
        n = int(ch)
        if i % 2 == 1:
            n *= 2
            if n > 9:
                n -= 9
        total += n

    return total % 10 == 0


async def check(imei: str) -> dict:
    """Check an IMEI against CEIR. Mocked for MVP.

    Real implementation will hit https://ceir.gov.in/... with auth
    headers and parse the response.
    """
    now = datetime.now(timezone.utc).isoformat()

    if not luhn_valid(imei):
        return {
            "status": "invalid",
            "checked_at": now,
            "source": "ceir_mock",
            "reason": "luhn_check_failed",
        }

    # MOCK: every well-formed IMEI is reported clean. To simulate a
    # blacklist match for testing, prefix the IMEI with the env-var
    # OWMEE_CEIR_TEST_BLACKLIST (handled elsewhere if ever needed).
    return {
        "status": "clean",
        "checked_at": now,
        "source": "ceir_mock",
    }
