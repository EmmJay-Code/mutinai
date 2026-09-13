/**
 * Freshness rules for time-sensitive surfaces: Discover's top story, latest events, trending, and counts of recent
 * releases. See docs/freshness.md.
 *
 * - Everything is decided by when a thing happened (event time), never by when Mutinai ingested it.
 * - Once live data exists, illustrative fixtures are excluded from every time-sensitive surface; they never compete
 *   with live data on significance.
 * - A top story must be recent and significant. When nothing qualifies, surfaces say so instead of promoting stale
 *   content.
 * - Trending needs measured growth over the last week. Lifetime totals are never trending.
 */
import { originOfSourceKind } from './data-origin';

export const FRESHNESS = {
  /** A top story happened within this many days. */
  topStoryDays: 14,
  /** Window for "recent releases and launches" counts. */
  recentDays: 30,
  /** Trending compares the latest observation with one at least this many days older. */
  trendingDays: 7,
  /** A trending baseline older than this no longer describes the last week. */
  trendingBaselineMaxDays: 14,
  /** Re-published copies of one release (same subject, same title or notes) within this window are one event. */
  duplicateWindowHours: 48,
  /** Events dated further in the future than this are bad data and never shown as current. */
  futureToleranceHours: 24,
  topStoryMinSignificance: 2,
  latestMinSignificance: 1,
} as const;

/** Counters that only grow, so a difference is real activity. Hugging Face `downloads` is a rolling 30-day count and is excluded. */
export const TRENDING_METRICS = ['stars', 'likes'] as const;

export interface FreshnessEvent {
  id: string;
  kind: string;
  title: string;
  summary: string | null;
  /** When the event happened (publication, release, launch). */
  occurredAt: Date | string;
  url: string | null;
  sourceKind: string | null;
  entities: { kind: string; slug: string; name: string; role?: string; category?: string | null }[];
}

export type ReleaseLevel = 'major' | 'minor' | 'patch' | 'build' | 'component' | 'unknown';
export type Significance = 0 | 1 | 2 | 3;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const time = (d: Date | string) => (typeof d === 'string' ? new Date(d) : d).getTime();
const normalized = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const byNewest = (a: FreshnessEvent, b: FreshnessEvent) => time(b.occurredAt) - time(a.occurredAt) || a.id.localeCompare(b.id);

export const isFixtureEvent = (e: Pick<FreshnessEvent, 'sourceKind'>) => e.sourceKind != null && originOfSourceKind(e.sourceKind) === 'fixture';
export const isLiveEvent = (e: Pick<FreshnessEvent, 'sourceKind'>) => e.sourceKind != null && originOfSourceKind(e.sourceKind) === 'live';

