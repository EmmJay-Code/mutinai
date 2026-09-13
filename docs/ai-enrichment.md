# AI enrichment

Status: **architecture only, disabled.** No provider is bundled and no model output is shown anywhere.

## Principles
- **Canonical facts come from structured sources and editors.** Enrichment writes only `ecosystem.derived_content`;
  it never updates entity, variant, model, event or benchmark columns, and nothing promotes its output to fact.
- **Every row records how it was produced:**
  - task id (`generator`) and prompt version (`generator_version`)
  - `provider` and exact `model`
  - `input_hash` over task, prompt version, provider and the exact facts sent
  - `input_source_record_ids` linking the source snapshots behind those facts
- **Output starts `unreviewed`.** Any future display must require `approved` and label the text as AI-generated.
- **Regeneration is deterministic about when it happens.** Unchanged inputs are skipped; changed facts or a new
  prompt version produce a new row, and the previous one is marked `superseded_at`.
- **Grounding:** tasks send only canonical facts and instruct the model to use nothing else. Output is validated:
  it must be non-empty, within length, and contain no links.

## Code
| Piece | Location |
|---|---|
| Contract (`EnrichmentProvider`, `EnrichmentTask`, tasks, output validation) | `packages/domain/src/enrichment.ts` |
| Runner (fact loading, input hash, supersede, store) | `packages/db/src/enrichment.ts` |
| Provider selection (`MUTINAI_ENRICHMENT_PROVIDER`) | `apps/worker/src/enrichment.ts` |
| Job hook | `enrich.entity` in `apps/worker/src/handlers.ts` (emitted by ingestion for touched entities) |

Tasks defined: `entity.plain_summary` (models, variants, projects, devices) and `event.why_it_matters` (events;
runner support exists, not yet emitted as a job).

## Enabling later
1. **Choose a provider and model.** Record cost limits and a review policy.
2. **Implement the provider.** Add an `EnrichmentProvider` in the worker that reads its own key from env and fails
   clearly when the key is missing, then register it in `ENRICHMENT_PROVIDERS`.
3. **Enable it.** Set `MUTINAI_ENRICHMENT_PROVIDER=<name>` and the provider's key on the worker/cron service only,
   never on the web service.
4. **Review before showing anything.** Add an approval tool, then a UI that shows only `approved` rows with an
   "AI-generated" label.

## Candidate future tasks
Classify topics, detect duplicate stories across feeds, extract entity mentions for editor confirmation (never auto-link),
beginner explanations, importance ranking. Each needs its own task id, prompt version and validation.

## Undecided
Provider/model, budget and rate limits, whether event enrichment runs automatically, retention of superseded rows,
and the reviewers.
