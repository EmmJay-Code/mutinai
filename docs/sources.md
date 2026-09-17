# Source notes (researched 2026-09-12/13)

Official documentation was checked for each source, and responses were confirmed with small real requests except
where noted. Re-check limits before raising volumes.

## Hugging Face Hub
- **Endpoints:**
  - `GET /api/models?author=…&sort=lastModified&direction=-1&limit≤1000&expand[]=…` (pagination via
    `link: <…cursor=…>; rel="next"`)
  - `GET /api/models?filter=base_model:<relation>:<repo>` (derivatives)
  - `GET /api/models/{repo}?blobs=true&expand[]=…` (detail with file sizes). `expand[]` *replaces* the default
    fields.
  - Useful fields: `baseModels {relation, models}`, `safetensors {total, parameters}`,
    `gguf {total, architecture, context_length}`, `cardData.license`, `siblings[].size`, `pipeline_tag`,
    `library_name`, `config.model_type/quantization_config`. `config` does *not* contain layer counts.
- **Missing or private repos** return **401**, not 404.
- **Without credentials:** all public metadata, including gated models' metadata, at 500 requests / 5 min
  (`ratelimit: "api";r=…;t=…`).
- **With a free token:** 1,000 / 5 min (PRO 2,500) and private/org repos.
- **Terms:** public content is licensed to users for display; model cards remain under their repository licenses.
- **Stored:** repo id, lineage, license key, pipeline/library, weight file names and sizes, parameter totals.
- **Not stored:** README bodies, chat templates. Downloads and likes are kept as daily metrics only.

## GitHub REST API
- **Endpoints:** `GET /repos/{o}/{r}`, `GET /repos/{o}/{r}/releases?per_page≤100` (Link pagination), `GET /rate_limit`
  (free). Send `X-GitHub-Api-Version: 2022-11-28` and a User-Agent (required).
- **Without credentials:** 60 requests/hour per IP, which covers about 25 repositories per hour at two requests each.
  Unauthenticated 304s still use quota.
- **With a token:** 5,000/hour, and 304 responses to conditional requests are free. A fine-grained token with no
  repository permissions is enough for public data.
- **Terms:** API use is not scraping under the Acceptable Use Policies. Avoid excessive request rates, don't share
  tokens, and don't collect personal data.
- **Stored:** description, homepage, language, license, topics, release tag/title/date/URL and the first line of the
  notes.
- **Not stored:** contributor or personal data, full release notes. Stars, forks and watchers are kept as daily
  metrics.
- **Policy note:** llama.cpp publishes every `b…` build as a pre-release, so it currently produces no release events.

## arXiv
- **Endpoint:** `https://export.arxiv.org/api/query?search_query=…&sortBy=lastUpdatedDate&sortOrder=descending&start=…&max_results≤2000`.
  Returns Atom (`opensearch:totalResults`, `id` `http://arxiv.org/abs/<id>v<n>`, `published` for v1, `updated` for
  the returned version). Errors come back as an entry titled `Error`.
- **Throttling:** a plain-text "Rate exceeded." body with HTTP 429. This happened during development, so tests use
  synthetic Atom built from the documented schema.
- **Terms:** at most one request every 3 seconds, one connection. Metadata, abstracts included, is CC0. Link to
  abstracts; don't host PDFs. Suggested acknowledgement: "Thank you to arXiv for use of its open access
  interoperability."
- **Stored:** id, version, title, up to 20 authors, categories, dates, a 240-character abstract excerpt.

## RSS / Atom feeds
- **Verified official feeds:** Hugging Face blog, Qwen blog, Mistral news (served as `text/plain`, valid RSS), Ollama
  and vLLM `releases.atom`. Also available but not enabled: Google DeepMind, Google AI, Google Research, PyTorch,
  NVIDIA developer blog (all broad). Meta AI has no official feed.
- **Practice:** conditional GET; dedupe by guid/Atom id; parse RFC 822 and RFC 3339 dates; don't trust Content-Type.
  The Hugging Face blog feed carries its whole history (861 entries), so each feed is capped at its 20 newest entries.
- **Stored:** feed key, entry id, title, canonical URL (tracking parameters removed), author, categories, dates, a
  280-character plain-text excerpt. Articles are never republished.

## Benchmark result sources

