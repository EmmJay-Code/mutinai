import { describe, expect, it } from 'vitest';
import { aggregateRatings, dimensionsFor, validateRatings } from '../src/ratings';

describe('rating dimensions', () => {
  it('model variants get capability dimensions, hardware gets value', () => {
    const variant = dimensionsFor('model_variant').map((d) => d.key);
    expect(variant).toEqual(expect.arrayContaining(['coding', 'reasoning', 'agentic']));
    expect(variant).not.toContain('value');
    expect(dimensionsFor('hardware_device').map((d) => d.key)).toContain('value');
    expect(dimensionsFor('hardware_device').map((d) => d.key)).not.toContain('coding');
  });

  it('validates applicability, range and duplicates', () => {
    expect(validateRatings('model_variant', [{ dimension: 'coding', score: 4 }])).toEqual({ ok: true });
    const r = validateRatings('hardware_device', [
      { dimension: 'coding', score: 4 },
      { dimension: 'value', score: 6 },
      { dimension: 'value', score: 3 },
      { dimension: 'vibes', score: 3 },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toEqual([
        'dimension coding does not apply to hardware_device',
        'score for value must be an integer 1–5',
        'duplicate rating for value',
        'unknown dimension vibes',
      ]);
    }
  });

  it('rejects unreviewable kinds and empty ratings', () => {
    expect(validateRatings('organization', [{ dimension: 'quality', score: 3 }]).ok).toBe(false);
    expect(validateRatings('project', []).ok).toBe(false);
  });

  it('aggregates per dimension with distributions, never a single overall score', () => {
    const agg = aggregateRatings([
      { dimension: 'coding', score: 5 },
      { dimension: 'coding', score: 3 },
      { dimension: 'speed', score: 2 },
    ]);
    expect(agg).toEqual([
      { dimension: 'coding', mean: 4, count: 2, distribution: [0, 0, 1, 0, 1] },
      { dimension: 'speed', mean: 2, count: 1, distribution: [0, 1, 0, 0, 0] },
    ]);
  });
});
