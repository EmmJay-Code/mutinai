# ADR-0002: Ecosystem ontology

Status: accepted · 2026-09-12

## Context
The open-model ecosystem is routinely flattened into strings ("llama3.1:8b-instruct-q4_K_M").
That string encodes a developer, family, release, parameter size, post-training
variant, quantization scheme, file format and publisher. Mutinai needs each of
those as a first-class, linkable, attributable fact.

## Decision

### Entity supertype
Every ecosystem object has a row in `ecosystem.entity` (`id`, `kind`, `slug`,
`name`, `summary`, search document). Kind-specific tables (`model`, `hardware_device`, …)
use the same primary key as a foreign key to `entity` (class-table inheritance).
This gives one identity space for provenance, relations, reviews, events, aliases
and search, while keeping typed columns and real foreign keys per kind.

### Model hierarchy

```
organization ──develops──▶ model_family (Qwen)            lineage/brand; optional parent family (Qwen Coder ⊂ Qwen)
                               └─ model_release (Qwen2.5)  dated generation, license, announcement
                                    └─ model (Qwen2.5 32B) one trained architecture: params, active params, layers, KV geometry, context
                                         └─ model_variant (Qwen2.5-32B-Instruct) a published set of weights: base / instruct / reasoning / coder / distill / fine-tune; publisher may differ from developer
                                              └─ model_artifact (…-Instruct Q4_K_M GGUF by publisher X) concrete downloadable weights
quantization_scheme (Q4_K_M, AWQ-4bit, MLX-4bit, FP8, BF16)   referenced by artifacts; bits-per-weight, format
```

- **Family vs. release vs. model**: a family is a lineage, a release is a dated
  generation with its own license and announcement, a model is a distinct
  architecture/size. Parameter count and KV geometry live on `model`, because
  every variant and quantization of that model shares them.
- **Variant**: a weight set. Instruct, reasoning and coder post-trains of the same
  base architecture are variants. Community fine-tunes and distills are variants
  whose `publisher_org_id` differs from the model developer; lineage to other
  variants (`fine_tuned_from`, `distilled_from`, `merged_from`, `quantized_from`)
  is recorded in `entity_relation`.
- **Quantization** is split into a reusable *scheme* (what Q4_K_M means) and an
  *artifact* (this specific file set, its byte size, its publisher and source repo).
  Unquantized native weights are an artifact with scheme `bf16`/`fp16`.

### Hardware
- `hardware_device`: a product SKU (RTX 4090, Apple M3 Max 40-core GPU). Memory is
  `dedicated` (fixed `memory_gb`) or `unified` (memory set per configuration),
  plus memory bandwidth, and the compute backends it supports (CUDA, Metal, ROCm, Vulkan, CPU).
- `hardware_configuration`: an assembled system — components (device × count),
  system RAM, unified memory size, RAM bandwidth. Reference configurations are
  public; user configurations are owned by a profile with a visibility level.

### Runtimes, tools, projects
- `project` is any open-source tool/project (UI, agent, fine-tuning, eval, gateway…).
- `runtime` extends `project` 1:1 for inference engines, with supported weight
  formats, supported backends, and whether it can offload layers to system RAM.

### Benchmarks and results
- `benchmark` (capability or performance) → `benchmark_metric` (unit, direction)
  and `benchmark_subtask` (the source's own tasks or categories, nesting one
  level). A benchmark names its headline metric and how its subtasks roll up.
- `benchmark_run`: one evaluation of one variant or artifact, under one
  `evaluation_config`, from one `result_source`, optionally with a
  `run_environment` (hardware config, runtime, version, backend, context, batch,
  offload, …).
- `benchmark_result`: one measured fact inside a run — metric, optional subtask,
  value, and the numerator and count it is a fraction of.
- `result_source` records what the source's licence permits; `evaluation_config`
  keeps prompt mode, thinking effort and the rest out of model identity. Both are
  described in [ADR-0010](0010-benchmark-results.md).
- Community `benchmark_submission`s live in the `community` schema with their own
  `run_environment` and measurements, moderation status and visibility. They are
  never silently merged into canonical results.

### Events and relations
- `event` (model release, runtime release, hardware launch, benchmark update,
  announcement) links to any entities through `event_entity` with a role.
- `entity_relation(subject, predicate, object)` holds cross-cutting typed
  relationships. Allowed subject/object kinds per predicate are enforced by the
  domain layer (`packages/domain/src/ontology.ts`) and tested.

### Provenance
- `ingest.source` (system: huggingface, github, rss, editorial, fixture),
  `ingest.source_record` (a raw payload snapshot, content-hashed, stored in the
  object store), `ingest.external_identifier` (source + external id → entity),
  `ingest.field_assertion` (entity + field + value + source record + time).
- Canonical rows carry `source_record_id` where applicable; `field_assertion`
  answers "where did this value come from, and what did other sources say".
- `ecosystem.derived_content` stores AI-generated or computed summaries with
  generator, version and input source records. Derived content is never canonical.

## Consequences
- Queries that display "Qwen2.5 32B Instruct Q4_K_M" join 5 tables; the query layer
  owns these joins and exposes DTOs.
- Adding a new entity kind means: enum value, kind table, domain validation, query DTO.
- Some real-world cases (merges of multiple parents, MoE-of-experts from different
  bases) are expressible only via relations, which is intentional.
