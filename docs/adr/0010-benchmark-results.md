# ADR-0010: Benchmark evidence and results

Status: policy accepted; schema implemented in migrations `0006`–`0007`; no adapters built (September 2026)

This ADR was written in two sittings and is recorded as one decision. The first settled *what counts as benchmark
evidence and what Mutinai is allowed to redistribute*; the second read the sources the policy admits and built the
schema that can hold them honestly. The policy came first deliberately, so that the choice of sources was made
against a rule rather than the rule being fitted to whatever was easiest to scrape.

## Context

Open decision 5 in [architecture.md](../architecture.md) had been outstanding since the ontology was written: which
benchmark sources are trusted, how evaluation settings are normalised, and how conflicting reports are displayed.

Ingestion is live for Hugging Face, GitHub, arXiv and feeds (ADR-0008), and the first attempt at a benchmark source
ran into the licensing problem directly: Artificial Analysis publishes exactly the comparison data Mutinai wants, and
its free Data API tier grants internal use only with no redistribution right. That made the question concrete rather
than theoretical, and it is a question about *rights and provenance*, not about scraping technique.

Reading the sources the policy does admit — LiveBench, the Berkeley Function Calling Leaderboard and Aider's polyglot
leaderboard — then turned up six things `ecosystem.benchmark_result` could not express, and one thing it displayed
wrongly.

- **Origin was too coarse.** `developer_reported | third_party | editorial` could not say that LiveBench, BFCL and
  Aider run every subject themselves, which is the whole reason to prefer them. Nor could it say what SWE-bench is:
  a registry that publishes numbers other people produced and submitted.
- **Nothing recorded what we are allowed to redistribute.** BFCL sits inside `ShishirPatil/gorilla`, Apache-2.0 at
  its root, so the grant covers the scores. Aider's leaderboard file sits inside `Aider-AI/aider`, also Apache-2.0.
  LiveBench is the awkward one: the harness repository is Apache-2.0, but the leaderboard tables are published from
  `LiveBench/livebench.github.io`, which carries no licence file at all.
- **Evaluation settings were one free-text column.** `'5-shot CoT'`, `'thinking mode'`. Meanwhile the sources encode
  configuration in the model's name: LiveBench has `claude-opus-4-5-20251101-thinking-64k-high-effort`, BFCL has
  `qwen3-0.6b-FC` and `qwen3-0.6b` as separate entries for one model. Mapping those to model variants would have
  invented models that do not exist.
- **Nothing recorded what a number is a fraction of.** BFCL's score files are headed
  `{"accuracy", "correct_count", "total_count"}`; Aider reports `pass_num_2: 18` of `test_cases: 225`. A percentage
  over 18 cases and one over 1053 were about to be stored identically.
- **Subtask scores had nowhere to go.** LiveBench's table is per-task columns and no average. BFCL's unit is the test
  category. Both were about to be flattened to one number, or have their published averages ingested as facts.
- **Leaderboard averages are not facts.** BFCL's overall is an unweighted mean within its non-live, multi-turn and
  agentic groups, a sample-weighted mean within its live group, then a fixed `[10, 10, 10, 30, 40]` weighting across
  groups — with a `TODO: adjust the weights` next to it. LiveBench's site computes category means and a mean of
  those. Ingesting either as a stored value would mean storing a number whose definition changes under us.
- **The display took `max(value)`.** `listBestBenchmarkScores` grouped by model and benchmark and took the maximum,
  mixing a benchmark's metrics, a model's variants and evaluation configurations together, and — when two sources
  disagreed — always returning the flattering number. Adding independent results to that reading would have been
  worse than not adding them: a developer's claim and an independent measurement would have silently resolved in the
  claim's favour whenever the claim was higher.

## Part A — the evidence policy

1. **Benchmark evidence is layered, and the layer is recorded, not inferred.** Five layers — developer-reported,
   independent, community, Mutinai-run, proprietary — defined in [benchmarks.md](../benchmarks.md). Layers 1–3 are
   ingestable, layer 4 is reserved for later, layer 5 is linked and never ingested.

2. **Redistribution rights are a precondition of ingestion, checked per source and recorded.** A source that does not
   grant reuse is a link. This is stored against the source so the obligation survives the person who researched it.

3. **Mutinai does not run its own evaluations yet.** The layer is defined so a future decision has somewhere to land
   and cannot be confused with independent measurement.

4. **Multiple results for the same model and benchmark coexist.** Disagreement between sources is data. Nothing
   merges rows, and nothing deletes the lower number.

5. **Summary surfaces pick one result by a stated rule, never by maximum.** The layer is shown next to the number.

