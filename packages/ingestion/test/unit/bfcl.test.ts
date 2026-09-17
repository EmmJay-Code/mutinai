/**
 * Parsing checks against real BFCL output, recorded 2026-09-17 from
 * `https://gorilla.cs.berkeley.edu/data_overall.csv` and `bfcl_eval/constants/model_config.py`.
 *
 * The arithmetic these fixtures are checked against is BFCL's own, read from
 * `bfcl_eval/eval_checker/eval_runner_helper.py`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BFCL_SCORE_COLUMNS,
  BFCL_VERSION,
  parseBfclLeaderboard,
  parseBfclModelConfig,
  parsePercent,
  resolveBfclModel,
} from '../../src/adapters/bfcl';

const fixture = (name: string) => readFileSync(new URL(`../recorded/bfcl/${name}`, import.meta.url), 'utf8');
const CSV = fixture('data_overall.csv');
const CONFIGS = parseBfclModelConfig(fixture('model_config.py'));

describe('model_config.py', () => {
  it('reads the identity map without executing it', () => {
    expect(CONFIGS.length).toBe(9);
    const llama = CONFIGS.find((c) => c.key === 'meta-llama/Llama-3.3-70B-Instruct-FC');
    expect(llama).toMatchObject({
      modelName: 'meta-llama/Llama-3.3-70B-Instruct',
      displayName: 'Llama-3.3-70B-Instruct (FC)',
      isFunctionCalling: true,
    });
  });

  it('distinguishes function-calling entries from prompt entries of the same weights', () => {
    const fc = CONFIGS.find((c) => c.key === 'Qwen/Qwen3-32B-FC');
    const prompt = CONFIGS.find((c) => c.key === 'Qwen/Qwen3-32B');
    expect(fc?.isFunctionCalling).toBe(true);
    expect(prompt?.isFunctionCalling).toBe(false);
    expect(fc?.modelName).toBe(prompt?.modelName);
  });
});

describe('resolving a leaderboard row to a model', () => {
  it('resolves a display name that BFCL registers twice, once per serving path', () => {
    // `Qwen3-32B (FC)` is both `qwen3-32b-FC` (the Qwen API) and `Qwen/Qwen3-32B-FC` (the weights). One model.
    const resolved = resolveBfclModel('Qwen3-32B (FC)', CONFIGS);
    expect(resolved).toMatchObject({ kind: 'resolved', huggingFaceId: 'Qwen/Qwen3-32B' });
  });

  it('refuses a model with no Hugging Face repo id rather than guessing one', () => {
    expect(resolveBfclModel('Claude-Opus-4-5-20251101 (FC)', CONFIGS)).toMatchObject({
      kind: 'unresolved',
      reason: 'no_huggingface_id',
    });
  });

  it('refuses a name it has never seen instead of matching something similar', () => {
    expect(resolveBfclModel('Llama-3.3-70B-Instruct', CONFIGS)).toMatchObject({ kind: 'unresolved', reason: 'unknown_model' });
    expect(resolveBfclModel('Qwen3-33B (FC)', CONFIGS)).toMatchObject({ kind: 'unresolved', reason: 'unknown_model' });
  });

  it('refuses a display name that two different repositories claim', () => {
    const conflicting = [
      { key: 'a', modelName: 'org-a/Model', displayName: 'Model (FC)', isFunctionCalling: true },
      { key: 'b', modelName: 'org-b/Model', displayName: 'Model (FC)', isFunctionCalling: true },
    ];
    expect(resolveBfclModel('Model (FC)', conflicting)).toMatchObject({ kind: 'unresolved', reason: 'ambiguous_huggingface_id' });
  });
});

describe('percentages', () => {
  it('reads published cells and treats an unevaluated category as absent, not as zero', () => {
    expect(parsePercent('77.47%')).toBe(77.47);
    expect(parsePercent('0.00%')).toBe(0);
    expect(parsePercent('N/A')).toBeNull();
    expect(parsePercent('')).toBeNull();
    expect(parsePercent(undefined)).toBeNull();
  });
});

describe('the published leaderboard', () => {
  const { runs, skipped } = parseBfclLeaderboard(CSV, CONFIGS);

  it('keeps only the rows whose model can be identified', () => {
    expect(runs.map((r) => r.displayName).sort()).toEqual([
      'Gemma-3-27b-it (Prompt)',
      'Llama-3.1-8B-Instruct (Prompt)',
      'Llama-3.3-70B-Instruct (FC)',
      'Phi-4 (Prompt)',
      'Qwen3-32B (FC)',
      'Qwen3-32B (Prompt)',
    ]);
    expect(skipped).toEqual([
      { displayName: 'Claude-Opus-4-5-20251101 (FC)', reason: 'no_huggingface_id', detail: 'claude-opus-4-5-20251101' },
    ]);
  });

  it('stores every published category and nothing else', () => {
    const llama = runs.find((r) => r.displayName === 'Llama-3.3-70B-Instruct (FC)')!;
    expect(llama.scores).toHaveLength(18);
    expect(llama.scores.map((s) => s.subtaskKey)).toEqual(Object.values(BFCL_SCORE_COLUMNS));
    // Relevance is published but excluded from BFCL's own overall, so it is provenance rather than a stored fact.
    // (`irrelevance` is a different category, and is scored.)
    expect(llama.scores.map((s) => s.subtaskKey)).not.toContain('relevance');
    expect(llama.scores.map((s) => s.subtaskKey)).toContain('irrelevance');
    expect(llama.raw['Relevance Detection']).toBe('100.00%');
  });

  it('separates one model\'s two modes into two runs of the same weights', () => {
    const fc = runs.find((r) => r.displayName === 'Qwen3-32B (FC)')!;
    const prompt = runs.find((r) => r.displayName === 'Qwen3-32B (Prompt)')!;
    expect(fc.huggingFaceId).toBe(prompt.huggingFaceId);
    expect(fc.functionCalling).toBe(true);
    expect(prompt.functionCalling).toBe(false);
    expect(fc.dedupeKey).not.toBe(prompt.dedupeKey);
    expect(fc.dedupeKey).toBe(`bfcl:${BFCL_VERSION}:qwen3-32b-FC`);
  });

  it('keeps cost, latency and rank as provenance rather than as measurements', () => {
    const llama = runs.find((r) => r.displayName === 'Llama-3.3-70B-Instruct (FC)')!;
    expect(llama.raw).toMatchObject({ Rank: '62', 'Total Cost ($)': '29.54', Organization: 'Meta', bfcl_version: BFCL_VERSION });
    expect(llama.raw['Latency Mean (s)']).toBe('26.11');
  });

  it('records what the leaderboard printed without storing it as a fact', () => {
    const llama = runs.find((r) => r.displayName === 'Llama-3.3-70B-Instruct (FC)')!;
    expect(llama.reportedOverall).toBe(31.9);
    expect(llama.scores.some((s) => s.value === 31.9)).toBe(false);
  });

  /**
   * The check that matters: BFCL's published overall is reproducible from the categories this adapter stores,
   * using BFCL's own mixture. If this drifts, the stored facts no longer add up to what the source published.
   */
  it('reproduces the published overall from the stored categories', () => {
    for (const run of runs) {
      const at = (key: string) => run.scores.find((s) => s.subtaskKey === key)!.value;
      const mean = (...v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
      const nonLive = mean(at('non_live_simple'), at('non_live_multiple'), at('non_live_parallel'), at('non_live_parallel_multiple'));
      // Live is weighted by the fixed BFCL_v4 question counts, which is what `calculate_weighted_accuracy` does.
      const counts = { live_simple: 258, live_multiple: 1053, live_parallel: 16, live_parallel_multiple: 24 };
      const live =
        Object.entries(counts).reduce((sum, [k, n]) => sum + at(k) * n, 0) /
        Object.values(counts).reduce((a, b) => a + b, 0);
      const multiTurn = mean(at('multi_turn_base'), at('multi_turn_miss_func'), at('multi_turn_miss_param'), at('multi_turn_long_context'));
      const webSearch = mean(at('web_search_base'), at('web_search_no_snippet'));
      const memory = mean(at('memory_kv'), at('memory_vector'), at('memory_rec_sum'));
      const agentic = mean(webSearch, memory);
      const overall = 0.1 * nonLive + 0.1 * live + 0.1 * at('irrelevance') + 0.3 * multiTurn + 0.4 * agentic;
      expect(overall).toBeCloseTo(run.reportedOverall!, 1);
    }
  });
});
