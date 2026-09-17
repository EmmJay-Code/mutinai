import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDatabase, resetAndSeed } from '../src/testing';
import * as s from '../src/schema';
import { createArtifact, createRelation, createVariant, ensureEvaluationConfig, OntologyError } from '../src/writers';
import type { DatabaseHandle } from '../src/client';

let h: DatabaseHandle;
const idOf = async (kind: string, slug: string) => {
  const [row] = await h.db.execute<{ id: string }>(sql`select id from ecosystem.entity where kind::text = ${kind} and slug = ${slug}`);
  if (!row) throw new Error(`missing ${kind}:${slug}`);
  return row.id;
};

beforeAll(async () => {
  h = createTestDatabase();
  await resetAndSeed(h.db, { community: false });
});
afterAll(() => h.close());

describe('model hierarchy', () => {
  it('resolves variant → model → release → family → developer without string parsing', async () => {
    const [row] = await h.db.execute<{ variant: string; model: string; release: string; family: string; parent: string | null; developer: string }>(sql`
      select ve.name as variant, me.name as model, re.name as release, fe.name as family, pfe.name as parent, oe.name as developer
      from ecosystem.model_variant v
      join ecosystem.entity ve on ve.id = v.id
      join ecosystem.model m on m.id = v.model_id join ecosystem.entity me on me.id = m.id
      join ecosystem.model_release r on r.id = m.release_id join ecosystem.entity re on re.id = r.id
      join ecosystem.model_family f on f.id = r.family_id join ecosystem.entity fe on fe.id = f.id
      left join ecosystem.entity pfe on pfe.id = f.parent_family_id
      join ecosystem.entity oe on oe.id = f.developer_org_id
      where ve.slug = 'qwen2-5-coder-32b-instruct'`);
    expect(row).toEqual({ variant: 'Qwen2.5-Coder 32B Instruct', model: 'Qwen2.5-Coder 32B', release: 'Qwen2.5-Coder', family: 'Qwen Coder', parent: 'Qwen', developer: 'Qwen Team (Alibaba Cloud)' });
  });

  it('third-party distills keep their architecture model and declare lineage', async () => {
    const rows = await h.db.execute<{ predicate: string; object: string; model: string; publisher: string }>(sql`
      select rel.predicate, oe.slug as object, me.slug as model, pe.slug as publisher
      from ecosystem.model_variant v
      join ecosystem.entity ve on ve.id = v.id
      join ecosystem.entity me on me.id = v.model_id
      join ecosystem.entity pe on pe.id = v.publisher_org_id
      join ecosystem.entity_relation rel on rel.subject_id = v.id
      join ecosystem.entity oe on oe.id = rel.object_id
      where ve.slug = 'deepseek-r1-distill-qwen-32b' order by rel.predicate::text`);
    expect(rows).toEqual([
      { predicate: 'distilled_from', object: 'deepseek-r1', model: 'qwen2-5-32b', publisher: 'deepseek' },
      { predicate: 'fine_tuned_from', object: 'qwen2-5-32b-base', model: 'qwen2-5-32b', publisher: 'deepseek' },
    ]);
  });

  it('quantizations are artifacts linked to a scheme and publisher, unique per variant/scheme/publisher', async () => {
    const [row] = await h.db.execute<{ scheme: string; bpw: number; publisher: string; format: string }>(sql`
      select se.name as scheme, q.bits_per_weight as bpw, pe.name as publisher, a.format
      from ecosystem.model_artifact a join ecosystem.entity ae on ae.id = a.id
      join ecosystem.quantization_scheme q on q.id = a.scheme_id join ecosystem.entity se on se.id = q.id
      join ecosystem.entity pe on pe.id = a.publisher_org_id
      where ae.slug = 'llama-3-1-8b-instruct--q4-k-m'`);
    expect(row).toMatchObject({ scheme: 'Q4_K_M', publisher: 'LM Studio Community', format: 'gguf' });
    const [artifact] = await h.db.select().from(s.modelArtifact).where(eq(s.modelArtifact.id, await idOf('model_artifact', 'llama-3-1-8b-instruct--q4-k-m')));
    await expect(
      h.db.insert(s.modelArtifact).values({ ...artifact!, id: await idOf('model_artifact', 'llama-3-1-8b-instruct--q8-0') }),
    ).rejects.toThrow();
  });

  it('every seeded MoE model has active params and dense models do not', async () => {
    const [row] = await h.db.execute<{ bad: number }>(sql`
      select count(*)::int as bad from ecosystem.model where (architecture = 'moe') <> (params_active is not null)`);
    expect(row!.bad).toBe(0);
  });
});