6. **Capability and performance results keep separate reproduction requirements.** A capability result needs its
   harness, version and prompt settings; a performance result needs its hardware, runtime and runtime settings.
   Neither is a subset of the other, and the schema should stop pretending one shape fits both.

7. **A leaderboard that hosts runs each team performed on its own scaffold is a registry, not an independent
   measurement.** The test is who ran the evaluation, not who publishes the table. SWE-bench's leaderboard is one:
   entries are third-party submissions of the submitter's own agent runs.

## Part B — how the schema holds it

8. **A result belongs to a run.** `ecosystem.benchmark_run` holds one evaluation of one subject, under one
   configuration, from one source. `benchmark_result` keeps only the measured fact: metric, optional subtask, value,
   and the numerator and count it is a fraction of. The subject, origin, environment and provenance moved to the run.
   Subtask scores from one evaluation therefore stay together, and two sources disagreeing about the same model are
   two runs rather than one overwritten number.

9. **Origin names who produced the result.** `ecosystem.result_origin` is
   `benchmark_operator | third_party | submitted_registry | developer_reported | editorial`. Precedence is the
   function `ecosystem.result_origin_rank`, deliberately not derived from the values:

   | Rank | Value | Meaning |
   | --- | --- | --- |
   | 0 | `benchmark_operator` | the benchmark's maintainers ran every subject themselves |
   | 1 | `third_party` | an independent evaluator ran it |
   | 2 | `editorial` | Mutinai measured or entered it |
   | 3 | `submitted_registry` | produced by a submitter, published by the benchmark |
   | 4 | `developer_reported` | reported by the party it describes |

   How the policy's layers map onto it:

   | Policy layer | Recorded as |
   | --- | --- |
   | 1. Developer-reported | `developer_reported` |
   | 2. Independent | `benchmark_operator` where the benchmark ran every subject, `third_party` where an outside evaluator did |
   | 3. Community | none of these — `community.benchmark_submission`, never the canonical tables |
   | 4. Mutinai-run | `editorial` today, which is overloaded — see G13 |
   | 5. Proprietary | never a run; a `result_source` row with `redistribution = 'prohibited'` and ingestion disabled |

   Layer 2 splits in two once you ask who ran the evaluation. That distinction did not exist when Part A was written
   and is the main thing reading the real sources changed.

10. **Permission is a stored, enforced fact.** `ecosystem.result_source` records the licence that was read, the URL it
    was read from, what redistribution it permits, the credit line to display, and the date someone checked. A check
    constraint forbids `ingestion_enabled` while redistribution is `unverified` or `prohibited`, and `benchmark_run`
    carries a foreign key into `result_source (id, ingestion_enabled)`, so the database refuses runs from a source
    that is not cleared. **LiveBench is registered and blocked** on exactly this.

11. **Configuration is structured and shared.** `ecosystem.evaluation_config` holds the knobs that mean the same
    thing across sources — prompt mode, shots, chain of thought, reasoning on/off, reasoning effort, thinking budget,
    attempts — plus a structured `harness_config` for the rest, which takes part in the uniqueness key. Configurations
    are interned, so `qwen3-0.6b-FC` and `qwen3-0.6b` are one variant under two configurations, and a thinking budget
    in a leaderboard's model string never becomes a model.

12. **Subtasks are the canonical stored facts, and rollups are computed.** `ecosystem.benchmark_subtask` holds the
    source's own task or category keys, nesting one level, each node declaring how its children combine.
    `benchmark_run_rollup` reproduces the source's arithmetic from the stored facts. What the leaderboard printed goes
    on the run as `reported_rollup_value`, for reconciliation, and is never displayed as a measurement.

13. **Reading is by declared precedence, never by value.** `benchmark_result_canonical` picks one preferred report per
    measurement and counts the ones it stands in for; `benchmark_headline_result` picks one number per subject and
    benchmark, preferring the benchmark's headline metric and configuration and then the precedence above.
    `listBestBenchmarkScores` is gone; `listBenchmarkScores` reads the headline view. Where a model has several
    variants it still reports the best variant's score, which is a claim about the model's variants rather than about
    which report to believe.

