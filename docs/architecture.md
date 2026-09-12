# Mutinai architecture

Mutinai is an open community and intelligence platform for the open-AI ecosystem.
This document describes the foundation. Individual consequential decisions are
recorded as ADRs in [`docs/adr`](./adr).

## Shape

```
apps/
  web/          Next.js (App Router). Public UI, public JSON API, community writes.
  worker/       Long-running process: ingestion runs + background job execution.
packages/
  domain/       Pure TypeScript. Ontology vocabulary + validation, compatibility
                engine, visibility/privacy policy, rating dimensions. No I/O.
  db/           Drizzle schema, SQL migrations, typed query layer (public vs.
                viewer-scoped), job queue, seed fixtures.
  ingestion/    Source-adapter contract, pipeline (fetch → normalize → dedupe →
                resolve → upsert → provenance → emit), object-store abstraction,
                fixture adapters (Hugging Face, GitHub, RSS shaped).
docs/           Architecture + ADRs.
scripts/        Local development helpers (isolated Postgres cluster).
```

Dependency direction: `domain` ← `db` ← `ingestion` ← `worker`; `web` depends on
`domain` and `db` (never on `ingestion`). The web tier is stateless (sessions are
rows in Postgres, cookies carry only an opaque token), so it can be horizontally
scaled independently of the worker.

## Runtime topology (initial)

One Postgres database, one or more stateless web instances, one worker instance.
The worker claims jobs with `FOR UPDATE SKIP LOCKED`, so more workers can be added
without coordination. No Redis, no message broker, no microservices yet — see
[ADR-0003](./adr/0003-postgres-job-queue.md).

## Database schemas

Postgres schemas separate data by trust and privacy class:

| schema      | contents                                                        | exposure |
|-------------|-----------------------------------------------------------------|----------|
| `ecosystem` | entities: organizations, families, releases, models, variants, quantizations, artifacts, hardware, runtimes, projects, benchmarks, results, events, relations | public |
| `ingest`    | sources, raw source records, external identifiers, field assertions (provenance), ingestion runs | internal (provenance summaries are public) |
| `community` | public profiles, reviews, ratings, votes, benchmark submissions, user hardware configs | per-row visibility |
| `identity`  | accounts (email, auth subject), sessions, private preferences    | never public |
| `jobs`      | background job queue                                             | internal |

See [ADR-0002](./adr/0002-ontology.md) for the ontology and
[ADR-0004](./adr/0004-privacy-architecture.md) for privacy.

## Key flows

- **Read path**: Server components call `@mutinai/db` public query functions,
  which select explicit columns into public DTOs. Viewer-scoped queries take a
  `Viewer` and apply the domain visibility policy.
- **Write path (community)**: server actions validate with zod + domain
  validators, write through `@mutinai/db` community mutations.
- **Ingestion**: `worker ingest <adapter>` runs a source adapter through the
  pipeline; each item is processed in a transaction and is idempotent.
  Downstream work (search reindex, compatibility invalidation, future AI
  enrichment) is emitted as deduplicated jobs. See
  [ADR-0005](./adr/0005-ingestion-boundary.md).
- **What can I run?**: `@mutinai/domain` compat engine combines hardware memory
  topology, artifact size, KV-cache estimates, runtime/backend support and
  measured community/canonical results. Measured values and estimates are always
  distinguished. See [ADR-0006](./adr/0006-compatibility-engine.md).
