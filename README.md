# Mutinai

An open community and intelligence platform for the open-AI ecosystem: open models and their variants and
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
| `npm run worker -- ingest <adapter\|all>` | Run ingestion adapters |
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

## Seed data

Architecture facts (parameter counts, layers, KV heads, context) follow public model cards. Benchmark scores,
throughput numbers, prices and community content are **illustrative** and attributed to the `mutinai-fixtures`
source; the UI labels them as such. Community accounts and content are fictional.

## Known limitations

- Authentication is development-only; no production identity provider is integrated.
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
