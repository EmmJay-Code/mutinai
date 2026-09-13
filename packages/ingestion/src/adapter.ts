/**
 * Source adapter contract. See docs/adr/0005-ingestion-boundary.md and docs/adr/0008-live-ingestion.md.
 *
 * Adapters only fetch and normalize. They never touch the database; the pipeline owns
 * deduplication, identity resolution, writes, provenance, review items and downstream work.
 */
import type { Architecture, EventKind, VariantKind } from '@mutinai/domain';

export type SourceKind = 'huggingface' | 'github' | 'arxiv' | 'rss' | 'editorial' | 'fixture';

export interface SourceDescriptor {
  /** Stable key, e.g. `huggingface` or `fixture-huggingface`. Source records are namespaced by it. */
  key: string;
  name: string;
  kind: SourceKind;
  baseUrl?: string;
  /** Higher-priority sources overwrite canonical field values; lower ones only add assertions. */
  priority: number;
}

export interface RawItem {
  /** Identifier of the item within the source (repo id, feed guid, …). */
  externalId: string;
  url?: string;
  fetchedAt: Date;
  contentType: string;
  /** The retained snapshot. Its canonical hash decides whether the item changed, so keep volatile counters out. */
  payload: unknown;
  /** Volatile counters (downloads, stars, …). Recorded once per day per entity; never part of the snapshot hash. */
  metrics?: { identifier: Identifier; values: Record<string, number> }[];
}

/** Stored HTTP validators, so adapters can make conditional requests (ETag / Last-Modified). */
export interface ValidatorCache {
  get(url: string): Promise<{ etag?: string; lastModified?: string } | null>;
  set(url: string, validators: { etag?: string; lastModified?: string }): Promise<void>;
}

export interface FetchContext {
  /** Only items changed at or after this instant (adapters that can filter server-side or by timestamp). */
  since?: Date;
  /** Maximum number of items to yield. */
  limit?: number;
  signal?: AbortSignal;
  validators?: ValidatorCache;
  log?: (message: string) => void;
}

export interface Identifier {
  /** Identifier namespace shared across sources: `huggingface`, `huggingface-org`, `github`, `arxiv`, … */
  namespace: string;
  value: string;
  url?: string;
}

export interface OrganizationRef {
  identifier?: Identifier;
  name: string;
}

/** Architecture facts a source reports (e.g. Hugging Face config.json / safetensors metadata). Used for review and checks. */
export interface ObservedModelFacts {
  architecture?: Architecture;
  paramsTotal?: number;
  layers?: number;
  attentionHeads?: number;
  kvHeads?: number;
  headDim?: number;
  contextLength?: number;
  modelType?: string;
}

/** A published weight set. Resolved by identifier; new variants require resolvable base variants. */
export interface VariantRecord {
  type: 'variant';
  identifier: Identifier;
  name: string;
  publisher: OrganizationRef;
  /** Parent weights. Merges may list several; every parent must resolve before a variant is created. */
  bases?: Identifier[];
  derivation?: Extract<VariantKind, 'fine_tune' | 'merge' | 'distill'>;
  /** Non-authoritative hint for editors (e.g. from the repo name). Never applied automatically. */
  suggestedKind?: VariantKind;
  licenseKey?: string;
  capabilities?: string[];
  releasedOn?: string;
  summary?: string;
  observed?: ObservedModelFacts;
}

/** Quantized or converted files published for a variant (e.g. a GGUF or MLX repo). */
export interface ArtifactSetRecord {
  type: 'artifact_set';
  identifier: Identifier;
  base: Identifier;
  publisher: OrganizationRef;
  /** One entry per quantization scheme found; sizes are summed across split files. */
  files: { schemeName: string; sizeBytes: number | null; fileName: string }[];
}

export interface ReleaseInfo {
  tag: string;
  title: string;
  publishedAt: string;
  url?: string;
  body?: string;
  prerelease?: boolean;
}

/** Facts about a known project, plus releases. */
export interface ProjectRecord {
  type: 'project';
  identifier: Identifier;
  fields: { summary?: string; homepageUrl?: string | null; primaryLanguage?: string | null };
  release?: ReleaseInfo;
  releases?: ReleaseInfo[];
}

/** A news item / announcement linked to entities by identifier or by explicit mention. */
export interface EventRecord {
  type: 'event';
  kind: EventKind;
  title: string;
  summary?: string;
  occurredAt: string;
  url?: string;
  /** Stable identity of the event across sources and edits. Defaults to `<source key>:<url or title>`. */
  dedupeKey?: string;
  identifiers?: Identifier[];
  /** Exact entity names/aliases supplied by the source (e.g. feed categories). No free-text extraction. */
  mentions?: string[];
}

/**
 * Something the source publishes that Mutinai deliberately does not model (a LoRA adapter, a deleted repo, …).
 * Recorded for review; never creates or deletes entities.
 */
export interface UnsupportedRecord {
  type: 'unsupported';
  identifier: Identifier;
  reason: 'unsupported_repo' | 'source_unavailable';
  detail: string;
}

export type NormalizedRecord = VariantRecord | ArtifactSetRecord | ProjectRecord | EventRecord | UnsupportedRecord;

export interface SourceAdapter {
  source: SourceDescriptor;
  fetch(ctx: FetchContext): AsyncIterable<RawItem>;
  normalize(item: RawItem): NormalizedRecord[];
}
