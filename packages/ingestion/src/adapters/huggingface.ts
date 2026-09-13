/**
 * Hugging Face Hub: normalizer, live adapter and fixture adapter.
 *
 * Written against `GET /api/models/{repo}?blobs=true&expand[]=…` (verified September 2026). The retained snapshot
 * is a projection of that response: identity, lineage, license, weight files and reported architecture facts.
 * Volatile counters (downloads, likes) are recorded as metrics, and README/model-card bodies are never stored.
 */
import { readFile } from 'node:fs/promises';
import type { VariantKind } from '@mutinai/domain';
import type { Identifier, NormalizedRecord, ObservedModelFacts, RawItem, SourceAdapter, SourceDescriptor, VariantRecord } from '../adapter';
import { HttpError, nextLink, RateLimitError, type HttpClient } from '../http';

export interface HfSibling {
  rfilename: string;
  size?: number;
  lfs?: { size?: number };
}

export interface HfModel {
  id: string;
  author?: string;
  createdAt?: string;
  lastModified?: string;
  pipeline_tag?: string;
  library_name?: string;
  tags?: string[];
  cardData?: { license?: string; license_name?: string; base_model?: string | string[]; tags?: string[] };
  baseModels?: { relation: string; models: { id: string }[] };
  config?: { architectures?: string[]; model_type?: string; quantization_config?: { bits?: number; quant_method?: string } };
  safetensors?: { total?: number; parameters?: Record<string, number> };
  gguf?: { total?: number; architecture?: string; context_length?: number };
  /** Facts from the repository's config.json, fetched only for root weights (no declared parent). */
  architecture?: HfArchitectureFacts;
  siblings?: HfSibling[];
  gated?: boolean | string;
  private?: boolean;
  disabled?: boolean;
  downloads?: number;
  likes?: number;
  /** Set by the live adapter when the Hub no longer serves a repository (deleted, renamed away, private). */
  unavailable?: { status: number };
}

/** Pipelines Mutinai models as language models. Other repos (embeddings, TTS, diffusion) are not modelled. */
const LLM_PIPELINES = new Set(['text-generation', 'image-text-to-text', 'any-to-any', 'text2text-generation']);

const hfIdentifier = (id: string): Identifier => ({ namespace: 'huggingface', value: id, url: `https://huggingface.co/${id}` });

function lineage(model: HfModel): { relation: string; bases: string[] } | null {
  if (model.baseModels?.models?.length) return { relation: model.baseModels.relation, bases: model.baseModels.models.map((m) => m.id) };
  let relation: string | null = null;
  const bases: string[] = [];
  for (const tag of model.tags ?? []) {
    const m = /^base_model:(finetune|quantized|merge|adapter|distillation):(.+)$/.exec(tag);
    if (!m) continue;
    relation ??= m[1]!;
    if (m[1] === relation && !bases.includes(m[2]!)) bases.push(m[2]!);
  }
  return relation ? { relation, bases } : null;
}

const fileSize = (f: HfSibling) => f.size ?? f.lfs?.size ?? null;
const sumSizes = (files: HfSibling[]) => (files.length && files.every((f) => fileSize(f) != null) ? files.reduce((n, f) => n + fileSize(f)!, 0) : null);

const GGUF_SCHEME = /[.\-_]((?:UD-)?I?Q\d+(?:_[A-Z0-9]+)*|B?F16|F32)\.gguf$/i;
const GGUF_DIR = /^((?:UD-)?I?Q\d+(?:_[A-Z0-9]+)*|B?F16|F32)$/i;
const SPLIT_PART = /-\d{5}-of-\d{5}(?=\.gguf$)/i;

/** Groups GGUF files by quantization scheme, summing split parts and ignoring projector/imatrix files. */
export function ggufSchemes(siblings: HfSibling[]): ArtifactFiles {
  const groups = new Map<string, { files: HfSibling[]; fileName: string }>();
  for (const f of siblings) {
    if (!/\.gguf$/i.test(f.rfilename)) continue;
    const parts = f.rfilename.split('/');
    const base = parts.pop()!;
    if (/mmproj|imatrix/i.test(base)) continue;
    const scheme = GGUF_SCHEME.exec(base.replace(SPLIT_PART, ''))?.[1] ?? parts.map((p) => GGUF_DIR.exec(p)?.[1]).filter(Boolean).pop();
    if (!scheme) continue;
    // Full-precision GGUF shares a name with safetensors BF16; keep it distinct so it is reviewed, not mis-typed.
    const name = /^B?F(16|32)$/i.test(scheme) ? `GGUF ${scheme.toUpperCase()}` : scheme.toUpperCase();
    const group = groups.get(name) ?? { files: [], fileName: f.rfilename };
    group.files.push(f);
    groups.set(name, group);
  }
  return [...groups].map(([schemeName, g]) => ({ schemeName, sizeBytes: sumSizes(g.files), fileName: g.fileName }));
}

