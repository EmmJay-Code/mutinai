# Recorded source responses

Real, unmodified API responses used by tests so the suite never needs network access.

`huggingface/*.json`: `GET https://huggingface.co/api/models/{repo}?blobs=true&expand[]=…` (the live adapter's
detail request) and one `GET /api/models?author=Qwen&sort=lastModified…` listing, recorded 2026-09-13 without
authentication. Tests override individual fields to simulate upstream changes.

Re-record with the same URLs when the Hub response shape changes; keep the set small.
