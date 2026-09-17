/**
 * The schema is checked against the three sources it was designed from, using rows taken verbatim from what each
 * one publishes. No adapters exist yet; these tests do by hand what an adapter will do, which is how the mapping
 * is kept honest before any of it is automated.
 *
 * Sources read 2026-09-17:
 *   LiveBench  LiveBench/livebench.github.io  public/table_2026_06_25.csv, public/categories_2026_06_25.json
 *   BFCL       ShishirPatil/gorilla           bfcl_eval/eval_checker/eval_runner_helper.py (score file header,
 *                                             group weights), bfcl_eval/constants/model_config.py
 *   Aider      Aider-AI/aider                 aider/website/_data/polyglot_leaderboard.yml
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { createTestDatabase, resetAndSeed } from '../src/testing';
import * as catalog from '../src/queries/catalog';
import * as s from '../src/schema';
import { ensureBenchmarkDefinitions, ensureResultSources } from '../src/reference';
import { ensureEvaluationConfig, insertRun } from '../src/writers';
import type { Database, DatabaseHandle } from '../src/client';

let h: DatabaseHandle;

beforeAll(async () => {
  h = createTestDatabase();
  await resetAndSeed(h.db);
});
afterAll(() => h.close());

const idOf = async (kind: string, slug: string) => {
  const [row] = await h.db.execute<{ id: string }>(sql`select id from ecosystem.entity where kind::text = ${kind} and slug = ${slug}`);
  if (!row) throw new Error(`missing ${kind}:${slug}`);
  return row.id;
};
const sourceId = async (key: string) => (await h.db.select().from(s.resultSource).where(eq(s.resultSource.key, key)))[0]!.id;
const metricId = async (benchmark: string, key: string) => {
  const [row] = await h.db
    .select({ id: s.benchmarkMetric.id })
    .from(s.benchmarkMetric)
    .where(and(eq(s.benchmarkMetric.benchmarkId, await idOf('benchmark', benchmark)), eq(s.benchmarkMetric.key, key)));
  return row!.id;
};
const subtaskIds = async (benchmark: string) => {
  const rows = await h.db.select().from(s.benchmarkSubtask).where(eq(s.benchmarkSubtask.benchmarkId, await idOf('benchmark', benchmark)));
  return new Map(rows.map((r) => [r.key, r.id]));
};
const rollup = async (db: Database, runId: string) => {
  const [row] = await db.execute<{ value: number; subtask_count: number; sample_count: number | null; reported_rollup_value: number | null }>(
    sql`select value::float8, subtask_count, sample_count, reported_rollup_value from ecosystem.benchmark_run_rollup where run_id = ${runId}`,
  );
  return row;
};

describe('LiveBench', () => {
  it('is registered as blocked until the licence covering the leaderboard tables is confirmed', async () => {
    const [src] = await h.db.select().from(s.resultSource).where(eq(s.resultSource.key, 'livebench-leaderboard'));
    expect(src!.ingestionEnabled).toBe(false);
    expect(src!.redistribution).toBe('unverified');
    expect(src!.licenseId).toBeNull();
    expect(src!.permissionNote).toMatch(/no licence file/i);
  });

  it('stores one real table row as per-task facts, and computes the averages the leaderboard displays', async () => {
    // public/table_2026_06_25.csv, the qwen3.6-27b row, in the file's column order.
    const row = {
      AMPS_Hard: 93.0, code_completion: 71.739, code_generation: 71.831, connections: 77.167, consecutive_events: 70.395,
      integrals_with_game: 52.0, javascript: 54.545, logic_with_navigation: 62.0, math_comp: 92.157, olympiad: 82.317,
      paraphrase: 49.433, plot_unscrambling: 42.746, python: 40.0, simplify: 50.733, spatial: 100.0,
      story_generation: 60.133, summarize: 52.617, tablejoin: 42.846, tablereformat: 98.039, theory_of_mind: 65.385,
      typescript: 23.333, typos: 70.0, zebra_puzzle: 53.75,
    };
    // A blocked source cannot be written to, so the mapping is exercised in a transaction that is rolled back and
    // against a source that has been cleared — which is also a check that the block is not merely advisory.
    await expect(
      h.db.transaction(async (tx) => {
        await tx.update(s.resultSource).set({ redistribution: 'permitted', ingestionEnabled: true }).where(eq(s.resultSource.key, 'livebench-leaderboard'));
        const benchmarkId = await idOf('benchmark', 'livebench');
        const tasks = await subtaskIds('livebench');
        const metric = await metricId('livebench', 'score');
        const runId = await insertRun(tx, {
          benchmarkId,
          variantId: await idOf('model_variant', 'qwen3-30b-a3b'),
          // "thinking-64k-high-effort" style suffixes belong here, not in a second model variant.
          configId: await ensureEvaluationConfig(tx, { label: 'default prompt', promptMode: 'prompt' }),
          resultSourceId: await sourceId('livebench-leaderboard'),
          origin: 'benchmark_operator',
          benchmarkVersion: '2026-06-25',
          harnessName: 'livebench',
          measuredOn: '2026-06-25',
          dedupeKey: 'livebench-leaderboard:2026-06-25:qwen3.6-27b',
          raw: { table: 'public/table_2026_06_25.csv', model: 'qwen3.6-27b' },
        });
        for (const [key, value] of Object.entries(row)) {
          // No numerator or count: the leaderboard table publishes neither.
          await tx.insert(s.benchmarkResult).values({ runId, benchmarkId, metricId: metric, subtaskId: tasks.get(key)!, value });
        }

        const stored = await tx.execute<{ n: number }>(sql`select count(*)::int as n from ecosystem.benchmark_result where run_id = ${runId}`);
        expect(stored[0]!.n).toBe(23);

        // Category averages are the mean of a category's tasks; the global average is the mean of the categories.
        const reasoning = (65.385 + 53.75 + 100.0 + 62.0) / 4;
        const coding = (71.831 + 71.739) / 2;
        const agentic = (54.545 + 23.333 + 40.0) / 3;
        const maths = (93.0 + 52.0 + 92.157 + 82.317) / 4;
        const data = (70.395 + 42.846 + 98.039) / 3;
        const language = (77.167 + 42.746 + 70.0) / 3;
        const iff = (49.433 + 50.733 + 60.133 + 52.617) / 4;
        const global = (reasoning + coding + agentic + maths + data + language + iff) / 7;

        const computed = await rollup(tx, runId);
        expect(computed!.value).toBeCloseTo(global, 6);
        expect(computed!.subtask_count).toBe(23);
        expect(computed!.sample_count).toBeNull();

        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    // The transaction rolled back, so the source is blocked again and nothing was stored.
    const [src] = await h.db.select().from(s.resultSource).where(eq(s.resultSource.key, 'livebench-leaderboard'));
    expect(src!.ingestionEnabled).toBe(false);
    const [count] = await h.db.execute<{ n: number }>(sql`
      select count(*)::int as n from ecosystem.benchmark_run where benchmark_id = ${await idOf('benchmark', 'livebench')}`);
    expect(count!.n).toBe(0);
  });
});

describe('BFCL', () => {
  it('stores the published categories and recomputes the overall the harness way', async () => {
    const benchmarkId = await idOf('benchmark', 'bfcl');
    const categories = await subtaskIds('bfcl');
    const metric = await metricId('bfcl', 'accuracy');
    // The `Llama-3.3-70B-Instruct (FC)` row of https://gorilla.cs.berkeley.edu/data_overall.csv, verbatim. BFCL
    // publishes no per-category counts, so nothing here carries a numerator: the live group is weighted by the
    // fixed BFCL_v4 question counts, which live on the subtasks as weights.
    const published: Record<string, number> = {
      non_live_simple: 76.08, non_live_multiple: 95.0, non_live_parallel: 90.0, non_live_parallel_multiple: 91.0,
      live_simple: 81.4, live_multiple: 75.5, live_parallel: 81.25, live_parallel_multiple: 70.83,
      irrelevance: 53.53,
      multi_turn_base: 26.0, multi_turn_miss_func: 19.0, multi_turn_miss_param: 14.5, multi_turn_long_context: 26.5,
      web_search_base: 14.0, web_search_no_snippet: 6.0,
      memory_kv: 4.52, memory_vector: 8.39, memory_rec_sum: 11.61,
    };
    // model_config.py carries `Qwen/Qwen3-32B-FC` and `Qwen/Qwen3-32B` as one model in two modes; the mode is the
    // configuration, never a second variant.
    const runId = await insertRun(h.db, {
      benchmarkId,
      variantId: await idOf('model_variant', 'llama-3-3-70b-instruct'),
      configId: await ensureEvaluationConfig(h.db, { label: 'Function calling', promptMode: 'function_calling' }),
      resultSourceId: await sourceId('bfcl-leaderboard'),
      origin: 'benchmark_operator',
      benchmarkVersion: 'BFCL_v4',
      harnessName: 'bfcl',
      // Rank, cost and latency are the leaderboard's presentation, not a measurement of the model. `Relevance
      // Detection` is published but excluded from BFCL's own overall, so it stays here too.
      raw: { Rank: '62', 'Total Cost ($)': '29.54', 'Latency Mean (s)': '26.11', 'Relevance Detection': '100.00%' },
      reportedRollupValue: 31.9,
    });
    for (const [key, value] of Object.entries(published)) {
      await h.db.insert(s.benchmarkResult).values({ runId, benchmarkId, metricId: metric, subtaskId: categories.get(key)!, value });
    }

    const mean = (...xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const at = (k: string) => published[k]!;
    // eval_runner_helper.py: unweighted within non-live, multi-turn and agentic; question-count-weighted within
    // live; then [10, 10, 10, 30, 40] across non-live, live, irrelevance, multi-turn and agentic. Agentic is the
    // unweighted mean of the web-search and memory summaries, stored here as two groups of 20.
    const nonLive = mean(at('non_live_simple'), at('non_live_multiple'), at('non_live_parallel'), at('non_live_parallel_multiple'));
    const counts: Record<string, number> = { live_simple: 258, live_multiple: 1053, live_parallel: 16, live_parallel_multiple: 24 };
    const live =
      Object.entries(counts).reduce((a, [k, n]) => a + at(k) * n, 0) / Object.values(counts).reduce((a, b) => a + b, 0);
    const multiTurn = mean(at('multi_turn_base'), at('multi_turn_miss_func'), at('multi_turn_miss_param'), at('multi_turn_long_context'));
    const webSearch = mean(at('web_search_base'), at('web_search_no_snippet'));
    const memory = mean(at('memory_kv'), at('memory_vector'), at('memory_rec_sum'));
    const overall = (10 * nonLive + 10 * live + 10 * at('irrelevance') + 30 * multiTurn + 20 * webSearch + 20 * memory) / 100;

    const computed = await rollup(h.db, runId);
    expect(computed!.value).toBeCloseTo(overall, 6);
    expect(computed!.subtask_count).toBe(18);
    // The whole point of recomputing: the stored facts add up to the number BFCL printed.
    expect(computed!.value).toBeCloseTo(31.9, 1);
    expect(computed!.reported_rollup_value).toBe(31.9);
    // No counts are published, so none are claimed.
    expect(computed!.sample_count).toBeNull();
  });
});

describe('Aider polyglot', () => {
  it('stores one leaderboard entry as two configurations of one model, with pass counts', async () => {
    // polyglot_leaderboard.yml, the Qwen2.5-Coder-32B-Instruct entry, verbatim.
    const entry = {
      dirname: '2024-12-22-13-22-32--polyglot-qwen-diff', test_cases: 225, model: 'Qwen2.5-Coder-32B-Instruct',
      edit_format: 'diff', commit_hash: '6d7e8be-dirty', pass_rate_1: 4.4, pass_rate_2: 8.0, pass_num_1: 10, pass_num_2: 18,
      percent_cases_well_formed: 71.6, error_outputs: 158, num_malformed_responses: 148, num_with_malformed_responses: 64,
      user_asks: 132, lazy_comments: 0, syntax_errors: 0, indentation_errors: 0, exhausted_context_windows: 1,
      test_timeouts: 2, total_tests: 225, command: 'aider --model openai/Qwen/Qwen2.5-Coder-32B-Instruct # via hyperbolic',
      date: '2024-12-22', versions: '0.69.2.dev', seconds_per_case: 84.4, total_cost: 0.0,
    };
    const benchmarkId = await idOf('benchmark', 'aider-polyglot');
    const variantId = await idOf('model_variant', 'qwen2-5-coder-32b-instruct');
    const passRate = await metricId('aider-polyglot', 'pass_rate');
    const wellFormed = await metricId('aider-polyglot', 'well_formed_rate');
    const source = await sourceId('aider-polyglot-leaderboard');
    const common = {
      benchmarkId, variantId, resultSourceId: source, origin: 'benchmark_operator' as const,
      harnessName: 'aider', harnessVersion: entry.versions, harnessCommit: entry.commit_hash, measuredOn: entry.date,
      raw: entry as unknown as Record<string, unknown>,
    };

    // One attempt and two attempts are the same session under different configurations, not two metrics and not
    // two models. The leaderboard's headline is the two-attempt figure.
    const firstTry = await insertRun(h.db, {
      ...common,
      configId: await ensureEvaluationConfig(h.db, { label: 'agentic editing, 1 attempt', promptMode: 'agentic', attempts: 1, harnessConfig: { editFormat: entry.edit_format } }),
      dedupeKey: `aider-polyglot-leaderboard:${entry.dirname}#attempts=1`,
    });
    await h.db.insert(s.benchmarkResult).values({
      runId: firstTry, benchmarkId, metricId: passRate, value: entry.pass_rate_1, sampleNumerator: entry.pass_num_1, sampleCount: entry.test_cases,
    });
    const secondTry = await insertRun(h.db, {
      ...common,
      configId: await ensureEvaluationConfig(h.db, { label: 'agentic editing, 2 attempts', promptMode: 'agentic', attempts: 2, harnessConfig: { editFormat: entry.edit_format } }),
      dedupeKey: `aider-polyglot-leaderboard:${entry.dirname}#attempts=2`,
    });
    await h.db.insert(s.benchmarkResult).values([
      { runId: secondTry, benchmarkId, metricId: passRate, value: entry.pass_rate_2, sampleNumerator: entry.pass_num_2, sampleCount: entry.test_cases },
      { runId: secondTry, benchmarkId, metricId: wellFormed, value: entry.percent_cases_well_formed },
    ]);

    // No subtasks: the leaderboard publishes no per-language breakdown, so there is nothing to roll up.
    expect(await rollup(h.db, secondTry)).toBeUndefined();

    // The headline is the configuration the benchmark declares, not whichever number is higher.
    const [headline] = await h.db.execute<{ value: number; computed: boolean; run_id: string }>(sql`
      select value::float8, computed, run_id from ecosystem.benchmark_headline_result
      where benchmark_id = ${benchmarkId} and variant_id = ${variantId}`);
    expect(headline!.value).toBe(entry.pass_rate_2);
    expect(headline!.run_id).toBe(secondTry);
    expect(headline!.computed).toBe(false);

    const results = (await catalog.getModelDetail(h.db, 'qwen2-5-coder-32b'))!.capabilityResults.filter((r) => r.benchmarkSlug === 'aider-polyglot');
    expect(results.map((r) => [r.evaluationSetting, r.metric.value])).toEqual(
      expect.arrayContaining([
        ['agentic editing, 1 attempt', entry.pass_rate_1],
        ['agentic editing, 2 attempts', entry.pass_rate_2],
      ]),
    );
    expect(results.find((r) => r.metric.value === entry.pass_rate_2)!.samples).toEqual({ numerator: 18, count: 225 });
    expect(results.every((r) => r.attribution?.startsWith('Aider polyglot coding benchmark'))).toBe(true);
  });
});

describe('the reference registry', () => {
  it('is idempotent, and a redeploy never enables a blocked source', async () => {
    const before = await h.db.execute<{ sources: number; subtasks: number }>(sql`
      select (select count(*)::int from ecosystem.result_source) as sources,
             (select count(*)::int from ecosystem.benchmark_subtask) as subtasks`);

    const sources = await ensureResultSources(h.db);
    const benchmarks = await ensureBenchmarkDefinitions(h.db);
    expect(sources.created).toBe(0);
    expect(benchmarks.created).toBe(0);

    const after = await h.db.execute<{ sources: number; subtasks: number }>(sql`
      select (select count(*)::int from ecosystem.result_source) as sources,
             (select count(*)::int from ecosystem.benchmark_subtask) as subtasks`);
    expect(after[0]).toEqual(before[0]);
    const [livebench] = await h.db.select().from(s.resultSource).where(eq(s.resultSource.key, 'livebench-leaderboard'));
    expect(livebench!.ingestionEnabled).toBe(false);
  });

  it('will not let a source be turned off while results from it are stored', async () => {
    await expect(
      h.db.update(s.resultSource).set({ ingestionEnabled: false }).where(eq(s.resultSource.key, 'bfcl-leaderboard')),
    ).rejects.toMatchObject({ cause: { constraint_name: 'benchmark_run_source_enabled_fk' } });
  });
});

describe('conflicting results', () => {
  it('keeps both reports and shows the independent one, whichever number is higher', async () => {
    const benchmarkId = await idOf('benchmark', 'aider-polyglot');
    const variantId = await idOf('model_variant', 'qwen2-5-32b-instruct');
    const passRate = await metricId('aider-polyglot', 'pass_rate');
    const configId = await ensureEvaluationConfig(h.db, { label: 'agentic editing, 2 attempts', promptMode: 'agentic', attempts: 2 });
    const common = { benchmarkId, variantId, configId, measuredOn: '2025-01-05' };

    const claimed = await insertRun(h.db, { ...common, resultSourceId: await sourceId('mutinai-catalog'), origin: 'developer_reported' });
    await h.db.insert(s.benchmarkResult).values({ runId: claimed, benchmarkId, metricId: passRate, value: 61.0 });
    const measured = await insertRun(h.db, { ...common, resultSourceId: await sourceId('aider-polyglot-leaderboard'), origin: 'benchmark_operator' });
    await h.db.insert(s.benchmarkResult).values({ runId: measured, benchmarkId, metricId: passRate, value: 44.9 });

    const [canonical] = await h.db.execute<{ value: number; origin: string; conflicting_count: number }>(sql`
      select value::float8, origin::text, conflicting_count from ecosystem.benchmark_result_canonical
      where benchmark_id = ${benchmarkId} and variant_id = ${variantId}`);
    expect(canonical!.value).toBe(44.9);
    expect(canonical!.origin).toBe('benchmark_operator');
    expect(canonical!.conflicting_count).toBe(1);

    // Both rows are still there.
    const [kept] = await h.db.execute<{ n: number }>(sql`
      select count(*)::int as n from ecosystem.benchmark_result r join ecosystem.benchmark_run run on run.id = r.run_id
      where run.benchmark_id = ${benchmarkId} and run.variant_id = ${variantId}`);
    expect(kept!.n).toBe(2);

    const scores = (await catalog.listBenchmarkScores(h.db)).filter((x) => x.benchmarkSlug === 'aider-polyglot' && x.modelSlug === 'qwen2-5-32b');
    expect(scores).toHaveLength(1);
    expect(scores[0]!.value).toBe(44.9);
  });
});
