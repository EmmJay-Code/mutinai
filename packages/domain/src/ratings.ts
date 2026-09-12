import type { EntityKind } from './ontology';

/**
 * Structured, multi-dimensional ratings. There is deliberately no single overall score:
 * a model can be excellent at coding and poor value on your hardware.
 */
export const REVIEWABLE_KINDS = [
  'model_variant',
  'model_artifact',
  'hardware_device',
  'hardware_configuration',
  'project',
] as const satisfies readonly EntityKind[];
export type ReviewableKind = (typeof REVIEWABLE_KINDS)[number];

export interface RatingDimension {
  key: string;
  label: string;
  description: string;
  appliesTo: readonly ReviewableKind[];
}

const MODEL: readonly ReviewableKind[] = ['model_variant', 'model_artifact'];

export const RATING_DIMENSIONS = [
  { key: 'quality', label: 'Output quality', description: 'General quality of responses for the reviewer\'s use', appliesTo: [...MODEL, 'project'] },
  { key: 'coding', label: 'Coding', description: 'Writing, editing and explaining code', appliesTo: MODEL },
  { key: 'reasoning', label: 'Reasoning', description: 'Multi-step problem solving, math, logic', appliesTo: MODEL },
  { key: 'agentic', label: 'Agents & tool use', description: 'Function calling, following tool schemas, multi-step agent loops', appliesTo: MODEL },
  { key: 'speed', label: 'Speed', description: 'Perceived throughput and latency in practice', appliesTo: ['model_artifact', 'hardware_device', 'hardware_configuration', 'project'] },
  { key: 'hardware_efficiency', label: 'Hardware efficiency', description: 'Capability delivered per GB of memory / watt', appliesTo: [...MODEL, 'project'] },
  { key: 'reliability', label: 'Reliability', description: 'Stability, crashes, regressions, consistent output', appliesTo: ['model_artifact', 'hardware_device', 'hardware_configuration', 'project'] },
  { key: 'ease_of_setup', label: 'Ease of setup', description: 'Time and expertise needed to get running', appliesTo: ['model_artifact', 'hardware_device', 'hardware_configuration', 'project'] },
  { key: 'value', label: 'Value', description: 'Usefulness relative to cost', appliesTo: ['hardware_device', 'hardware_configuration'] },
] as const satisfies readonly RatingDimension[];

export type RatingDimensionKey = (typeof RATING_DIMENSIONS)[number]['key'];

export const RATING_MIN = 1;
export const RATING_MAX = 5;

export function dimensionsFor(kind: ReviewableKind): RatingDimension[] {
  return RATING_DIMENSIONS.filter((d) => (d.appliesTo as readonly string[]).includes(kind));
}

export function isReviewableKind(kind: string): kind is ReviewableKind {
  return (REVIEWABLE_KINDS as readonly string[]).includes(kind);
}

export interface RatingInput {
  dimension: string;
  score: number;
}

export function validateRatings(kind: string, ratings: RatingInput[]): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isReviewableKind(kind)) return { ok: false, errors: [`entities of kind ${kind} cannot be reviewed`] };
  if (ratings.length === 0) errors.push('at least one rating dimension is required');
  const allowed = new Set(dimensionsFor(kind).map((d) => d.key));
  const seen = new Set<string>();
  for (const r of ratings) {
    if (seen.has(r.dimension)) errors.push(`duplicate rating for ${r.dimension}`);
    seen.add(r.dimension);
    if (!RATING_DIMENSIONS.some((d) => d.key === r.dimension)) errors.push(`unknown dimension ${r.dimension}`);
    else if (!allowed.has(r.dimension)) errors.push(`dimension ${r.dimension} does not apply to ${kind}`);
    if (!Number.isInteger(r.score) || r.score < RATING_MIN || r.score > RATING_MAX) {
      errors.push(`score for ${r.dimension} must be an integer ${RATING_MIN}–${RATING_MAX}`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

export interface RatingAggregate {
  dimension: string;
  mean: number;
  count: number;
  /** Counts per score 1..5 — a distribution says more than a mean. */
  distribution: [number, number, number, number, number];
}

export function aggregateRatings(ratings: RatingInput[]): RatingAggregate[] {
  const by = new Map<string, number[]>();
  for (const r of ratings) {
    const list = by.get(r.dimension) ?? [];
    list.push(r.score);
    by.set(r.dimension, list);
  }
  return RATING_DIMENSIONS.filter((d) => by.has(d.key)).map((d) => {
    const scores = by.get(d.key)!;
    const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    for (const s of scores) distribution[s - 1]! += 1;
    return { dimension: d.key, mean: scores.reduce((a, b) => a + b, 0) / scores.length, count: scores.length, distribution };
  });
}