Researched 2026-09-17. Read for field shapes and licences before any adapter was written. Nothing below is ingested
yet; the registry lives in `packages/db/src/reference.ts` and the schema is described in
[ADR-0010](adr/0010-benchmark-results.md).

This section is the registered state of each source. The policy that admits or refuses a source is
[benchmarks.md](benchmarks.md), and the full research record — including the fields each source publishes and what an
adapter would need — is [benchmark-sources.md](benchmark-sources.md).

### LiveBench — **blocked**
- **Data:** `LiveBench/new-livebench`, `public/table_<date>.csv` (a `model` column plus one column per task, scored
  0–100) with `public/categories_<date>.json` mapping categories to those task columns. The 2026-06-25 table has 23
  task columns under 7 categories and 58 model rows. 11 releases, `2024_06_24` to `2026_06_25`.
- **This is the live publisher, verified 2026-09-17.** Two repositories in the org carry a `public/table_*.csv` set.
  `new-livebench` is the one whose `gh-pages` branch has `CNAME = livebench.ai`, and the table served at
  `https://livebench.ai/table_2026_06_25.csv` is byte-identical to its copy. `livebench.github.io` is the legacy site
  repo: its Pages serve `livebench.github.io`, and its tables were last updated 2026-07-06 against 2026-09-16.
- **No averages in the file.** Category averages and the global average are computed by the site: a category is the
  mean of its tasks, the global average the mean of the categories.
- **Configuration is in the model string.** Entries like `claude-opus-4-5-20251101-thinking-64k-high-effort` are one
  model under one configuration. An adapter must split them, not create a variant. The source agrees: `modelLinks.js`
  groups effort variants under a base model via a `variants` list, which `getVariantGroup` resolves.
- **Model identity is good.** `src/Table/modelLinks.js` keys every table row; 56 of 58 rows resolve (46 directly, 10
  as effort variants), and 18 of the 19 open-weight rows carry an explicit `huggingface:` repo URL. A model with no
  entry is hidden from the leaderboard.
- **No sample counts** in `table_*.csv`, so numerator and count stay null. The optional `cost_<date>.csv`, present for
  2026-06-25 in `new-livebench` only, carries `nq_<subtask>` question counts.
- **Licence:** `LiveBench/LiveBench` carries an Apache-2.0 `LICENSE`, prefaced "The original LICENSE from
  FastChat is copied below" (GitHub reads it as `NOASSERTION`). `new-livebench` has **no licence file**, and neither
  does `livebench.github.io`. The datasheet's grant — "distributed under the Apache License 2.0", "no copyrights on
  the data", "no fees or restrictions" — sits in a section about distributing *the question set* via
  `huggingface.co/livebench`, and none of those HF datasets declares a licence tag either.
