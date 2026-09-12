/**
 * Ingestion + provenance. See docs/adr/0005-ingestion-boundary.md.
 */
import { index, integer, jsonb, pgSchema, primaryKey, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { entity } from './ecosystem';

export const ingest = pgSchema('ingest');

export const sourceKind = ingest.enum('source_kind', ['huggingface', 'github', 'arxiv', 'rss', 'editorial', 'fixture']);
export const sourceRecordStatus = ingest.enum('source_record_status', ['processed', 'unresolved', 'failed']);
export const ingestionRunStatus = ingest.enum('ingestion_run_status', ['running', 'succeeded', 'failed']);

export const source = ingest.table('source', {
  id: uuid().primaryKey().defaultRandom(),
  key: text().notNull().unique(),
  name: text().notNull(),
  kind: sourceKind().notNull(),
  baseUrl: text(),
  /** Higher-priority sources overwrite canonical fields; lower ones only add assertions. */
  priority: integer().notNull().default(0),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/** One immutable snapshot of one external item. */
export const sourceRecord = ingest.table(
  'source_record',
  {
    id: uuid().primaryKey().defaultRandom(),
    sourceId: uuid().notNull().references(() => source.id),
    externalId: text().notNull(),
    contentHash: text().notNull(),
    objectKey: text().notNull(),
    contentType: text().notNull(),
    url: text(),
    fetchedAt: timestamp({ withTimezone: true }).notNull(),
    status: sourceRecordStatus().notNull(),
    statusDetail: text(),
    runId: uuid().references((): AnyPgColumn => ingestionRun.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('source_record_snapshot_key').on(t.sourceId, t.externalId, t.contentHash),
    index('source_record_latest_idx').on(t.sourceId, t.externalId, t.fetchedAt),
  ],
);

/**
 * Identity mapping from an external identifier to a Mutinai entity.
 * Keyed by identifier *namespace* (e.g. `huggingface` repo ids, `github` repos), not by source:
 * a live API adapter, a fixture adapter and a mirror all resolve the same identifier to the same entity.
 */
export const externalIdentifier = ingest.table(
  'external_identifier',
  {
    namespace: text().notNull(),
    value: text().notNull(),
    entityId: uuid().notNull().references(() => entity.id, { onDelete: 'cascade' }),
    url: text(),
    /** Snapshot in which this mapping was first established (null for editorial/seeded mappings). */
    firstSeenRecordId: uuid().references((): AnyPgColumn => sourceRecord.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.namespace, t.value] }), index('external_identifier_entity_idx').on(t.entityId)],
);

/** Field-level provenance: source X said field F of entity E had value V at time T. */
export const fieldAssertion = ingest.table(
  'field_assertion',
  {
    id: uuid().primaryKey().defaultRandom(),
    entityId: uuid().notNull().references(() => entity.id, { onDelete: 'cascade' }),
    field: text().notNull(),
    value: jsonb().notNull(),
    sourceRecordId: uuid().notNull().references(() => sourceRecord.id),
    /** Whether this assertion's value is what the canonical row currently holds. */
    applied: integer().notNull().default(0),
    assertedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('field_assertion_key').on(t.entityId, t.field, t.sourceRecordId),
    index('field_assertion_entity_field_idx').on(t.entityId, t.field),
  ],
);

export const ingestionRun = ingest.table('ingestion_run', {
  id: uuid().primaryKey().defaultRandom(),
  sourceId: uuid().notNull().references(() => source.id),
  status: ingestionRunStatus().notNull().default('running'),
  startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp({ withTimezone: true }),
  stats: jsonb().$type<Record<string, number>>().notNull().default({}),
  error: text(),
});
