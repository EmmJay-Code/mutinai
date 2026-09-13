import { describe, expect, it } from 'vitest';
import type { ArtifactSetRecord, RawItem, VariantRecord } from '../../src/adapter';
import { configFacts, createHuggingFaceAdapter, ggufSchemes, normalizeHuggingFaceModel, projectHfModel, suggestVariantKind, type HfModel } from '../../src/adapters/huggingface';
import { canonicalJson, sha256 } from '../../src/hash';
import { HttpError } from '../../src/http';
import { offlineHub, recordedHf } from '../support/recorded';

const raw = (payload: unknown): RawItem => ({ externalId: 'x', fetchedAt: new Date(), contentType: 'application/json', payload });
const normalizeRecorded = (file: string) => normalizeHuggingFaceModel(raw(projectHfModel(recordedHf(file))));

async function collect(iterable: AsyncIterable<RawItem>) {
  const items: RawItem[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

describe('Hugging Face normalization (recorded responses)', () => {
  it('first-party post-trained weights keep their declared parent and reported facts', () => {
    const [rec] = normalizeRecorded('qwen3-8b') as VariantRecord[];
    expect(rec).toMatchObject({
      type: 'variant',
      identifier: { namespace: 'huggingface', value: 'Qwen/Qwen3-8B' },
      publisher: { identifier: { namespace: 'huggingface-org', value: 'Qwen' } },
      bases: [{ namespace: 'huggingface', value: 'Qwen/Qwen3-8B-Base' }],
      derivation: 'fine_tune',
      licenseKey: 'apache-2.0',
      observed: { paramsTotal: 8190735360, modelType: 'qwen3' },
    });
  });

  it('community fine-tunes map to fine_tune with their base', () => {
    const [rec] = normalizeRecorded('hermes-3-llama-3.1-8b') as VariantRecord[];
    expect(rec).toMatchObject({ derivation: 'fine_tune', bases: [{ value: 'meta-llama/Llama-3.1-8B' }], publisher: { name: 'NousResearch' }, licenseKey: 'llama3' });
  });

  it('first-party GGUF repos become artifact sets with real file sizes per scheme', () => {
    const [rec] = normalizeRecorded('qwen3-8b-gguf') as ArtifactSetRecord[];
    expect(rec).toMatchObject({ type: 'artifact_set', base: { value: 'Qwen/Qwen3-8B' }, publisher: { name: 'Qwen' } });
    expect(rec!.files.map((f) => f.schemeName)).toEqual(['Q4_K_M', 'Q5_0', 'Q5_K_M', 'Q6_K', 'Q8_0']);
    expect(rec!.files.find((f) => f.schemeName === 'Q4_K_M')!.sizeBytes).toBe(5027783488);
  });

  it('sums split GGUF parts in scheme subdirectories and keeps full-precision GGUF distinct', () => {
    const model = recordedHf('unsloth-qwen3-235b-gguf');
    const [rec] = normalizeHuggingFaceModel(raw(projectHfModel(model))) as ArtifactSetRecord[];
    const bf16Parts = model.siblings!.filter((f) => f.rfilename.startsWith('BF16/') && f.rfilename.endsWith('.gguf'));
    const bf16 = rec!.files.find((f) => f.schemeName === 'GGUF BF16')!;
    expect(bf16.sizeBytes).toBe(bf16Parts.reduce((n, f) => n + f.size!, 0));
    expect(rec!.files.map((f) => f.schemeName)).not.toContain('BF16');
    expect(rec!.files.every((f) => !/mmproj/i.test(f.fileName))).toBe(true);
    expect(new Set(rec!.files.map((f) => f.schemeName)).size).toBe(rec!.files.length);
  });

  it('MLX repos take their bit width from quantization metadata', () => {
    const [rec] = normalizeRecorded('mlx-qwen3-8b-4bit') as ArtifactSetRecord[];
    expect(rec!.files).toEqual([{ schemeName: 'MLX 4-bit', sizeBytes: 4607835174, fileName: 'model.safetensors' }]);
  });
});

describe('Hugging Face normalization (edge cases)', () => {
  it('LoRA adapters are recorded as unsupported, not as fine-tunes', () => {
    const [rec] = normalizeHuggingFaceModel(raw({ id: 'someone/lora', baseModels: { relation: 'adapter', models: [{ id: 'Qwen/Qwen3-8B' }] } }));
    expect(rec).toMatchObject({ type: 'unsupported', reason: 'unsupported_repo' });
  });

  it('non-language-model pipelines are not modelled', () => {
    const [rec] = normalizeHuggingFaceModel(raw({ id: 'Qwen/Qwen3-Embedding-8B', pipeline_tag: 'feature-extraction' }));
    expect(rec).toMatchObject({ type: 'unsupported', reason: 'unsupported_repo', detail: expect.stringContaining('feature-extraction') });
  });

  it('unavailable repos normalize to a source_unavailable record', () => {
    const [rec] = normalizeHuggingFaceModel(raw({ id: 'Org/Gone', unavailable: { status: 401 } }));
    expect(rec).toMatchObject({ type: 'unsupported', reason: 'source_unavailable' });
  });

  it('merges keep every parent; tag lineage works without baseModels', () => {
    const [rec] = normalizeHuggingFaceModel(raw({ id: 'm/merge', tags: ['base_model:merge:a/one', 'base_model:merge:b/two', 'base_model:finetune:c/ignored'] })) as VariantRecord[];
    expect(rec).toMatchObject({ derivation: 'merge', bases: [{ value: 'a/one' }, { value: 'b/two' }] });
  });

  it('quantized repos without a stated scheme produce no guessed files', () => {
    const [rec] = normalizeHuggingFaceModel(raw({ id: 'x/quant', baseModels: { relation: 'quantized', models: [{ id: 'a/b' }] }, siblings: [{ rfilename: 'model.safetensors', size: 10 }] })) as ArtifactSetRecord[];
    expect(rec!.files).toEqual([]);
  });

  it('parses GGUF scheme names from file names, directories and dynamic quants', () => {
    const files = ggufSchemes([
      { rfilename: 'M.Q4_K_M.gguf', size: 1 },
      { rfilename: 'Q8_0/M-Q8_0-00001-of-00002.gguf', size: 2 },
      { rfilename: 'Q8_0/M-Q8_0-00002-of-00002.gguf', size: 3 },
      { rfilename: 'UD-Q4_K_XL/M-UD-Q4_K_XL-00001-of-00001.gguf', size: 4 },
      { rfilename: 'mmproj-F16.gguf', size: 5 },
      { rfilename: 'M-IQ2_XXS.gguf' },
    ]);
    expect(files).toEqual([
      { schemeName: 'Q4_K_M', sizeBytes: 1, fileName: 'M.Q4_K_M.gguf' },
      { schemeName: 'Q8_0', sizeBytes: 5, fileName: 'Q8_0/M-Q8_0-00001-of-00002.gguf' },
      { schemeName: 'UD-Q4_K_XL', sizeBytes: 4, fileName: 'UD-Q4_K_XL/M-UD-Q4_K_XL-00001-of-00001.gguf' },
      { schemeName: 'IQ2_XXS', sizeBytes: null, fileName: 'M-IQ2_XXS.gguf' },
    ]);
  });

  it('suggests (never decides) variant kinds from repo names', () => {
    expect(suggestVariantKind('Qwen3-8B-Base')).toBe('base');
    expect(suggestVariantKind('Llama-3.1-8B-Instruct')).toBe('instruct');
    expect(suggestVariantKind('gemma-3-27b-it')).toBe('instruct');
    expect(suggestVariantKind('Qwen2.5-Coder-32B-Instruct')).toBe('coder');
    expect(suggestVariantKind('Qwen2.5-VL-7B-Instruct')).toBe('vision');
    expect(suggestVariantKind('Qwen3-4B-Thinking-2507')).toBe('reasoning');
    expect(suggestVariantKind('Qwen3-8B')).toBeUndefined();
  });

  it('the retained snapshot excludes volatile and bulky fields and is order-independent', () => {
    const model = recordedHf('qwen3-8b-gguf');
    const projected = projectHfModel(model);
    const text = JSON.stringify(projected);
    for (const key of ['downloads', 'likes', 'lastModified', 'blobId', 'lfs', 'chat_template', 'LICENSE']) expect(text).not.toContain(key);
    const shuffled: HfModel = { ...model, downloads: 1, likes: 2, lastModified: '2030-01-01', siblings: [...model.siblings!].reverse(), tags: [...model.tags!].reverse() };
    expect(sha256(canonicalJson(projectHfModel(shuffled)))).toBe(sha256(canonicalJson(projected)));
  });
});

describe('Hugging Face root weights (new first-party models)', () => {
  // config.json of Qwen/Qwen3.8-27B (September 2026): a multimodal config with the language model under text_config.
  const qwen38Config = { architectures: ['Qwen3_5ForConditionalGeneration'], model_type: 'qwen3_5', text_config: { model_type: 'qwen3_5_text', num_hidden_layers: 64, num_attention_heads: 24, num_key_value_heads: 4, head_dim: 256, hidden_size: 5120, max_position_embeddings: 262144 } };
  const qwen38: HfModel = { id: 'Qwen/Qwen3.8-27B', createdAt: '2026-08-05T09:00:00.000Z', pipeline_tag: 'image-text-to-text', library_name: 'transformers', tags: ['conversational', 'license:apache-2.0'], safetensors: { total: 27781427952 }, siblings: [{ rfilename: 'model-00001-of-00011.safetensors', size: 1 }] };

  it('reads architecture facts from config.json, nested or not, deriving head dim only from hidden size', () => {
    expect(configFacts(qwen38Config)).toEqual({ modelType: 'qwen3_5_text', layers: 64, attentionHeads: 24, kvHeads: 4, headDim: 256, hiddenSize: 5120, contextLength: 262144 });
    expect(configFacts({ num_hidden_layers: 36, num_attention_heads: 32, hidden_size: 4096, n_routed_experts: 128, num_experts_per_tok: 4 })).toMatchObject({ headDim: 128, experts: 128, expertsPerToken: 4 });
    expect(configFacts({ num_hidden_layers: 'many' })).toBeUndefined();
    expect(configFacts(null)).toBeUndefined();
  });

  it('fetches config.json only for root weights and carries the facts into the variant record', async () => {
    const { client, requested } = offlineHub({
      overrides: { 'Qwen/Qwen3.8-27B': qwen38 },
      routes: [(url) => (url.pathname === '/Qwen/Qwen3.8-27B/resolve/main/config.json' ? { status: 200, body: qwen38Config } : undefined)],
    });
    const items = await collect(createHuggingFaceAdapter({ client, repos: ['Qwen/Qwen3.8-27B', 'Qwen/Qwen3-8B'] }).fetch({}));
    expect(requested.filter((u) => u.includes('config.json'))).toEqual(['https://huggingface.co/Qwen/Qwen3.8-27B/resolve/main/config.json']);
    const [rec] = normalizeHuggingFaceModel(items[0]!) as VariantRecord[];
    expect(rec).toMatchObject({ bases: undefined, releasedOn: '2026-08-05', capabilities: ['chat', 'vision'], observed: { architecture: 'dense', paramsTotal: 27781427952, layers: 64, attentionHeads: 24, kvHeads: 4, headDim: 256, contextLength: 262144 } });
  });

  it('a missing or gated config.json leaves the facts out without failing the run', async () => {
    const { client } = offlineHub({ overrides: { 'Qwen/Qwen3.8-27B': qwen38 } });
    const [item] = await collect(createHuggingFaceAdapter({ client, repos: ['Qwen/Qwen3.8-27B'] }).fetch({}));
    expect((item!.payload as HfModel).architecture).toBeUndefined();
  });

  it('repositories without language-model evidence are not modelled', () => {
    const [mesh] = normalizeHuggingFaceModel(raw({ id: 'microsoft/SQuadGen', library_name: 'pytorch', tags: ['3d', 'mesh-generation'] }));
    expect(mesh).toMatchObject({ type: 'unsupported', reason: 'unsupported_repo', detail: expect.stringContaining('no language-model evidence') });
    const [mistral] = normalizeHuggingFaceModel(raw({ id: 'mistralai/Mistral-Small-4-119B-2603', config: { architectures: ['Mistral3ForConditionalGeneration'] } }));
    expect(mistral).toMatchObject({ type: 'variant' });
  });
});

describe('live Hugging Face adapter fetch', () => {
  const listing = (ids: [string, string, string?][]) => ids.map(([id, lastModified, pipeline_tag]) => ({ id, lastModified, pipeline_tag: pipeline_tag ?? 'text-generation' }));

  it('requires an explicit selection', () => {
    expect(() => createHuggingFaceAdapter({ client: offlineHub().client })).toThrow(/select repositories, authors or derivatives/);
  });

  it('follows pagination, skips non-LLM repos, stops at `since`, and records metrics outside the snapshot', async () => {
    const pages: Record<string, unknown> = {
      first: listing([['Qwen/Qwen3-8B', '2026-09-01T00:00:00Z'], ['Qwen/Qwen3-Embedding-8B', '2026-08-31T00:00:00Z', 'feature-extraction']]),
      second: listing([['Qwen/Qwen3-8B-GGUF', '2026-08-20T00:00:00Z'], ['Qwen/Qwen3-30B-A3B', '2025-01-01T00:00:00Z']]),
    };
    const { client, requested } = offlineHub({
      routes: [
        (url) => (url.pathname === '/api/models' && !url.searchParams.get('cursor') ? { status: 200, body: pages.first, headers: { link: '<https://huggingface.co/api/models?author=Qwen&cursor=p2>; rel="next"' } } : undefined),
        (url) => (url.pathname === '/api/models' && url.searchParams.get('cursor') === 'p2' ? { status: 200, body: pages.second } : undefined),
      ],
    });
    const adapter = createHuggingFaceAdapter({ client, authors: ['Qwen'] });
    const items = await collect(adapter.fetch({ since: new Date('2026-06-01T00:00:00Z') }));
    expect(items.map((i) => i.externalId)).toEqual(['Qwen/Qwen3-8B', 'Qwen/Qwen3-8B-GGUF']);
    expect(requested.some((u) => u.includes('Qwen3-Embedding'))).toBe(false);
    expect(requested.some((u) => u.includes('Qwen3-30B-A3B'))).toBe(false);
    expect(items[0]!.metrics).toEqual([{ identifier: expect.objectContaining({ value: 'Qwen/Qwen3-8B' }), values: { downloads: expect.any(Number), likes: expect.any(Number) } }]);
    expect(JSON.stringify(items[0]!.payload)).not.toContain('downloads');
    expect(requested[1]).toMatch(/blobs=true/);
  });

  it('respects limit and de-duplicates repos across selections', async () => {
    const { client } = offlineHub({ routes: [(url) => (url.pathname === '/api/models' ? { status: 200, body: listing([['Qwen/Qwen3-8B', '2026-09-01T00:00:00Z'], ['Qwen/Qwen3-8B-GGUF', '2026-09-01T00:00:00Z']]) } : undefined)] });
    const adapter = createHuggingFaceAdapter({ client, repos: ['Qwen/Qwen3-8B'], authors: ['Qwen'] });
    expect((await collect(adapter.fetch({}))).map((i) => i.externalId)).toEqual(['Qwen/Qwen3-8B', 'Qwen/Qwen3-8B-GGUF']);
    expect((await collect(adapter.fetch({ limit: 1 })))).toHaveLength(1);
  });

  it('reports repos the Hub no longer serves instead of failing the run', async () => {
    const { client } = offlineHub();
    const items = await collect(createHuggingFaceAdapter({ client, repos: ['Gone/Repo'] }).fetch({}));
    expect(items).toEqual([expect.objectContaining({ externalId: 'Gone/Repo', payload: { id: 'Gone/Repo', unavailable: { status: 401 } } })]);
  });

  it('discovers derivatives of known repos through base_model tags, bounded per base and relation', async () => {
    const { client, requested } = offlineHub({
      routes: [
        (url) =>
          url.pathname === '/api/models' && url.searchParams.get('filter') === 'base_model:quantized:Qwen/Qwen3-8B'
            ? { status: 200, body: listing([['Qwen/Qwen3-8B-GGUF', '2026-09-01T00:00:00Z'], ['mlx-community/Qwen3-8B-4bit', '2025-01-01T00:00:00Z'], ['x/extra', '2026-09-01T00:00:00Z']]) }
            : undefined,
        (url) => (url.pathname === '/api/models' && url.searchParams.get('filter')?.startsWith('base_model:finetune:') ? { status: 200, body: listing([['Qwen/Qwen3-8B', '2026-09-01T00:00:00Z']]) } : undefined),
      ],
    });
    const adapter = createHuggingFaceAdapter({ client, repos: ['Qwen/Qwen3-8B'], derivatives: { bases: ['Qwen/Qwen3-8B'], relations: ['quantized', 'finetune'], perBase: 2 } });
    const items = await collect(adapter.fetch({ since: new Date('2026-06-01T00:00:00Z') }));
    expect(items.map((i) => i.externalId)).toEqual(['Qwen/Qwen3-8B', 'Qwen/Qwen3-8B-GGUF']);
    expect(requested.filter((u) => u.includes('filter=')).map((u) => new URL(u).searchParams.get('limit'))).toEqual(['2', '2']);
    expect(requested.some((u) => u.includes('x/extra'))).toBe(false);
  });

  it('skips community derivatives below the likes floor', async () => {
    const { client } = offlineHub({
      routes: [(url) => (url.pathname === '/api/models' ? { status: 200, body: [{ id: 'Qwen/Qwen3-8B-GGUF', lastModified: '2026-09-01T00:00:00Z', likes: 40 }, { id: 'nobody/qwen3-8b-copy', lastModified: '2026-09-01T00:00:00Z', likes: 0 }] } : undefined)],
    });
    const adapter = createHuggingFaceAdapter({ client, derivatives: { bases: ['Qwen/Qwen3-8B'], relations: ['quantized'], perBase: 5, minLikes: 5 } });
    expect((await collect(adapter.fetch({}))).map((i) => i.externalId)).toEqual(['Qwen/Qwen3-8B-GGUF']);
  });

  it('fails clearly on malformed listings and server errors', async () => {
    const bad = offlineHub({ routes: [(url) => (url.pathname === '/api/models' ? { status: 200, body: { error: 'nope' } } : undefined)] });
    await expect(collect(createHuggingFaceAdapter({ client: bad.client, authors: ['Qwen'] }).fetch({}))).rejects.toThrow(/expected a JSON array/);
    const down = offlineHub({ routes: [() => ({ status: 500, body: { error: 'boom' } })] });
    await expect(collect(createHuggingFaceAdapter({ client: down.client, repos: ['Qwen/Qwen3-8B'] }).fetch({}))).rejects.toBeInstanceOf(HttpError);
  });
});
