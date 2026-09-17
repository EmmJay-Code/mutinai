# Mutinai

An open community and intelligence platform for the open model ecosystem: open-weight models and their variants and
quantizations, the hardware they run on, runtimes and tools, benchmarks, events, and community results and reviews.

This repository is the **foundation build**: a coherent, tested, locally runnable system with realistic seeded
data and fixture-based ingestion. It does not call external services.

## Quick start

Requirements: Node ≥ 22.12, PostgreSQL 16 binaries (`initdb`, `pg_ctl`) **or** Docker.

```bash
npm install
cp .env.example .env
npm run setup          # starts an isolated Postgres on :54329, migrates, seeds
npm run ingest         # runs the Hugging Face / GitHub / RSS fixture adapters
npm run jobs           # processes emitted background jobs once
npm run dev            # http://localhost:3000
```

Using Docker instead of the local cluster: `docker compose up -d`, then set
`DATABASE_URL=postgres://mutinai:mutinai@127.0.0.1:54329/mutinai` (and the matching `TEST_DATABASE_URL`) and run
`npm run db:migrate && npm run db:seed`.

Development sign-in (`MUTINAI_DEV_LOGIN=1`, never in production builds) lists the seeded members:
`kestrel` (moderator), `tokenwright`, `basement-cluster`, `quietmodel`.

| Command | Purpose |
|---|---|
| `npm test` | Unit + integration tests (integration uses `TEST_DATABASE_URL`, rebuilt from migrations each run) |
| `npm run typecheck` | Typecheck all workspaces |
| `npm run build` | Production build of the web app |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:reset` | Drop and re-migrate the dev database |
| `npm run db:bootstrap` | Idempotent deploy step: migrate, seed once, ingest fixtures, drain jobs |
| `npm run ingest:huggingface -- --repos a/b --dry-run` | Live ingestion (also `worker -- ingest github\|feeds\|arxiv`) |
| `npm run ingest:scheduled` | Cron entrypoint for `MUTINAI_LIVE_SOURCES` |
| `npm run review -- list` | Review queue for incoming records that could not be placed |
| `npm run worker -- ingest hardware-specs --file <csv>` | Import researched hardware specs, each field citing the page it was read from ([format](docs/hardware-data.md#importing-researched-specifications)) |
| `npm run worker -- ingest <source\|fixtures>` | Run ingestion adapters |
| `npm run worker -- work` | Long-running job worker |
| `npm run worker -- status` | Job and ingestion run summary |

## Repository layout

```
apps/web          Next.js App Router: UI, public JSON API (/api/v1), server actions
apps/worker       Ingestion runs and background jobs (scales independently)
packages/domain   Pure TS: ontology rules, compatibility engine, privacy policy, ratings
packages/db       Drizzle schema + SQL migrations, query layer, job queue, identity, seed data
packages/ingestion Source-adapter contract, idempotent pipeline, object store, fixture adapters
docs/             Architecture overview and ADRs
```

Read [docs/architecture.md](docs/architecture.md) first, then the ADRs:

1. [Stack and repository layout](docs/adr/0001-stack-and-repository-layout.md)
2. [Ecosystem ontology](docs/adr/0002-ontology.md)
3. [Postgres job queue](docs/adr/0003-postgres-job-queue.md)
4. [Privacy architecture](docs/adr/0004-privacy-architecture.md)
5. [Ingestion boundary](docs/adr/0005-ingestion-boundary.md)
6. [Compatibility engine](docs/adr/0006-compatibility-engine.md)
7. [Public preview deployment](docs/adr/0007-preview-deployment.md)
8. [Live source ingestion](docs/adr/0008-live-ingestion.md)
9. [Freshness and publisher accounts](docs/adr/0009-freshness-and-publisher-accounts.md)
10. [Layered benchmark evidence](docs/adr/0010-benchmark-evidence.md)

## Live data

Live adapters for the Hugging Face Hub, GitHub, official feeds and arXiv run through the same pipeline as the fixtures,
with a review queue for anything that cannot be placed safely. See [docs/live-ingestion.md](docs/live-ingestion.md),
[docs/sources.md](docs/sources.md), [docs/ai-enrichment.md](docs/ai-enrichment.md) and [docs/hardware-data.md](docs/hardware-data.md).

## Benchmarks

Benchmark numbers are layered by who measured them, ingested only where redistribution is permitted, and never
merged into a single score. See [docs/benchmarks.md](docs/benchmarks.md) for the policy and
[docs/benchmark-sources.md](docs/benchmark-sources.md) for the research on candidate independent sources.

## Deployment

The public preview (read-only, `noindex`) deploys to Render from `render.yaml`. See [docs/deployment.md](docs/deployment.md).

## Seed data

Architecture facts (parameter counts, layers, KV heads, context) follow public model cards. Benchmark scores,
throughput numbers, prices and community content are **illustrative** and attributed to the `mutinai-fixtures`
source; the UI labels them as such. Community accounts and content are fictional.

## Known limitations

- Authentication is development-only; no production identity provider is integrated, so production builds are read-only.
- Compatibility estimates are coarse (±35%): no prompt-processing estimate, no per-runtime KV quantization,
  sliding-window attention (e.g. Gemma) overstates long-context KV memory.
- Search is Postgres full-text + trigram; no synonyms or typo-tolerant ranking beyond trigram similarity.
- Ingestion creates new variants only when a base variant is known; new first-party models and new projects
  are recorded as `unresolved` for editorial handling, which has no UI yet.
- No moderation UI beyond verifying submissions; no rate limiting or abuse controls.
- The public read path uses the same database role as writes (see ADR-0004 “Future”).
- Completed jobs and raw snapshots are not pruned.

## Decisions to make before connecting real sources

See the end of [docs/architecture.md](docs/architecture.md#decisions-before-connecting-real-sources).