type ArtifactFiles = { schemeName: string; sizeBytes: number | null; fileName: string }[];

/** Non-GGUF quantized repos: one artifact per repo when the scheme is stated by metadata (never inferred from size). */
function safetensorsScheme(model: HfModel): ArtifactFiles {
  const weights = (model.siblings ?? []).filter((f) => f.rfilename.endsWith('.safetensors'));
  if (!weights.length) return [];
  const tags = new Set((model.tags ?? []).map((t) => t.toLowerCase()));
  const q = model.config?.quantization_config;
  const method = q?.quant_method?.toLowerCase();
  const repo = model.id.split('/')[1] ?? model.id;
  let schemeName: string | null = null;
  if (model.library_name === 'mlx' || tags.has('mlx')) {
    const bits = q?.bits ?? Number(/(\d+)-?bit/i.exec(repo)?.[1] ?? [...tags].map((t) => /^(\d+)-bit$/.exec(t)?.[1]).find(Boolean) ?? NaN);
    if (Number.isFinite(bits)) schemeName = `MLX ${bits}-bit`;
  } else if (method === 'awq' || tags.has('awq')) {
    schemeName = q?.bits ? `AWQ ${q.bits}-bit` : 'AWQ';
  } else if (method === 'gptq' || tags.has('gptq')) {
    schemeName = q?.bits ? `GPTQ ${q.bits}-bit` : 'GPTQ';
  } else if (method === 'fp8' || /(^|[-_])fp8($|[-_])/i.test(repo)) {
    schemeName = 'FP8';
  } else if (tags.has('exl2') || /exl2/i.test(repo)) {
    schemeName = 'EXL2';
  }
  return schemeName ? [{ schemeName, sizeBytes: sumSizes(weights), fileName: weights[0]!.rfilename }] : [];
}

/** Editor hint only: never applied as the variant kind. */
export function suggestVariantKind(repo: string): VariantKind | undefined {
  const n = repo.toLowerCase();
  if (/(^|[-_.])base($|[-_.])/.test(n)) return 'base';
  if (/coder/.test(n)) return 'coder';
  if (/thinking|reasoning|(^|[-_])r1($|[-_])/.test(n)) return 'reasoning';
  if (/(^|[-_])vl($|[-_])|vision/.test(n)) return 'vision';
  if (/instruct|(^|[-_])it($|[-_])|chat/.test(n)) return 'instruct';
  return undefined;
}

export interface HfArchitectureFacts {
  modelType?: string;
  layers?: number;
  attentionHeads?: number;
  kvHeads?: number;
  headDim?: number;
  hiddenSize?: number;
  contextLength?: number;
  experts?: number;
  expertsPerToken?: number;
}

const positiveInt = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined);

/** Language-model architecture facts from a config.json. Multimodal configs nest the language model under `text_config`. */
export function configFacts(config: unknown): HfArchitectureFacts | undefined {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return undefined;
  const top = config as Record<string, unknown>;
  const c = (top.text_config && typeof top.text_config === 'object' ? top.text_config : top) as Record<string, unknown>;
  const heads = positiveInt(c.num_attention_heads);
  const hidden = positiveInt(c.hidden_size);
  const facts: HfArchitectureFacts = {
    modelType: typeof c.model_type === 'string' ? c.model_type : typeof top.model_type === 'string' ? top.model_type : undefined,
    layers: positiveInt(c.num_hidden_layers),
    attentionHeads: heads,
    kvHeads: positiveInt(c.num_key_value_heads),
    headDim: positiveInt(c.head_dim) ?? (heads && hidden && hidden % heads === 0 ? hidden / heads : undefined),
    hiddenSize: hidden,
    contextLength: positiveInt(c.max_position_embeddings),
    experts: positiveInt(c.num_experts) ?? positiveInt(c.num_local_experts) ?? positiveInt(c.n_routed_experts),
    expertsPerToken: positiveInt(c.num_experts_per_tok),
  };
  const defined = Object.fromEntries(Object.entries(facts).filter(([, v]) => v !== undefined)) as HfArchitectureFacts;
  return Object.keys(defined).length ? defined : undefined;
}