14. **Source-specific fields stay in provenance.** Rank, cost, latency, logos and harness counters (Aider's
    `error_outputs`, `user_asks`, `test_timeouts`; BFCL's latency percentiles) live in `benchmark_run.raw`. They are
    not canonicalized until something cross-source needs them.

## Gaps

The gap numbering below is the original list from Part A, carried forward with its current status. Nothing is marked
closed that was not actually implemented.

| Gap | Status |
| --- | --- |
| **G1** — `result_origin` cannot express the layers | **Closed.** Replaced via a new type and column swap; five values, plus `result_origin_rank`. |
| **G2** — two origin vocabularies (`compat.ts` says `canonical` / `community_verified`) | **Open.** `loadMeasurements` still projects `'canonical'`. A reader of the compat output still cannot tell a developer-reported number from an independent one. |
| **G3** — no licence or redistribution field | **Closed.** `result_source`, with the enabled-source foreign key making it enforceable rather than advisory. |
| **G4** — evaluation configuration is one free-text column | **Closed.** `evaluation_config`, interned; the legacy `evaluation_setting` strings were parsed once in the backfill and the column dropped. |
| **G5** — no uncertainty or sample count | **Partly closed.** `sample_numerator` and `sample_count` exist, paired and range-checked. **`stderr` was not added**: none of the four sources researched publishes one, so it would have been a column of nulls. It returns when a source reports it. |
| **G6** — nothing requires a result to be citable | **Open.** `citation_url` and `source_record_id` both moved to `benchmark_run` and are both still nullable. The `num_nonnulls(...) >= 1` check was not added. |
| **G7** — no dedupe key for re-ingested results | **Closed.** `benchmark_run.dedupe_key` is unique, and `benchmark_result` is unique over `(run_id, metric_id, subtask_id)` with nulls not distinct. |
| **G8** — summary queries collapse with `max()` | **Closed.** `listBestBenchmarkScores` deleted; selection is by `result_origin_rank` in the two views. The remaining `max(...)` in `compat.ts` pivots one run's metrics into columns and does not choose between runs. |
| **G9** — community submissions capture less than layer 3 demands | **Open.** `community.benchmark_submission` is untouched: still no harness or harness version, no evidence column, no measured-on date, and `artifact_id` is still `not null`, so a community capability run of an unquantized variant cannot be filed. |
| **G10** — no supersession or retraction | **Open, deliberately.** Needed the first time a developer corrects a model card. |
| **G11** — a benchmark has three levels, not two | **Closed.** `benchmark_subtask` nests one level; rollups computed by `benchmark_run_rollup`. |
| **G12** — the subject is often a model *as configured* | **Closed.** Configuration lives in `evaluation_config`; the run still points at the real variant. |
| **G13** — `editorial` is overloaded | **New, open.** It means both "a person entered this by hand" (the seeded sample results) and "Mutinai measured this" (its rank-2 position). Policy decision 3 says those must not be confused. They need separating before Mutinai runs its first evaluation. |

## Consequences

- Migrations `0006_benchmark_result_provenance` and `0007_benchmark_runs` are one change in two files: the first adds
  the structure and backfills every existing result into a single-result run attributed to a `mutinai-catalog`
  source, parsing the free-text `evaluation_setting` strings once into structured configurations; the second drops
  the columns that moved and creates the views. The uniqueness key over `(run, metric, subtask)` is added after the
  backfill, because it cannot hold while `run_id` is null on every row.
- `reference.ts` gains the source registry and the three benchmark definitions, so they exist on every deploy whether
  or not the sample catalog was seeded — and so that enabling a source stays a decision someone makes, not something
  a deploy does.
- No adapters are built. `packages/db/test/benchmark-results.test.ts` does by hand what an adapter will do, using rows
  taken verbatim from what each source publishes, and checks that the computed rollups reproduce each source's own
  arithmetic.
- The model page reads headlines rather than raw rows, so a benchmark that stores per-task facts contributes one
  cell, and says underneath how many disagreeing reports are on record.
- Artificial Analysis and anything with comparable terms will not appear as data in Mutinai without a licence. The
  comparison tables will be thinner than a site that ignores this, and thinner honestly.
- Layer 2 will be small at first. Independent open-model results with clear reuse terms are not abundant, and the
  licence gate rejects some obvious candidates.

## What remains

1. **The LiveBench licence answer.** Registered, `redistribution = 'unverified'`, ingestion disabled and enforced.
   Unblock only on an explicit statement from the maintainers that the Apache-2.0 grant covers
   `public/table_*.csv` in `LiveBench/livebench.github.io`. Not yet asked.
2. **The first adapter.** BFCL is the fallback if the LiveBench answer does not come, and is the only one of the four
   whose licence explicitly names the leaderboard statistics.
3. **G2 and G6** are cheap and should land with the first adapter, which is the change that makes them matter.
4. **G9, G10 and G13** when community submissions, the first correction, and the first Mutinai-run evaluation arrive
   respectively.
