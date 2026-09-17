# ADR-0010: Layered benchmark evidence

Status: policy accepted, schema changes proposed (September 2026)

## Context

Open decision 5 in [architecture.md](../architecture.md) has been outstanding since the ontology was written: which
benchmark sources are trusted, how evaluation settings are normalised, and how conflicting reports are displayed.

Ingestion is now live for Hugging Face, GitHub, arXiv and feeds (ADR-0008), and the first attempt at a benchmark
source ran into the licensing problem directly: Artificial Analysis publishes exactly the comparison data Mutinai
wants, and its free Data API tier grants internal use only with no redistribution right. That made the question
concrete rather than theoretical, and it is a question about *rights and provenance*, not about scraping technique.

The decision is therefore taken before any adapter is written, and no benchmark scraper is built as part of this ADR.

## Decisions

1. **Benchmark evidence is layered, and the layer is recorded, not inferred.** Five layers — developer-reported,
   independent, community, Mutinai-run, proprietary — defined in [benchmarks.md](../benchmarks.md). Layers 1–3 are
   ingested, layer 4 is reserved for later, layer 5 is linked and never ingested.

2. **Redistribution rights are a precondition of ingestion, checked per source and recorded.** A source that does not
   grant reuse is a link. This is stored against the source so the obligation survives the person who researched it.

3. **Mutinai does not run its own evaluations yet.** The layer is defined so a future decision has somewhere to land
   and cannot be confused with independent measurement.

4. **Multiple results for the same model and benchmark coexist.** Disagreement between sources is data. Nothing merges
   rows, and nothing deletes the lower number.

5. **Summary surfaces pick one result by a stated rule, never by maximum.** Order: independent (and Mutinai-run) →
   developer-reported → community-verified; within a layer, most recent; the layer is shown next to the number.

6. **Capability and performance results keep separate reproduction requirements.** A capability result needs its
   harness, version and prompt settings; a performance result needs its hardware, runtime and runtime settings.
   Neither is a subset of the other, and the schema should stop pretending one shape fits both.

## What the schema already supports

Inspected at `packages/db/src/schema/ecosystem.ts`, `.../community.ts`, `.../ingest.ts` and the queries in
`packages/db/src/queries/`.

- **Coexistence works today.** `ecosystem.benchmark_result` has no unique constraint over (benchmark, metric,
  subject) — only `benchmark_result_one_subject`, which enforces that a result is about a variant *or* an artifact,
  never both. Several results for one model and benchmark can already be stored. Decision 4 needs no migration.
- **Per-result provenance exists.** `citation_url` and `source_record_id` are both on the row, and the model detail
  page already reads source name, source kind, origin, evaluation setting and citation through
  `CapabilityResultDTO` (`packages/db/src/queries/catalog.ts`).
- **Community submissions are already separate.** `community.benchmark_submission` has its own visibility, moderation
  status and `verification_state`, and `loadMeasurements` (`queries/compat.ts`) admits only verified submissions and
  can exclude them entirely. Decision 1's separation of layer 3 from layers 1–2 is structurally in place.
- **Performance reproduction detail is good.** `ecosystem.run_environment` records runtime, runtime version, backend,
  context length, prompt and generation tokens, batch size, GPU layers, KV cache type, flash attention, OS, driver
  version and a free `parameters` map, and is shared by canonical results and community submissions.

## Gaps

Each gap says whether changing it needs a migration. Nothing in this list has been applied.

### G1 — `result_origin` cannot express the layers · **migration required**

`ecosystem.result_origin` is `('developer_reported', 'third_party', 'editorial')`.

- `third_party` conflates a licensed independent harness with a blog post.
- There is no value for Mutinai-run. `editorial` currently means "a person entered this by hand" (the seed uses it for
  performance results), which is a different claim from "Mutinai ran this".
- Community is correctly absent — it lives in `community.benchmark_submission` — but see G2.

Proposed values: `developer_reported`, `independent`, `mutinai_run`, `editorial`. Note that `ALTER TYPE … ADD VALUE`
cannot be used and then *referenced* inside the same transaction, and the Drizzle migrator runs each file in one; so
the safe form is a new type, a column swap and a drop, in that order, with the `third_party` → `independent` mapping
done explicitly rather than by rename.

### G2 — two origin vocabularies · **no migration** (TypeScript only)

`queries/compat.ts` labels measurements `'canonical' | 'community_verified'`, which is a different vocabulary from
`result_origin`. A reader of the compat output cannot tell a developer-reported number from an independent one. One
union type in `@mutinai/domain` should cover all layers, with the compat query projecting into it.

### G3 — no licence or redistribution field · **migration required**

