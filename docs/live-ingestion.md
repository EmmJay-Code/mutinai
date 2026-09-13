# Live ingestion

Structured public sources feed Mutinai's canonical data. The design is in [ADR-0008](adr/0008-live-ingestion.md) and
the per-source findings (limits, terms, what is stored) are in [sources.md](sources.md).

| Source | Command | Selection | Credentials |
|---|---|---|---|
| Hugging Face Hub | `ingest huggingface` | first-party authors + derivatives of known variants (`apps/worker/sources/huggingface.json`), or `--repos`/`--authors` | optional `HUGGINGFACE_TOKEN` |
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

Start with `--dry-run` and a handful of repositories. Running any command twice is safe: unchanged snapshots are
skipped, and unresolved ones are re-evaluated without duplicating anything.

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

- Hugging Face: watchlist authors, derivatives and unresolved re-checks
- GitHub: known projects
- feeds and arXiv: their configuration

It then drains jobs and exits non-zero if any source failed. `MUTINAI_INGEST_LIMIT` caps items per source (default 300).

### Render Cron Job

1. **Choose the database.** Live data can go into the preview database (it will sit beside the fixtures, and pages
   label which is which) or into a new database without fixtures. See "Decisions" below.
2. **Add the cron service.** Uncomment the `cron` block in `render.yaml` (it keeps `DATABASE_URL` on the private
   network), commit, then sync the Blueprint in the Render dashboard.
3. **Set the tokens.** In the dashboard, set `GITHUB_TOKEN` and optionally `HUGGINGFACE_TOKEN` on the cron service.
   They are `sync: false`, so Blueprint syncs never overwrite them.
4. **Test it.** Trigger a run manually from the dashboard and read its logs, then leave the schedule to run.

Cost: a Cron Job is billed per minute of runtime on its plan (Starter $0.00016/min), with a $1/month minimum. A few
minutes, four times a day, stays at the minimum.

## Limits and politeness
- **Hugging Face:** 500 requests per 5 minutes anonymously, 1,000 with a free token. The client waits out a window
  instead of failing.
- **GitHub:** 60 requests/hour anonymously, 5,000 with a token. Conditional requests (ETags) only save quota when
  authenticated. Each run checks `/rate_limit` first and ingests only as many repositories as the quota allows.
- **arXiv:** one request every 3 seconds on a single connection. Queries are narrow.
- **Feeds:** conditional GET; a broken feed fails the run clearly after the healthy feeds are processed.
