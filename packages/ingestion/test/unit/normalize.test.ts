import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256 } from '../../src/hash';
import { normalizeHuggingFaceModel, type HfModel } from '../../src/adapters/huggingface';
import { normalizeGitHubRepo } from '../../src/adapters/github';
import { normalizeFeedItem } from '../../src/adapters/rss';
import { MemoryObjectStore, FileSystemObjectStore } from '../../src/object-store';

const raw = (payload: unknown) => ({ externalId: 'x', fetchedAt: new Date(), contentType: 'application/json', payload });

describe('content hashing', () => {
  it('is independent of key order', () => {
    expect(sha256(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: 3 } }))).toBe(sha256(canonicalJson({ a: { c: 3, d: [2, { y: 2, z: 1 }] }, b: 1 })));
    expect(sha256(canonicalJson({ a: [1, 2] }))).not.toBe(sha256(canonicalJson({ a: [2, 1] })));
  });
});

describe('Hugging Face normalization', () => {
  it('maps finetune tags to a fine_tune variant with its base', () => {
    const model: HfModel = { id: 'NousResearch/Hermes-3-Llama-3.1-8B', tags: ['base_model:finetune:meta-llama/Llama-3.1-8B', 'function calling'], cardData: { license: 'llama3' } };
    expect(normalizeHuggingFaceModel(raw(model))).toEqual([
      expect.objectContaining({
        type: 'variant',
        name: 'Hermes 3 Llama 3.1 8B',
        derivation: 'fine_tune',
        base: { namespace: 'huggingface', value: 'meta-llama/Llama-3.1-8B' },
        publisher: expect.objectContaining({ identifier: expect.objectContaining({ namespace: 'huggingface-org', value: 'NousResearch' }) }),
        licenseKey: 'llama3',
        capabilities: ['chat', 'tool_use'],
      }),
    ]);
  });

  it('maps quantized repos to artifact sets with parsed GGUF schemes', () => {
    const model: HfModel = {
      id: 'Org/Model-GGUF',
      tags: ['base_model:quantized:Org/Model'],
      siblings: [{ rfilename: 'README.md' }, { rfilename: 'Model.Q4_K_M.gguf', size: 10 }, { rfilename: 'Model-IQ2_XXS.gguf', size: 5 }, { rfilename: 'Model-Q8_0.gguf' }],
    };
    const [rec] = normalizeHuggingFaceModel(raw(model));
    expect(rec).toMatchObject({ type: 'artifact_set', base: { value: 'Org/Model' } });
    if (rec?.type !== 'artifact_set') throw new Error();
    expect(rec.files.map((f) => [f.schemeName, f.sizeBytes])).toEqual([['Q4_K_M', 10], ['IQ2_XXS', 5], ['Q8_0', null]]);
  });

  it('first-party repos without a base produce a variant with no derivation', () => {
    const [rec] = normalizeHuggingFaceModel(raw({ id: 'meta-llama/Llama-3.1-8B-Instruct', tags: [] }));
    expect(rec).toMatchObject({ type: 'variant', derivation: undefined, base: undefined });
  });

  it('throws on invalid repo ids', () => {
    expect(() => normalizeHuggingFaceModel(raw({ id: 'no-owner' }))).toThrow();
  });
});

describe('GitHub and RSS normalization', () => {
  it('lowercases repo identifiers and captures releases', () => {
    const [rec] = normalizeGitHubRepo(raw({ full_name: 'Ollama/Ollama', html_url: 'u', description: 'd', homepage: '', language: 'Go', license: null, pushed_at: '', latest_release: { tag_name: 'v1', name: null, published_at: '2025-01-01T00:00:00Z', html_url: 'r', body: null } }));
    expect(rec).toMatchObject({ type: 'project', identifier: { value: 'ollama/ollama' }, fields: { homepageUrl: null }, release: { tag: 'v1', title: 'v1' } });
  });

  it('splits feed categories into identifiers and exact mentions', () => {
    const [rec] = normalizeFeedItem(raw({ guid: 'g', title: 't', link: 'l', pubDate: 'Tue, 20 May 2025 09:00:00 GMT', categories: ['Qwen3', 'Org/Repo'], kind: 'nonsense' }));
    expect(rec).toMatchObject({ type: 'event', kind: 'announcement', identifiers: [{ namespace: 'huggingface', value: 'Org/Repo' }], mentions: ['Qwen3'], occurredAt: '2025-05-20T09:00:00.000Z' });
  });
});

describe('object stores', () => {
  it('memory store is write-once per key', async () => {
    const store = new MemoryObjectStore();
    await store.put('a/b', new Uint8Array([1]), 'x');
    await store.put('a/b', new Uint8Array([2]), 'x');
    expect(await store.get('a/b')).toEqual(new Uint8Array([1]));
  });

  it('filesystem store rejects path traversal', async () => {
    const store = new FileSystemObjectStore('/tmp/mutinai-never-written');
    await expect(store.put('../escape', new Uint8Array(), 'x')).rejects.toThrow(/unsafe/);
    await expect(store.put('/abs', new Uint8Array(), 'x')).rejects.toThrow(/unsafe/);
  });
});
