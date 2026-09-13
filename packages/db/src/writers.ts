/**
 * Validated entity writers shared by the seed loader and the ingestion pipeline.
 * Every write that creates ontology structure goes through domain validation here.
 */
import {
  validateArtifact,
  validatePriceObservation,
  validateRelation,
  validateVariant,
  type PriceObservationKind,
  type Capability,
  type EntityKind,
  type RelationPredicate,
  type VariantKind,
} from '@mutinai/domain';
import { eq } from 'drizzle-orm';
import type { Executor } from './client';
import * as s from './schema';

export class OntologyError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join('; '));
  }
}

export function normalizeAlias(alias: string): string {
  return alias.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export async function createEntity(
  db: Executor,
  input: { kind: EntityKind; slug: string; name: string; summary?: string | null; aliases?: string[] },
): Promise<string> {
  const [row] = await db
    .insert(s.entity)
    .values({ kind: input.kind, slug: input.slug, name: input.name, summary: input.summary ?? null })
    .returning({ id: s.entity.id });
  await addAliases(db, row!.id, [input.name, ...(input.aliases ?? [])]);
  return row!.id;
}

export async function addAliases(db: Executor, entityId: string, aliases: string[]): Promise<void> {
  const unique = new Map<string, string>();
  for (const alias of aliases) {
    const normalized = normalizeAlias(alias);
    if (normalized && !unique.has(normalized)) unique.set(normalized, alias);
  }
  if (!unique.size) return;
  await db
    .insert(s.entityAlias)
    .values([...unique].map(([normalized, alias]) => ({ entityId, alias, normalized })))
    .onConflictDoNothing();
}

export async function linkExternalId(
  db: Executor,
  input: { namespace: string; value: string; entityId: string; url?: string | null; firstSeenRecordId?: string | null },
): Promise<void> {
  await db
    .insert(s.externalIdentifier)
    .values({ namespace: input.namespace, value: input.value, entityId: input.entityId, url: input.url ?? null, firstSeenRecordId: input.firstSeenRecordId ?? null })
    .onConflictDoNothing();
}

export async function entityKindOf(db: Executor, id: string): Promise<EntityKind> {
  const [row] = await db.select({ kind: s.entity.kind }).from(s.entity).where(eq(s.entity.id, id));
  if (!row) throw new OntologyError([`entity ${id} does not exist`]);
  return row.kind;
}

export async function createRelation(
  db: Executor,
  input: { subjectId: string; predicate: RelationPredicate; objectId: string; sourceRecordId?: string | null },
): Promise<void> {
  const [subjectKind, objectKind] = await Promise.all([entityKindOf(db, input.subjectId), entityKindOf(db, input.objectId)]);
  const result = validateRelation({
    predicate: input.predicate,
    subject: { id: input.subjectId, kind: subjectKind },
    object: { id: input.objectId, kind: objectKind },
  });
  if (!result.ok) throw new OntologyError(result.errors);
  await db
    .insert(s.entityRelation)
    .values({ subjectId: input.subjectId, predicate: input.predicate, objectId: input.objectId, sourceRecordId: input.sourceRecordId ?? null })
    .onConflictDoNothing();
}

export async function developerOfModel(db: Executor, modelId: string): Promise<string> {
  const [row] = await db
    .select({ developerOrgId: s.modelFamily.developerOrgId })
    .from(s.model)
    .innerJoin(s.modelRelease, eq(s.modelRelease.id, s.model.releaseId))
    .innerJoin(s.modelFamily, eq(s.modelFamily.id, s.modelRelease.familyId))
    .where(eq(s.model.id, modelId));
  if (!row) throw new OntologyError([`model ${modelId} does not exist`]);
  return row.developerOrgId;
}

export interface CreateVariantInput {
  slug: string;
  name: string;
  summary?: string | null;
  modelId: string;
  kind: VariantKind;
  publisherOrgId: string;
  licenseId: string | null;
  capabilities: Capability[];
  releasedOn?: string | null;
  lineage?: { predicate: RelationPredicate; objectVariantId: string }[];
  aliases?: string[];
  sourceRecordId?: string | null;
}

export async function createVariant(db: Executor, input: CreateVariantInput): Promise<string> {
  const developerOrgId = await developerOfModel(db, input.modelId);
  const lineage = input.lineage ?? [];
  const check = validateVariant({ kind: input.kind, developerOrgId, publisherOrgId: input.publisherOrgId, lineage });
  if (!check.ok) throw new OntologyError(check.errors.map((e) => `${input.slug}: ${e}`));
  const id = await createEntity(db, { kind: 'model_variant', slug: input.slug, name: input.name, summary: input.summary, aliases: input.aliases });
  await db.insert(s.modelVariant).values({
    id,
    modelId: input.modelId,
    variantKind: input.kind,
    publisherOrgId: input.publisherOrgId,
    licenseId: input.licenseId,
    capabilities: input.capabilities,
    releasedOn: input.releasedOn ?? null,
  });
  for (const l of lineage) await createRelation(db, { subjectId: id, predicate: l.predicate, objectId: l.objectVariantId, sourceRecordId: input.sourceRecordId });
  return id;
}

export interface CreateArtifactInput {
  slug: string;
  name: string;
  variantId: string;
  schemeId: string;
  publisherOrgId: string;
  sizeBytes: number | null;
  sourceRepo?: string | null;
  aliases?: string[];
}

export async function createArtifact(db: Executor, input: CreateArtifactInput): Promise<string> {
  const [facts] = await db
    .select({ method: s.quantizationScheme.method, format: s.quantizationScheme.format, bitsPerWeight: s.quantizationScheme.bitsPerWeight, paramsTotal: s.model.paramsTotal })
    .from(s.modelVariant)
    .innerJoin(s.model, eq(s.model.id, s.modelVariant.modelId))
    .innerJoin(s.quantizationScheme, eq(s.quantizationScheme.id, input.schemeId))
    .where(eq(s.modelVariant.id, input.variantId));
  if (!facts) throw new OntologyError([`${input.slug}: variant or scheme does not exist`]);
  const check = validateArtifact({
    format: facts.format,
    scheme: { method: facts.method, format: facts.format, bitsPerWeight: facts.bitsPerWeight },
    sizeBytes: input.sizeBytes,
    model: { paramsTotal: facts.paramsTotal },
  });
  if (!check.ok) throw new OntologyError(check.errors.map((e) => `${input.slug}: ${e}`));
  const id = await createEntity(db, { kind: 'model_artifact', slug: input.slug, name: input.name, aliases: input.aliases });
  await db.insert(s.modelArtifact).values({
    id,
    variantId: input.variantId,
    schemeId: input.schemeId,
    publisherOrgId: input.publisherOrgId,
    format: facts.format,
    sizeBytes: input.sizeBytes,
    sourceRepo: input.sourceRepo ?? null,
  });
  return id;
}

export async function ensureSource(
  db: Executor,
  input: { key: string; name: string; kind: (typeof s.sourceKind.enumValues)[number]; baseUrl?: string | null; priority: number },
): Promise<string> {
  const [row] = await db
    .insert(s.source)
    .values({ key: input.key, name: input.name, kind: input.kind, baseUrl: input.baseUrl ?? null, priority: input.priority })
    .onConflictDoUpdate({ target: s.source.key, set: { name: input.name, baseUrl: input.baseUrl ?? null, priority: input.priority } })
    .returning({ id: s.source.id });
  return row!.id;
}

export interface PriceObservationInput {
  entityId: string;
  priceKind: PriceObservationKind;
  amount: number;
  currency: string;
  region?: string | null;
  observedAt: Date;
  sourceName: string;
  sourceUrl?: string | null;
  sourceRecordId?: string | null;
  note?: string | null;
}

/** Records a dated, sourced hardware price. Validation rejects unsourced market prices and non-hardware subjects. */
export async function recordPriceObservation(db: Executor, input: PriceObservationInput): Promise<string> {
  const entityKind = await entityKindOf(db, input.entityId);
  const check = validatePriceObservation({ ...input, entityKind });
  if (!check.ok) throw new OntologyError(check.errors);
  const [row] = await db
    .insert(s.priceObservation)
    .values({
      entityId: input.entityId,
      priceKind: input.priceKind,
      amount: input.amount,
      currency: input.currency,
      region: input.region ?? null,
      observedAt: input.observedAt,
      sourceName: input.sourceName,
      sourceUrl: input.sourceUrl ?? null,
      sourceRecordId: input.sourceRecordId ?? null,
      note: input.note ?? null,
    })
    .returning({ id: s.priceObservation.id });
  return row!.id;
}
