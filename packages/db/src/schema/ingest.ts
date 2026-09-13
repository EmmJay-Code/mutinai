/**
 * Ingestion + provenance. See docs/adr/0005-ingestion-boundary.md and docs/adr/0008-live-ingestion.md.
 * Everything in this schema is internal: never selected by public queries.
 */
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgSchema, primaryKey, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { entity } from './ecosystem';

export const ingest = pgSchema('ingest');

export const sourceKind = ingest.enum('source_kind', ['huggingface', 'github', 'arxiv', 'rss', 'editorial', 'fixture']);
export const sourceRecordStatus = ingest.enum('source_record_status', ['processed', 'unresolved', 'failed']);
export const ingestionRunStatus = ingest.enum('ingestion_run_status', ['running', 'succeeded', 'failed', 'abandoned']);
export const reviewStatus = ingest.enum('review_status', ['open', 'resolved', 'dismissed', 'superseded']);

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
    /** Last time a fetch returned this exact snapshot. Lets disappearance be reasoned about later. */
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
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

export const ingestionRun = ingest.table(
  'ingestion_run',
  {
    id: uuid().primaryKey().defaultRandom(),
    sourceId: uuid().notNull().references(() => source.id),
    status: ingestionRunStatus().notNull().default('running'),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
    stats: jsonb().$type<Record<string, number>>().notNull().default({}),
    /** Options the run was started with (limit, since, selection), for audit and incremental windows. */
    options: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    error: text(),
  },
  // At most one running ingestion per source, enforced by the database rather than by scheduling discipline.
  (t) => [uniqueIndex('ingestion_run_one_running').on(t.sourceId).where(sql`status = 'running'`)],
);

export interface ReviewCandidate {
  entityId: string;
  kind: string;
  slug: string;
  name: string;
  /** Why this entity is a plausible match (never applied automatically). */
  basis: string;
}

/**
 * A decision an editor must make about an incoming item: an unknown base model, a new first-party model, an
 * unmapped license, a possible re-upload, … One row per (source, item, reason, subject), updated as new snapshots
 * of the item arrive. Blocking items leave their source record `unresolved`; the pipeline re-evaluates unresolved
 * records whenever they are seen again, and closes items that no longer apply.
 */
export const reviewItem = ingest.table(
  'review_item',
  {
    id: uuid().primaryKey().defaultRandom(),
    sourceId: uuid().notNull().references(() => source.id),
    externalId: text().notNull(),
    reason: text().notNull(),
    /** What within the item the reason is about (a base repo id, a file, a license key); '' for the item itself. */
    subject: text().notNull().default(''),
    detail: text().notNull(),
    /** Whether this prevents the item from being applied (vs. an advisory note on applied data). */
    blocking: integer().notNull().default(1),
    candidates: jsonb().$type<ReviewCandidate[]>().notNull().default([]),
    /** Source-reported facts or hints that help an editor decide (never canonical). */
    suggestion: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    status: reviewStatus().notNull().default('open'),
    resolution: text(),
    firstSourceRecordId: uuid().notNull().references(() => sourceRecord.id),
    lastSourceRecordId: uuid().notNull().references(() => sourceRecord.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('review_item_key').on(t.sourceId, t.externalId, t.reason, t.subject),
    index('review_item_status_idx').on(t.status, t.reason),
  ],
);

/** Stored HTTP validators for conditional requests (ETag / Last-Modified), per source and URL. */
export const httpValidator = ingest.table(
  'http_validator',
  {
    sourceId: uuid().notNull().references(() => source.id, { onDelete: 'cascade' }),
    url: text().notNull(),
    etag: text(),
    lastModified: text(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.url] })],
);
