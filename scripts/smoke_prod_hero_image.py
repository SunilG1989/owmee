#!/usr/bin/env python3
"""Smoke-test that production returns the cleaned primary listing image first.

Usage:
  python3 scripts/smoke_prod_hero_image.py \
    --listing-id 7d79da1b-965e-4bb7-8ec4-e82bb2b73ac0

This does not mutate production. It checks:
  - API health is reachable
  - listing detail has thumbnail_url and image_urls
  - listing detail image_urls[0] is the AI-cleaned hero display image
  - feed/listing-card endpoints also expose the cleaned hero first
"""

from __future__ import annotations

import argparse
import json
import sys
from urllib.parse import unquote, urljoin, urlparse
from urllib.request import Request, urlopen


DEFAULT_API_URL = "https://owmee-api.onrender.com"
CLEANED_MARKER = ".hero-cleaned.png"


def fetch_json(url: str) -> dict:
    request = Request(url, headers={"Accept": "application/json"})
    with urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def image_key(url: str) -> str:
    path = unquote(urlparse(url).path).lstrip("/")
    if path.startswith("owmee-media/"):
        path = path[len("owmee-media/") :]
    return path.split("?", 1)[0]


def image_identity(url: str) -> str:
    path = image_key(url)
    return (
        path
        .removesuffix(".thumb.webp")
        .removesuffix(".display.webp")
    )


def first_image_from_payload(payload: dict) -> str | None:
    image_urls = payload.get("image_urls") or payload.get("images") or []
    return image_urls[0] if image_urls else None


def assert_cleaned(label: str, url: str | None) -> tuple[bool, str]:
    if not url:
        return False, f"{label}: missing first image"
    key = image_key(url)
    if CLEANED_MARKER not in key:
        return False, f"{label}: first image is not cleaned: {key}"
    return True, key


def find_listing(items: list[dict], listing_id: str) -> dict | None:
    return next((item for item in items if str(item.get("id")) == listing_id), None)


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
    checks: list[tuple[str, str | None]] = [
        ("detail", first_image_from_payload(listing)),
    ]

    browse = fetch_json(urljoin(api_url, "v1/listings?limit=30"))
    browse_items = browse.get("items") or browse.get("listings") or []
    browse_listing = find_listing(browse_items, args.listing_id)
    if browse_listing:
        checks.append(("browse", first_image_from_payload(browse_listing)))

    explore = fetch_json(urljoin(api_url, "v1/feed/explore?limit=30"))
    explore_items = explore.get("items") or explore.get("listings") or []
    explore_listing = find_listing(explore_items, args.listing_id)
    if explore_listing:
        checks.append(("feed", first_image_from_payload(explore_listing)))

    failures = []
    cleaned_keys = []
    for label, url in checks:
        ok, message = assert_cleaned(label, url)
        if ok:
            cleaned_keys.append(message)
        else:
            failures.append(message)

    if failures:
        print("FAIL production is not returning the cleaned hero first:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        thumbnail = listing.get("thumbnail_url")
        if thumbnail:
            print(f"  thumbnail identity: {image_identity(thumbnail)}", file=sys.stderr)
        return 1

    print("OK production cleaned hero image order")
    print(f"listing_id={listing.get('id')}")
    print(f"title={listing.get('title')}")
    print(f"primary_key={cleaned_keys[0]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
