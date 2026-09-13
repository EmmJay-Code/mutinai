import { describe, expect, it } from 'vitest';
import { planFirstPartyRelease } from '../../src/promotion';

const qwen = [{ id: 'f-qwen', name: 'Qwen' }, { id: 'f-coder', name: 'Qwen Coder' }];
// Facts as reported by Hugging Face for Qwen/Qwen3.8-27B (config.json text_config and safetensors metadata, September 2026).
const qwen38 = { architecture: 'dense' as const, paramsTotal: 27_781_427_952, layers: 64, attentionHeads: 24, kvHeads: 4, headDim: 256, contextLength: 262_144 };
const rules = (r: ReturnType<typeof planFirstPartyRelease>) => r.failures.map((f) => f.rule);

describe('first-party release promotion rules', () => {
  it('plans release and model from source facts, leaving the variant kind open when the name does not state it', () => {
    const { plan, failures } = planFirstPartyRelease({ repo: 'Qwen/Qwen3.8-27B', developerName: 'Qwen Team', families: qwen, observed: qwen38, releasedOn: '2026-08-05' });
    expect(failures).toEqual([]);
    expect(plan).toMatchObject({
      family: { id: 'f-qwen' },
      releaseName: 'Qwen3.8',
      modelName: 'Qwen3.8 27B',
      releasedOn: '2026-08-05',
      model: { architecture: 'dense', paramsTotal: 27_781_427_952, paramsActive: null, layers: 64, kvHeads: 4, headDim: 256, contextLength: 262_144 },
      variantKind: null,
    });
    expect(plan!.evidence.join('\n')).toMatch(/config\.json: 64 layers.*\n.*27,781,427,952 parameters, consistent with 27B/s);
  });

  it('plans a complete variant when the name states its kind, and MoE active parameters from the name', () => {
    const { plan } = planFirstPartyRelease({
      repo: 'Qwen/Qwen3-30B-A3B-Instruct-2507',
      developerName: 'Qwen Team',
      families: qwen,
      observed: { paramsTotal: 30_532_122_624, layers: 48, attentionHeads: 32, kvHeads: 4, headDim: 128, contextLength: 262_144, experts: 128, expertsPerToken: 8 },
      releasedOn: '2025-07-29',
    });
    expect(plan).toMatchObject({ releaseName: 'Qwen3', modelName: 'Qwen3 30B-A3B', variantKind: 'instruct', model: { architecture: 'moe', paramsActive: 3_000_000_000 } });
  });

  it('keeps ambiguous and inconsistent repositories unresolved, naming every unmet rule', () => {
    const base = { developerName: 'Qwen Team', families: qwen, releasedOn: '2026-08-24' };
    expect(rules(planFirstPartyRelease({ ...base, repo: 'Qwen/Qwen3.8-Flash-Next', observed: { ...qwen38, experts: 512 } }))).toEqual(['name_not_parsed']);
    expect(rules(planFirstPartyRelease({ ...base, repo: 'Qwen/Qwen4-235B', observed: { ...qwen38, paramsTotal: 235e9, experts: 128 } }))).toEqual(['moe_active_params_unknown']);
    expect(rules(planFirstPartyRelease({ ...base, repo: 'Qwen/Qwen4-14B', observed: { paramsTotal: 14.1e9 } }))).toEqual(['architecture_facts_incomplete']);
    expect(rules(planFirstPartyRelease({ ...base, repo: 'Qwen/Qwen4-14B', observed: qwen38, releasedOn: undefined }))).toEqual(['name_size_mismatch', 'release_date_unknown']);
    expect(rules(planFirstPartyRelease({ repo: 'someone/Qwen4-27B-Instruct', developerName: null, families: [], observed: qwen38, releasedOn: '2026-09-01' }))).toEqual(['publisher_not_known_developer']);
  });

  it('rejects a drafter named after the model it assists', () => {
    // google/gemma-4-12B-it-assistant: 4 layers and 0.42B parameters despite "12B" in the name.
    const result = planFirstPartyRelease({
      repo: 'google/gemma-4-12B-it-assistant',
      developerName: 'Google DeepMind',
      families: [{ id: 'f-gemma', name: 'Gemma' }],
      observed: { paramsTotal: 422_856_964, layers: 4, attentionHeads: 16, kvHeads: 8, headDim: 256, contextLength: 262_144 },
      releasedOn: '2026-05-23',
    });
    expect(result.plan).toBeNull();
    expect(rules(result)).toEqual(['name_size_mismatch', 'unrecognised_name_tokens']);
  });

  it('never attaches a new generation to a family it does not name', () => {
    const result = planFirstPartyRelease({ repo: 'deepseek-ai/DeepSeek-V5-236B-Instruct', developerName: 'DeepSeek', families: [{ id: 'f-r1', name: 'DeepSeek-R1' }], observed: { ...qwen38, paramsTotal: 236e9 }, releasedOn: '2026-09-10' });
    expect(rules(result)).toEqual(['no_matching_family']);
  });
});
