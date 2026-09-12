import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, resetAndSeed } from '../src/testing';
import * as catalog from '../src/queries/catalog';
import * as compatQueries from '../src/queries/compat';
import type { DatabaseHandle } from '../src/client';

let h: DatabaseHandle;

beforeAll(async () => {
  h = createTestDatabase();
  await resetAndSeed(h.db);
});
afterAll(() => h.close());

describe('catalog queries', () => {
  it('filters models by parent family, architecture and capability', async () => {
    const qwen = await catalog.listModels(h.db, { family: 'qwen' });
    expect(qwen.map((m) => m.slug)).toEqual(expect.arrayContaining(['qwen2-5-7b', 'qwen2-5-coder-32b', 'qwen3-30b-a3b']));
    const moe = await catalog.listModels(h.db, { architecture: 'moe', sort: 'params_asc' });
    expect(moe.map((m) => m.slug)).toEqual(['qwen3-30b-a3b', 'mixtral-8x7b', 'deepseek-r1-671b']);
    const vision = await catalog.listModels(h.db, { capability: 'vision' });
    expect(vision.map((m) => m.slug)).toEqual(['gemma-3-27b']);
    const small = await catalog.listModels(h.db, { maxParamsB: 8.5 });
    expect(small.every((m) => m.paramsTotal <= 8.5e9)).toBe(true);
  });

  it('model detail groups variants, artifacts, lineage and results', async () => {
    const m = await catalog.getModelDetail(h.db, 'qwen2-5-32b');
    expect(m?.family).toEqual({ slug: 'qwen', name: 'Qwen', parent: null });
    const distill = m!.variants.find((v) => v.slug === 'deepseek-r1-distill-qwen-32b')!;
    expect(distill.publisher.slug).toBe('deepseek');
    expect(distill.lineage.map((l) => `${l.direction}:${l.predicate}:${l.slug}`).sort()).toEqual(['outgoing:distilled_from:deepseek-r1', 'outgoing:fine_tuned_from:qwen2-5-32b-base']);
    const base = m!.variants.find((v) => v.slug === 'qwen2-5-32b-base')!;
    expect(base.lineage).toEqual([{ direction: 'incoming', predicate: 'fine_tuned_from', slug: 'deepseek-r1-distill-qwen-32b', name: 'DeepSeek-R1-Distill-Qwen-32B', modelSlug: 'qwen2-5-32b' }]);
    expect(m!.capabilityResults.some((r) => r.sourceKind === 'fixture')).toBe(true);
    expect(m!.performanceResults[0]!.metrics.length).toBeGreaterThan(0);
  });

  it('search ranks exact entities first and resolves variant owners', async () => {
    const hits = await catalog.searchEntities(h.db, 'rtx 4090');
    expect(hits[0]).toMatchObject({ kind: 'hardware_device', slug: 'nvidia-rtx-4090' });
    const coder = await catalog.searchEntities(h.db, 'qwen coder 32b', { kinds: ['model_variant'] });
    expect(coder[0]).toMatchObject({ slug: 'qwen2-5-coder-32b-instruct', modelSlug: 'qwen2-5-coder-32b' });
    const fuzzy = await catalog.searchEntities(h.db, 'lama.cpp');
    expect(fuzzy.some((x) => x.slug === 'llama-cpp')).toBe(true);
  });

  it('provenance lists sources and identifiers', async () => {
    const ref = await catalog.getEntityRef(h.db, 'model_variant', 'llama-3-1-8b-instruct');
    const p = await catalog.getProvenance(h.db, ref!.id);
    expect(p.externalIds).toEqual([{ namespace: 'huggingface', value: 'meta-llama/Llama-3.1-8B-Instruct', url: 'https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct' }]);
    expect(p.sources.map((x) => x.key)).toContain('mutinai-fixtures');
  });
});

describe('what can I run', () => {
  it('recommends the best-precision fit and uses measured speeds where they exist', async () => {
    const hw = (await compatQueries.loadReferenceHardware(h.db, 'dual-rtx-3090'))!;
    const results = await compatQueries.runCompatibility(h.db, hw, { contextLength: 4096 });
    const l70 = results.find((r) => r.variantSlug === 'llama-3-3-70b-instruct')!;
    expect(l70.recommended?.row.artifactSlug).toBe('llama-3-3-70b-instruct--q4-k-m');
    expect(l70.recommended?.runtime.slug).toBe('llama-cpp');
    expect(l70.recommended?.result.speed).toMatchObject({ basis: 'measured', samples: 2, origins: expect.arrayContaining(['canonical', 'community_verified']) });

    const l8 = results.find((r) => r.variantSlug === 'llama-3-1-8b-instruct')!;
    expect(l8.recommended?.result.fit).toBe('full');
    expect(l8.recommended?.row.schemeName).toBe('Q8_0');
    expect(l8.recommended?.result.speed.basis).toBe('estimated');

    const r1 = results.find((r) => r.variantSlug === 'deepseek-r1')!;
    expect(r1.recommended).toBeNull();
  });

  it('Apple silicon picks MLX or GGUF runtimes, never CUDA-only runtimes', async () => {
    const hw = (await compatQueries.loadReferenceHardware(h.db, 'macbook-pro-m3-max-64gb'))!;
    const results = await compatQueries.runCompatibility(h.db, hw, { contextLength: 8192 });
    const runtimes = new Set(results.flatMap((r) => (r.recommended ? [r.recommended.runtime.slug] : [])));
    expect([...runtimes].every((x) => ['llama-cpp', 'ollama', 'mlx-lm'].includes(x))).toBe(true);
    expect(results.find((r) => r.variantSlug === 'qwen3-30b-a3b')?.recommended?.result.fit).toBe('full');
  });

  it('builds custom hardware and respects runtime and capability filters', async () => {
    const hw = (await compatQueries.buildCustomHardware(h.db, { components: [{ deviceSlug: 'nvidia-rtx-4060-ti-16gb', count: 2 }], systemRamGb: 64 }))!;
    expect(hw.spec.components.some((c) => c.device.kind === 'cpu')).toBe(true);
    const coding = await compatQueries.runCompatibility(h.db, hw, { contextLength: 4096, capability: 'code', runtimeSlugs: ['vllm'] });
    expect(coding.every((r) => r.capabilities.includes('code'))).toBe(true);
    expect(coding.every((r) => !r.recommended || r.recommended.runtime.slug === 'vllm')).toBe(true);
    expect(coding.some((r) => r.recommended?.row.format === 'safetensors')).toBe(true);
  });
});