/** Weights with no declared parent, published as a language model: the only repos worth a config.json request. */
export const isRootLanguageModel = (m: HfModel) =>
  !lineage(m) && (!m.pipeline_tag || LLM_PIPELINES.has(m.pipeline_tag)) && (m.siblings ?? []).some((f) => f.rfilename.endsWith('.safetensors'));

/** Evidence that a repo without a pipeline tag is a language model (not, say, a 3D mesh or materials model). */
const languageModelEvidence = (m: HfModel) =>
  Boolean(m.architecture?.layers) || Boolean(m.gguf) || (m.config?.architectures ?? []).some((a) => /For(CausalLM|ConditionalGeneration)$/.test(a));

function observedFacts(model: HfModel): ObservedModelFacts | undefined {
  const a = model.architecture;
  const facts: ObservedModelFacts = {
    architecture: a?.layers ? ((a.experts ?? 0) > 1 ? 'moe' : 'dense') : undefined,
    paramsTotal: model.safetensors?.total ?? model.gguf?.total,
    layers: a?.layers,
    attentionHeads: a?.attentionHeads,
    kvHeads: a?.kvHeads,
    headDim: a?.headDim,
    contextLength: a?.contextLength ?? model.gguf?.context_length,
    modelType: model.config?.model_type ?? a?.modelType ?? model.gguf?.architecture,
    experts: a?.experts,
    expertsPerToken: a?.expertsPerToken,
  };
  const defined = Object.fromEntries(Object.entries(facts).filter(([, v]) => v != null)) as ObservedModelFacts;
  return Object.keys(defined).length ? defined : undefined;
}

const prettyName = (repo: string) => repo.replace(/-/g, ' ').replace(/\b(\d+(?:\.\d+)?)b\b/gi, '$1B');

export function normalizeHuggingFaceModel(item: RawItem): NormalizedRecord[] {
  const model = item.payload as HfModel;
  if (typeof model?.id !== 'string') throw new Error('payload has no repo id');
  const [owner, repo] = model.id.split('/');
  if (!owner || !repo) throw new Error(`invalid repo id ${model.id}`);
  const identifier = hfIdentifier(model.id);

  if (model.unavailable) {
    return [{ type: 'unsupported', identifier, reason: 'source_unavailable', detail: `Hugging Face returned HTTP ${model.unavailable.status} (deleted, renamed or private)` }];
  }
  if (model.pipeline_tag && !LLM_PIPELINES.has(model.pipeline_tag)) {
    return [{ type: 'unsupported', identifier, reason: 'unsupported_repo', detail: `pipeline "${model.pipeline_tag}" is not modelled` }];
  }

  const publisher = { identifier: { namespace: 'huggingface-org', value: owner, url: `https://huggingface.co/${owner}` }, name: owner };
  const rel = lineage(model);
  const licenseKey = model.cardData?.license ?? model.tags?.find((t) => t.startsWith('license:'))?.slice('license:'.length);
  if (!rel && !model.pipeline_tag && !languageModelEvidence(model)) {
    return [{ type: 'unsupported', identifier, reason: 'unsupported_repo', detail: 'no language-model evidence (no pipeline tag, causal-LM architecture or config facts)' }];
  }

  if (rel?.relation === 'adapter') {
    return [{ type: 'unsupported', identifier, reason: 'unsupported_repo', detail: `LoRA/PEFT adapter for ${rel.bases.join(', ')}; Mutinai models complete weight sets only` }];
  }
  if (rel?.relation === 'quantized') {
    const files = ggufSchemes(model.siblings ?? []);
    return [{ type: 'artifact_set', identifier, base: hfIdentifier(rel.bases[0]!), publisher, files: files.length ? files : safetensorsScheme(model) }];
  }

  const tags = new Set([...(model.tags ?? []), ...(model.cardData?.tags ?? [])].map((t) => t.toLowerCase()));
  const capabilities = ['chat'];
  if (tags.has('function calling') || tags.has('tool-use')) capabilities.push('tool_use');
  if (tags.has('code')) capabilities.push('code');
  if (model.pipeline_tag === 'image-text-to-text') capabilities.push('vision');

  const derivation: VariantRecord['derivation'] =
    rel?.relation === 'finetune' ? 'fine_tune' : rel?.relation === 'merge' ? 'merge' : rel?.relation === 'distillation' ? 'distill' : undefined;
  // A fine-tune records its first declared parent; a merge records every parent.
  const bases = rel ? (derivation === 'merge' ? rel.bases : rel.bases.slice(0, 1)).map(hfIdentifier) : undefined;

  return [
    {
      type: 'variant',
      identifier,
      name: prettyName(repo),
      publisher,
      bases,
      derivation,
      suggestedKind: suggestVariantKind(repo),
      licenseKey,
      capabilities,
      releasedOn: model.createdAt?.slice(0, 10),
      observed: observedFacts(model),
    },
  ];
}

