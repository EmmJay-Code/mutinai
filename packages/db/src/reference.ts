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
import { refreshSearchText } from './search-text';
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
    datasetUrl: 'https://github.com/LiveBench/new-livebench/tree/main/public',
    redistribution: 'unverified',
    ingestionEnabled: false,
    priority: 50,
    permissionNote:
      'Blocked. The harness repository (LiveBench/LiveBench) carries an Apache-2.0 LICENSE, but the leaderboard tables are published from LiveBench/new-livebench — the repository whose gh-pages branch serves livebench.ai — which carries no licence file of its own. The datasheet grant describes the question set on Hugging Face, not the score tables, so Apache demonstrably covers the code and the questions, and not demonstrably the tables. Unblock only on an explicit statement from the maintainers that Apache-2.0 covers public/table_*.csv; then set redistribution to attribution_required with the credit line, and enable. Asked 2026-09-17 at https://github.com/LiveBench/new-livebench/issues/53 — that issue is the pending decision.',
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
      'Per-category accuracy as the published leaderboard reports it. The overall is recomputed here from those categories using the harness\'s own mixture (bfcl_eval/eval_checker/eval_runner_helper.py): an unweighted mean within the non-live, multi-turn and agentic groups, a question-count-weighted mean within the live group, and a fixed percentage weighting across groups. BFCL publishes no per-category counts, so the live weights are the fixed BFCL_v4 question counts and no result carries a sample count.',
    metrics: [{ key: 'accuracy', label: 'Accuracy', unit: '%' }],
    headlineMetric: 'accuracy',
    rollupMethod: 'weighted_subtasks',
    /**
     * The group weights are the harness's `[10, 10, 10, 30, 40]` over non-live, live, irrelevance, multi-turn and
     * agentic. Agentic is the unweighted mean of its web-search and memory summaries, so it is stored as two groups
     * of 20 — arithmetically identical, and it keeps the tree one level deep.
     *
     * Two things here are not guesses about BFCL but readings of its code:
     *
     * - Non-live means four terms, not six. `Simple AST` is already the mean of the Python, Java and JavaScript
     *   simple categories, and the leaderboard publishes that sub-mean rather than its parts, so the published
     *   column is stored as one leaf.
     * - Live is weighted by question count, not evaluated unweighted. The counts are fixed properties of the
     *   BFCL_v4 dataset (`bfcl_eval/data/BFCL_v4_live_*.json`: 258, 1053, 16, 24), so they are leaf weights here.
     *   That reproduces `calculate_weighted_accuracy` exactly without inventing a per-model sample count.
     *
     * `Relevance Detection` is published but is deliberately absent: the harness computes it and then does not
     * include it in the overall. It is kept in the run's raw payload instead of being stored as a fact.
     */
    subtasks: [
      { key: 'non_live', label: 'Non-live', weight: 10, rollupMethod: 'mean_of_subtasks', children: [
        { key: 'non_live_simple', label: 'Simple AST' }, { key: 'non_live_multiple', label: 'Multiple AST' },
        { key: 'non_live_parallel', label: 'Parallel AST' }, { key: 'non_live_parallel_multiple', label: 'Parallel multiple AST' }] },
      { key: 'live', label: 'Live', weight: 10, rollupMethod: 'weighted_subtasks', children: [
        { key: 'live_simple', label: 'Live simple AST', weight: 258 },
        { key: 'live_multiple', label: 'Live multiple AST', weight: 1053 },
        { key: 'live_parallel', label: 'Live parallel AST', weight: 16 },
        { key: 'live_parallel_multiple', label: 'Live parallel multiple AST', weight: 24 }] },
      // Published as one number that is already the mean of the non-live and live irrelevance categories.
      { key: 'irrelevance', label: 'Irrelevance detection', weight: 10, rollupMethod: 'mean_of_subtasks' },
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
      const shape = { parentId, label: node.label, weight: node.weight ?? null, rollupMethod: node.rollupMethod ?? null, position };
      // Updated rather than left alone: a correction to how a benchmark rolls up has to reach databases that
      // already hold the old shape, or the arithmetic silently stays wrong wherever it was first seeded.
      if (found) await db.update(s.benchmarkSubtask).set(shape).where(eq(s.benchmarkSubtask.id, found.id));
      const subtaskId = found
        ? found.id
        : (await db
            .insert(s.benchmarkSubtask)
            .values({ benchmarkId: id!, key: node.key, ...shape })
            .returning({ id: s.benchmarkSubtask.id }))[0]!.id;
      for (const [i, child] of (node.children ?? []).entries()) await upsertSubtask(child, subtaskId, i);
    };
    for (const [i, node] of (def.subtasks ?? []).entries()) await upsertSubtask(node, null, i);
    ids.set(def.slug, id);
  }
  return { ids, created };
}

