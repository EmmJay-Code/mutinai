/**
 * Berkeley Function Calling Leaderboard — the first independent benchmark source.
 *
 * BFCL runs every model itself, so its results are `benchmark_operator` evidence (ADR-0010). Its repository
 * (`ShishirPatil/gorilla`) is Apache-2.0 at the root and its README grants the statistics explicitly: "All the
 * leaderboard statistics, and data used to train the models are released under Apache 2.0."
 *
 * Two files are read, and neither is scraped from HTML:
 *
 * - `https://gorilla.cs.berkeley.edu/data_overall.csv` — the published leaderboard, whose columns are
 *   `COLUMNS_OVERALL` in `bfcl_eval/constants/column_headers.py`.
 * - `bfcl_eval/constants/model_config.py` — the identity map. The CSV names models by *display name*
 *   ("Llama-3.3-70B-Instruct (FC)"); only this file carries the Hugging Face repo id behind it.
 *
 * What this adapter deliberately does not do: it never invents a score. BFCL's own category numbers are stored as
 * they are published, and the overall is recomputed from them by `benchmark_run_rollup` using BFCL's own arithmetic
 * (see the `bfcl` entry in `benchmarkDefinitions`, `packages/db/src/reference.ts`). The leaderboard's printed overall is kept on the run as
 * `reported_rollup_value` for reconciliation only.
 */
import { parseCsv } from './hardware-specs';

export const BFCL_LEADERBOARD_URL = 'https://gorilla.cs.berkeley.edu/data_overall.csv';
export const BFCL_MODEL_CONFIG_URL =
  'https://raw.githubusercontent.com/ShishirPatil/gorilla/main/berkeley-function-call-leaderboard/bfcl_eval/constants/model_config.py';
export const BFCL_CITATION_URL = 'https://gorilla.cs.berkeley.edu/leaderboard.html';

/** The dataset generation the published table is scored against (`bfcl_eval/data/BFCL_v4_*.json`). */
export const BFCL_VERSION = 'BFCL_v4';

/**
 * The 18 published columns that are scored, and the subtask they belong to.
 *
 * Only these enter the rollup. The group summaries BFCL also prints (`Non-Live AST Acc`, `Live Acc`, …) are
 * recomputed from these, and `Relevance Detection` is excluded because BFCL itself excludes it from the overall:
 * `eval_runner_helper.py` computes `total_relevance` and then does not pass it to the weighting. Both are kept in
 * the run's raw payload rather than stored as facts.
 */
export const BFCL_SCORE_COLUMNS: Readonly<Record<string, string>> = {
  'Non-Live Simple AST': 'non_live_simple',
  'Non-Live Multiple AST': 'non_live_multiple',
  'Non-Live Parallel AST': 'non_live_parallel',
  'Non-Live Parallel Multiple AST': 'non_live_parallel_multiple',
  'Live Simple AST': 'live_simple',
  'Live Multiple AST': 'live_multiple',
  'Live Parallel AST': 'live_parallel',
  'Live Parallel Multiple AST': 'live_parallel_multiple',
  'Irrelevance Detection': 'irrelevance',
  'Multi Turn Base': 'multi_turn_base',
  'Multi Turn Miss Func': 'multi_turn_miss_func',
  'Multi Turn Miss Param': 'multi_turn_miss_param',
  'Multi Turn Long Context': 'multi_turn_long_context',
  'Web Search Base': 'web_search_base',
  'Web Search No Snippet': 'web_search_no_snippet',
  'Memory KV': 'memory_kv',
  'Memory Vector': 'memory_vector',
  'Memory Recursive Summarization': 'memory_rec_sum',
};

/** Columns kept as provenance on the run: presentation, cost, latency, and BFCL's own recomputable summaries. */
const RAW_COLUMNS = [
  'Rank',
  'Overall Acc',
  'Model Link',
  'Total Cost ($)',
  'Latency Mean (s)',
  'Latency Standard Deviation (s)',
  'Latency 95th Percentile (s)',
  'Non-Live AST Acc',
  'Live Acc',
  'Multi Turn Acc',
  'Web Search Acc',
  'Memory Acc',
  'Relevance Detection',
  'Format Sensitivity Max Delta',
  'Format Sensitivity Standard Deviation',
  'Organization',
  'License',
] as const;

export interface BfclModelConfig {
  /** The mapping key, e.g. `meta-llama/Llama-3.3-70B-Instruct-FC`. */
  key: string;
  /** The model as the vendor API or Hugging Face names it. Only an id containing `/` is treated as a repo id. */
  modelName: string;
  /** How the row is labelled in the CSV, e.g. `Llama-3.3-70B-Instruct (FC)`. */
  displayName: string;
  org?: string;
  license?: string;
  url?: string;
  isFunctionCalling: boolean;
}

/**
 * Reads `model_config.py` without executing it. The file is a flat mapping of string keys to `ModelConfig(...)`
 * literals whose scalar fields are plain string/bool literals, so the fields are read individually rather than the
 * call being parsed as an expression — a handler reference or a new keyword argument cannot break it.
 */
export function parseBfclModelConfig(text: string): BfclModelConfig[] {
  const out: BfclModelConfig[] = [];
  const entry = /"([^"]+)"\s*:\s*ModelConfig\(([\s\S]*?)\n\s*\),/g;
  for (const [, key, body] of text.matchAll(entry)) {
    const str = (field: string) => body!.match(new RegExp(`\\b${field}\\s*=\\s*"([^"]*)"`))?.[1];
    const modelName = str('model_name');
    const displayName = str('display_name');
    if (!modelName || !displayName) continue;
    out.push({
      key: key!,
      modelName,
      displayName,
      org: str('org'),
      license: str('license'),
      url: str('url'),
      isFunctionCalling: /\bis_fc_model\s*=\s*True\b/.test(body!),
    });
  }
  return out;
}