/** The retained snapshot: what normalization uses, with stable ordering and without volatile or bulky fields. */
export function projectHfModel(model: HfModel): HfModel {
  const card = model.cardData;
  const weightFiles = (model.siblings ?? [])
    .filter((f) => /\.(gguf|safetensors)$/i.test(f.rfilename))
    .map((f) => ({ rfilename: f.rfilename, size: fileSize(f) ?? undefined }))
    .sort((a, b) => a.rfilename.localeCompare(b.rfilename));
  const q = model.config?.quantization_config;
  return {
    id: model.id,
    author: model.author,
    createdAt: model.createdAt,
    pipeline_tag: model.pipeline_tag,
    library_name: model.library_name,
    tags: model.tags ? [...model.tags].sort() : undefined,
    cardData: card ? { license: card.license, license_name: card.license_name, base_model: card.base_model, tags: card.tags } : undefined,
    baseModels: model.baseModels ? { relation: model.baseModels.relation, models: model.baseModels.models.map((m) => ({ id: m.id })) } : undefined,
    config: model.config ? { architectures: model.config.architectures, model_type: model.config.model_type, quantization_config: q ? { bits: q.bits, quant_method: q.quant_method } : undefined } : undefined,
    safetensors: model.safetensors ? { total: model.safetensors.total, parameters: model.safetensors.parameters } : undefined,
    gguf: model.gguf ? { total: model.gguf.total, architecture: model.gguf.architecture, context_length: model.gguf.context_length } : undefined,
    architecture: model.architecture,
    siblings: weightFiles,
    gated: model.gated,
  };
}

// ─── Live adapter ────────────────────────────────────────────────────────────

export const HUGGINGFACE_SOURCE: SourceDescriptor = {
  key: 'huggingface',
  name: 'Hugging Face Hub',
  kind: 'huggingface',
  baseUrl: 'https://huggingface.co',
  priority: 60,
};

const DETAIL_FIELDS = ['author', 'baseModels', 'cardData', 'config', 'createdAt', 'disabled', 'downloads', 'gated', 'gguf', 'lastModified', 'library_name', 'likes', 'pipeline_tag', 'private', 'safetensors', 'siblings', 'tags'];

export interface HuggingFaceAdapterOptions {
  client: HttpClient;
  /** Explicit repositories, always fetched (and reported unavailable if gone). */
  repos?: string[];
  /** Organizations/users whose text-generation repos are listed newest-modified first (bounded by `since`/`limit`). */
  authors?: string[];
  /**
   * Derivatives of known repos, discovered through the Hub's `base_model:<relation>:<repo>` tags: the most-downloaded
   * `perBase` repos per base and relation. Keeps discovery anchored to variants Mutinai already models.
   */
  derivatives?: { bases: string[]; relations: string[]; perBase: number; /** Skip derivatives with fewer likes (a community-attention floor). */ minLikes?: number };
  baseUrl?: string;
  pageSize?: number;
}

const encodeRepo = (id: string) => id.split('/').map(encodeURIComponent).join('/');