/** Release tag of a release event: from its GitHub release URL, else the last title token that looks like a version. */
export function releaseTagOf(e: Pick<FreshnessEvent, 'url' | 'title'>): string | null {
  const m = e.url ? /\/releases\/tag\/([^/?#]+)/.exec(e.url) : null;
  if (m) return decodeURIComponent(m[1]!);
  return e.title.split(/\s+/).reverse().find((t) => /^v?\d+\.\d+/.test(t) || /^b\d+$/.test(t)) ?? null;
}

/**
 * Classifies a release tag.
 * - `component`: a sub-package tag such as `proto-v0.1.0` or `gguf-v0.10.0`
 * - `build`: an automated build number such as llama.cpp's `b5450`
 * - semver-like tags: `x.0.0` (x ≥ 1) major; `x.y.0`, including `0.y.0`, minor; a non-zero patch or any further
 *   component (`.post1`, a fourth number) patch. Channel suffixes such as `-vscode` do not change the level.
 */
export function releaseLevel(tag: string | null | undefined): ReleaseLevel {
  const t = tag?.trim();
  if (!t) return 'unknown';
  if (/^b\d+$/i.test(t)) return 'build';
  const m = /^(?:([a-z][\w-]*?)[-_])?v?(\d+)\.(\d+)(?:\.(\d+))?((?:\.\d+)*)(.*)$/i.exec(t);
  if (!m) return 'unknown';
  const [, prefix, major, minor, patch, extra, suffix] = m;
  if (prefix) return 'component';
  if (Number(patch ?? 0) > 0 || extra || /^\.?post/i.test(suffix ?? '')) return 'patch';
  return Number(major) > 0 && Number(minor) === 0 ? 'major' : 'minor';
}

/**
 * How much an event matters to someone following open models, from facts alone (no text interpretation):
 * 3 model releases, hardware launches and major runtime versions; 2 minor runtime versions; 1 announcements, papers,
 * benchmark updates and releases without a recognisable version; 0 patch, build and sub-package releases.
 */
export function eventSignificance(e: Pick<FreshnessEvent, 'kind' | 'url' | 'title'>): Significance {
  if (e.kind === 'model_release' || e.kind === 'hardware_launch') return 3;
  if (e.kind !== 'runtime_release') return 1;
  const level = releaseLevel(releaseTagOf(e));
  return level === 'major' ? 3 : level === 'minor' ? 2 : level === 'unknown' ? 1 : 0;
}

const subjectOf = (e: FreshnessEvent) => (e.entities.find((x) => x.role === 'subject') ?? e.entities[0])?.slug ?? '';

/**
 * Collapses re-published copies of one event: same kind and subject, within 48 hours, with the same title or the same
 * substantive notes (e.g. a project tagging the same release twice). Keeps the newest copy. Returns newest first.
 */
export function collapseDuplicates<E extends FreshnessEvent>(events: readonly E[]): E[] {
  const kept: E[] = [];
  for (const e of [...events].sort(byNewest)) {
    const subject = subjectOf(e);
    const duplicate =
      subject !== '' &&
      kept.some(
        (k) =>
          k.kind === e.kind &&
          subjectOf(k) === subject &&
          Math.abs(time(k.occurredAt) - time(e.occurredAt)) <= FRESHNESS.duplicateWindowHours * HOUR &&
          (normalized(k.title) === normalized(e.title) || (normalized(e.summary).length >= 40 && normalized(k.summary) === normalized(e.summary))),
      );
    if (!duplicate) kept.push(e);
  }
  return kept;
}

export interface DiscoverSelection<E> {
  /** `live` once any live-sourced event exists; fixtures are then excluded from time-sensitive surfaces. */
  mode: 'live' | 'fixture';
  /** The most significant recent event, or null when nothing significant happened in the window. */
  topStory: E | null;
  /** Newest first by event time, excluding the top story, noise (significance 0) and duplicates. */
  latest: E[];
  /** Releases and launches of significance ≥ 2 that happened in the last `recentDays` days. */
  recentReleaseCount: number;
}

const kindRank = (e: FreshnessEvent) => (e.kind === 'model_release' || e.kind === 'hardware_launch' ? 1 : 0);
const runtimeRank = (e: FreshnessEvent) => (e.entities.some((x) => x.category === 'runtime') ? 1 : 0);

/** Events that may appear on a time-sensitive surface at all: not future-dated, not fixtures once live data exists, not duplicates. */
export function currentEvents<E extends FreshnessEvent>(events: readonly E[], now: Date): { mode: 'live' | 'fixture'; events: E[] } {
  const mode = events.some(isLiveEvent) ? 'live' : 'fixture';
  const limit = now.getTime() + FRESHNESS.futureToleranceHours * HOUR;
  return { mode, events: collapseDuplicates(events.filter((e) => time(e.occurredAt) <= limit && !(mode === 'live' && isFixtureEvent(e)))) };
}

export function selectDiscover<E extends FreshnessEvent>(events: readonly E[], now: Date, opts: { latestLimit?: number } = {}): DiscoverSelection<E> {
  const { mode, events: eligible } = currentEvents(events, now);
  const age = (e: FreshnessEvent) => now.getTime() - time(e.occurredAt);
  const topStory =
    eligible
      .filter((e) => !isFixtureEvent(e) && age(e) <= FRESHNESS.topStoryDays * DAY && eventSignificance(e) >= FRESHNESS.topStoryMinSignificance)
      .sort((a, b) => eventSignificance(b) - eventSignificance(a) || kindRank(b) - kindRank(a) || runtimeRank(b) - runtimeRank(a) || byNewest(a, b))[0] ?? null;
  const latest = eligible.filter((e) => e !== topStory && eventSignificance(e) >= FRESHNESS.latestMinSignificance).slice(0, opts.latestLimit ?? 8);
  const recentReleaseCount = eligible.filter((e) => !isFixtureEvent(e) && age(e) <= FRESHNESS.recentDays * DAY && eventSignificance(e) >= 2).length;
  return { mode, topStory, latest, recentReleaseCount };
}

export interface MonthActivity {
  month: string;
  count: number;
  kinds: Record<string, number>;
}

/** Releases and launches (significance ≥ 2) per month by event time, for the `months` months ending with `now`'s month. */
export function activityByMonth(events: readonly FreshnessEvent[], now: Date, months = 12): MonthActivity[] {
  const { events: eligible } = currentEvents(events, now);
  const counted = eligible.filter((e) => eventSignificance(e) >= 2 && time(e.occurredAt) <= now.getTime());
  const out: MonthActivity[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const key = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7);
    const entries = counted.filter((e) => new Date(e.occurredAt).toISOString().slice(0, 7) === key);
    const kinds: Record<string, number> = {};
    for (const e of entries) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
    out.push({ month: key, count: entries.length, kinds });
  }
  return out;
}

export interface MetricObservation<R = unknown> {
  entityId: string;
  entity: R;
  metric: string;
  /** Calendar day of the observation (YYYY-MM-DD). */
  observedOn: string;
  value: number;
  observedAt: Date | string;
}

export interface TrendingItem<R = unknown> {
  entityId: string;
  entity: R;
  metric: string;
  gain: number;
  from: number;
  to: number;
  /** Day of the baseline observation. */
  since: string;
}

/**
 * Entities whose cumulative counters (GitHub stars, Hugging Face likes) grew over the last week. Requires a current
 * observation (within `trendingDays` of now) and a baseline 7–14 days before it; entities with only lifetime totals,
 * only old observations, or no growth are never trending. Sorted by gain, largest first.
 */
export function rankTrending<R>(observations: readonly MetricObservation<R>[], now: Date): TrendingItem<R>[] {
  const series = new Map<string, MetricObservation<R>[]>();
  for (const o of observations) {
    if (!(TRENDING_METRICS as readonly string[]).includes(o.metric) || !Number.isFinite(o.value)) continue;
    const key = `${o.entityId}|${o.metric}`;
    series.set(key, [...(series.get(key) ?? []), o]);
  }
  const items: TrendingItem<R>[] = [];
  for (const list of series.values()) {
    const sorted = [...list].sort((a, b) => time(b.observedAt) - time(a.observedAt));
    const latest = sorted[0]!;
    if (now.getTime() - time(latest.observedAt) > FRESHNESS.trendingDays * DAY) continue;
    const latestDay = Date.parse(`${latest.observedOn}T00:00:00Z`);
    const baseline = sorted.find((o) => {
      const days = (latestDay - Date.parse(`${o.observedOn}T00:00:00Z`)) / DAY;
      return days >= FRESHNESS.trendingDays && days <= FRESHNESS.trendingBaselineMaxDays;
    });
    if (!baseline || latest.value <= baseline.value) continue;
    items.push({ entityId: latest.entityId, entity: latest.entity, metric: latest.metric, gain: latest.value - baseline.value, from: baseline.value, to: latest.value, since: baseline.observedOn });
  }
  return items.sort((a, b) => b.gain - a.gain || a.entityId.localeCompare(b.entityId));
}

/**
 * Display title of a project release: `<project> <tag>` when the release is named after its tag, the release title
 * when it already names the project, otherwise `<project> <title>`.
 */
export function releaseTitle(project: string, tag: string, title?: string | null): string {
  const t = title?.trim() ?? '';
  if (!t || normalized(t) === normalized(tag) || t.includes(tag)) return `${project} ${tag}`;
  if (normalized(t).startsWith(normalized(project))) return t;
  return `${project} ${t}`;
}
