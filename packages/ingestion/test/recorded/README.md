# Recorded source responses

Real, unmodified API responses used by tests so the suite never needs network access.

`huggingface/*.json`: `GET https://huggingface.co/api/models/{repo}?blobs=true&expand[]=…` (the live adapter's
detail request) and one `GET /api/models?author=Qwen&sort=lastModified…` listing, recorded 2026-09-13 without
authentication. Tests override individual fields to simulate upstream changes.

Re-record with the same URLs when the Hub response shape changes; keep the set small.

`bfcl/data_overall.csv`: seven rows of `GET https://gorilla.cs.berkeley.edu/data_overall.csv` (the published BFCL
leaderboard), recorded 2026-09-17. Columns are unmodified and in published order; only rows were dropped, chosen to
cover a model with no Hugging Face id, a model registered twice under one display name, and the models the sample
catalog actually holds.

`bfcl/model_config.py`: nine entries copied verbatim from
`ShishirPatil/gorilla:berkeley-function-call-leaderboard/bfcl_eval/constants/model_config.py`, same date, with only
the surrounding mapping trimmed.

Both are Apache-2.0 (gorilla repository root; the leaderboard README grants the statistics by name). Re-record from
the same URLs if BFCL changes its columns or adds a dataset generation.
