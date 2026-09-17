/**
 * Writes parsed BFCL runs into the catalog.
 *
 * Resolution is by exact Hugging Face repo id against the `huggingface` identifier namespace — the same namespace
 * the Hub adapter writes. A model BFCL evaluated that Mutinai does not hold is reported and skipped; nothing is
 * matched on name similarity, so the catalog never gains a score belonging to a model it cannot identify.
 *
 * The write is refused by the database if `bfcl-leaderboard` is not cleared for redistribution, so this module has
 * no permission logic of its own.
 */
import { and, eq, sql } from 'drizzle-orm';
import { schema as s, ensureEvaluationConfig, insertRun, type Executor } from '@mutinai/db';
import { BFCL_CITATION_URL, BFCL_VERSION, type BfclRun, type BfclSkip } from './bfcl';

export interface BfclImportOptions {
  /** Snapshot provenance: the source record the leaderboard CSV was stored as, when the pipeline supplies one. */
  sourceRecordId?: string;
  /** `Last-Modified` of the published CSV, recorded as provenance. BFCL publishes no per-model measurement date. */
  leaderboardLastModified?: string;
  log?: (message: string) => void;
}

export interface BfclImportStats {
  written: number;
  replaced: number;
  unresolvedModels: { displayName: string; huggingFaceId: string }[];
  skipped: BfclSkip[];
}

async function variantIdByHuggingFace(db: Executor, repoId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: s.externalIdentifier.entityId })
    .from(s.externalIdentifier)
    .innerJoin(s.modelVariant, eq(s.modelVariant.id, s.externalIdentifier.entityId))
    .where(and(eq(s.externalIdentifier.namespace, 'huggingface'), eq(s.externalIdentifier.value, repoId)));
  return row?.id ?? null;
}

/**
 * Stores one run per leaderboard row, with one result per published category.
 *
 * Re-ingesting the same generation replaces the run rather than adding a second one: `dedupe_key` identifies the
 * measurement, and BFCL republishes a corrected table in place rather than versioning it.
 */
export async function importBfclRuns(db: Executor, runs: readonly BfclRun[], opts: BfclImportOptions = {}): Promise<BfclImportStats> {
  const log = opts.log ?? (() => {});
  const stats: BfclImportStats = { written: 0, replaced: 0, unresolvedModels: [], skipped: [] };

  const [benchmark] = await db
    .select({ id: s.entity.id })
    .from(s.entity)
    .where(and(eq(s.entity.kind, 'benchmark'), eq(s.entity.slug, 'bfcl')));
  if (!benchmark) throw new Error('the bfcl benchmark definition is missing; run the worker bootstrap first');

  const [source] = await db.select({ id: s.resultSource.id }).from(s.resultSource).where(eq(s.resultSource.key, 'bfcl-leaderboard'));
  if (!source) throw new Error('the bfcl-leaderboard result source is missing; run the worker bootstrap first');

  const [metric] = await db
    .select({ id: s.benchmarkMetric.id })
    .from(s.benchmarkMetric)
    .where(and(eq(s.benchmarkMetric.benchmarkId, benchmark.id), eq(s.benchmarkMetric.key, 'accuracy')));
  if (!metric) throw new Error('the bfcl accuracy metric is missing; run the worker bootstrap first');

  const subtasks = new Map(
    (await db.select({ id: s.benchmarkSubtask.id, key: s.benchmarkSubtask.key }).from(s.benchmarkSubtask).where(eq(s.benchmarkSubtask.benchmarkId, benchmark.id)))
      .map((r) => [r.key, r.id] as const),
  );

  for (const run of runs) {
    const variantId = await variantIdByHuggingFace(db, run.huggingFaceId);
    if (!variantId) {
      stats.unresolvedModels.push({ displayName: run.displayName, huggingFaceId: run.huggingFaceId });
      continue;
    }
    const unknown = run.scores.find((score) => !subtasks.has(score.subtaskKey));
    if (unknown) throw new Error(`bfcl publishes a category the benchmark definition does not declare: ${unknown.subtaskKey}`);

    const configId = await ensureEvaluationConfig(db, {
      label: run.functionCalling ? 'Function calling' : 'Prompt',
      promptMode: run.functionCalling ? 'function_calling' : 'prompt',
    });

    const [existing] = await db.select({ id: s.benchmarkRun.id }).from(s.benchmarkRun).where(eq(s.benchmarkRun.dedupeKey, run.dedupeKey));
    if (existing) {
      await db.delete(s.benchmarkRun).where(eq(s.benchmarkRun.id, existing.id));
      stats.replaced += 1;
    }

    const runId = await insertRun(db, {
      benchmarkId: benchmark.id,
      variantId,
      configId,
      resultSourceId: source.id,
      // BFCL evaluates every model itself, which is what makes it independent evidence rather than a registry.
      origin: 'benchmark_operator',
      benchmarkVersion: BFCL_VERSION,
      harnessName: 'bfcl',
      harnessVersion: BFCL_VERSION,
      citationUrl: BFCL_CITATION_URL,
      reportedRollupValue: run.reportedOverall ?? undefined,
      raw: opts.leaderboardLastModified ? { ...run.raw, leaderboard_last_modified: opts.leaderboardLastModified } : run.raw,
      dedupeKey: run.dedupeKey,
      sourceRecordId: opts.sourceRecordId,
    });

    await db.insert(s.benchmarkResult).values(
      run.scores.map((score) => ({
        runId,
        benchmarkId: benchmark.id,
        metricId: metric.id,
        subtaskId: subtasks.get(score.subtaskKey)!,
        value: score.value,
        // BFCL publishes no per-category counts, so what the percentage is a fraction of stays unknown.
        sampleNumerator: null,
        sampleCount: null,
      })),
    );
    stats.written += 1;
    log(`  ${run.displayName} -> ${run.huggingFaceId} (${run.scores.length} categories)`);
  }

  if (stats.unresolvedModels.length) {
    log(`  ${stats.unresolvedModels.length} model(s) BFCL scores are not in the catalog; no score was attached to a guess`);
  }
  return stats;
}

/** How far the recomputed rollup sits from the number BFCL printed, per run. Used to check a run after import. */
export async function bfclRollupReconciliation(db: Executor): Promise<{ dedupeKey: string; computed: number; reported: number | null }[]> {
  return db.execute<{ dedupeKey: string; computed: number; reported: number | null }>(sql`
    select run.dedupe_key as "dedupeKey", ro.value::float8 as computed, run.reported_rollup_value::float8 as reported
    from ecosystem.benchmark_run_rollup ro
    join ecosystem.benchmark_run run on run.id = ro.run_id
    where run.dedupe_key like 'bfcl:%'
    order by run.dedupe_key`);
}
