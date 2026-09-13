import { describe, expect, it } from 'vitest';
import { matchFamily, modelNameFor, parseModelRepoName, releaseNameFor, variantKindFromSuffix } from '../src/model-naming';

const families = [{ name: 'Qwen' }, { name: 'Qwen Coder' }, { name: 'Qwen Math' }, { name: 'Mistral' }, { name: 'Mixtral' }, { name: 'Gemma' }, { name: 'DeepSeek-R1' }, { name: 'Llama' }];

describe('first-party repository names', () => {
  it('parses brand, version, line, size, active parameters and suffix', () => {
    expect(parseModelRepoName('Qwen3.8-27B')).toMatchObject({ brand: ['Qwen'], version: '3.8', joined: true, line: [], sizeB: 27, activeB: null, suffix: [] });
    expect(parseModelRepoName('Qwen3-30B-A3B-Instruct-2507')).toMatchObject({ brand: ['Qwen'], version: '3', sizeToken: '30B', activeB: 3, activeToken: 'A3B', suffix: ['Instruct', '2507'] });
    expect(parseModelRepoName('Qwen2.5-Coder-32B-Instruct')).toMatchObject({ brand: ['Qwen'], version: '2.5', line: ['Coder'], sizeB: 32 });
    expect(parseModelRepoName('Llama-3.1-8B-Instruct')).toMatchObject({ brand: ['Llama'], version: '3.1', joined: false, suffix: ['Instruct'] });
    expect(parseModelRepoName('Mistral-Small-4-119B-2603')).toMatchObject({ brand: ['Mistral', 'Small'], version: '4', sizeB: 119, suffix: ['2603'] });
    expect(parseModelRepoName('gemma-4-12B-it')).toMatchObject({ brand: ['gemma'], version: '4', suffix: ['it'] });
  });

  it('refuses names that do not state a size and version', () => {
    for (const name of ['Qwen3.8-Flash-Next', 'DeepSeek-V4.1-Flash', 'mattergen', 'Mixtral-8x7B-Instruct-v0.1', 'Mistral-Small-24B-Instruct-2501']) expect(parseModelRepoName(name)).toBeNull();
  });

  it('matches the developer family by brand, preferring brand plus line, and never guesses', () => {
    expect(matchFamily(parseModelRepoName('Qwen3.8-27B')!, families)).toEqual({ family: { name: 'Qwen' }, includesLine: false });
    expect(matchFamily(parseModelRepoName('Qwen2.5-Coder-32B-Instruct')!, families)).toEqual({ family: { name: 'Qwen Coder' }, includesLine: true });
    expect(matchFamily(parseModelRepoName('Mistral-Small-4-119B-2603')!, families)).toEqual({ family: { name: 'Mistral' }, includesLine: false });
    expect(matchFamily(parseModelRepoName('DeepSeek-V5-236B')!, families)).toBeNull();
    expect(matchFamily(parseModelRepoName('Qwen4-8B')!, [{ name: 'Qwen' }, { name: 'qwen' }])).toEqual({ ambiguous: [{ name: 'Qwen' }, { name: 'qwen' }] });
  });

  it('names releases and models in the catalog style', () => {
    const qwen = parseModelRepoName('Qwen3.8-27B')!;
    expect(releaseNameFor(qwen, 'Qwen')).toBe('Qwen3.8');
    expect(modelNameFor(qwen, 'Qwen3.8')).toBe('Qwen3.8 27B');
    const moe = parseModelRepoName('Qwen3-30B-A3B-Instruct-2507')!;
    expect(modelNameFor(moe, releaseNameFor(moe, 'Qwen'))).toBe('Qwen3 30B-A3B');
    expect(releaseNameFor(parseModelRepoName('gemma-4-12B-it')!, 'Gemma')).toBe('Gemma 4');
    expect(releaseNameFor(parseModelRepoName('Mistral-Small-4-119B-2603')!, 'Mistral')).toBe('Mistral Small 4');
    expect(releaseNameFor(parseModelRepoName('Qwen2.5-Coder-32B-Instruct')!, 'Qwen Coder')).toBe('Qwen2.5-Coder');
  });

  it('reads the variant kind only from explicit tokens', () => {
    expect(variantKindFromSuffix(['Instruct', '2507'])).toEqual({ kind: 'instruct', unrecognized: [], conflicting: false });
    expect(variantKindFromSuffix(['Base'])).toMatchObject({ kind: 'base' });
    expect(variantKindFromSuffix([])).toMatchObject({ kind: null, unrecognized: [] });
    expect(variantKindFromSuffix(['it', 'assistant'])).toMatchObject({ kind: 'instruct', unrecognized: ['assistant'] });
    expect(variantKindFromSuffix(['Instruct', 'Thinking'])).toMatchObject({ kind: null, conflicting: true });
  });
});
