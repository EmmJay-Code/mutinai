/**
 * Reference vocabulary the catalog needs whether or not the fixture dataset is seeded: quantization schemes, the
 * registry of sources canonical benchmark results may come from, and the benchmarks those sources publish.
 * Idempotent. Runs in the seed and on every deploy (worker `bootstrap`), so production gains entries added to the
 * repository without reseeding. Existing rows are only ever refreshed, never replaced — and a source's
 * `ingestionEnabled` flag is never changed by a deploy.
 */
import { and, eq } from 'drizzle-orm';
import type { Executor } from './client';
import * as s from './schema';
import { schemes } from './seed/catalog';
import { addAliases, createEntity, ensureEvaluationConfig, type EvaluationConfigInput } from './writers';

export async function ensureQuantizationSchemes(db: Executor): Promise<{ ids: Map<string, string>; created: number }> {
  const ids = new Map<string, string>();
  let created = 0;
  for (const scheme of schemes) {
    const [existing] = await db.select({ id: s.entity.id }).from(s.entity).where(and(eq(s.entity.kind, 'quantization_scheme'), eq(s.entity.slug, scheme.slug)));
    let id = existing?.id;
    if (!id) {
      id = await createEntity(db, { kind: 'quantization_scheme', slug: scheme.slug, name: scheme.name, summary: scheme.summary });
      await db.insert(s.quantizationScheme).values({ id, method: scheme.method, format: scheme.format, bitsPerWeight: scheme.bitsPerWeight });
      created += 1;
    }
    if ('aliases' in scheme) await addAliases(db, id, [...scheme.aliases]);
    ids.set(scheme.slug, id);
  }
  return { ids, created };
}

/**
 * Where canonical benchmark results may come from, and on what terms. Every entry records the licence that was
 * actually read and the date it was read, because the database refuses runs from a source whose permission is
 * still `unverified`. Adding a source here does not start ingesting it; flipping `ingestionEnabled` does.
 *
 * Idempotent, and deliberately conservative on update: an entry that already exists has its descriptive fields
 * refreshed but never has `ingestionEnabled` turned on by a deploy. Enabling a source is a decision someone makes
 * once the permission note says it is settled. See docs/sources.md.
 */
export const resultSources = [
  {
    key: 'mutinai-catalog',
    name: 'Mutinai catalog',
    redistribution: 'permitted',
    ingestionEnabled: true,
    priority: -100,
    permissionNote:
      'Results Mutinai holds itself: the sample catalog and editorial measurements. Nothing here is redistributed from a third party.',
  },
  {
    key: 'livebench-leaderboard',
    name: 'LiveBench leaderboard',
    homepageUrl: 'https://livebench.ai',
    datasetUrl: 'https://github.com/LiveBench/livebench.github.io/tree/main/public',
    redistribution: 'unverified',
    ingestionEnabled: false,
    priority: 50,
    permissionNote:
      'Blocked. The harness repository (LiveBench/LiveBench) is Apache-2.0, but the leaderboard tables are published from LiveBench/livebench.github.io, which carries no licence file of its own — so the Apache grant demonstrably covers the code, and not demonstrably the tables. Unblock only on an explicit statement from the maintainers that Apache-2.0 covers public/table_*.csv; then set redistribution to attribution_required with the credit line, and enable.',
  },
  {
    key: 'bfcl-leaderboard',
    name: 'Berkeley Function Calling Leaderboard',
    homepageUrl: 'https://gorilla.cs.berkeley.edu/leaderboard.html',
    datasetUrl: 'https://github.com/ShishirPatil/gorilla/tree/main/berkeley-function-call-leaderboard',
    licenseKey: 'apache-2.0',
    licenseUrl: 'https://github.com/ShishirPatil/gorilla/blob/main/LICENSE',
    redistribution: 'attribution_required',
    attribution: 'Berkeley Function Calling Leaderboard — Gorilla, UC Berkeley (Apache-2.0)',
    ingestionEnabled: true,
    priority: 50,
    permissionNote:
      'The gorilla repository is Apache-2.0 at its root, and the leaderboard lives inside it, so the grant covers the scores and the harness alike. Attribution and the notice are the conditions.',
  },
  {
    key: 'aider-polyglot-leaderboard',
    name: 'Aider polyglot leaderboard',
    homepageUrl: 'https://aider.chat/docs/leaderboards/',
    datasetUrl: 'https://github.com/Aider-AI/aider/blob/main/aider/website/_data/polyglot_leaderboard.yml',
    licenseKey: 'apache-2.0',
    licenseUrl: 'https://github.com/Aider-AI/aider/blob/main/LICENSE.txt',
    redistribution: 'attribution_required',
    attribution: 'Aider polyglot coding benchmark — Aider-AI (Apache-2.0)',
    ingestionEnabled: true,
    priority: 50,
    permissionNote:
      'The aider repository is Apache-2.0 and the leaderboard data file is inside it, so the grant covers the results. Attribution and the notice are the conditions.',
  },
] as const satisfies readonly {
  key: string;
  name: string;
  homepageUrl?: string;
  datasetUrl?: string;
  licenseKey?: string;
  licenseUrl?: string;
  redistribution: 'permitted' | 'attribution_required' | 'unverified' | 'prohibited';
  attribution?: string;
  permissionNote: string;
  ingestionEnabled: boolean;
  priority: number;
}[];

