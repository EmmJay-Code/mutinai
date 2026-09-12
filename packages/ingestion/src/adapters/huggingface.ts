/**
 * Hugging Face model-repo normalizer + fixture adapter.
 * `normalizeHuggingFaceModel` is written against the shape of `GET /api/models/{id}?blobs=true`,
 * so a live adapter only needs to implement `fetch`.
 */
import { readFile } from 'node:fs/promises';
import type { NormalizedRecord, RawItem, SourceAdapter, SourceDescriptor, VariantRecord } from '../adapter';

export interface HfModel {
  id: string;
  author?: string;
  createdAt?: string;
  lastModified?: string;
  pipeline_tag?: string;
  library_name?: string;
  tags?: string[];
  cardData?: { license?: string; base_model?: string | string[]; tags?: string[] };
  siblings?: { rfilename: string; size?: number }[];
  downloads?: number;
  likes?: number;
}

const GGUF_SCHEME = /[.-](I?Q\d+_[A-Z0-9_]+|Q\d+_\d|F16|BF16)\.gguf$/i;

function baseRelation(model: HfModel): { relation: string; base: string } | null {
  for (const tag of model.tags ?? []) {
    const m = /^base_model:(finetune|quantized|merge|adapter|distillation):(.+)$/.exec(tag);
    if (m) return { relation: m[1]!, base: m[2]! };
  }
  return null;
}

export function normalizeHuggingFaceModel(item: RawItem): NormalizedRecord[] {
  const model = item.payload as HfModel;
  const [owner, repoName] = model.id.split('/');
  if (!owner || !repoName) throw new Error(`invalid repo id ${model.id}`);
  const identifier = { namespace: 'huggingface', value: model.id, url: `https://huggingface.co/${model.id}` };
  const publisher = { identifier: { namespace: 'huggingface-org', value: owner, url: `https://huggingface.co/${owner}` }, name: owner };
  const rel = baseRelation(model);
  const licenseKey = model.cardData?.license ?? model.tags?.find((t) => t.startsWith('license:'))?.slice('license:'.length);

  if (rel?.relation === 'quantized') {
    const files = (model.siblings ?? []).flatMap((f) => {
      const m = GGUF_SCHEME.exec(f.rfilename);
      return m ? [{ schemeName: m[1]!.toUpperCase(), sizeBytes: f.size ?? null, fileName: f.rfilename }] : [];
    });
    return [{ type: 'artifact_set', identifier, base: { namespace: 'huggingface', value: rel.base }, publisher, files }];
  }

  const tags = new Set([...(model.tags ?? []), ...(model.cardData?.tags ?? [])].map((t) => t.toLowerCase()));
  const capabilities = ['chat'];
  if (tags.has('function calling') || tags.has('tool-use')) capabilities.push('tool_use');
  if (tags.has('code')) capabilities.push('code');

  const derivation: VariantRecord['derivation'] =
    rel?.relation === 'finetune' || rel?.relation === 'adapter' ? 'fine_tune' : rel?.relation === 'merge' ? 'merge' : rel?.relation === 'distillation' ? 'distill' : undefined;

  return [
    {
      type: 'variant',
      identifier,
      name: repoName.replace(/-/g, ' ').replace(/\b(\d+(?:\.\d+)?)b\b/gi, '$1B'),
      publisher,
      base: rel ? { namespace: 'huggingface', value: rel.base } : undefined,
      derivation,
      licenseKey,
      capabilities: derivation ? capabilities : undefined,
      releasedOn: model.createdAt?.slice(0, 10),
    },
  ];
}

export const FIXTURE_HUGGINGFACE_SOURCE: SourceDescriptor = {
  key: 'fixture-huggingface',
  name: 'Hugging Face (fixture)',
  kind: 'fixture',
  baseUrl: 'https://huggingface.co',
  priority: 40,
};

export function createFixtureHuggingFaceAdapter(opts: { file?: string; models?: HfModel[]; source?: SourceDescriptor } = {}): SourceAdapter {
  const file = opts.file ?? new URL('../../fixtures/huggingface-models.json', import.meta.url);
  return {
    source: opts.source ?? FIXTURE_HUGGINGFACE_SOURCE,
    async *fetch() {
      const models: HfModel[] = opts.models ?? JSON.parse(await readFile(file, 'utf8'));
      for (const model of models) {
        yield { externalId: model.id, url: `https://huggingface.co/${model.id}`, fetchedAt: new Date(), contentType: 'application/json', payload: model };
      }
    },
    normalize: normalizeHuggingFaceModel,
  };
}
