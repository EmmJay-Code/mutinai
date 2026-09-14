import type { EntityType } from '@/components/viz';

/**
 * The parts of the ecosystem Discover and the timeline report on, in reading order.
 * One definition so the homepage digest and `/new`'s filter can never drift apart.
 */
export interface EventGroup {
  key: string;
  label: string;
  /** Plain-language line for readers who do not know what the kind means. */
  hint: string;
  kinds: readonly string[];
  type: EntityType;
}

export const EVENT_GROUPS: readonly EventGroup[] = [
  { key: 'models', label: 'Model releases', hint: 'New open-weight models and new versions of existing ones', kinds: ['model_release'], type: 'model' },
  { key: 'tools', label: 'Tools & runtimes', hint: 'New versions of the programs that run models', kinds: ['runtime_release'], type: 'tool' },
  { key: 'hardware', label: 'Hardware launches', hint: 'Graphics cards, chips and machines to run models on', kinds: ['hardware_launch'], type: 'hardware' },
  { key: 'benchmarks', label: 'Benchmark updates', hint: 'New or changed scores on the tests models are compared with', kinds: ['benchmark_update'], type: 'bench' },
  { key: 'research', label: 'Research & news', hint: 'Papers and announcements from the labs and projects', kinds: ['research_paper', 'announcement'], type: 'event' },
];

export const eventGroup = (key: string | null | undefined) => EVENT_GROUPS.find((g) => g.key === key);

/** The group an event belongs to, for the glyph and label shown beside it. */
export const groupOfKind = (kind: string) => EVENT_GROUPS.find((g) => g.kinds.includes(kind));

export const entityTypeOfEvent = (kind: string): EntityType => groupOfKind(kind)?.type ?? 'event';
