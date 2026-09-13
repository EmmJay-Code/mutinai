# ADR-0008: Live source ingestion

Status: accepted · 2026-09-13

## Context
Mutinai moves from fixture data to structured public sources (Hugging Face Hub, GitHub, official feeds, arXiv) as
canonical inputs. AI enrichment comes later and is never a source of facts. The pipeline from ADR-0005 stays; this
records what live sources required on top of it.

## Decisions

1. **Adapters stay at the boundary.** Live adapters implement the same `fetch`/`normalize` contract as fixtures. They
   do HTTP through one `HttpClient`: an explicit User-Agent, timeouts, bounded retries, Retry-After, IETF `RateLimit`
   and GitHub `x-ratelimit-*` handling, and conditional requests. Failures are errors, never a silent fallback to
   fixtures. Fixture adapters remain for tests, local development and deterministic demos, and live sources are
   selected explicitly (`ingest huggingface`, not `ingest all`).
2. **Snapshots are projections.** Each adapter retains only the fields normalization uses. Volatile counters
   (downloads, likes, stars, forks) and bulky or licensed text are excluded: no model-card bodies, no release-note
   bodies beyond a first line, no article bodies beyond a 280-character excerpt, no PDFs. Unchanged items therefore
   hash identically, and repeat runs are no-ops. Counters go to `ecosystem.entity_metric`, one row per entity,
   metric, source and day.
3. **Resolution never guesses; it queues.** `ingest.review_item` holds stable reason codes (`unknown_base`,
   `new_first_party_model`, `first_party_variant_kind`, `possible_reupload`, `unknown_quantization`,
   `unmapped_license`, …). Each item carries candidate matches and source-reported facts. Blocking items leave the
   snapshot `unresolved`; advisory items annotate applied data. Specific rules:
   - Post-trained weights from a model's own developer are first-party variants whose kind needs an editor. They
     are not community fine-tunes.
   - A third-party repo with a known variant's name is a likely re-upload, not a new variant.
   - LoRA adapters are recorded as unsupported.
   - Merges need every parent resolved, and all parents must share one model.
   - Unmapped licenses stay null.
   - Source-reported architecture facts are compared against canonical models and flagged, never applied.
4. **Unresolved snapshots are re-evaluated when seen again.** Resolution depends on catalog state as well as on the
   payload. A snapshot that is seen again and still unresolved is re-applied, which is idempotent. Open review items
   it no longer raises are superseded. An editor's `review link` therefore takes effect on the next scheduled run
   without an upstream change.
5. **Source priority** decides which assertion is canonical: fixtures (10–40) < feeds, arXiv (50) < Hugging Face,
   GitHub (60) < editorial (reserved, 100). Lower-priority sources still add assertions (ADR-0005).
6. **Events have one identity across sources, and one owner.** A GitHub release is
   `github:<repo>:release:<tag>` whether it comes from the REST API or `releases.atom`. The source that created the
   event owns its text; other sources only add entity links. Pre-releases produce no events.
7. **One running ingestion per source**, enforced by a partial unique index. Runs stuck for 6 h are marked
   `abandoned`. Dry runs execute the full pipeline inside a transaction and roll it back.
8. **Scheduling is a cron entrypoint, not a resident worker.** `worker scheduled` runs each source listed in
   `MUTINAI_LIVE_SOURCES` with a `last-run` window and per-source defaults, then drains jobs and exits. On Render
   this is a Cron Job (billed per minute, $1/month minimum, runs never overlap) on the same private network as the
   database. A permanent worker ($7/month) is unnecessary until jobs need low latency.

## Consequences
- **Quantization schemes:** llama.cpp's own GGUF types (Q5_0, IQ4_XS, …) are catalog schemes since ADR-0009; Unsloth
  `UD-*` mixes are still queued as `unknown_quantization`.
- **Review tooling:** it is CLI-only (`review list|show|dismiss|link`). New first-party models with complete source
  evidence are added automatically (ADR-0009); new families and ambiguous models still need editorial creation.
- **Raw snapshots:** stored in the object store, which is ephemeral on Render. Live snapshots are reproducible only
  while upstream serves them, so an S3-compatible `ObjectStore` is needed before relying on retained raw data.
- **Deletions:** a repo that disappears raises `source_unavailable` for review; entities are never deleted
  automatically.
