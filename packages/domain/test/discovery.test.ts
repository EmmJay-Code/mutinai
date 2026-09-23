import { describe, expect, it } from 'vitest';
import {
  balanceStarterDownload,
  speedupPhrase,
  describeModel,
  deviceCategory,
  deviceClassLabel,
  devicePositioning,
  formatPrice,
  hardwareGoal,
  licenseOpenness,
  hardwareMemoryTier,
  memoryPhrase,
  MEMORY_TIERS,
  MODEL_INTENTS,
  modelMemoryTier,
  modelIntent,
  isSpecialist,
  pickStarter,
  reachPhrase,
  readingSpeed,
  searchIntent,
  speedPhrase,
  systemCategories,
  systemMatchesGoal,
  systemPositioning,
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

  it('puts a model in the first tier that holds it', () => {
    expect(modelMemoryTier(0.6)?.key).toBe('laptop');
    expect(modelMemoryTier(6)?.key).toBe('laptop');
    expect(modelMemoryTier(6.1)?.key).toBe('gpu-16');
    expect(modelMemoryTier(22)?.key).toBe('gpu-24');
    expect(modelMemoryTier(400)?.key).toBe('server');
    expect(modelMemoryTier(null)).toBeNull();
  });

  it('puts a machine in the largest tier it runs completely', () => {
    // Usable memory: nominal × 0.95 for dedicated cards, × 0.75 for unified memory.
    expect(hardwareMemoryTier(24 * 0.95)?.key).toBe('gpu-24');
    expect(hardwareMemoryTier(16 * 0.95)?.key).toBe('gpu-16');
    expect(hardwareMemoryTier(8 * 0.95)?.key).toBe('laptop');
    expect(hardwareMemoryTier(64 * 0.75)?.key).toBe('workstation');
    expect(hardwareMemoryTier(80 * 0.95)?.key).toBe('workstation');
    expect(hardwareMemoryTier(512 * 0.75)?.key).toBe('server');
    expect(hardwareMemoryTier(4)).toBeNull();
  });

  it('agrees with itself: a machine runs every model in its own tier', () => {
    for (const t of MEMORY_TIERS.filter((x) => Number.isFinite(x.maxGb))) {
      expect(hardwareMemoryTier(t.maxGb)?.key).toBe(t.key);
      expect(modelMemoryTier(t.maxGb)?.key).toBe(t.key);
    }
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

describe('hardware presentation', () => {
  it('always says what a price means', () => {
    expect(formatPrice({ amount: 1999, currency: 'USD', kind: 'msrp' })).toMatchObject({ value: '$1,999', qualifier: 'MSRP' });
    expect(formatPrice({ amount: 1649, currency: 'USD', kind: 'observed', checkedOn: '2026-09-03', source: 'Retailer' })).toMatchObject({
      value: '~$1,649', qualifier: 'observed · checked Sep 2026', description: 'Price seen at a retailer on the date shown. Source: Retailer.',
    });
    expect(formatPrice({ amount: 3200, currency: 'USD', kind: 'estimate' })).toMatchObject({ value: '~$3,200', qualifier: 'build estimate' });
    expect(formatPrice({ amount: 900, currency: 'CHF', kind: 'used' }).value).toBe('~900 CHF');
  });

  it('labels hardware by class and positions it in plain language', () => {
    expect(deviceClassLabel({ deviceKind: 'gpu', memoryKind: 'dedicated' })).toBe('Graphics card');
    expect(deviceClassLabel({ deviceKind: 'soc', memoryKind: 'unified' })).toBe('Unified-memory chip');
    expect(devicePositioning({ deviceKind: 'gpu', memoryKind: 'dedicated' }, 47)).toMatch(/^Top consumer card/);
    expect(devicePositioning({ deviceKind: 'gpu', memoryKind: 'dedicated' }, 22)).toBe('Comfortable with 14B–24B models.');
    expect(systemPositioning('accelerator', 73, 2)).toMatch(/^Multi-GPU/);
    expect(systemPositioning('ram', 170, 0)).toMatch(/^Budget build/);
  });
});

describe('first steps', () => {
  const c = (over: Partial<Parameters<typeof pickStarter>[0][number]> & { id: string }) => ({
    variantKind: 'instruct', capabilities: ['chat'], placement: 'accelerator', fit: 'full', genTps: 30, quality: 50, paramsTotal: 8e9, ...over,
  });

  it('suggests the strongest general chat model that runs comfortably in memory', () => {
    const pick = pickStarter([
      c({ id: 'big-offload', quality: 90, placement: 'hybrid', fit: 'offload' }),
      c({ id: 'coder', variantKind: 'coder', quality: 95 }),
      c({ id: 'slow', quality: 80, genTps: 3 }),
      c({ id: 'good', quality: 70 }),
      c({ id: 'weaker', quality: 40 }),
    ]);
    expect(pick?.id).toBe('good');
  });

  it('falls back to a slow general model rather than suggesting nothing, and returns null when nothing general runs', () => {
    expect(pickStarter([c({ id: 'slow', genTps: 3 })])?.id).toBe('slow');
    expect(pickStarter([c({ id: 'base', variantKind: 'base' }), c({ id: 'off', placement: 'hybrid', fit: 'offload' })])).toBeNull();
  });

  it('says speed against reading speed', () => {
    expect(readingSpeed(152)?.text).toBe('Much faster than you can read');
    expect(readingSpeed(9)?.text).toBe('Types faster than you can read');
    expect(readingSpeed(6)?.tone).toBe('mixed');
    expect(readingSpeed(2)?.tone).toBe('limited');
    expect(readingSpeed(null)).toBeNull();
  });
});

describe('search intent', () => {
  it('reads purpose, not just names', () => {
    expect(searchIntent('like chatgpt')?.key).toBe('chat');
    expect(searchIntent('something like ChatGPT?')?.key).toBe('chat');
    expect(searchIntent('coding assistant')?.key).toBe('coding');
    expect(searchIntent('describe my photos')?.key).toBe('vision');
  });

  it('knows a coding-only model is not a general assistant', () => {
    expect(isSpecialist({ capabilities: ['chat', 'code', 'long_context'] })).toBe(true);
    expect(isSpecialist({ capabilities: ['chat', 'code', 'tool_use', 'multilingual'] })).toBe(false);
    expect(isSpecialist({ capabilities: ['chat'] })).toBe(false);
    expect(searchIntent('like chatgpt')?.generalOnly).toBe(true);
  });

  it('leaves names and hardware alone', () => {
    expect(searchIntent('qwen2.5 32b')).toBeNull();
    expect(searchIntent('llama.cpp')).toBeNull();
    expect(searchIntent('24GB GPU')).toBeNull();
    expect(searchIntent('gpt2-medium')).toBeNull();
  });
});

describe('starter download', () => {
  const opt = (id: string, bitsPerWeight: number, genTps: number | null, over: Partial<{ fit: string; placement: string; measured: boolean }> = {}) =>
    ({ id, bitsPerWeight, genTps, fit: 'full', placement: 'accelerator', measured: false, ...over });

  it('keeps a recommendation that is already quick', () => {
    const q8 = opt('q8', 8.5, 20);
    expect(balanceStarterDownload(q8, [opt('q4', 4.89, 35)])).toEqual({ pick: q8, swappedFrom: null });
  });

  it('trades a slow high-precision file for the most precise one that reaches the line', () => {
    const q8 = opt('q8', 8.5, 9);
    const { pick, swappedFrom } = balanceStarterDownload(q8, [opt('q6', 6.56, 12), opt('q4', 4.89, 16), opt('q3', 3.91, 20), opt('big-offload', 4.5, 30, { fit: 'offload', placement: 'hybrid' })]);
    expect(pick.id).toBe('q4');
    expect(swappedFrom?.id).toBe('q8');
    expect(speedupPhrase(pick.genTps!, q8.genTps!)).toBe('1.8×');
    expect(speedupPhrase(27, 9)).toBe('3×');
  });

  it('keeps the recommendation when nothing smaller reaches the line', () => {
    const q8 = opt('q8', 8.5, 5);
    expect(balanceStarterDownload(q8, [opt('q4', 4.89, 9)]).pick.id).toBe('q8');
  });
});
