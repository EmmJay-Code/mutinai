/**
 * The BFCL adapter end to end: the real published leaderboard in, runs and results out, and the database's own
 * rollup reproducing the overall BFCL printed.
 *
 * Fixtures are real rows recorded 2026-09-17 (see test/recorded/bfcl). Nothing here reaches the network.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDatabase, resetAndSeed } from '@mutinai/db/testing';
import { ensureBenchmarkDefinitions, ensureResultSources, schema as s, type DatabaseHandle } from '@mutinai/db';
import { parseBfclLeaderboard, parseBfclModelConfig } from '../../src/adapters/bfcl';
import { bfclRollupReconciliation, importBfclRuns } from '../../src/adapters/bfcl-import';

const fixture = (name: string) => readFileSync(new URL(`../recorded/bfcl/${name}`, import.meta.url), 'utf8');

let h: DatabaseHandle;
let parsed: ReturnType<typeof parseBfclLeaderboard>;

beforeAll(async () => {
  h = createTestDatabase();
  await resetAndSeed(h.db);
  await ensureResultSources(h.db);
  await ensureBenchmarkDefinitions(h.db);
  parsed = parseBfclLeaderboard(fixture('data_overall.csv'), parseBfclModelConfig(fixture('model_config.py')));
}, 120_000);
afterAll(() => h.close());

describe('importing BFCL', () => {
  it('stores only models the catalog already holds, and never guesses at the rest', async () => {
    const stats = await importBfclRuns(h.db, parsed.runs, { leaderboardLastModified: 'Mon, 13 Apr 2026 03:20:44 GMT' });
    // Of the six rows carrying a Hugging Face id, the catalog holds four. Qwen3-32B is not seeded, in either mode.
    expect(stats.written).toBe(4);
    expect(stats.unresolvedModels.map((m) => m.huggingFaceId).sort()).toEqual(['Qwen/Qwen3-32B', 'Qwen/Qwen3-32B']);

    const runs = await h.db.select().from(s.benchmarkRun).where(sql`${s.benchmarkRun.dedupeKey} like 'bfcl:%'`);
    expect(runs).toHaveLength(4);
    for (const run of runs) {
      expect(run.origin).toBe('benchmark_operator');
      expect(run.benchmarkVersion).toBe('BFCL_v4');
      // Every run is citable: the rule the policy states, on the row rather than in a person's memory.
      expect(run.citationUrl).toBe('https://gorilla.cs.berkeley.edu/leaderboard.html');
      expect(run.variantId).not.toBeNull();
      expect(run.artifactId).toBeNull();
      expect((run.raw as Record<string, unknown>).leaderboard_last_modified).toBe('Mon, 13 Apr 2026 03:20:44 GMT');
    }
  });

  it('reproduces the overall BFCL published, from the facts it stored', async () => {
    const reconciliation = await bfclRollupReconciliation(h.db);
    expect(reconciliation).toHaveLength(4);
    for (const row of reconciliation) {
      // The database recomputes the roll-up; the leaderboard's own number is only kept alongside it.
      expect(row.computed).toBeCloseTo(row.reported!, 1);
    }
  });

  it('keeps cost, latency and relevance out of the measurements', async () => {
    const [llama] = await h.db
      .select()
      .from(s.benchmarkRun)
      .where(eq(s.benchmarkRun.dedupeKey, 'bfcl:BFCL_v4:meta-llama/Llama-3.3-70B-Instruct-FC'));
    const raw = llama!.raw as Record<string, unknown>;
    expect(raw['Total Cost ($)']).toBe('29.54');
    expect(raw['Relevance Detection']).toBe('100.00%');

    const results = await h.db.select().from(s.benchmarkResult).where(eq(s.benchmarkResult.runId, llama!.id));
    expect(results).toHaveLength(18);
    // Nothing claims a sample count, because BFCL publishes none.
    expect(results.every((r) => r.sampleCount === null && r.sampleNumerator === null)).toBe(true);
  });

  it('records one model\'s two modes as two configurations of one variant', async () => {
    const rows = await h.db.execute<{ variantId: string; promptMode: string }>(sql`
      select run.variant_id as "variantId", cfg.prompt_mode as "promptMode"
      from ecosystem.benchmark_run run
      join ecosystem.evaluation_config cfg on cfg.id = run.config_id
      where run.dedupe_key like 'bfcl:%'`);
    const llama = rows.filter((r) => r.promptMode === 'function_calling');
    expect(llama.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.promptMode))).toEqual(new Set(['function_calling', 'prompt']));
    // Prompt mode and function-calling mode are interned configurations, not separate models.
    const configs = await h.db.select().from(s.evaluationConfig).where(eq(s.evaluationConfig.promptMode, 'function_calling'));
    expect(configs).toHaveLength(1);
  });

  it('re-ingesting the same table replaces the run rather than storing it twice', async () => {
    const before = await h.db.select().from(s.benchmarkRun).where(sql`${s.benchmarkRun.dedupeKey} like 'bfcl:%'`);
    const stats = await importBfclRuns(h.db, parsed.runs, {});
    const after = await h.db.select().from(s.benchmarkRun).where(sql`${s.benchmarkRun.dedupeKey} like 'bfcl:%'`);
    expect(stats.replaced).toBe(4);
    expect(after).toHaveLength(before.length);
    const results = await h.db.execute<{ n: number }>(sql`
      select count(*)::int as n from ecosystem.benchmark_result r
      join ecosystem.benchmark_run run on run.id = r.run_id where run.dedupe_key like 'bfcl:%'`);
    expect(results[0]!.n).toBe(4 * 18);
  });

  it('is refused outright while the source is not cleared for redistribution', async () => {
    // Stored runs pin their source open, so the ones written above come out before it can be blocked. That the
    // database refuses the disable while they exist is itself the permission rule holding.
    await expect(
      h.db.update(s.resultSource).set({ ingestionEnabled: false }).where(eq(s.resultSource.key, 'bfcl-leaderboard')),
    ).rejects.toThrow();

    await h.db.delete(s.benchmarkRun).where(sql`${s.benchmarkRun.dedupeKey} like 'bfcl:%'`);
    await h.db.update(s.resultSource).set({ ingestionEnabled: false }).where(eq(s.resultSource.key, 'bfcl-leaderboard'));
    await expect(importBfclRuns(h.db, parsed.runs, {})).rejects.toThrow();
    const left = await h.db.select().from(s.benchmarkRun).where(sql`${s.benchmarkRun.dedupeKey} like 'bfcl:%'`);
    expect(left).toHaveLength(0);

    await h.db.update(s.resultSource).set({ ingestionEnabled: true }).where(eq(s.resultSource.key, 'bfcl-leaderboard'));
  });
});
