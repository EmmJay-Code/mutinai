# Benchmark evidence policy

Mutinai does not publish "the score". It publishes **who measured what, how, and where that can be read**. A number
without those three things is not evidence, and is not shown.

This document is the policy. The decision and the schema work it implies are in
[ADR-0010](./adr/0010-benchmark-evidence.md). Nothing here describes an ingestion that exists yet — the sources for
layers 2 and 3 have not been chosen. The policy is written first so that the choice of sources is made against a
rule, not the other way round.

## The five layers of evidence

Every benchmark number in Mutinai belongs to exactly one layer. The layer is a fact about the number's origin, not a
judgement of its quality, and it is recorded on the row rather than inferred at display time.

| Layer | What it is | Ingested? | Shown as |
| --- | --- | --- | --- |
| 1. Developer-reported | A score the model's own developer published, in a model card, paper, release post or repository | Yes, with the page it was read from | "Reported by the developer" |
| 2. Independent | A result from an outside project that measured the model itself, **where its licence or terms permit reuse** | Yes, with attribution and the licence recorded | Named project, linked |
| 3. Community | A run submitted by a Mutinai member, reproducible from what they filed | Yes, into `community`, never into the canonical tables | Named member, with its verification state |
| 4. Mutinai-run | An evaluation Mutinai ran itself | Not yet — see below | "Measured by Mutinai" |
| 5. Proprietary | A source whose results are licensed for internal use only, or whose terms forbid redistribution | **No.** Never ingested | A link, and nothing else |

### 1. Developer-reported

The model's developer is the first and often only source for a capability score. These are real evidence — the
developer ran the evaluation — but the developer also chose the settings, chose which benchmarks to report, and has an
interest in the answer. So they are ingested and always labelled as the developer's own claim.

Requirements: the exact variant the score is about, the benchmark and metric, the evaluation setting as the developer
stated it, and the URL of the page carrying the claim. A score quoted in a news article or a leaderboard's "reported
by" column is second-hand — follow it to the developer's page, or do not ingest it.

### 2. Independent

An independent result is one produced by a project that is not the model's developer and not Mutinai. It is the most
useful layer, because it is the only one that puts different models through the same harness at the same settings.

Note what that excludes. A leaderboard that *hosts* runs each vendor or team performed on their own scaffold is a
registry of self-reported results, not an independent measurement, however reputable the registry. Those numbers are
layer 1 evidence displayed by a third party, and if they are ever ingested it is as developer-reported, attributed to
whoever ran them. The test is who ran the evaluation, not who publishes the table.

Two conditions before any independent source is ingested:

- **Reuse must actually be permitted.** The licence or terms must allow redistributing the numbers, with whatever
  attribution they require. "Publicly visible" is not permission. If the terms are silent, treat that as no.
- **The evaluation must be described.** A number from a harness whose version, few-shot count and prompt are unknown
  cannot be compared with anything, and is not worth ingesting even when the licence allows it.

The permission and the attribution text are recorded against the source, so the obligation travels with the data
instead of living in someone's memory.

Sources known to fall outside this layer today are listed under [Proprietary](#5-proprietary), with why.

Four candidates — LiveBench, SWE-bench, Aider Polyglot and BFCL — have been researched against this gate. The
findings, including which of them clear it, are in [benchmark-sources.md](./benchmark-sources.md).

### 3. Community

A community run is evidence when someone else could repeat it. A submission is accepted when it carries, at minimum:

- the exact model artifact — variant *and* quantization, not "Qwen3 30B";
- the hardware it ran on;
- the harness and its version, and the runtime and its version;
- the settings that change the answer — context length, batch size, layers offloaded, KV cache type, flash attention,
  temperature and seed where they apply;
- the score, with its metric;
- evidence — the command line and the harness's own output.

Anything missing means the submission is incomplete, not that Mutinai fills it in. Community runs stay in the
`community` schema with their own visibility, moderation and verification state; they never become canonical results,
and an unverified run is never shown as though it were verified.

### 4. Mutinai-run

Mutinai is not committing to running its own evaluation operation. If it happens later, it will be because a specific
gap justifies it — a benchmark nobody independent runs on open models, or a hardware configuration nobody has
measured — and not to have a house number next to everyone else's. When it happens, those results are labelled as
Mutinai's own and held to the same standard demanded of layer 3: harness, version, settings, hardware, and the raw
output published.

The layer exists in the policy now so that the day it is used, it is not mistaken for layer 2.

### 5. Proprietary

Some of the best benchmark data in this ecosystem is commercial. Mutinai links to it and does not take it.

**Artificial Analysis** is the current example. Its Data API's free tier grants internal use only and explicitly does
not grant redistribution; redistribution requires a commercial agreement, and its terms separately forbid
reconstructing its methodology. So: no scraping, no ingestion of its scores on any tier Mutinai holds today, and no
re-implementation of its evaluations. A link from a model page is the whole of the relationship unless a licence is
agreed.

The same rule applies to any leaderboard whose terms reserve its results. Linking is always allowed. Copying is not.

## Rules that apply to every layer

**A score without a page is not a fact.** Every canonical result carries either the snapshot it was ingested from or
an explicit citation URL. This is the same rule the hardware spec importer enforces
([hardware-data.md](./hardware-data.md)), applied to benchmarks.

**Settings are part of the number.** The same model on the same benchmark can differ by ten points between a 0-shot
and a 5-shot run, or between harness versions. A result whose settings are unknown is stored as unknown and displayed
as unknown; it is never quietly compared against results whose settings are known.

**Results are not merged.** Two sources reporting different MMLU scores for the same model is the normal case, not a
data error. Both rows are kept, both are attributed, and neither is deleted to make the page tidier.

**One number on a summary surface is a display choice, and it is stated.** Where a surface has room for only one score
per model — a card, a comparison row — the rule is:

1. Prefer the highest layer available for that model and benchmark, in the order independent → developer-reported →
   community-verified. Mutinai-run results, if they ever exist, sit alongside independent.
2. Within a layer, prefer the most recent measurement.
3. Say which layer the shown number came from, and link to the full list of results.

Never take the maximum across layers. The best-looking number is not the most reliable one, and a summary that silently
picks it teaches readers the wrong thing about the whole page.

**Retired and contaminated benchmarks stay visible as history.** The Hugging Face Open LLM Leaderboard was retired in
2025; results measured under it are still real measurements of their time. They are labelled with their date and with
the fact that the benchmark is no longer maintained, rather than deleted.

**Capability and performance are different questions.** A capability score (MMLU, GPQA, HumanEval) is about the model
and travels with the variant. A performance measurement (tokens per second) is about a model *on specific hardware
with a specific runtime* and is meaningless without that. They are separate benchmark kinds in the schema and are
never averaged together.

## What is not decided yet

- **Which independent sources.** Four candidates researched; see
  [benchmark-sources.md](./benchmark-sources.md). LiveBench is the recommended first source, blocked on one licensing
  confirmation; BFCL is the fallback. SWE-bench's leaderboard results carry no licence and are link-only.
- **Normalisation across harnesses.** Whether two independent sources running "MMLU" at different few-shot counts are
  shown as one benchmark with two settings, or two benchmarks. Related and now evidenced: every source researched so
  far publishes *subtask* scores under a named benchmark, and computes the headline average at display time. Mutinai
  should store the subtasks and compute the roll-up, never ingest someone else's average as a fact. Currently they would be one benchmark with two settings
  recorded in free text, which is not good enough — see ADR-0010's gap list.
- **What makes a community submission verified.** Open decision 6 in [architecture.md](./architecture.md).