- **Status:** registered with `redistribution = 'unverified'` and `ingestion_enabled = false`, which the database
  enforces. Unblock only on an explicit statement from the maintainers that the Apache 2.0 grant covers
  `public/table_*.csv`. **Asked 2026-09-17: [LiveBench/new-livebench#53](https://github.com/LiveBench/new-livebench/issues/53)**
  — that issue is the pending decision, and the answer on it is what unblocks this source.

### Berkeley Function Calling Leaderboard (BFCL) — **ingested**

The first independent benchmark source. Adapter: `packages/ingestion/src/adapters/bfcl.ts`; run it with
`npm run worker -- ingest bfcl [--dry-run]`.

- **Data:** `https://gorilla.cs.berkeley.edu/data_overall.csv` — plain CSV, no auth, no HTML scraping, whose columns
  are `COLUMNS_OVERALL` in `bfcl_eval/constants/column_headers.py`. 109 model rows when read 2026-09-17, with
  `Last-Modified: 13 Apr 2026` and an ETag for conditional requests. Per-group tables are published alongside it
  (`data_live.csv`, `data_non_live.csv`, `data_multi_turn.csv`, `data_agentic.csv`) and are not read: the overall
  table carries every column needed.
- **Not the Hugging Face Space.** `gorilla-llm/berkeley-function-calling-leaderboard` is a three-file static stub
  last touched in August 2024 and holds no data. Earlier notes pointing at a `data.csv` there were wrong.
- **No counts are published.** The harness writes `{"accuracy", "correct_count", "total_count"}` score files
  locally, but those are not committed and the published CSV has no count columns. So every BFCL result stores a
  percentage with `sample_numerator` and `sample_count` null, rather than a numerator reverse-engineered from a
  rounded percentage.
- **Categories:** 18 scored columns are stored as subtasks. `Relevance Detection` is published but deliberately not
  stored as a fact: `eval_runner_helper.py` computes `total_relevance` and then does not include it in the overall.
  It is kept in the run's raw payload. Version prefix `BFCL_v4`, matching `bfcl_eval/data/BFCL_v4_*.json`.
- **Overall accuracy is a mixture, and is recomputed rather than ingested:** unweighted means within the non-live,
  multi-turn and agentic groups, a question-count-weighted mean within the live group, then `[10, 10, 10, 30, 40]`
  across non-live, live, irrelevance, multi-turn and agentic — with a `TODO: adjust the weights` beside it. The live
  weights are the fixed BFCL_v4 question counts (258, 1053, 16, 24), read from the committed dataset files, which
  reproduces `calculate_weighted_accuracy` without inventing a per-model sample count. What the leaderboard printed
  is kept on the run as `reported_rollup_value`; the recomputed value matches it to within 0.004 points.
- **Non-live means four terms, not six.** `Simple AST` is already the mean of the Python, Java and JavaScript simple
  categories, and the leaderboard publishes that sub-mean rather than its parts.
- **Function calling is a configuration.** `model_config.py` carries `Qwen/Qwen3-32B-FC` and `Qwen/Qwen3-32B` with
  `is_fc_model` true and false and the same `model_name`. They are one variant under two evaluation configurations.
- **Model identity comes from `model_config.py`, not from the CSV.** The CSV names models by display name; only that
  file carries the Hugging Face repo id. Display names are not unique — BFCL registers the same weights twice when
  it evaluates them through a vendor API and from the Hub — so a row resolves only when its candidates agree on a
  single repo id. A row with no repo id, or with two, is skipped and reported; nothing is matched by name similarity.
- **Not canonicalized:** rank, total cost, latency mean/standard deviation/95th percentile, format-sensitivity
  spread, organization and licence strings. These go in run provenance.
- **Licence:** Apache-2.0 at the repository root, and the leaderboard README grants the statistics by name: "All the
  leaderboard statistics, and data used to train the models are released under Apache 2.0." Attribution required;
  the credit line is on the `bfcl-leaderboard` source row. Maintainer contact: `huanzhimao@berkeley.edu`.
- **Freshness:** the gorilla repository was last pushed 2026-04-13 and the published table carries the same date.
  BFCL is updating more slowly than it did; that is a reason to re-check, not to distrust what it published.

### Aider polyglot
- **Data:** `Aider-AI/aider`, `aider/website/_data/polyglot_leaderboard.yml`. One record per leaderboard entry:
  `dirname`, `model`, `edit_format`, `commit_hash`, `versions`, `date`, `test_cases`, `pass_rate_1`, `pass_rate_2`,
  `pass_num_1`, `pass_num_2`, `percent_cases_well_formed`, `command`, `seconds_per_case`, `total_cost`, and harness
  counters (`error_outputs`, `num_malformed_responses`, `num_with_malformed_responses`, `user_asks`,
  `lazy_comments`, `syntax_errors`, `indentation_errors`, `exhausted_context_windows`, `test_timeouts`). Some
  records also carry `reasoning_effort`, `thinking_tokens`, `prompt_tokens`, `completion_tokens`, `editor_model`
  and `editor_edit_format`.
- **Two numbers per entry.** `pass_rate_1` and `pass_rate_2` are one session at one attempt and at two. Stored as
  two runs differing by configuration, not as two metrics and not as two models. The leaderboard's headline is the
  two-attempt figure.
- **Counts are published:** `pass_num_2` of `test_cases`.
- **No breakdown.** Despite covering six languages, the file publishes no per-language scores, so there are no
  subtasks.
- **`dirname` is a natural key** for idempotent re-ingestion.
- **Licence:** Apache-2.0 (`LICENSE.txt`); attribution required.

### SWE-bench — not ingested
SWE-bench's leaderboard is a registry of externally produced submissions: each entry is a result someone else ran
with their own scaffold and submitted, not a measurement the benchmark's maintainers made. It is therefore not a
canonical independent-result source, and is not registered. If it is ever ingested it belongs under origin
`submitted_registry`, which ranks below an independent run and below our own measurement, and each entry's
submitter and scaffold would have to be recorded as part of its provenance.