describe('database constraints', () => {
  it('rejects a run environment without exactly one hardware reference', async () => {
    const runtimeId = await idOf('project', 'llama-cpp');
    await expect(h.db.insert(s.runEnvironment).values({ runtimeId, backend: 'cpu' })).rejects.toMatchObject({ cause: { constraint_name: 'run_environment_one_hardware' } });
  });

  it('rejects benchmark runs with zero or two subjects', async () => {
    const [metric] = await h.db.select().from(s.benchmarkMetric).limit(1);
    const [source] = await h.db.select().from(s.resultSource).where(eq(s.resultSource.key, 'mutinai-catalog'));
    const configId = await ensureEvaluationConfig(h.db, {});
    await expect(
      h.db.insert(s.benchmarkRun).values({ benchmarkId: metric!.benchmarkId, configId, resultSourceId: source!.id, origin: 'editorial' }),
    ).rejects.toMatchObject({ cause: { constraint_name: 'benchmark_run_one_subject' } });
  });

  it('refuses runs from a source whose redistribution permission has not been established', async () => {
    const [metric] = await h.db.select().from(s.benchmarkMetric).limit(1);
    const variantId = await idOf('model_variant', 'llama-3-1-8b-instruct');
    const [blocked] = await h.db.select().from(s.resultSource).where(eq(s.resultSource.key, 'livebench-leaderboard'));
    expect(blocked!.ingestionEnabled).toBe(false);
    const configId = await ensureEvaluationConfig(h.db, {});
    await expect(
      h.db.insert(s.benchmarkRun).values({ benchmarkId: metric!.benchmarkId, variantId, configId, resultSourceId: blocked!.id, origin: 'benchmark_operator' }),
    ).rejects.toMatchObject({ cause: { constraint_name: 'benchmark_run_source_enabled_fk' } });
  });

  it('refuses to enable a source whose licence has not been read', async () => {
    await expect(
      h.db.update(s.resultSource).set({ ingestionEnabled: true }).where(eq(s.resultSource.key, 'livebench-leaderboard')),
    ).rejects.toMatchObject({ cause: { constraint_name: 'result_source_permission_checked' } });
  });

  it('keeps one model under two evaluation configurations rather than making two models', async () => {
    const fc = await ensureEvaluationConfig(h.db, { label: 'function calling', promptMode: 'function_calling' });
    const prompted = await ensureEvaluationConfig(h.db, { label: 'prompt', promptMode: 'prompt' });
    expect(fc).not.toBe(prompted);
    expect(await ensureEvaluationConfig(h.db, { label: 'a different label', promptMode: 'function_calling' })).toBe(fc);
  });

  it('rejects MoE models without active parameter counts', async () => {
    const releaseId = await idOf('model_release', 'qwen3');
    const [e] = await h.db.insert(s.entity).values({ kind: 'model', slug: 'bad-moe', name: 'Bad MoE' }).returning();
    await expect(
      h.db.insert(s.model).values({ id: e!.id, releaseId, architecture: 'moe', paramsTotal: 1e9, layers: 1, attentionHeads: 1, kvHeads: 1, headDim: 1, contextLength: 1 }),
    ).rejects.toMatchObject({ cause: { constraint_name: 'model_moe_active_params' } });
  });

  it('slugs are unique per kind, not globally', async () => {
    // "deepseek-r1" is both a family and a variant slug in the seed.
    const rows = await h.db.execute<{ kind: string }>(sql`select kind::text from ecosystem.entity where slug = 'deepseek-r1' order by kind`);
    expect(rows.map((r) => r.kind)).toEqual(['model_family', 'model_release', 'model_variant']);
  });
});

describe('validated writers', () => {
  it('rejects relations between disallowed kinds', async () => {
    await expect(
      createRelation(h.db, { subjectId: await idOf('project', 'ollama'), predicate: 'distilled_from', objectId: await idOf('model_variant', 'deepseek-r1') }),
    ).rejects.toBeInstanceOf(OntologyError);
  });

  it('rejects a third-party variant that is not a derivation (should be an artifact)', async () => {
    await expect(
      createVariant(h.db, {
        slug: 'reupload', name: 'Re-upload', modelId: await idOf('model', 'llama-3-1-8b'), kind: 'instruct',
        publisherOrgId: await idOf('organization', 'unsloth'), licenseId: null, capabilities: [],
      }),
    ).rejects.toThrow(/third party/);
  });

  it('rejects artifacts with implausible sizes', async () => {
    await expect(
      createArtifact(h.db, {
        slug: 'bad-size', name: 'Bad', variantId: await idOf('model_variant', 'llama-3-1-8b-instruct'),
        schemeId: await idOf('quantization_scheme', 'q4-k-m'), publisherOrgId: await idOf('organization', 'unsloth'), sizeBytes: 900_000_000,
      }),
    ).rejects.toThrow(/implausible/);
  });
});