Neither `ingest.source` (key, name, kind, base URL, priority) nor `ecosystem.benchmark` (kind, homepage URL,
methodology) can record terms. Decision 2 needs, on the source: a licence identifier, the required attribution text, a
terms URL, and an explicit `redistribution_allowed` flag that ingestion refuses to run without. Layer 5 sources are
then rows that exist for linking with the flag false, rather than sources that are simply absent and might get added
by someone who does not know why they were missing.

### G4 — capability evaluation configuration is one free-text column · **migration required**

`benchmark_result.evaluation_setting` is `text`. For a capability result this must carry the harness (e.g.
lm-evaluation-harness) and its version, the few-shot count, the prompt template or task revision, the dataset
revision, the scoring method, and temperature/seed where sampling applies. As free text these cannot be compared,
filtered, or checked for "same settings" before two numbers are shown side by side — which decision 5 and the
normalisation question in benchmarks.md both depend on.

`run_environment` cannot absorb this: `runtime_id` is `not null` and `run_environment_one_hardware` requires exactly
one hardware reference, so a capability evaluation that ran on someone else's cluster, or through an API, has no
representable row. Options are a sibling `evaluation_config` table keyed the same way, or relaxing
`run_environment`'s constraints for capability rows; the sibling table is cleaner and does not touch the performance
path.

### G5 — no uncertainty or sample count · **migration required**

`value` is a single `double precision`. Independent harnesses report a standard error, and pass@k figures depend on
the number of samples. Without `stderr` and `sample_count`, two results that differ inside their error bars are shown
as if one beat the other.

### G6 — nothing requires a result to be citable · **migration required** (check constraint)

Both `citation_url` and `source_record_id` are nullable, so a row with neither is legal. The policy's first rule says
that row should not exist. A `num_nonnulls(citation_url, source_record_id) >= 1` check makes the rule structural,
after auditing existing seed rows.

### G7 — no dedupe key for re-ingested results · **migration required** (index only)

Coexistence is wanted between *different* sources; the same source record ingested twice should not create a second
row. A unique index on (benchmark_id, metric_id, subject, source_record_id, evaluation config) is the cheap version
of this and can wait until the first real adapter.

### G8 — summary queries collapse with `max()` · **no migration**

`listBestBenchmarkScores` selects `max(br.value)` grouped by model and benchmark, ignoring origin, settings and which
variant produced it. `listCapabilityProfiles` and `benchmarkFrontier` both build on that shape. Today every capability
row in the seed is developer-reported, so the maximum happens to be within one layer and nothing on the site is
currently wrong. The moment a second source lands, this becomes exactly the behaviour decision 5 forbids: silently
showing the best-looking number across layers. **This must be replaced with the stated precedence in the same change
that introduces the second source**, and the DTO must carry the origin so the surface can label it.

### G9 — community submissions capture less than layer 3 demands · **migration required**

Against the layer 3 checklist, `community.benchmark_submission` (submitter, artifact, benchmark, environment, notes,
visibility, status, verification) is missing:

- **harness and harness version** — `run_environment.runtime_version` is the *runtime's* version, not the harness's;
- **evidence** — there is no column for the command line or the harness output; `notes` is prose and cannot be
  required or checked;
- **when it was measured** — only `created_at`, the time it was filed;
- **capability submissions** — `artifact_id` is `not null`, so a submission can only ever be about a quantized
  artifact. A community MMLU run of an unquantized variant cannot be filed at all. The same `one_subject` check
  `benchmark_result` uses would fix it.

### G10 — no supersession or retraction · **migration required**, decide later

There is no way to mark a result as withdrawn (contamination found, developer corrected their card) while keeping it
visible as history. `ingest.review_status` has a `superseded` value for source records; results have no equivalent.
Not needed before the first independent source, but it will be needed the first time a developer edits a model card.

## Sequencing

1. This ADR and [benchmarks.md](../benchmarks.md) — done, no code.
2. Choose independent sources against the layer 2 licence gate. In progress, outside this ADR.
3. One migration covering G1, G3, G4, G5, G6 and G9, written against the chosen sources so the columns match what
   those sources actually publish rather than what they might.
4. G2 and G8 in the same change as the first independent adapter, because that is the change that makes them wrong.
5. G7 and G10 when the first source is re-ingested and the first correction arrives, respectively.

## Consequences

- Artificial Analysis and anything with comparable terms will not appear as data in Mutinai without a licence. The
  comparison tables will be thinner than a site that ignores this, and thinner honestly.
- Layer 2 will be small at first. Independent open-model results with clear reuse terms are not abundant, and the
  licence gate will reject some obvious candidates.
- Until step 3 lands, capability results keep their free-text evaluation setting, which means "same settings" cannot
  be checked programmatically and side-by-side comparison stays a display of separately-attributed numbers rather
  than a like-for-like ranking. That is the correct behaviour for the data currently held.
