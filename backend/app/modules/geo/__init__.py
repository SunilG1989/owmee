"""Geo module — reverse geocoding and address search proxy.

Wraps Nominatim (OpenStreetMap) with Redis caching to avoid rate limits and
to keep the mobile app's network surface clean. Mobile clients NEVER call
Nominatim directly — always through these endpoints.

Endpoints:
- GET /v1/geo/reverse?lat=&lng=  → reverse geocode to display name + address
- GET /v1/geo/search?q=          → forward search for address autocomplete
"""
