/**
 * Enrichment runner: loads canonical facts, asks a provider for derived text, and stores it apart from the facts.
 * Idempotent per input: unchanged facts, prompt version and provider never regenerate. Never writes canonical columns.
 * See docs/ai-enrichment.md.
 */
import { createHash } from 'node:crypto';
import { validateEnrichmentOutput, type EnrichmentFacts, type EnrichmentProvider, type EnrichmentTask } from '@mutinai/domain';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Database, Executor } from './client';
import * as s from './schema';

export type EnrichmentSubjectRef = { kind: 'entity' | 'event'; id: string };

export async function loadEnrichmentFacts(db: Executor, subject: EnrichmentSubjectRef): Promise<EnrichmentFacts | null> {
  if (subject.kind === 'event') {
    const [ev] = await db.execute<{ id: string; kind: string; title: string; summary: string | null; occurred_at: Date; url: string | null; source_record_id: string | null; entities: string[] }>(sql`
      select ev.id, ev.event_kind::text as kind, ev.title, ev.summary, ev.occurred_at, ev.url, ev.source_record_id,
        coalesce((select array_agg(e.name order by e.name) from ecosystem.event_entity ee join ecosystem.entity e on e.id = ee.entity_id where ee.event_id = ev.id), '{}') as entities
      from ecosystem.event ev where ev.id = ${subject.id}`);
    if (!ev) return null;
    return {
      subject: { kind: 'event', id: ev.id, type: ev.kind, name: ev.title },
      facts: { kind: ev.kind, title: ev.title, summary: ev.summary, occurredOn: new Date(ev.occurred_at).toISOString().slice(0, 10), relatedTo: ev.entities },
      sourceRecordIds: ev.source_record_id ? [ev.source_record_id] : [],
    };
  }
  const [e] = await db.execute<{ id: string; kind: string; name: string; summary: string | null }>(sql`select id, kind::text, name, summary from ecosystem.entity where id = ${subject.id}`);
  if (!e) return null;
  const [details] = await db.execute<{ facts: Record<string, unknown> | null }>(sql`
    select case ${e.kind}
      when 'model_variant' then (select jsonb_build_object('variantKind', v.variant_kind, 'model', me.name, 'publisher', pe.name, 'license', l.name, 'capabilities', v.capabilities)
        from ecosystem.model_variant v join ecosystem.entity me on me.id = v.model_id join ecosystem.entity pe on pe.id = v.publisher_org_id left join ecosystem.license l on l.id = v.license_id where v.id = ${e.id})
      when 'model' then (select jsonb_build_object('architecture', m.architecture, 'paramsTotal', m.params_total, 'paramsActive', m.params_active, 'contextLength', m.context_length)
        from ecosystem.model m where m.id = ${e.id})
      when 'project' then (select jsonb_build_object('category', p.category, 'repository', p.repo_url, 'language', p.primary_language) from ecosystem.project p where p.id = ${e.id})
      when 'hardware_device' then (select jsonb_build_object('deviceKind', d.device_kind, 'memoryKind', d.memory_kind, 'memoryGb', d.memory_gb, 'backends', d.backends) from ecosystem.hardware_device d where d.id = ${e.id})
      else '{}'::jsonb end as facts`);
  const records = await db.execute<{ id: string }>(sql`
    select distinct source_record_id as id from (
      select source_record_id from ingest.field_assertion where entity_id = ${e.id}
      union select first_seen_record_id from ingest.external_identifier where entity_id = ${e.id} and first_seen_record_id is not null
    ) r order by 1 limit 50`);
  return {
    subject: { kind: 'entity', id: e.id, type: e.kind, name: e.name },
    facts: { summary: e.summary, ...(details?.facts ?? {}) },
    sourceRecordIds: records.map((r) => r.id),
  };
}

const sortKeys = (value: unknown): unknown =>
  Array.isArray(value) ? value.map(sortKeys) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys((value as Record<string, unknown>)[k])])) : value;

export type EnrichmentOutcome = { status: 'generated'; id: string } | { status: 'unchanged'; id: string } | { status: 'not_applicable' };

export async function runEnrichment(db: Database, provider: EnrichmentProvider, task: EnrichmentTask, subject: EnrichmentSubjectRef, signal?: AbortSignal): Promise<EnrichmentOutcome> {
  const facts = await loadEnrichmentFacts(db, subject);
  if (!facts) throw new Error(`enrichment subject ${subject.kind} ${subject.id} does not exist`);
  if (!task.appliesTo(facts.subject)) return { status: 'not_applicable' };
  const request = task.build(facts);
  const inputHash = createHash('sha256').update(JSON.stringify(sortKeys({ task: task.id, promptVersion: task.promptVersion, provider: provider.id, instructions: request.instructions, input: request.input }))).digest('hex');
  const subjectColumn = subject.kind === 'entity' ? s.derivedContent.entityId : s.derivedContent.eventId;
  const current = and(eq(subjectColumn, subject.id), eq(s.derivedContent.contentKind, task.contentKind), isNull(s.derivedContent.supersededAt));

  const [existing] = await db.select({ id: s.derivedContent.id, inputHash: s.derivedContent.inputHash }).from(s.derivedContent).where(current);
  if (existing?.inputHash === inputHash) return { status: 'unchanged', id: existing.id };

  const result = await provider.generate(request, signal);
  const check = validateEnrichmentOutput(result.text, request);
  if (!check.ok) throw new Error(`${provider.id}/${result.model} output rejected for ${task.id}: ${check.errors.join('; ')}`);

  const id = await db.transaction(async (tx) => {
    await tx.update(s.derivedContent).set({ supersededAt: new Date() }).where(current);
    const [row] = await tx
      .insert(s.derivedContent)
      .values({
        entityId: subject.kind === 'entity' ? subject.id : null,
        eventId: subject.kind === 'event' ? subject.id : null,
        contentKind: task.contentKind,
        body: result.text.trim(),
        generator: task.id,
        generatorVersion: task.promptVersion,
        provider: provider.id,
        model: result.model,
        inputHash,
        inputSourceRecordIds: facts.sourceRecordIds,
        reviewStatus: 'unreviewed',
      })
      .returning({ id: s.derivedContent.id });
    return row!.id;
  });
  return { status: 'generated', id };
}