// ─── Everyday hardware ───────────────────────────────────────────────────────

/**
 * The machines most people already own, so "What can I run?" has a starting point for someone without a graphics
 * card or a high-memory Mac. The fixture catalog's reference systems are enthusiast builds; these are ordinary ones.
 * Specifications are the manufacturers' published figures (unified memory bandwidth from Apple's tech specs pages:
 * M1 68.25 GB/s, M2 and M3 100 GB/s, M4 120 GB/s; DDR5-5600 dual channel for the laptop). macOS lets the GPU use about
 * two thirds of unified memory on machines of 36 GB or less, hence the usable fraction.
 *
 * Idempotent: missing entries are created, existing ones are left exactly as they are (an editorial import may have
 * refined them since).
 */
export const everydayDevices = [
  { slug: 'apple-m1', name: 'Apple M1', vendor: 'apple', deviceKind: 'soc', memoryKind: 'unified', memoryType: 'LPDDR4X', memoryBandwidthGbps: 68.25, unifiedUsableFraction: 0.67, backends: ['metal', 'cpu'], releasedOn: '2020-11-17', summary: 'Apple’s first Mac chip; unified memory up to 16 GB.' },
  { slug: 'apple-m2', name: 'Apple M2', vendor: 'apple', deviceKind: 'soc', memoryKind: 'unified', memoryType: 'LPDDR5', memoryBandwidthGbps: 100, unifiedUsableFraction: 0.67, backends: ['metal', 'cpu'], releasedOn: '2022-06-24', summary: 'Base M2 chip; unified memory up to 24 GB.' },
  { slug: 'apple-m3', name: 'Apple M3', vendor: 'apple', deviceKind: 'soc', memoryKind: 'unified', memoryType: 'LPDDR5', memoryBandwidthGbps: 100, unifiedUsableFraction: 0.67, backends: ['metal', 'cpu'], releasedOn: '2023-11-07', summary: 'Base M3 chip; unified memory up to 24 GB.' },
  { slug: 'apple-m4', name: 'Apple M4', vendor: 'apple', deviceKind: 'soc', memoryKind: 'unified', memoryType: 'LPDDR5X', memoryBandwidthGbps: 120, unifiedUsableFraction: 0.67, backends: ['metal', 'cpu'], releasedOn: '2024-11-08', summary: 'Base M4 chip; unified memory up to 32 GB.' },
  { slug: 'intel-core-ultra-7-155h', name: 'Intel Core Ultra 7 155H', vendor: 'intel', deviceKind: 'cpu', memoryKind: 'none', memoryType: undefined, memoryBandwidthGbps: undefined, unifiedUsableFraction: undefined, backends: ['cpu'], releasedOn: '2023-12-14', summary: 'A common laptop processor (Meteor Lake) with integrated graphics only.' },
] as const;

export const everydayConfigurations = [
  { slug: 'macbook-air-m1-8gb', name: 'MacBook Air M1 8 GB', formFactor: 'laptop', device: 'apple-m1', unifiedMemoryGb: 8, summary: 'The most common entry-level Mac laptop: 8 GB of unified memory.' },
  { slug: 'macbook-air-m2-16gb', name: 'MacBook Air M2 16 GB', formFactor: 'laptop', device: 'apple-m2', unifiedMemoryGb: 16, summary: 'Everyday Mac laptop with 16 GB of unified memory.' },
  { slug: 'macbook-air-m3-16gb', name: 'MacBook Air M3 16 GB', formFactor: 'laptop', device: 'apple-m3', unifiedMemoryGb: 16, summary: 'Everyday Mac laptop with 16 GB of unified memory.' },
  { slug: 'macbook-air-m4-16gb', name: 'MacBook Air M4 16 GB', formFactor: 'laptop', device: 'apple-m4', unifiedMemoryGb: 16, summary: 'Current everyday Mac laptop; 16 GB is the base memory.' },
  { slug: 'mac-mini-m4-16gb', name: 'Mac mini M4 16 GB', formFactor: 'mini_pc', device: 'apple-m4', unifiedMemoryGb: 16, summary: 'Entry Mac desktop with 16 GB of unified memory.' },
  { slug: 'windows-laptop-16gb', name: 'Windows laptop 16 GB (no graphics card)', formFactor: 'laptop', device: 'intel-core-ultra-7-155h', systemRamGb: 16, systemRamBandwidthGbps: 89.6, summary: 'A typical recent laptop without a separate graphics card: models run on the processor and its 16 GB of RAM.' },
] as const;

