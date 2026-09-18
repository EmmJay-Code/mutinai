# Live ingestion

Structured public sources feed Mutinai's canonical data. The design is in [ADR-0008](adr/0008-live-ingestion.md) and
the per-source findings (limits, terms, what is stored) are in [sources.md](sources.md).

| Source | Command | Selection | Credentials |
|---|---|---|---|
| Hugging Face Hub | `ingest huggingface` | curated first-party repositories + their authors + derivatives of known variants (`apps/worker/sources/huggingface.json`), or `--repos`/`--authors` | optional `HUGGINGFACE_TOKEN` |
| GitHub | `ingest github` | projects already in the catalog, or `--repos` | optional `GITHUB_TOKEN` (strongly recommended) |
| Official feeds | `ingest feeds` | `apps/worker/sources/feeds.json`, or `--feeds key,…` | none |
| arXiv | `ingest arxiv` | curated queries in `apps/worker/sources/arxiv.json` | none |
| Fixtures | `ingest fixtures` | bundled JSON | none |

## Running locally

```bash
npm run db:up && npm run db:migrate                     # an empty or seeded database
npm run ingest:huggingface -- --repos Qwen/Qwen3-30B-A3B,unsloth/Qwen3-30B-A3B-GGUF --dry-run
npm run ingest:huggingface -- --repos Qwen/Qwen3-30B-A3B,unsloth/Qwen3-30B-A3B-GGUF
npm run worker -- ingest github --repos ggml-org/llama.cpp,ollama/ollama
npm run worker -- ingest feeds --feeds qwen-blog
npm run worker -- ingest arxiv
npm run jobs                                            # drain emitted jobs (search reindex, …)
npm run worker -- status
```

Options for `ingest <source>`:

| Option | Meaning |
|---|---|
| `--dry-run` | Run the whole pipeline (resolution, review items, jobs) in a transaction and roll it back |
| `--limit N` | Process at most N items |
| `--since 7d \| 36h \| 2026-09-01 \| last-run` | Only items changed since then (`last-run`: the last successful run minus 1 h; 30 days if none) |
| `--repos a/b,c/d` | Hugging Face or GitHub repositories to fetch explicitly |
| `--authors org,…` | Hugging Face authors to list, newest-modified first |
| `--known` | Refresh every repository already mapped to the catalog |
| `--derivatives` | Hugging Face: discover quantizations/fine-tunes of known variants via `base_model` tags |
| `--recheck-unresolved` | Re-fetch items whose latest snapshot is still unresolved |
| `--feeds key,…` | Feeds subset |

Time-sensitive surfaces use event time, never ingest time: see [freshness.md](freshness.md).

Start with `--dry-run` and a handful of repositories. Running any command twice is safe: unchanged snapshots are
skipped, and unresolved ones are re-evaluated without duplicating anything.

## First-party releases

Root weights (no declared parent) published by a model developer become catalog structure automatically when every
rule holds. The rules are implemented in `packages/ingestion/src/promotion.ts`; the reasons are in
[ADR-0009](adr/0009-freshness-and-publisher-accounts.md).

| Rule | Evidence | Failure code |
|---|---|---|
| The publisher is a known developer | The `huggingface-org` identifier resolves to an organization that develops at least one family | `publisher_not_known_developer` |
| The name follows the developer convention | `<name><version>[-<line>]-<size>B[-A<active>B][-<suffix>]`, e.g. `Qwen3.8-27B`, `Qwen3-30B-A3B-Instruct-2507` | `name_not_parsed` |
| The name belongs to exactly one of that developer's families | Family named by the brand (`Mistral` for `Mistral-Small-4`), or brand plus line (`Qwen Coder`) | `no_matching_family`, `ambiguous_family` |
| Architecture is stated | config.json (or its `text_config`): layers, attention heads, KV heads, head dim, context length | `architecture_facts_incomplete` |
| The size is real | Safetensors parameter count within 15% of the size in the name | `parameter_count_missing`, `name_size_mismatch` |
| Mixture-of-experts models name their active parameters | config.json declares experts, and the name has `A<n>B` (a dense model must not) | `moe_active_params_unknown`, `dense_with_active_params` |
| Every name token is understood | Kind tokens (`Base`, `Instruct`, `it`, `Thinking`, `Coder`, `VL`, …), date codes (`2507`), versions (`v0.3`) | `unrecognised_name_tokens` |
| The source dates the publication | Hugging Face repository creation date. Ingest time is never used. | `release_date_unknown` |

- **When every rule holds:** the release is matched by name within the family or created, and so is the model within
  the release. A release created this way gets a `model_release` event dated by publication. The variant is created
  when the name states its kind. Otherwise it stays unresolved as `first_party_variant_kind`.
- **When any rule fails:** nothing is created, and the review item's `suggestion.promotion.failed` lists every unmet rule.

