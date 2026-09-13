# ADR-0007: Public preview deployment

Status: accepted · 2026-09-12

## Context
Mutinai needs a publicly reachable, read-only preview at mutinai.com that runs without the founder's laptop.
Authentication is development-only, the data is fixtures, and no live sources are connected.

What the preview actually needs:
- **Web** reads Postgres only (`@mutinai/domain` + `@mutinai/db`). It never touches the object store or ingestion.
- **Postgres** 16 with `pg_trgm` (migration 0000). The only persistent service.
- **Worker** is not needed at runtime: fixture ingestion and its emitted jobs (search reindex; compat/enrich are
  no-ops) can run once per deploy. Nothing enqueues jobs afterwards because community writes are disabled.
- **Object store** holds raw ingestion snapshots for provenance only. Nothing reads them back, and fixtures are
  reproducible from the repository, so an ephemeral filesystem is acceptable for now.

## Decision
1. **Host: Render**, declared in `render.yaml` — one Node web service (`next start`, Starter) and one managed
   Postgres 16 (Basic-256mb, private network only). The Blueprint creates the database, wires `DATABASE_URL`
   and attaches the domains, so no secrets are handled by hand.
2. **Deploy-time data**: `npm run db:bootstrap` (worker `bootstrap`) runs as Render's pre-deploy command: migrate,
   seed only if the fixture source is absent, ingest fixtures (content-addressed, so repeats are no-ops), drain jobs.
3. **Read-only preview**: development sign-in is the only identity provider and is disabled whenever
   `NODE_ENV=production`. Sessions are never resolved without it, every write action refuses, and contribution,
   sign-in and vote controls are hidden. No flag can enable writes in production.
4. **Not indexed**: `noindex, nofollow` via `X-Robots-Tag` on all responses and a robots meta tag, until
   `MUTINAI_ALLOW_INDEXING=1`. `robots.txt` still allows crawling so the directive is seen.

## Alternatives
- **Vercel + Neon**: cheapest ($0 on Hobby), but Hobby is non-commercial only (Pro $20/mo), the long-running
  polling worker (ADR-0003) cannot run there, and postgres.js pooling in serverless functions needs tuning.
- **Railway**: similar cost (~$5–10/mo usage), but its config-as-code cannot create databases and is being replaced,
  apex domains need CNAME flattening at the registrar, and there is no built-in www redirect.
- **Fly.io**: Managed Postgres starts at $38/mo, and a custom Dockerfile for the workspace is needed.
- **Render free tier**: the web service sleeps (~1 min cold start) and free Postgres is deleted after 30 days.

## Consequences
- About $13/month (web $7 + database $6 + storage). Adding the worker later is one `type: worker` entry
  (`npm run worker -- work`, $7/month) on the same private network.
- Before live sources: an S3-compatible `ObjectStore` (Render disks are single-service), and snapshot retention.
- Before community writes: production identity, rate limiting, and the restricted read role (ADR-0004 "Future").
