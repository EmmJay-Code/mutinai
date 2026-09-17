# ADR-0010: Independent benchmark results

Status: accepted (September 2026)

## Context

Every benchmark number in the catalog so far is developer-reported and illustrative. Before independent results can
land, the schema has to be able to hold them honestly. Reading the three sources we intend to ingest first —
LiveBench, the Berkeley Function Calling Leaderboard and Aider's polyglot leaderboard — turned up six things the old
`ecosystem.benchmark_result` could not express, and one thing it displayed wrongly.

- **Origin was too coarse.** `developer_reported | third_party | editorial` could not say that LiveBench, BFCL and
  Aider run every subject themselves, which is the whole reason to prefer them. Nor could it say what SWE-bench is:
  a registry that publishes numbers other people produced and submitted.
- **Nothing recorded what we are allowed to redistribute.** BFCL sits inside `ShishirPatil/gorilla`, which is
  Apache-2.0 at its root, so the grant covers the scores. Aider's leaderboard file sits inside `Aider-AI/aider`, also
  Apache-2.0. LiveBench is the awkward one: the harness repository is Apache-2.0, but the leaderboard tables are
  published from `LiveBench/livebench.github.io`, which carries no licence file at all.
- **Evaluation settings were one free-text column.** `'5-shot CoT'`, `'thinking mode'`. Meanwhile the sources encode
  configuration in the model's name: LiveBench has `claude-opus-4-5-20251101-thinking-64k-high-effort`, BFCL has
  `qwen3-0.6b-FC` and `qwen3-0.6b` as separate entries for one model. Mapping those to model variants would have
  invented models that do not exist.
- **Nothing recorded what a number is a fraction of.** BFCL's score files are headed
  `{"accuracy", "correct_count", "total_count"}`; Aider reports `pass_num_2: 18` of `test_cases: 225`. A percentage
  over 18 cases and one over 1053 were about to be stored identically.
- **Subtask scores had nowhere to go.** LiveBench's table is 23 per-task columns and no average. BFCL's unit is the
  test category. Both were about to be flattened to one number, or have their published averages ingested as facts.
- **Leaderboard averages are not facts.** BFCL's overall is an unweighted mean within its non-live, multi-turn and
  agentic groups, a sample-weighted mean within its live group, and then a fixed `[10, 10, 10, 30, 40]` weighting
  across groups — with a `TODO: adjust the weights` next to it. LiveBench's site computes category means and a mean
  of those. Ingesting either as a stored value would mean storing a number whose definition changes under us.
- **The display took `max(value)`.** `listBestBenchmarkScores` grouped by model and benchmark and took the maximum,
  which mixed a benchmark's metrics together, mixed evaluation configurations together, mixed a model's variants
  together, and — when two sources disagreed — always returned the flattering number. Adding independent results to
  that reading would have been worse than not adding them: a developer's claim and an independent measurement would
  have silently resolved in the claim's favour whenever the claim was higher.

## Decisions

1. **A result belongs to a run.** `ecosystem.benchmark_run` holds one evaluation of one subject, under one
   configuration, from one source. `benchmark_result` keeps only the measured fact: metric, optional subtask, value,
   and the numerator and count it is a fraction of. The subject, origin, environment and provenance moved to the run.
   Subtask scores from one evaluation therefore stay together, and two sources disagreeing about the same model are
   two runs rather than one overwritten number.

2. **Origin names who produced the result**, with `benchmark_operator` for a benchmark that ran every subject itself
   and `submitted_registry` for one that publishes what others submitted. Precedence between conflicting reports is
   `ecosystem.result_origin_rank`, and it is deliberately not derived from the values: benchmark operator, then
   independent third party, then our own measurement, then a registry submission, then the party the number
   flatters.

3. **Permission is a stored, enforced fact.** `ecosystem.result_source` records the licence that was read, the URL it
   was read from, what redistribution it permits, the credit line to display, and the date someone checked. A source
   cannot be enabled while its permission is `unverified`, and `benchmark_run` carries a foreign key into
   `result_source (id, ingestion_enabled)` so the database refuses runs from a source that is not enabled. **LiveBench
   is registered and blocked** on exactly this: until its maintainers confirm that the Apache 2.0 grant covers
   `public/table_*.csv`, no adapter can write a LiveBench result even by mistake.

4. **Configuration is structured and shared.** `ecosystem.evaluation_config` holds the knobs that mean the same thing
   across sources — prompt mode, shots, chain of thought, reasoning on/off, reasoning effort, thinking budget,
   attempts — plus a structured `harness_config` for the rest, which takes part in the uniqueness key. Configurations
   are interned, so `qwen3-0.6b-FC` and `qwen3-0.6b` are one variant under two configurations, and a thinking budget
   in a leaderboard's model string never becomes a model.

5. **Subtasks are the canonical stored facts, and rollups are computed.** `ecosystem.benchmark_subtask` holds the
   source's own task or category keys, nesting one level, each node declaring how its children combine.
   `benchmark_run_rollup` reproduces the source's arithmetic from the stored facts. What the leaderboard printed goes
   on the run as `reported_rollup_value`, for reconciliation, and is never displayed as a measurement.

6. **Reading is by declared precedence, never by value.** `benchmark_result_canonical` picks one preferred report per
   measurement and counts the ones it stands in for; `benchmark_headline_result` picks one number per subject and
   benchmark, preferring the benchmark's headline metric and configuration and then the precedence above.
   `listBestBenchmarkScores` is gone; `listBenchmarkScores` reads the headline view. Where a model has several
   variants it still reports the best variant's score, which is a claim about the model's variants rather than about
   which report to believe.

7. **Source-specific fields stay in provenance.** Rank, cost, latency, logos, harness counters (Aider's
   `error_outputs`, `user_asks`, `test_timeouts`; BFCL's latency percentiles) live in `benchmark_run.raw`. They are
   not canonicalized until something cross-source needs them.

8. **SWE-bench is not an independent-result source.** Its leaderboard is a registry of externally produced
   submissions, described in [sources.md](../sources.md#swe-bench-not-ingested). If it is ever ingested, it is as
   `submitted_registry`, and the schema already ranks that accordingly.

## Consequences

- Migrations `0006_benchmark_result_provenance` and `0007_benchmark_runs` are one change in two files: the first adds
  the structure and backfills every existing result into a single-result run attributed to a `mutinai-catalog`
  source, parsing the free-text `evaluation_setting` strings once into structured configurations; the second drops
  the columns that moved and creates the views. The uniqueness key over `(run, metric, subtask)` is added after the
  backfill, because it cannot hold while `run_id` is null on every row.
- `reference.ts` gains the source registry and the three benchmark definitions, so they exist on every deploy whether
  or not the sample catalog was seeded — and so that enabling a source stays a decision someone makes, not something
  a deploy does.
- No adapters are built. `packages/db/test/benchmark-results.test.ts` does by hand what an adapter will do, using
  rows taken verbatim from what each source publishes, and checks that the computed rollups reproduce each source's
  own arithmetic.
- The model page reads headlines rather than raw rows, so a benchmark that stores 23 per-task facts contributes one
  cell, and says underneath how many disagreeing reports are on record.