export async function ensureResultSources(db: Executor): Promise<{ ids: Map<string, string>; created: number }> {
  const ids = new Map<string, string>();
  let created = 0;
  for (const src of resultSources) {
    const licenseId = 'licenseKey' in src && src.licenseKey
      ? (await db.select({ id: s.license.id }).from(s.license).where(eq(s.license.key, src.licenseKey)))[0]?.id ?? null
      : null;
    const fields = {
      name: src.name,
      homepageUrl: 'homepageUrl' in src ? src.homepageUrl : null,
      datasetUrl: 'datasetUrl' in src ? src.datasetUrl : null,
      licenseId,
      licenseUrl: 'licenseUrl' in src ? src.licenseUrl : null,
      redistribution: src.redistribution,
      attribution: 'attribution' in src ? src.attribution : null,
      permissionNote: src.permissionNote,
      priority: src.priority,
      updatedAt: new Date(),
    };
    const [existing] = await db.select({ id: s.resultSource.id }).from(s.resultSource).where(eq(s.resultSource.key, src.key));
    if (existing) {
      // Never re-enables a source a deployment has deliberately turned off, and never turns one on.
      await db.update(s.resultSource).set(fields).where(eq(s.resultSource.id, existing.id));
      ids.set(src.key, existing.id);
      continue;
    }
    const [row] = await db
      .insert(s.resultSource)
      .values({ key: src.key, ingestionEnabled: src.ingestionEnabled, ...fields })
      .returning({ id: s.resultSource.id });
    ids.set(src.key, row!.id);
    created += 1;
  }
  return { ids, created };
}

interface SubtaskSeed { key: string; label: string; weight?: number; rollupMethod?: (typeof s.rollupMethod.enumValues)[number]; children?: SubtaskSeed[] }
interface BenchmarkDefinition {
  slug: string;
  name: string;
  kind: 'capability' | 'performance';
  summary: string;
  homepageUrl?: string;
  methodology?: string;
  metrics: { key: string; label: string; unit: string; higherIsBetter?: boolean }[];
  headlineMetric: string;
  rollupMethod: (typeof s.rollupMethod.enumValues)[number];
  headlineConfig?: EvaluationConfigInput;
  subtasks?: SubtaskSeed[];
}

/**
 * The benchmarks Mutinai ingests independent results for, described exactly as their sources publish them: the
 * subtask keys are the source's own keys, so an adapter maps a column or a score file to a row by name.
 *
 * None of these carry results here. Whether a benchmark's results may be ingested is a property of its
 * `result_source`, which LiveBench's is not yet cleared for.
 */