/** A Hugging Face repo id is an owner/name pair; a bare vendor API name (`qwen3-32b`) is not one. */
const isRepoId = (name: string) => /^[^/\s]+\/[^/\s]+$/.test(name);

export type BfclResolution =
  | { kind: 'resolved'; huggingFaceId: string; configs: BfclModelConfig[] }
  | { kind: 'unresolved'; reason: 'no_huggingface_id' | 'ambiguous_huggingface_id' | 'unknown_model'; detail: string };

/**
 * Resolves a leaderboard row's display name to a Hugging Face repo id.
 *
 * Display names are not unique: BFCL registers the same weights twice when it evaluates them both through a vendor
 * API and from the Hub, so `Qwen3-32B (FC)` matches both `qwen3-32b-FC` and `Qwen/Qwen3-32B-FC`. Those name one
 * model, and exactly one of them carries the repo id, so the row still resolves. If two candidates ever name
 * *different* repos the row is refused rather than guessed — nothing here matches on name similarity.
 */
export function resolveBfclModel(displayName: string, configs: readonly BfclModelConfig[]): BfclResolution {
  const candidates = configs.filter((c) => c.displayName === displayName);
  if (candidates.length === 0) return { kind: 'unresolved', reason: 'unknown_model', detail: 'no model_config entry' };
  const ids = [...new Set(candidates.map((c) => c.modelName).filter(isRepoId))];
  if (ids.length === 0) {
    return { kind: 'unresolved', reason: 'no_huggingface_id', detail: candidates.map((c) => c.modelName).join(', ') };
  }
  if (ids.length > 1) return { kind: 'unresolved', reason: 'ambiguous_huggingface_id', detail: ids.join(', ') };
  return { kind: 'resolved', huggingFaceId: ids[0]!, configs: candidates };
}

export interface BfclRun {
  /** Stable across re-ingestion: the dataset generation and the model as BFCL keys it. */
  dedupeKey: string;
  displayName: string;
  huggingFaceId: string;
  /** BFCL evaluates a model in function-calling mode or prompt mode; that is a configuration, never a variant. */
  functionCalling: boolean;
  /** The overall BFCL printed, kept for reconciliation and never shown as a measurement. */
  reportedOverall: number | null;
  /** One entry per scored category, in published order. */
  scores: { subtaskKey: string; value: number }[];
  raw: Record<string, unknown>;
}

export type BfclSkipReason = 'no_huggingface_id' | 'ambiguous_huggingface_id' | 'unknown_model' | 'incomplete_scores';

export interface BfclSkip {
  displayName: string;
  reason: BfclSkipReason;
  detail: string;
}

/** `"77.47%"` → `77.47`; `"N/A"`, `""` and anything unparseable → null. */
export function parsePercent(raw: string | undefined): number | null {
  const text = (raw ?? '').trim().replace(/%$/, '');
  if (text === '' || text.toUpperCase() === 'N/A') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export interface BfclParseResult {
  runs: BfclRun[];
  skipped: BfclSkip[];
}

/**
 * Turns the published leaderboard into runs, one per row that resolves to a Hugging Face repo.
 *
 * A row missing any scored category is skipped rather than stored: BFCL treats an unevaluated category as zero when
 * it computes its own overall, whereas a rollup over the categories that happen to be present would quietly rescale
 * and produce a number neither side ever published.
 */
export function parseBfclLeaderboard(csv: string, configs: readonly BfclModelConfig[]): BfclParseResult {
  const [header, ...rows] = parseCsv(csv);
  if (!header) return { runs: [], skipped: [] };
  const index = new Map(header.map((name, i) => [name.trim(), i]));
  const runs: BfclRun[] = [];
  const skipped: BfclSkip[] = [];
  const modelAt = index.get('Model');
  if (modelAt === undefined) return { runs: [], skipped: [] };

  for (const row of rows) {
    const displayName = (row[modelAt] ?? '').trim();
    if (!displayName) continue;
    const resolution = resolveBfclModel(displayName, configs);
    if (resolution.kind === 'unresolved') {
      skipped.push({ displayName, reason: resolution.reason, detail: resolution.detail });
      continue;
    }
    const cell = (column: string) => {
      const at = index.get(column);
      return at === undefined ? undefined : row[at];
    };
    const scores: BfclRun['scores'] = [];
    let missing: string | null = null;
    for (const [column, subtaskKey] of Object.entries(BFCL_SCORE_COLUMNS)) {
      const value = parsePercent(cell(column));
      if (value === null) { missing = column; break; }
      scores.push({ subtaskKey, value });
    }
    if (missing) {
      skipped.push({ displayName, reason: 'incomplete_scores', detail: `${missing} not published for this model` });
      continue;
    }
    const raw: Record<string, unknown> = { bfcl_model_keys: resolution.configs.map((c) => c.key), bfcl_version: BFCL_VERSION };
    for (const column of RAW_COLUMNS) {
      const value = cell(column);
      if (value !== undefined && value.trim() !== '') raw[column] = value.trim();
    }
    const config = resolution.configs[0]!;
    runs.push({
      // One row per (model, mode) per generation; the mode is already part of BFCL's own key.
      dedupeKey: `bfcl:${BFCL_VERSION}:${config.key}`,
      displayName,
      huggingFaceId: resolution.huggingFaceId,
      functionCalling: config.isFunctionCalling,
      reportedOverall: parsePercent(cell('Overall Acc')),
      scores,
      raw,
    });
  }
  return { runs, skipped };
}
