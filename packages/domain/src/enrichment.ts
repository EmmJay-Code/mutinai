/**
 * Provider-independent AI enrichment contract. See docs/ai-enrichment.md.
 *
 * Enrichment produces derived text (plain-language summaries, "why it matters") from canonical facts. It never
 * becomes a source of facts: output is stored in `ecosystem.derived_content` with task, prompt version, provider,
 * model and input hash, starts `unreviewed`, and is regenerated only when its inputs change.
 */
import type { ValidationResult } from './ontology';

export interface EnrichmentSubject {
  kind: 'entity' | 'event';
  id: string;
  /** Entity kind or event kind. */
  type: string;
  name: string;
}

/** Canonical facts handed to a task. Only these may inform the output. */
export interface EnrichmentFacts {
  subject: EnrichmentSubject;
  facts: Record<string, unknown>;
  sourceRecordIds: string[];
}

export interface EnrichmentRequest {
  task: string;
  promptVersion: string;
  instructions: string;
  /** Serialized facts (JSON). */
  input: string;
  maxOutputChars: number;
}

export interface EnrichmentResult {
  text: string;
  /** Exact model identifier the provider used. */
  model: string;
}

/** Implemented per vendor outside the domain (none is bundled). Selected by MUTINAI_ENRICHMENT_PROVIDER. */
export interface EnrichmentProvider {
  id: string;
  generate(request: EnrichmentRequest, signal?: AbortSignal): Promise<EnrichmentResult>;
}

export interface EnrichmentTask {
  id: string;
  contentKind: string;
  promptVersion: string;
  appliesTo(subject: EnrichmentSubject): boolean;
  build(facts: EnrichmentFacts): EnrichmentRequest;
}

const GROUNDING = 'Use only the facts provided. If something is not in the facts, do not state or imply it. No marketing language, no speculation, no recommendations to buy.';

export const ENRICHMENT_TASKS: readonly EnrichmentTask[] = [
  {
    id: 'entity.plain_summary',
    contentKind: 'plain_summary',
    promptVersion: '2026-09-13.1',
    appliesTo: (s) => s.kind === 'entity' && ['model', 'model_variant', 'project', 'hardware_device'].includes(s.type),
    build: (f) => ({
      task: 'entity.plain_summary',
      promptVersion: '2026-09-13.1',
      instructions: `Explain what this ${f.subject.type.replace('_', ' ')} is to someone new to running open models, in at most two sentences. ${GROUNDING}`,
      input: JSON.stringify({ subject: f.subject.name, facts: f.facts }),
      maxOutputChars: 400,
    }),
  },
  {
    id: 'event.why_it_matters',
    contentKind: 'why_it_matters',
    promptVersion: '2026-09-13.1',
    appliesTo: (s) => s.kind === 'event',
    build: (f) => ({
      task: 'event.why_it_matters',
      promptVersion: '2026-09-13.1',
      instructions: `In one or two sentences, explain why this event may matter to people who run open models on their own hardware. ${GROUNDING}`,
      input: JSON.stringify({ event: f.subject.name, facts: f.facts }),
      maxOutputChars: 360,
    }),
  },
];

export function enrichmentTask(id: string): EnrichmentTask | undefined {
  return ENRICHMENT_TASKS.find((t) => t.id === id);
}

export function validateEnrichmentOutput(text: string, request: Pick<EnrichmentRequest, 'maxOutputChars'>): ValidationResult {
  const errors: string[] = [];
  const trimmed = text.trim();
  if (!trimmed) errors.push('empty output');
  if (trimmed.length > request.maxOutputChars) errors.push(`output longer than ${request.maxOutputChars} characters`);
  if (/https?:\/\//i.test(trimmed)) errors.push('output must not introduce links');
  return errors.length ? { ok: false, errors } : { ok: true };
}
