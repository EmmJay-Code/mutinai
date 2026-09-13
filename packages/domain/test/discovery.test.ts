import { describe, expect, it } from 'vitest';
import {
  describeModel,
  deviceCategory,
  hardwareGoal,
  licenseOpenness,
  memoryPhrase,
  MODEL_INTENTS,
  modelIntent,
  reachPhrase,
  speedPhrase,
  systemCategories,
  systemMatchesGoal,
} from '../src/discovery';

const model = (over: Partial<Parameters<typeof describeModel>[0]> & { minMemoryGb?: number | null; licenses?: { commercialUse: string }[] } = {}) => ({
  capabilities: ['chat'],
  architecture: 'dense' as const,
  paramsTotal: 32e9,
  paramsActive: null,
  minMemoryGb: 20,
  licenses: [{ commercialUse: 'allowed' }],
  ...over,
});

describe('plain-language statements', () => {
  it('distinguishes permissive licensing from merely downloadable weights', () => {
    expect(licenseOpenness([{ commercialUse: 'restricted' }, { commercialUse: 'allowed' }])).toBe('permissive');
    expect(licenseOpenness([{ commercialUse: 'restricted' }])).toBe('restricted');
    expect(licenseOpenness([{ commercialUse: 'prohibited' }])).toBe('noncommercial');
    expect(licenseOpenness([])).toBe('unknown');
  });

  it('rounds memory up and names a machine it fits', () => {
    expect(memoryPhrase(17.2)).toEqual({ amount: '~18 GB to run', fits: 'fits a 24 GB graphics card' });
    expect(memoryPhrase(5)?.fits).toBe('fits most laptops');
    expect(memoryPhrase(400)?.fits).toBe('needs server-class memory');
    expect(memoryPhrase(null)).toBeNull();
  });

  it('summarises reference-system reach', () => {
    expect(reachPhrase({ runsWell: 12, slow: 1, of: 14 })).toEqual({ text: 'Runs well on most reference systems', tone: 'good' });
    expect(reachPhrase({ runsWell: 2, slow: 10, of: 14 })?.tone).toBe('mixed');
    expect(reachPhrase({ runsWell: 0, slow: 3, of: 14 })?.text).toBe('Runs only slowly on reference systems');
    expect(reachPhrase({ runsWell: 0, slow: 0, of: 14 })?.text).toBe('Needs server hardware');
    expect(reachPhrase({ runsWell: 0, slow: 0, of: 0 })).toBeNull();
  });

  it('describes what a model is for without technical vocabulary', () => {
    const qwen3 = describeModel(model({ capabilities: ['chat', 'code', 'reasoning', 'tool_use'], architecture: 'moe', paramsTotal: 30.5e9, paramsActive: 3.3e9 }), {
      coding: { score: 98, benchmark: 'humaneval', value: 90 },
    });
    expect(qwen3.summary).toBe('Efficient general-purpose model for coding, reasoning and tool use.');
    expect(qwen3.strength).toBe('Among the strongest open models at coding.');
    expect(describeModel(model({ paramsTotal: 7e9 })).summary).toBe('Compact model for everyday chat.');
    expect(describeModel(model({ capabilities: ['chat', 'vision'] })).summary).toBe('Chat model that also understands images.');
    expect(describeModel(model({ capabilities: ['code'] }), { coding: { score: 92, benchmark: 'humaneval', value: 1 } }).strength).toBeNull();
  });

  it('describes speed from memory bandwidth', () => {
    expect(speedPhrase(1008)?.text).toBe('Very fast replies');
    expect(speedPhrase(273)?.tone).toBe('mixed');
    expect(speedPhrase(null)).toBeNull();
  });
});

describe('model intents', () => {
  it('have unique keys and resolve by key', () => {
    expect(new Set(MODEL_INTENTS.map((i) => i.key)).size).toBe(MODEL_INTENTS.length);
    expect(modelIntent('coding')?.label).toBe('Coding');
    expect(modelIntent('nope')).toBeUndefined();
  });

  it('select models by purpose, memory, speed and license', () => {
    expect(modelIntent('coding')!.test(model({ capabilities: ['code'] }))).toBe(true);
    expect(modelIntent('local')!.test(model({ minMemoryGb: 40 }))).toBe(false);
    expect(modelIntent('fast')!.test(model({ architecture: 'moe', paramsTotal: 30e9, paramsActive: 3e9 }))).toBe(true);
    expect(modelIntent('fast')!.test(model({ paramsTotal: 32e9 }))).toBe(false);
    expect(modelIntent('open')!.test(model({ licenses: [{ commercialUse: 'restricted' }] }))).toBe(false);
  });

  it('rank coding results by coding benchmark before reach', () => {
    const coding = modelIntent('coding')!;
    const m = model({ capabilities: ['code'] });
    const strong = coding.score(m, { profile: { coding: { score: 90, benchmark: 'humaneval', value: 1 } }, reach: { runsWell: 1, slow: 0, of: 10 } });
    const reachable = coding.score(m, { profile: { coding: { score: 80, benchmark: 'humaneval', value: 1 } }, reach: { runsWell: 10, slow: 0, of: 10 } });
    expect(strong).toBeGreaterThan(reachable);
  });
});

describe('hardware organisation', () => {
  it('groups devices by buying context, not manufacturer', () => {
    expect(deviceCategory({ deviceKind: 'gpu', memoryKind: 'dedicated' })).toBe('gpu');
    expect(deviceCategory({ deviceKind: 'accelerator', memoryKind: 'dedicated' })).toBe('server');
    expect(deviceCategory({ deviceKind: 'soc', memoryKind: 'unified' })).toBe('unified');
    expect(deviceCategory({ deviceKind: 'cpu', memoryKind: 'none' })).toBeNull();
  });

  it('lets a system belong to several contexts', () => {
    const gpu = { deviceKind: 'gpu', memoryKind: 'dedicated' };
    expect(systemCategories({ formFactor: 'desktop', unifiedMemoryGb: null, components: [{ ...gpu, count: 2 }] })).toEqual(['systems', 'server']);
    expect(systemCategories({ formFactor: 'laptop', unifiedMemoryGb: 64, components: [{ deviceKind: 'soc', memoryKind: 'unified', count: 1 }] })).toEqual(['systems', 'unified']);
    expect(systemCategories({ formFactor: 'server', unifiedMemoryGb: null, components: [{ deviceKind: 'accelerator', memoryKind: 'dedicated', count: 1 }] })).toEqual(['server']);
  });

  it('filters systems for price- and capacity-led goals', () => {
    expect(systemMatchesGoal(hardwareGoal('first')!, { formFactor: 'mini_pc', approxPriceUsd: 1800 }, 36)).toBe(true);
    expect(systemMatchesGoal(hardwareGoal('first')!, { formFactor: 'desktop', approxPriceUsd: null }, 36)).toBe(false);
    expect(systemMatchesGoal(hardwareGoal('workstation')!, { formFactor: 'desktop', approxPriceUsd: 3500 }, 45.6)).toBe(true);
    expect(systemMatchesGoal(hardwareGoal('workstation')!, { formFactor: 'server', approxPriceUsd: null }, 76)).toBe(false);
  });
});
