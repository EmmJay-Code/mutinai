import { describe, expect, it } from 'vitest';
import { originOfSourceKind, resultOrigins, sourceKindLabel, summariseOrigin } from '../src/data-origin';

describe('data origin', () => {
  it('classifies source kinds so fixtures never pass as live data', () => {
    expect(originOfSourceKind('fixture')).toBe('fixture');
    expect(originOfSourceKind('editorial')).toBe('editorial');
    for (const kind of ['huggingface', 'github', 'rss', 'arxiv']) expect(originOfSourceKind(kind)).toBe('live');
    expect(sourceKindLabel('huggingface')).toBe('Hugging Face');
    expect(sourceKindLabel('fixture')).toBe('Illustrative fixture');
  });

  it('summarises mixed sources: live wins and reports the latest fetch', () => {
    const summary = summariseOrigin([
      { kind: 'fixture', name: 'Mutinai illustrative fixtures', lastFetchedAt: '2026-09-01T00:00:00Z' },
      { kind: 'huggingface', name: 'Hugging Face Hub', lastFetchedAt: '2026-09-12T00:00:00Z' },
      { kind: 'github', name: 'GitHub', lastFetchedAt: new Date('2026-09-13T00:00:00Z') },
    ]);
    expect(summary).toEqual({ origin: 'live', names: ['Hugging Face', 'GitHub'], lastFetchedAt: new Date('2026-09-13T00:00:00Z') });
  });

  it('reports fixture-only entities as fixture data', () => {
    expect(summariseOrigin([{ kind: 'fixture', name: 'Hugging Face (fixture)', lastFetchedAt: null }])).toMatchObject({ origin: 'fixture', names: ['Illustrative fixture'] });
    expect(summariseOrigin([])).toBeNull();
  });

  it('never labels a benchmark-run result as developer-reported, and lists the most independent origin first', () => {
    const labels = resultOrigins(['developer_reported', 'benchmark_operator', 'developer_reported']);
    expect(labels.map((l) => l.origin)).toEqual(['benchmark_operator', 'developer_reported']);
    expect(labels[0]!.label).toBe('run by the benchmark');
    expect(labels[0]!.label).not.toMatch(/developer/);
  });
});