export const benchmarkDefinitions: BenchmarkDefinition[] = [
  {
    slug: 'livebench',
    name: 'LiveBench',
    kind: 'capability',
    homepageUrl: 'https://livebench.ai',
    summary: 'Contamination-limited benchmark whose questions are refreshed on a schedule, scored per task.',
    methodology:
      'Per-task scores from the leaderboard table for a given release date. Category averages are the mean of a category\'s tasks and the global average is the mean of the categories, both computed here rather than read from the table.',
    metrics: [{ key: 'score', label: 'Score', unit: '%' }],
    headlineMetric: 'score',
    rollupMethod: 'mean_of_subtasks',
    // Categories and tasks as published in public/categories_<date>.json (read at 2026-06-25).
    subtasks: [
      { key: 'reasoning', label: 'Reasoning', children: [
        { key: 'theory_of_mind', label: 'Theory of mind' }, { key: 'zebra_puzzle', label: 'Zebra puzzle' },
        { key: 'spatial', label: 'Spatial' }, { key: 'logic_with_navigation', label: 'Logic with navigation' }] },
      { key: 'coding', label: 'Coding', children: [
        { key: 'code_generation', label: 'Code generation' }, { key: 'code_completion', label: 'Code completion' }] },
      { key: 'agentic_coding', label: 'Agentic coding', children: [
        { key: 'javascript', label: 'JavaScript' }, { key: 'typescript', label: 'TypeScript' }, { key: 'python', label: 'Python' }] },
      { key: 'mathematics', label: 'Mathematics', children: [
        { key: 'AMPS_Hard', label: 'AMPS Hard' }, { key: 'integrals_with_game', label: 'Integrals with game' },
        { key: 'math_comp', label: 'Math competition' }, { key: 'olympiad', label: 'Olympiad' }] },
      { key: 'data_analysis', label: 'Data analysis', children: [
        { key: 'consecutive_events', label: 'Consecutive events' }, { key: 'tablejoin', label: 'Table join' },
        { key: 'tablereformat', label: 'Table reformat' }] },
      { key: 'language', label: 'Language', children: [
        { key: 'connections', label: 'Connections' }, { key: 'plot_unscrambling', label: 'Plot unscrambling' },
        { key: 'typos', label: 'Typos' }] },
      { key: 'if', label: 'Instruction following', children: [
        { key: 'paraphrase', label: 'Paraphrase' }, { key: 'simplify', label: 'Simplify' },
        { key: 'story_generation', label: 'Story generation' }, { key: 'summarize', label: 'Summarize' }] },
    ],
  },
  {
    slug: 'bfcl',
    name: 'Berkeley Function Calling Leaderboard',
    kind: 'capability',
    homepageUrl: 'https://gorilla.cs.berkeley.edu/leaderboard.html',
    summary: 'Executable evaluation of function calling across single-turn, multi-turn and agentic categories.',
    methodology:
      'Per-category accuracy with its correct and total counts, as the harness writes them. The overall is recomputed here from those counts using the harness\'s own mixture: an unweighted mean within the non-live, multi-turn and agentic groups, a sample-weighted mean within the live group, and a fixed percentage weighting across groups.',
    metrics: [{ key: 'accuracy', label: 'Accuracy', unit: '%' }],
    headlineMetric: 'accuracy',
    rollupMethod: 'weighted_subtasks',
    /**
     * Group weights are the harness's `[10, 10, 10, 30, 40]` over non-live, live, irrelevance, multi-turn and
     * agentic. Agentic is the unweighted mean of its web-search and memory summaries, so it is stored as two
     * groups of 20 — arithmetically the same, and it keeps the tree one level deep.
     */
    subtasks: [
      { key: 'non_live', label: 'Non-live', weight: 10, rollupMethod: 'mean_of_subtasks', children: [
        { key: 'simple_python', label: 'Simple (Python)' }, { key: 'simple_java', label: 'Simple (Java)' },
        { key: 'simple_javascript', label: 'Simple (JavaScript)' }, { key: 'multiple', label: 'Multiple' },
        { key: 'parallel', label: 'Parallel' }, { key: 'parallel_multiple', label: 'Parallel multiple' }] },
      { key: 'live', label: 'Live', weight: 10, rollupMethod: 'pooled_samples', children: [
        { key: 'live_simple', label: 'Live simple' }, { key: 'live_multiple', label: 'Live multiple' },
        { key: 'live_parallel', label: 'Live parallel' }, { key: 'live_parallel_multiple', label: 'Live parallel multiple' }] },
      { key: 'irrelevance', label: 'Irrelevance and relevance', weight: 10, rollupMethod: 'mean_of_subtasks', children: [
        { key: 'irrelevance_non_live', label: 'Irrelevance (non-live)' }, { key: 'live_irrelevance', label: 'Irrelevance (live)' },
        { key: 'live_relevance', label: 'Relevance (live)' }] },
      { key: 'multi_turn', label: 'Multi turn', weight: 30, rollupMethod: 'mean_of_subtasks', children: [
        { key: 'multi_turn_base', label: 'Base' }, { key: 'multi_turn_miss_func', label: 'Missing function' },
        { key: 'multi_turn_miss_param', label: 'Missing parameter' }, { key: 'multi_turn_long_context', label: 'Long context' }] },
      { key: 'web_search', label: 'Web search', weight: 20, rollupMethod: 'mean_of_subtasks', children: [
        { key: 'web_search_base', label: 'Base' }, { key: 'web_search_no_snippet', label: 'No snippet' }] },
      { key: 'memory', label: 'Memory', weight: 20, rollupMethod: 'mean_of_subtasks', children: [
        { key: 'memory_kv', label: 'Key-value' }, { key: 'memory_vector', label: 'Vector' },
        { key: 'memory_rec_sum', label: 'Recursive summarization' }] },
    ],
  },
  {
    slug: 'aider-polyglot',
    name: 'Aider polyglot',
    kind: 'capability',
    homepageUrl: 'https://aider.chat/docs/leaderboards/',
    summary: 'Aider edits 225 Exercism exercises across six languages and runs each exercise\'s own tests.',
    methodology:
      'Share of the 225 exercises whose tests pass, reported by the harness at one attempt and at two. The leaderboard privileges the two-attempt figure; both are stored, distinguished by configuration rather than by metric. The harness publishes no per-language breakdown, so there are no subtasks.',
    metrics: [
      { key: 'pass_rate', label: 'Cases passing', unit: '%' },
      { key: 'well_formed_rate', label: 'Cases with well-formed edits', unit: '%' },
    ],
    headlineMetric: 'pass_rate',
    rollupMethod: 'none',
    headlineConfig: { label: 'agentic editing, 2 attempts', promptMode: 'agentic', attempts: 2 },
  },
];

