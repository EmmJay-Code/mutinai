import { describe, expect, it } from 'vitest';
import { capabilityProfiles, frontier } from '../src/profile';

describe('capabilityProfiles', () => {
  const scores = [
    { subject: 'a', benchmark: 'humaneval', value: 90 },
    { subject: 'a', benchmark: 'livecodebench', value: 30 },
    { subject: 'b', benchmark: 'livecodebench', value: 60 },
    { subject: 'b', benchmark: 'gpqa-diamond', value: 70 },
    { subject: 'c', benchmark: 'gpqa-diamond', value: 35 },
    { subject: 'c', benchmark: 'unknown-bench', value: 99 },
  ];

  it('scores relative to the best result per benchmark and keeps the strongest benchmark per axis', () => {
    const p = capabilityProfiles(scores);
    expect(p.get('a')).toEqual({ coding: { score: 100, benchmark: 'humaneval', value: 90 } });
    expect(p.get('b')).toEqual({ coding: { score: 100, benchmark: 'livecodebench', value: 60 }, reasoning: { score: 100, benchmark: 'gpqa-diamond', value: 70 } });
    expect(p.get('c')).toEqual({ reasoning: { score: 50, benchmark: 'gpqa-diamond', value: 35 } });
  });

  it('ignores benchmarks outside the capability axes', () => {
    expect(capabilityProfiles([{ subject: 'x', benchmark: 'llama-bench', value: 100 }]).size).toBe(0);
  });
});

describe('frontier', () => {
  it('returns only results that set a new best over time', () => {
    const f = frontier([
      { subject: 'late-weak', date: '2025-02', value: 40 },
      { subject: 'first', date: '2024-07', value: 30 },
      { subject: 'second', date: '2024-09', value: 50 },
      { subject: 'tie', date: '2024-12', value: 50 },
      { subject: 'best', date: '2025-01', value: 71 },
    ]);
    expect(f.map((p) => p.subject)).toEqual(['first', 'second', 'best']);
  });
});