export function createHuggingFaceAdapter(opts: HuggingFaceAdapterOptions): SourceAdapter {
  const repos = opts.repos ?? [];
  const authors = opts.authors ?? [];
  const derivatives = opts.derivatives?.bases.length ? opts.derivatives : undefined;
  if (!repos.length && !authors.length && !derivatives) throw new Error('huggingface: select repositories, authors or derivatives of known repos to ingest (no broad crawl)');
  const base = (opts.baseUrl ?? HUGGINGFACE_SOURCE.baseUrl!).replace(/\/$/, '');
  const pageSize = Math.min(opts.pageSize ?? 100, 1000);

  return {
    source: HUGGINGFACE_SOURCE,
    normalize: normalizeHuggingFaceModel,
    async *fetch(ctx) {
      const seen = new Set<string>();
      let yielded = 0;
      const full = () => ctx.limit != null && yielded >= ctx.limit;

      async function* detail(id: string): AsyncGenerator<RawItem> {
        if (seen.has(id.toLowerCase())) return;
        seen.add(id.toLowerCase());
        const url = `${base}/api/models/${encodeRepo(id)}?blobs=true&${DETAIL_FIELDS.map((f) => `expand[]=${f}`).join('&')}`;
        let model: HfModel | null;
        try {
          model = (await opts.client.getJson<HfModel>(url, { signal: ctx.signal })).data;
        } catch (error) {
          // The Hub answers 401 for repositories that do not exist or are private, 404 for some deleted ones.
          if (error instanceof HttpError && (error.status === 401 || error.status === 404)) {
            yielded += 1;
            yield { externalId: id, url: `${base}/${id}`, fetchedAt: new Date(), contentType: 'application/json', payload: { id, unavailable: { status: error.status } } };
            return;
          }
          throw error;
        }
        if (!model || typeof model.id !== 'string' || !Array.isArray(model.siblings ?? [])) throw new HttpError(url, 200, `unexpected model payload for ${id}`);
        const hidden = model.private || model.disabled;
        const architecture = !hidden && isRootLanguageModel(model) ? await rootConfigFacts(model.id) : undefined;
        const fetchedAt = new Date();
        const payload: HfModel = hidden ? { id: model.id, unavailable: { status: 403 } } : projectHfModel({ ...model, architecture });
        const values = Object.fromEntries(Object.entries({ downloads: model.downloads, likes: model.likes }).filter(([, v]) => typeof v === 'number')) as Record<string, number>;
        yielded += 1;
        yield { externalId: model.id, url: `${base}/${model.id}`, fetchedAt, contentType: 'application/json', payload, metrics: Object.keys(values).length ? [{ identifier: hfIdentifier(model.id), values }] : undefined };
      }

      // Root weights may be a new first-party model: config.json carries the architecture facts needed to add one.
      // One extra request, only for such repos; missing or gated configs are skipped, rate limits still stop the run.
      async function rootConfigFacts(id: string): Promise<HfArchitectureFacts | undefined> {
        try {
          return configFacts((await opts.client.getJson<unknown>(`${base}/${encodeRepo(id)}/resolve/main/config.json`, { signal: ctx.signal })).data);
        } catch (error) {
          if (error instanceof HttpError && !(error instanceof RateLimitError)) return undefined;
          throw error;
        }
      }

      for (const id of repos) {
        if (full()) return;
        yield* detail(id);
      }
      for (const author of authors) {
        let url: string | null = `${base}/api/models?author=${encodeURIComponent(author)}&sort=lastModified&direction=-1&limit=${pageSize}&expand[]=lastModified&expand[]=pipeline_tag`;
        pages: while (url) {
          const { data, response } = await opts.client.getJson<{ id: string; lastModified?: string; pipeline_tag?: string }[]>(url, { signal: ctx.signal });
          if (!Array.isArray(data)) throw new HttpError(url, response.status, `expected a JSON array listing models for ${author}`);
          for (const m of data) {
            if (full()) return;
            if (typeof m?.id !== 'string') throw new HttpError(url, response.status, `model listing for ${author} contains an entry without an id`);
            if (ctx.since && m.lastModified && new Date(m.lastModified) < ctx.since) break pages;
            if (m.pipeline_tag && !LLM_PIPELINES.has(m.pipeline_tag)) continue;
            yield* detail(m.id);
          }
          url = nextLink(response.headers.get('link'));
        }
      }
      for (const baseRepo of derivatives?.bases ?? []) {
        for (const relation of derivatives!.relations) {
          const filter = encodeURIComponent(`base_model:${relation}:${baseRepo}`);
          const url = `${base}/api/models?filter=${filter}&sort=downloads&direction=-1&limit=${Math.min(derivatives!.perBase, 100)}&expand[]=lastModified&expand[]=pipeline_tag&expand[]=likes`;
          const { data, response } = await opts.client.getJson<{ id: string; lastModified?: string; pipeline_tag?: string; likes?: number }[]>(url, { signal: ctx.signal });
          if (!Array.isArray(data)) throw new HttpError(url, response.status, `expected a JSON array listing ${relation} derivatives of ${baseRepo}`);
          for (const m of data.slice(0, derivatives!.perBase)) {
            if (full()) return;
            if (typeof m?.id !== 'string') throw new HttpError(url, response.status, `derivative listing for ${baseRepo} contains an entry without an id`);
            // Sorted by downloads, not time: skip (rather than stop at) repos unchanged since the window.
            if (ctx.since && m.lastModified && new Date(m.lastModified) < ctx.since) continue;
            if (m.pipeline_tag && !LLM_PIPELINES.has(m.pipeline_tag)) continue;
            if (derivatives!.minLikes && (m.likes ?? 0) < derivatives!.minLikes) continue;
            yield* detail(m.id);
          }
        }
      }
    },
  };
}

// ─── Fixture adapter ─────────────────────────────────────────────────────────

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
