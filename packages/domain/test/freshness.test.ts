import { describe, expect, it } from 'vitest';
import { activityByMonth, collapseDuplicates, eventSignificance, releaseLevel, releaseTitle, rankTrending, selectDiscover, type FreshnessEvent, type MetricObservation } from '../src/freshness';

const NOW = new Date('2026-09-13T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

let seq = 0;
const event = (e: Partial<Omit<FreshnessEvent, 'occurredAt'>> & { occurredAt: string }): FreshnessEvent => ({
  id: `e${++seq}`,
  kind: 'announcement',
  title: `Event ${seq}`,
  summary: null,
  url: null,
  sourceKind: 'rss',
  entities: [],
  ...e,
});
const release = (project: string, tag: string, occurredAt: string, extra: Partial<Omit<FreshnessEvent, 'occurredAt'>> = {}) =>
  event({ kind: 'runtime_release', title: `${project} ${tag}`, url: `https://github.com/x/${project}/releases/tag/${tag}`, sourceKind: 'github', occurredAt, entities: [{ kind: 'project', slug: project.toLowerCase(), name: project, role: 'subject', category: 'runtime' }], ...extra });

describe('release levels and significance', () => {
  it('classifies tags by what changed, not by how they are written', () => {
    expect(releaseLevel('v2.0.0')).toBe('major');
    expect(releaseLevel('v2.0.0-vscode')).toBe('major');
    expect(releaseLevel('v0.29.0')).toBe('minor');
    expect(releaseLevel('v1.100.0')).toBe('minor');
    expect(releaseLevel('0.3.2')).toBe('patch');
    expect(releaseLevel('v0.5.15.post1')).toBe('patch');
    expect(releaseLevel('v0.4.9.2')).toBe('patch');
    expect(releaseLevel('v0.1.808-beta')).toBe('patch');
    expect(releaseLevel('b5450')).toBe('build');
    expect(releaseLevel('proto-v0.1.0')).toBe('component');
    expect(releaseLevel('gguf-v0.10.0')).toBe('component');
    expect(releaseLevel(undefined)).toBe('unknown');
  });

  it('ranks model releases and major versions above minor versions, and patches, builds and sub-packages as noise', () => {
    expect(eventSignificance(event({ kind: 'model_release', occurredAt: daysAgo(1) }))).toBe(3);
    expect(eventSignificance(release('vLLM', 'v0.29.0', daysAgo(1)))).toBe(2);
    expect(eventSignificance(release('vLLM', 'v0.29.1', daysAgo(1)))).toBe(0);
    expect(eventSignificance(release('vLLM', 'proto-v0.1.0', daysAgo(1)))).toBe(0);
    expect(eventSignificance(event({ kind: 'announcement', occurredAt: daysAgo(1) }))).toBe(1);
  });

  it('titles releases once, whatever the release is called', () => {
    expect(releaseTitle('Aider', 'v0.86.0', 'Aider v0.86.0')).toBe('Aider v0.86.0');
    expect(releaseTitle('lm-evaluation-harness', 'v0.4.9.2', 'lm-eval v0.4.9.2 Release Notes')).toBe('lm-evaluation-harness v0.4.9.2');
    expect(releaseTitle('vLLM', 'v0.29.0', 'v0.29.0')).toBe('vLLM v0.29.0');
    expect(releaseTitle('Unsloth', 'v0.1.808-beta', 'Large Performance Gains + Fixes')).toBe('Unsloth Large Performance Gains + Fixes');
    expect(releaseTitle('Continue', 'v2.0.0-vscode', null)).toBe('Continue v2.0.0-vscode');
  });
});

describe('Discover selection', () => {
  it('an old fixture cannot become today’s top story over legitimate recent live events', () => {
    const fixture = event({ kind: 'model_release', title: 'Qwen3 released', sourceKind: 'fixture', occurredAt: '2025-04-29T12:00:00Z' });
    const live = release('vLLM', 'v0.29.0', daysAgo(4));
    const { mode, topStory, latest } = selectDiscover([fixture, live], NOW);
    expect(mode).toBe('live');
    expect(topStory).toBe(live);
    expect(latest).not.toContain(fixture);
  });

  it('a fixture never outranks live data on significance, even when recent', () => {
    const fixture = event({ kind: 'model_release', sourceKind: 'fixture', occurredAt: daysAgo(1) });
    const live = release('Ollama', 'v0.34.0', daysAgo(6));
    expect(selectDiscover([fixture, live], NOW).topStory).toBe(live);
  });

  it('uses event time, not ingest time: a record ingested today about 2025 is not a current event', () => {
    const backfilled = { ...release('Aider', 'v0.86.0', '2025-08-09T17:42:19Z'), discoveredAt: NOW.toISOString() };
    const selection = selectDiscover([backfilled], NOW);
    expect(selection.topStory).toBeNull();
    expect(selection.recentReleaseCount).toBe(0);
    expect(activityByMonth([backfilled], NOW, 12).reduce((n, m) => n + m.count, 0)).toBe(0);
  });

  it('shows no top story when nothing significant happened recently, instead of promoting stale content', () => {
    const selection = selectDiscover([release('vLLM', 'v0.28.0', daysAgo(20)), release('vLLM', 'v0.29.1', daysAgo(1)), event({ occurredAt: daysAgo(2) })], NOW);
    expect(selection.topStory).toBeNull();
    expect(selection.latest.map((e) => e.title)).toEqual(['Event ' + seq, 'vLLM v0.28.0']);
  });

  it('prefers model releases, then runtimes, then recency among significant recent events', () => {
    const tool = release('Axolotl', 'v0.19.0', daysAgo(1), { entities: [{ kind: 'project', slug: 'axolotl', name: 'Axolotl', role: 'subject', category: 'fine_tuning' }] });
    const runtime = release('vLLM', 'v0.29.0', daysAgo(3));
    expect(selectDiscover([tool, runtime], NOW).topStory).toBe(runtime);
    const model = event({ kind: 'model_release', sourceKind: 'huggingface', occurredAt: daysAgo(12) });
    expect(selectDiscover([tool, runtime, model], NOW).topStory).toBe(model);
  });

  it('Latest is strictly chronological by event time and leaves out noise, duplicates and future-dated entries', () => {
    const a = release('vLLM', 'v0.29.0', daysAgo(5));
    const b = event({ occurredAt: daysAgo(1), title: 'Newest announcement' });
    const c = event({ occurredAt: daysAgo(9), title: 'Older announcement' });
    const patch = release('vLLM', 'v0.29.1', daysAgo(2));
    const future = event({ occurredAt: new Date(NOW.getTime() + 3 * 86_400_000).toISOString(), title: 'Future' });
    const { topStory, latest } = selectDiscover([c, patch, a, future, b], NOW);
    expect(topStory).toBe(a);
    expect(latest.map((e) => e.title)).toEqual(['Newest announcement', 'Older announcement']);
  });

  it('collapses a release tagged twice with the same title, keeping the newest', () => {
    const first = release('Unsloth', 'v0.1.805-beta', '2026-09-02T11:41:10Z', { title: 'Unsloth 2x Faster Qwen3.8-Flash' });
    const second = release('Unsloth', 'v0.1.806-beta', '2026-09-02T12:49:18Z', { title: 'Unsloth 2x Faster Qwen3.8-Flash' });
    const notes = 'Stable release of the Continue VS Code extension (final release): removes the CLI-install banner';
    const c1 = release('Continue', 'v1.2.23-vscode', '2026-06-15T16:27:25Z', { summary: notes });
    const c2 = release('Continue', 'v1.2.24-vscode', '2026-06-15T16:59:46Z', { summary: notes });
    expect(collapseDuplicates([first, second, c1, c2])).toEqual([second, c2]);
    const weekLater = release('Unsloth', 'v0.1.807-beta', '2026-09-09T12:00:00Z', { title: 'Unsloth 2x Faster Qwen3.8-Flash' });
    expect(collapseDuplicates([first, weekLater])).toHaveLength(2);
  });

  it('in fixture-only mode nothing is current, but Latest still lists the fixtures by date', () => {
    const fixtures = [event({ kind: 'model_release', sourceKind: 'fixture', occurredAt: '2025-04-29T12:00:00Z' }), event({ sourceKind: 'fixture', occurredAt: '2025-05-02T12:00:00Z' })];
    const selection = selectDiscover(fixtures, NOW);
    expect(selection).toMatchObject({ mode: 'fixture', topStory: null, recentReleaseCount: 0 });
    expect(selection.latest.map((e) => e.occurredAt)).toEqual(['2025-05-02T12:00:00Z', '2025-04-29T12:00:00Z']);
  });

  it('counts releases and launches per month by event time, ending with the current month', () => {
    const months = activityByMonth([release('vLLM', 'v0.29.0', '2026-09-09T08:00:00Z'), release('vLLM', 'v0.28.0', '2026-08-26T08:00:00Z'), release('vLLM', 'v0.27.1', '2026-08-11T08:00:00Z')], NOW, 3);
    expect(months).toEqual([
      { month: '2026-07', count: 0, kinds: {} },
      { month: '2026-08', count: 1, kinds: { runtime_release: 1 } },
      { month: '2026-09', count: 1, kinds: { runtime_release: 1 } },
    ]);
  });
});

describe('trending', () => {
  const obs = (entityId: string, metric: string, day: string, value: number): MetricObservation<{ name: string }> => ({ entityId, entity: { name: entityId }, metric, observedOn: day, value, observedAt: `${day}T06:00:00Z` });

  it('ranks measured growth over a week, largest first', () => {
    const items = rankTrending([obs('vllm', 'stars', '2026-09-05', 70_000), obs('vllm', 'stars', '2026-09-13', 70_400), obs('ollama', 'stars', '2026-09-06', 150_000), obs('ollama', 'stars', '2026-09-13', 150_900)], NOW);
    expect(items.map((t) => [t.entityId, t.gain, t.since])).toEqual([['ollama', 900, '2026-09-06'], ['vllm', 400, '2026-09-05']]);
  });

  it('stale entities with high lifetime counts are never trending without recent growth', () => {
    const items = rankTrending(
      [
        obs('huge-but-flat', 'stars', '2026-09-04', 500_000), obs('huge-but-flat', 'stars', '2026-09-13', 500_000),
        obs('only-today', 'stars', '2026-09-13', 900_000),
        obs('old-growth', 'stars', '2026-08-01', 10), obs('old-growth', 'stars', '2026-08-20', 5_000),
        obs('baseline-too-old', 'stars', '2026-08-20', 10), obs('baseline-too-old', 'stars', '2026-09-13', 5_000),
        obs('rolling-counter', 'downloads', '2026-09-04', 10), obs('rolling-counter', 'downloads', '2026-09-13', 1_000_000),
      ],
      NOW,
    );
    expect(items).toEqual([]);
  });
});
