import { describe, expect, it } from 'vitest';
import { slugify, validateArtifact, validateRelation, validateVariant } from '../src/ontology';

const variant = (id: string) => ({ id, kind: 'model_variant' as const });

describe('validateRelation', () => {
  it('accepts lineage between variants', () => {
    expect(validateRelation({ predicate: 'distilled_from', subject: variant('a'), object: variant('b') })).toEqual({ ok: true });
  });

  it('rejects kinds the predicate does not allow', () => {
    const r = validateRelation({ predicate: 'fine_tuned_from', subject: { id: 'p', kind: 'project' }, object: variant('b') });
    expect(r.ok).toBe(false);
  });

  it('rejects self relations and unknown predicates', () => {
    expect(validateRelation({ predicate: 'merged_from', subject: variant('a'), object: variant('a') }).ok).toBe(false);
    expect(validateRelation({ predicate: 'likes', subject: variant('a'), object: variant('b') }).ok).toBe(false);
  });

  it('requires same-kind for successor_of', () => {
    expect(validateRelation({ predicate: 'successor_of', subject: { id: 'm', kind: 'model' }, object: { id: 'r', kind: 'model_release' } }).ok).toBe(false);
    expect(validateRelation({ predicate: 'successor_of', subject: { id: 'r2', kind: 'model_release' }, object: { id: 'r1', kind: 'model_release' } }).ok).toBe(true);
  });
});

describe('validateVariant', () => {
  it('requires lineage for derived variants', () => {
    const r = validateVariant({ kind: 'distill', developerOrgId: 'qwen', publisherOrgId: 'deepseek', lineage: [] });
    expect(r).toEqual({ ok: false, errors: ['distill variant requires a distilled_from relation'] });
    expect(validateVariant({ kind: 'distill', developerOrgId: 'qwen', publisherOrgId: 'deepseek', lineage: [{ predicate: 'distilled_from' }] }).ok).toBe(true);
  });

  it('treats third-party non-derived variants as re-uploads (invalid)', () => {
    const r = validateVariant({ kind: 'instruct', developerOrgId: 'meta', publisherOrgId: 'someone', lineage: [] });
    expect(r.ok).toBe(false);
  });

  it('accepts first-party post-trains without lineage', () => {
    expect(validateVariant({ kind: 'instruct', developerOrgId: 'meta', publisherOrgId: 'meta', lineage: [] }).ok).toBe(true);
  });
});

describe('validateArtifact', () => {
  const scheme = { method: 'k_quant' as const, format: 'gguf' as const, bitsPerWeight: 4.89 };
  it('accepts plausible Q4_K_M sizes', () => {
    // Llama 3.1 8B Q4_K_M is ~4.92 GB
    expect(validateArtifact({ format: 'gguf', scheme, sizeBytes: 4_920_000_000, model: { paramsTotal: 8.03e9 } }).ok).toBe(true);
  });
  it('rejects format mismatch and implausible size', () => {
    const r = validateArtifact({ format: 'mlx', scheme, sizeBytes: 16_000_000_000, model: { paramsTotal: 8.03e9 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(2);
  });
});

describe('slugify', () => {
  it('produces stable url slugs', () => {
    expect(slugify('Qwen2.5 32B Instruct')).toBe('qwen2-5-32b-instruct');
    expect(slugify('DeepSeek-R1-Distill-Qwen-7B')).toBe('deepseek-r1-distill-qwen-7b');
    expect(slugify('  Llama 3.1: 8B  ')).toBe('llama-3-1-8b');
  });
});