Evidence is stored as an `auto_promotion` field assertion on what was created. The Hugging Face adapter fetches
`config.json` only for root weights. Repositories with no language-model evidence (no pipeline tag, causal-LM
architecture or config facts) are recorded as unsupported.

## Publisher accounts

Organizations are either **recognized** (editorial: developers, hardware vendors, project maintainers) or **publisher
accounts** that ingestion records so every variant and artifact keeps its publisher. Accounts are excluded from
organization search and developer facets; an editor promotes one by setting `organization.recognized`.

A derivative that repeats its base's repository name under another account is a re-upload (`possible_reupload`) and is
not created. Derivative discovery skips repositories with fewer than `minLikes` likes (`sources/huggingface.json`).

## Quantization schemes

GGUF schemes follow llama.cpp's definitions (`tools/quantize/quantize.cpp`, `ggml/src/ggml-common.h`):

- **Bits per weight:** the documented figure for i-quants (`IQ4_XS` 4.25, `IQ3_M` 3.66, …). For other types it is the
  documented Llama-3-8B file size over 8.03B parameters, the same derivation as the original `Q4_K_M`.
- **Aliases:** `Q3_K`, `Q4_K` and `Q5_K` are llama.cpp aliases for the `_M` mixes.
- **Full precision:** `GGUF BF16` and `GGUF F16` are distinct from safetensors `BF16`.
- **Deploys:** `bootstrap` adds schemes missing from an existing database on every deploy.
- **Unresolved on purpose:** Unsloth Dynamic mixes (`UD-Q4_K_XL`, …), ternary `TQ*`, `MXFP4` and NVFP4. Their bits per
  weight vary per model or are not modelled.

## Reviewing what could not be placed

```bash
npm run review -- list                                  # open items, blocking first, with candidates
npm run review -- list --reason unknown_base --source huggingface
npm run review -- show <id>                             # detail, candidates, source-reported facts
npm run review -- link <id> model_variant:qwen3-8b      # map the external id to an existing entity
npm run review -- dismiss <id> --note "not an LLM"
```

`link` records an identifier mapping. Blocked snapshots apply on the next run with `--recheck-unresolved`, which the
scheduled run always includes, and their review items close as `superseded`. The CLI cannot yet create new families,
releases, models or quantization schemes; those need editorial data.

## Scheduled ingestion

`npm run ingest:scheduled` (worker `scheduled`) is the cron entrypoint. It runs every source in
`MUTINAI_LIVE_SOURCES`, each independently with `--since last-run` and its defaults:

- Hugging Face: watchlist repositories and authors, derivatives and unresolved re-checks
- GitHub: known projects
- feeds and arXiv: their configuration

It then drains jobs and exits non-zero if any source failed. `MUTINAI_INGEST_LIMIT` caps items per source (default 300).

### Render Cron Job

`render.yaml` defines the `mutinai-ingest` Cron Job: every 6 hours at minute 15, `MUTINAI_LIVE_SOURCES=huggingface,github,feeds`,
`MUTINAI_INGEST_LIMIT=300`, writing into the preview database `mutinai-db` over the private network. Live data sits
beside the fixtures, and pages label which is which. arXiv is not scheduled because its API rate-limited us (429). It
stays available manually (`npm run worker -- ingest arxiv`); add it to `MUTINAI_LIVE_SOURCES` once a run succeeds.

1. **Create the service.** In the Render dashboard, open the Blueprint and **Sync** it. This creates `mutinai-ingest`.
2. **Set the tokens.** Open **mutinai-ingest → Environment** and set `GITHUB_TOKEN` (fine-grained, public repositories
   read-only; strongly recommended) and optionally `HUGGINGFACE_TOKEN`. They are `sync: false`, so Blueprint syncs never
   overwrite them. Never set them on `mutinai-web`. Without `GITHUB_TOKEN`, GitHub allows 60 requests/hour: runs ingest
   only as many repositories as that covers and log a hint.
3. **Test it.** Click **Trigger Run** on the service, read its logs, then leave the schedule to run. A run exits
   non-zero, and Render marks it failed, if any source failed. The other sources still complete.

Cost: a Cron Job is billed per minute of runtime on its plan (Starter $0.00016/min), with a $1/month minimum. A few
minutes, four times a day, stays at the minimum.

## Limits and politeness
- **Hugging Face:** 500 requests per 5 minutes anonymously, 1,000 with a free token. The client waits out a window
  instead of failing.
- **GitHub:** 60 requests/hour anonymously, 5,000 with a token. Conditional requests (ETags) only save quota when
  authenticated. Each run checks `/rate_limit` first and ingests only as many repositories as the quota allows.
- **arXiv:** one request every 3 seconds on a single connection. Queries are narrow.
- **Feeds:** conditional GET; a broken feed fails the run clearly after the healthy feeds are processed.
