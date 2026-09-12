# ADR-0005: Ingestion boundary

Status: accepted · 2026-09-12

## Decision
A source adapter implements a narrow contract (`packages/ingestion/src/adapter.ts`):

```ts
interface SourceAdapter {
  source: { key: string; kind: SourceKind; name: string; baseUrl?: string };
  fetch(ctx): AsyncIterable<RawItem>;      // externalId, fetchedAt, contentType, payload
  normalize(raw): NormalizedRecord[];      // typed candidate facts, no DB access
}
```

The shared pipeline owns everything else, per raw item, in one transaction:

1. **Snapshot** – compute a content hash of the canonicalized payload; store raw bytes
   in the object store under `sources/<source>/<sha256>`.
2. **Dedupe** – `ingest.source_record` is unique on `(source_id, external_id, content_hash)`.
   An already-seen snapshot is a no-op.
3. **Resolve identity** – `ingest.external_identifier (source, external_id) → entity`,
   then deterministic fallbacks (aliases, canonical slugs). Unresolvable records are
   marked `unresolved` for review rather than guessed.
4. **Upsert** – create or update entities; every written field produces an
   `ingest.field_assertion` (unique on entity + field + source_record).
5. **Provenance** – canonical rows reference the source record.
6. **Emit** – enqueue deduplicated downstream jobs (`search.reindex_entity`,
   `compat.invalidate`, `enrich.entity` placeholder).

Adapters never write to the database and pipeline stages never call external
services, so adapters are testable from fixture payloads and the pipeline is
testable without network.

## Source authority
Each field assertion records its source. Fields that sources disagree on are
resolved by source priority (`ingest.source.priority`; editorial > official > fixture/aggregator);
lower-priority sources add assertions without overwriting.

## Fixture adapters
`fixture-huggingface`, `fixture-github`, `fixture-rss` read JSON shaped like the real
APIs, so replacing them with live adapters changes `fetch` only.

## Before live sources
See "Decisions before real data" in the README.
