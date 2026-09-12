/**
 * Source adapter contract. See docs/adr/0005-ingestion-boundary.md.
 *
 * Adapters only fetch and normalize. They never touch the database; the pipeline owns
 * deduplication, identity resolution, writes, provenance and downstream work.
 */
import type { EventKind, VariantKind } from '@mutinai/domain';

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
  payload: unknown;
}

export interface FetchContext {
  since?: Date;
  signal?: AbortSignal;
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

/** A published weight set. Resolved by identifier; new variants require a resolvable base variant. */
export interface VariantRecord {
  type: 'variant';
  identifier: Identifier;
  name: string;
  publisher: OrganizationRef;
  base?: Identifier;
  derivation?: Extract<VariantKind, 'fine_tune' | 'merge' | 'distill'>;
  licenseKey?: string;
  capabilities?: string[];
  releasedOn?: string;
  summary?: string;
}

/** Quantized files published for a variant (e.g. a GGUF repo). */
export interface ArtifactSetRecord {
  type: 'artifact_set';
  identifier: Identifier;
  base: Identifier;
  publisher: OrganizationRef;
  files: { schemeName: string; sizeBytes: number | null; fileName: string }[];
}

/** Facts about a known project, plus an optional release. */
export interface ProjectRecord {
  type: 'project';
  identifier: Identifier;
  fields: { summary?: string; homepageUrl?: string | null; primaryLanguage?: string | null };
  release?: { tag: string; title: string; publishedAt: string; url?: string; body?: string };
}

/** A news item / announcement linked to entities by identifier or by explicit mention. */
export interface EventRecord {
  type: 'event';
  kind: EventKind;
  title: string;
  summary?: string;
  occurredAt: string;
  url?: string;
  identifiers?: Identifier[];
  /** Exact entity names/aliases supplied by the source (e.g. feed categories). No free-text extraction. */
  mentions?: string[];
}

export type NormalizedRecord = VariantRecord | ArtifactSetRecord | ProjectRecord | EventRecord;

export interface SourceAdapter {
  source: SourceDescriptor;
  fetch(ctx: FetchContext): AsyncIterable<RawItem>;
  normalize(item: RawItem): NormalizedRecord[];
}
