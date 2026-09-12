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

## Decisions before connecting real sources

1. **Source authority and licensing.** Per-source terms of use, attribution requirements, rate limits and
   whether raw payloads may be retained (and for how long) in the object store.
2. **Source priorities per field.** `ingest.source.priority` is per source today; real data will likely need
   per-field authority (e.g. Hugging Face authoritative for file sizes, the developer's model card for
   architecture, GitHub for repository metadata).
3. **Editorial workflow for unresolved records.** New first-party models need architecture data and new
   projects need categorisation. Decide who reviews `unresolved` source records and build that queue UI.
4. **Identity resolution policy.** When fuzzy matches (not just identifiers/exact aliases) are acceptable, and
   how merges/splits of mistaken entities are recorded without losing provenance.
5. **Canonical benchmark policy.** Which leaderboards/sources are trusted for capability results, how
   evaluation settings are normalized, and how conflicting reports are displayed.
6. **Community verification rules.** What makes a submission "verified" (moderator review, reproduction by
   another member, statistical agreement) and how verified runs weight into measured speeds.
7. **Scheduling and freshness.** Polling vs. webhooks per source, cursor storage, and retention/pruning of
   snapshots and completed jobs.
8. **Production identity.** Auth provider(s), whether email is collected at all, and the restricted database
   role for the public read path.
9. **AI enrichment boundary.** Model/provider choice, cost limits, and review requirements before any
   `derived_content` is displayed — always labelled and never overwriting canonical fields.
10. **Deployment target.** Managed Postgres, S3-compatible object store implementation, and a worker host.
