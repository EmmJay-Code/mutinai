# ADR-0009: Freshness, first-party promotion and publisher accounts

Status: accepted (September 2026)

## Context

Live ingestion (ADR-0008) went into production on 13 September 2026. Four problems showed up on the public preview:

- **Stale top story.** Discover took the 12 newest events of any origin and led with the first model release among
  them. Before live data arrived, that was the April 2025 *Qwen3 released* fixture. After the first run it was a vLLM
  sub-package tag (`proto-v0.1.0`), because no model release was in the newest 12.
- **"Trending" from lifetime counts.** Trending showed lifetime counts of demo community runs, and the most-measured
  runtime and device. Nothing about them was recent.
- **Unresolved first-party releases.** 14 of 30 Hugging Face items stayed unresolved. Every new first-party model
  (Qwen3.8, DeepSeek-V4.1, …) needed hand-seeded structure. Some of the 14 were not language models at all (materials,
  3D mesh).
- **Low-confidence organizations.** Each community fine-tune created a first-class organization, 13 in the first run,
  findable in search. Some "fine-tunes" were re-uploads that duplicated an existing variant's identity
  (`zeromodels/qwen3-30b-a3b`).

## Decisions

1. **Event time only.** Time-sensitive surfaces use when things happened, never ingest time. Rules, windows and
   significance levels are in [freshness.md](../freshness.md). With nothing significant in the window, the page says
   so. Fixtures are excluded from time-sensitive surfaces once live data exists.
2. **Trending is measured growth.** Cumulative counters are compared a week apart. Until a week of history exists,
   Discover shows that trending is not available yet.
3. **Automatic promotion of first-party root weights**, only with complete source evidence. The rules are in
   [live-ingestion.md](../live-ingestion.md#first-party-releases). A release and model are added when every rule holds.
   A variant is added only when the repository name states its kind. Anything else stays unresolved, with the unmet
   rules recorded on the review item. Evidence is stored as an `auto_promotion` field assertion on each created entity.
   New families are never created automatically, and neither is a new generation outside a family the developer
   already has.
4. **Publisher accounts are not organizations.** `organization.recognized` separates recognized ecosystem
   organizations from accounts that ingestion records as publishers:
   - Recognized: editorial ones, plus any organization that develops a family, makes hardware or maintains a project.
   - Accounts keep provenance (external identifier, variant and artifact publisher) but are excluded from organization
     search and developer facets.
5. **Re-uploads are not variants.** A derivative that repeats its declared base's repository name under another account
   is recorded as `possible_reupload` and creates nothing. So is a root repository that repeats a known variant's name.
6. **Discovery floor for community derivatives.** Derivative discovery skips repositories with fewer than 5 Hugging Face
   likes (`apps/worker/sources/huggingface.json`). Explicitly requested repositories are unaffected.
7. **Quantization schemes from llama.cpp's own definitions.** GGUF types defined in `tools/quantize/quantize.cpp` and
   `ggml/src/ggml-common.h` are catalog schemes, added on every deploy by `bootstrap`. Unsloth Dynamic (`UD-*`) mixes
   vary per model and stay unresolved.

## Consequences

- The public preview can show no top story, and an empty trending block, for days at a time. That is intended.
- Migration `0005` marks existing organizations recognized by the rule above. It removes the live-created re-upload
  variants that nothing references and marks their snapshots for re-evaluation. It also drops stored GitHub validators,
  so the next run rewrites release titles and summaries through the pipeline.
- Release dates of promoted models are Hugging Face repository creation dates. A repository created privately before
  publication dates the release early. No better source date is available from the Hub API.
- Promotion adds model structure without artifacts. Compatibility needs quantized files, which arrive through the usual
  artifact ingestion once the variant exists.
