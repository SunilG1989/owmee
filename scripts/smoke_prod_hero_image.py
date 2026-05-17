#!/usr/bin/env python3
"""Smoke-test that production returns the cleaned primary listing image first.

Usage:
  python3 scripts/smoke_prod_hero_image.py \
    --listing-id 7d79da1b-965e-4bb7-8ec4-e82bb2b73ac0

This does not mutate production. It checks:
  - API health is reachable
  - listing detail has thumbnail_url and image_urls
  - image_urls[0] matches thumbnail_url after stripping signed query params
    and thumbnail/display suffixes
"""

from __future__ import annotations

import argparse
import json
import sys
from urllib.parse import unquote, urljoin, urlparse
from urllib.request import Request, urlopen


DEFAULT_API_URL = "https://owmee-api.onrender.com"


def fetch_json(url: str) -> dict:
    request = Request(url, headers={"Accept": "application/json"})
    with urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def image_identity(url: str) -> str:
    path = unquote(urlparse(url).path).lstrip("/")
    if path.startswith("owmee-media/"):
        path = path[len("owmee-media/") :]
    return (
        path.split("?", 1)[0]
        .removesuffix(".thumb.webp")
        .removesuffix(".display.webp")
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-url", default=DEFAULT_API_URL)
    parser.add_argument("--listing-id", required=True)
    args = parser.parse_args()

    api_url = args.api_url.rstrip("/") + "/"
    health = fetch_json(urljoin(api_url, "health"))
    if health.get("status") != "ok":
        print(f"FAIL health: {health}", file=sys.stderr)
        return 1

    listing = fetch_json(urljoin(api_url, f"v1/listings/{args.listing_id}"))
    thumbnail = listing.get("thumbnail_url")
    image_urls = listing.get("image_urls") or []
    if not thumbnail or not image_urls:
        print("FAIL listing is missing thumbnail_url or image_urls", file=sys.stderr)
        return 1

    thumb_id = image_identity(thumbnail)
    first_id = image_identity(image_urls[0])
    if first_id != thumb_id:
        print(
            "FAIL primary image mismatch:\n"
            f"  thumbnail identity: {thumb_id}\n"
            f"  first image identity: {first_id}",
            file=sys.stderr,
        )
        return 1

    print("OK production hero image order")
    print(f"listing_id={listing.get('id')}")
    print(f"title={listing.get('title')}")
    print(f"primary_identity={first_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
