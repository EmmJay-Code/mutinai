# ADR-0001: Stack and repository layout

Status: accepted · 2026-09-12

## Context
Mutinai is a long-lived public platform with a read-heavy web surface, community
writes, and a future ingestion workload (Hugging Face, GitHub, arXiv, RSS, AI
enrichment) with very different scaling and failure characteristics.

## Decision
- **TypeScript everywhere**, Next.js (App Router, React Server Components) for web.
  TypeScript is pinned to 5.9 until Next's toolchain is validated on TS 7.
- **PostgreSQL 16** as the single system of record. Relational model, full-text
  search + `pg_trgm` for search, `jsonb` only for genuinely open-ended data
  (raw payloads, runtime parameters), never for core relationships.
- **Drizzle ORM** with generated, committed SQL migrations (`packages/db/migrations`).
  Chosen over Prisma for SQL transparency, first-class Postgres schemas,
  and no separate engine binary.
- **npm workspaces monorepo**: `apps/web`, `apps/worker`, `packages/{domain,db,ingestion}`.
  Packages export TypeScript source (no build step); Next transpiles them and
  the worker runs under `tsx`.
- `packages/domain` is pure (no I/O) so the ontology rules, compatibility logic and
  privacy policy are unit-testable and reusable by web, worker and future services.
- No microservices, Kubernetes, Redis or graph database. The web/worker split is
  the only process boundary.

## Consequences
- Web and worker deploy from one repo but scale independently.
- A future split (e.g. a separate ingestion service) is a deploy change, not a
  code reorganization: `ingestion` never imports from `web`.
- Relationship-heavy exploration uses relational joins + an `entity_relation`
  table. A graph database should only be considered with demonstrated query needs.
