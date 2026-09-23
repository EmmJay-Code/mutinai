/**
 * Where a fact came from, as shown to readers. Live-sourced and illustrative fixture data must never look alike.
 * Community submissions and estimates carry their own labels (see ratings and compat); AI-derived content is
 * stored separately and labelled `derived` wherever it is shown.
 */

export type DataOrigin = 'live' | 'fixture' | 'editorial' | 'derived';

/** Maps an ingestion source kind to the origin readers see. */
export function originOfSourceKind(kind: string): DataOrigin {
  if (kind === 'fixture') return 'fixture';
  if (kind === 'editorial') return 'editorial';
  return 'live';
}

const SOURCE_KIND_LABELS: Record<string, string> = {
  huggingface: 'Hugging Face',
  github: 'GitHub',
  arxiv: 'arXiv',
  rss: 'Official feed',
  editorial: 'Editorial',
  fixture: 'Illustrative fixture',
};

export function sourceKindLabel(kind: string): string {
  return SOURCE_KIND_LABELS[kind] ?? kind;
}

/**
 * Summarises an entity's sources for a compact badge: live wins if any live source contributed, otherwise the entity
 * rests on fixtures or editorial data only.
 */
export function summariseOrigin(sources: { kind: string; name: string; lastFetchedAt: Date | string | null }[]): { origin: DataOrigin; names: string[]; lastFetchedAt: Date | null } | null {
  if (!sources.length) return null;
  const live = sources.filter((s) => originOfSourceKind(s.kind) === 'live');
  const chosen = live.length ? live : sources;
  const origin = live.length ? 'live' : sources.some((s) => s.kind === 'fixture') ? 'fixture' : 'editorial';
  const times = chosen.map((s) => (s.lastFetchedAt ? new Date(s.lastFetchedAt).getTime() : NaN)).filter(Number.isFinite);
  return { origin, names: [...new Set(chosen.map((s) => sourceKindLabel(s.kind)))], lastFetchedAt: times.length ? new Date(Math.max(...times)) : null };
}

/**
 * Who produced a benchmark result (the `result_origin` column), in readers' words. A score run by a benchmark's own
 * maintainers is not the developer's claim about their model, so the two are never labelled alike.
 */
export const RESULT_ORIGIN_TEXT: Record<string, { label: string; detail: string }> = {
  benchmark_operator: { label: 'run by the benchmark', detail: "The benchmark's own maintainers ran every model themselves, with the same setup for each" },
  third_party: { label: 'independent evaluation', detail: 'Run by an independent evaluator, not the model developer' },
  submitted_registry: { label: 'submitted to the benchmark', detail: 'Produced by whoever submitted it; the benchmark publishes submissions without re-running them' },
  editorial: { label: 'editorial', detail: 'Recorded by Mutinai editors' },
  developer_reported: { label: 'developer-reported', detail: "Reported by the model's developer with their own prompts and settings, not measured by Mutinai" },
};

const ORIGIN_ORDER = ['benchmark_operator', 'third_party', 'submitted_registry', 'editorial', 'developer_reported'];

/** The distinct origins among some results, most independent first. Unknown values pass through humanised. */
export function resultOrigins(origins: Iterable<string>): { origin: string; label: string; detail: string }[] {
  return [...new Set(origins)]
    .sort((a, b) => (ORIGIN_ORDER.indexOf(a) + 1 || 99) - (ORIGIN_ORDER.indexOf(b) + 1 || 99))
    .map((origin) => ({ origin, ...(RESULT_ORIGIN_TEXT[origin] ?? { label: origin.replace(/_/g, ' '), detail: origin.replace(/_/g, ' ') }) }));
}