const everydayOrganizations = [
  { slug: 'apple', name: 'Apple', orgKind: 'hardware_vendor', websiteUrl: 'https://www.apple.com', country: 'US', summary: 'Apple silicon with unified memory; maintains MLX.' },
  { slug: 'intel', name: 'Intel', orgKind: 'hardware_vendor', websiteUrl: 'https://www.intel.com', country: 'US', summary: 'CPU and GPU vendor.' },
  { slug: 'lm-studio', name: 'LM Studio', orgKind: 'company', websiteUrl: 'https://lmstudio.ai', country: 'US', summary: 'Company behind the LM Studio desktop app.' },
] as const;

/** Tools a beginner is sent to by name, which the catalog must therefore hold. */
export const everydayProjects = [
  {
    slug: 'lm-studio', name: 'LM Studio', category: 'ui', maintainer: 'lm-studio', homepageUrl: 'https://lmstudio.ai', repoUrl: 'https://github.com/lmstudio-ai/lms', language: 'TypeScript',
    summary: 'Desktop app for finding, downloading and chatting with local models, with a built-in local server. Runs GGUF models through llama.cpp, and MLX models on Macs.',
  },
] as const;

async function entityId(db: Executor, kind: (typeof s.entityKind.enumValues)[number], slug: string): Promise<string | undefined> {
  const [row] = await db.select({ id: s.entity.id }).from(s.entity).where(and(eq(s.entity.kind, kind), eq(s.entity.slug, slug)));
  return row?.id;
}

export async function ensureEverydayHardware(db: Executor): Promise<{ created: string[] }> {
  const created: string[] = [];
  const orgs = new Map<string, string>();
  for (const o of everydayOrganizations) {
    let id = await entityId(db, 'organization', o.slug);
    if (!id) {
      id = await createEntity(db, { kind: 'organization', slug: o.slug, name: o.name, summary: o.summary });
      await db.insert(s.organization).values({ id, orgKind: o.orgKind, recognized: true, websiteUrl: o.websiteUrl, country: o.country });
      created.push(id);
    }
    orgs.set(o.slug, id);
  }
  const devices = new Map<string, string>();
  for (const d of everydayDevices) {
    let id = await entityId(db, 'hardware_device', d.slug);
    if (!id) {
      id = await createEntity(db, { kind: 'hardware_device', slug: d.slug, name: d.name, summary: d.summary, aliases: [d.name.replace(/^(Apple|Intel)\s+/, '')] });
      await db.insert(s.hardwareDevice).values({
        id, vendorOrgId: orgs.get(d.vendor)!, deviceKind: d.deviceKind, memoryKind: d.memoryKind, memoryGb: null, memoryType: d.memoryType ?? null,
        memoryBandwidthGbps: d.memoryBandwidthGbps ?? null, unifiedUsableFraction: d.unifiedUsableFraction ?? null, backends: [...d.backends], releasedOn: d.releasedOn,
      });
      created.push(id);
    }
    devices.set(d.slug, id);
  }
  for (const c of everydayConfigurations) {
    if (await entityId(db, 'hardware_configuration', c.slug)) continue;
    const id = await createEntity(db, { kind: 'hardware_configuration', slug: c.slug, name: c.name, summary: c.summary });
    await db.insert(s.hardwareConfiguration).values({
      id, formFactor: c.formFactor,
      systemRamGb: 'systemRamGb' in c ? c.systemRamGb : 0,
      systemRamBandwidthGbps: 'systemRamBandwidthGbps' in c ? c.systemRamBandwidthGbps : null,
      unifiedMemoryGb: 'unifiedMemoryGb' in c ? c.unifiedMemoryGb : null,
    });
    await db.insert(s.hardwareConfigurationComponent).values({ configurationId: id, deviceId: devices.get(c.device)!, count: 1 });
    created.push(id);
  }
  for (const p of everydayProjects) {
    if (await entityId(db, 'project', p.slug)) continue;
    const id = await createEntity(db, { kind: 'project', slug: p.slug, name: p.name, summary: p.summary, aliases: ['lmstudio'] });
    await db.insert(s.project).values({ id, category: p.category, maintainerOrgId: orgs.get(p.maintainer)!, repoUrl: p.repoUrl, homepageUrl: p.homepageUrl, primaryLanguage: p.language });
    created.push(id);
  }
  if (created.length) await refreshSearchText(db, created);
  return { created };
}
