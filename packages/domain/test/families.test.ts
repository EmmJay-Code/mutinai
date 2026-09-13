import { describe, expect, it } from 'vitest';
import { ARCHITECTURE_PHRASE, familyKnownFor, rankFamilies, summariseFamily, type FamilyModel } from '../src/families';

const model = (m: Partial<FamilyModel> = {}): FamilyModel => ({
  capabilities: ['chat'],
  architecture: 'dense',
  paramsTotal: 7e9,
  paramsActive: null,
  releasedOn: '2025-01-01',
  ...m,
});

describe('what a family is known for', () => {
  it('describes the union of its models’ recorded capabilities, in reader words', () => {
    const family = [model({ capabilities: ['chat', 'code'] }), model({ capabilities: ['chat', 'reasoning', 'vision'] })];
    expect(familyKnownFor(family)).toBe('Coding, reasoning and images');
  });

  it('never claims more than three things, so the line stays scannable', () => {
    const everything = [model({ capabilities: ['code', 'reasoning', 'vision', 'tool_use', 'long_context', 'multilingual'] })];
    expect(familyKnownFor(everything)).toBe('Coding, reasoning and images');
  });

  it('falls back to plain chat rather than inventing a specialism', () => {
    expect(familyKnownFor([model({ capabilities: ['chat'] })])).toBe('Everyday chat');
    expect(familyKnownFor([model({ capabilities: [] })])).toBe('Everyday chat');
  });
});

describe('family summary', () => {
  it('folds the family into the few facts worth showing before drilling in', () => {
    const summary = summariseFamily([
      model({ capabilities: ['chat', 'code'], paramsTotal: 4e9, releasedOn: '2024-09-19' }),
      model({ capabilities: ['chat'], paramsTotal: 72e9, architecture: 'moe', paramsActive: 3e9, releasedOn: '2025-04-29' }),
    ]);
    expect(summary).toEqual({
      knownFor: 'Coding',
      paramsMin: 4e9,
      paramsMax: 72e9,
      architecture: 'mixed',
      latestReleasedOn: '2025-04-29',
      modelCount: 2,
    });
    expect(ARCHITECTURE_PHRASE[summary.architecture!]).toBe('Dense and mixture of experts');
  });

  it('reports missing facts as missing instead of guessing them', () => {
    expect(summariseFamily([])).toEqual({ knownFor: 'Everyday chat', paramsMin: null, paramsMax: null, architecture: null, latestReleasedOn: null, modelCount: 0 });
    expect(summariseFamily([model({ releasedOn: null })]).latestReleasedOn).toBeNull();
  });
});

describe('ranking families', () => {
  it('puts the most recently released first, then the largest family, and never drops undated ones', () => {
    const families = [
      { slug: 'old', summary: summariseFamily([model({ releasedOn: '2024-01-01' })]) },
      { slug: 'undated', summary: summariseFamily([model({ releasedOn: null }), model({ releasedOn: null })]) },
      { slug: 'new', summary: summariseFamily([model({ releasedOn: '2025-06-01' })]) },
    ];
    expect(rankFamilies(families).map((f) => f.slug)).toEqual(['new', 'old', 'undated']);
  });
});