/**
 * Creates the benchmarks Mutinai ingests independent results for, with their metrics and the subtask tree the
 * source publishes. Idempotent, and never rewrites a benchmark that already exists: subtasks only gain rows.
 */
export async function ensureBenchmarkDefinitions(db: Executor): Promise<{ ids: Map<string, string>; created: number }> {
  const ids = new Map<string, string>();
  let created = 0;
  for (const def of benchmarkDefinitions) {
    const [existing] = await db.select({ id: s.entity.id }).from(s.entity).where(and(eq(s.entity.kind, 'benchmark'), eq(s.entity.slug, def.slug)));
    let id = existing?.id;
    if (!id) {
      id = await createEntity(db, { kind: 'benchmark', slug: def.slug, name: def.name, summary: def.summary });
      await db.insert(s.benchmark).values({ id, benchmarkKind: def.kind, homepageUrl: def.homepageUrl, methodology: def.methodology, rollupMethod: def.rollupMethod });
      created += 1;
    }
    const metricIds = new Map<string, string>();
    for (const m of def.metrics) {
      const [found] = await db
        .select({ id: s.benchmarkMetric.id })
        .from(s.benchmarkMetric)
        .where(and(eq(s.benchmarkMetric.benchmarkId, id), eq(s.benchmarkMetric.key, m.key)));
      if (found) { metricIds.set(m.key, found.id); continue; }
      const [row] = await db
        .insert(s.benchmarkMetric)
        .values({ benchmarkId: id, key: m.key, label: m.label, unit: m.unit, higherIsBetter: m.higherIsBetter ?? true })
        .returning({ id: s.benchmarkMetric.id });
      metricIds.set(m.key, row!.id);
    }
    const headlineConfigId = def.headlineConfig ? await ensureEvaluationConfig(db, def.headlineConfig) : null;
    await db
      .update(s.benchmark)
      .set({ headlineMetricId: metricIds.get(def.headlineMetric)!, headlineConfigId, rollupMethod: def.rollupMethod })
      .where(eq(s.benchmark.id, id));

    const upsertSubtask = async (node: SubtaskSeed, parentId: string | null, position: number) => {
      const [found] = await db
        .select({ id: s.benchmarkSubtask.id })
        .from(s.benchmarkSubtask)
        .where(and(eq(s.benchmarkSubtask.benchmarkId, id!), eq(s.benchmarkSubtask.key, node.key)));
      const subtaskId = found
        ? found.id
        : (await db
            .insert(s.benchmarkSubtask)
            .values({ benchmarkId: id!, parentId, key: node.key, label: node.label, weight: node.weight, rollupMethod: node.rollupMethod, position })
            .returning({ id: s.benchmarkSubtask.id }))[0]!.id;
      for (const [i, child] of (node.children ?? []).entries()) await upsertSubtask(child, subtaskId, i);
    };
    for (const [i, node] of (def.subtasks ?? []).entries()) await upsertSubtask(node, null, i);
    ids.set(def.slug, id);
  }
  return { ids, created };
}
