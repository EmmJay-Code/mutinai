# ADR-0003: Postgres-backed job queue

Status: accepted · 2026-09-12

## Decision
Background work is stored in `jobs.job` and claimed with `SELECT … FOR UPDATE SKIP LOCKED`.
Jobs have a `kind`, `payload`, optional `dedupe_key` (unique while pending/running),
attempts with backoff, and `run_after`. The worker process (`apps/worker`) runs a
handler registry keyed by job kind.

Emitters (ingestion, community writes) enqueue jobs inside the same transaction as
the data change (transactional outbox semantics without a separate relay).

## Why
One fewer piece of infrastructure, transactional enqueue, adequate throughput for
ingestion/enrichment volumes for a long time. The `enqueue`/`claim` interface is
small enough to swap for pg-boss or a broker if throughput demands it.

## Consequences
- Deduplication by `dedupe_key` makes "entity changed" signals collapse naturally.
- Completed jobs should be pruned periodically (not yet implemented).
