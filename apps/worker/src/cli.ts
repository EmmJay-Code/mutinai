/**
 * Pure helpers for the worker command line: argument parsing, incremental windows and editorial mappings.
 */
import { parseArgs } from 'node:util';

export interface IngestFlags {
  limit?: number;
  since?: string;
  dryRun: boolean;
  repos?: string[];
  authors?: string[];
  known: boolean;
  derivatives: boolean;
  recheckUnresolved: boolean;
  feeds?: string[];
  /** Path to a CSV, for sources that read a researched file rather than a network endpoint. */
  file?: string;
}

export function parseCommand(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      limit: { type: 'string' },
      since: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      repos: { type: 'string' },
      feeds: { type: 'string' },
      file: { type: 'string' },
      authors: { type: 'string' },
      known: { type: 'boolean', default: false },
      derivatives: { type: 'boolean', default: false },
      'recheck-unresolved': { type: 'boolean', default: false },
      once: { type: 'boolean', default: false },
      source: { type: 'string' },
      reason: { type: 'string' },
      status: { type: 'string' },
      note: { type: 'string' },
    },
  });
  const list = (v: string | undefined) => v?.split(',').map((x) => x.trim()).filter(Boolean);
  let limit: number | undefined;
  if (values.limit != null) {
    limit = Number(values.limit);
    if (!Number.isInteger(limit) || limit < 1) throw new Error(`--limit must be a positive integer (got ${values.limit})`);
  }
  const ingest: IngestFlags = {
    limit,
    since: values.since,
    dryRun: values['dry-run'],
    repos: list(values.repos),
    authors: list(values.authors),
    known: values.known,
    derivatives: values.derivatives,
    recheckUnresolved: values['recheck-unresolved'],
    feeds: list(values.feeds),
    file: values.file,
  };
  return { positionals, ingest, once: values.once, source: values.source, reason: values.reason, status: values.status, note: values.note };
}

/**
 * `--since` accepts an ISO timestamp/date, a relative window (`36h`, `7d`), or `last-run` (resolved by the caller
 * from the source's last successful run). Returns null for `last-run`.
 */
export function parseSince(value: string, now = new Date()): Date | null {
  if (value === 'last-run') return null;
  const rel = /^(\d+)([hd])$/.exec(value);
  if (rel) return new Date(now.getTime() - Number(rel[1]) * (rel[2] === 'h' ? 3_600_000 : 86_400_000));
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`--since must be an ISO date, a window like 7d or 36h, or last-run (got ${value})`);
  return date;
}

/** Overlap applied to `last-run` windows so items modified during the previous run are not missed. */
export const LAST_RUN_OVERLAP_MS = 60 * 60 * 1000;

/** Window used by `last-run` when a source has never completed a run, so a first scheduled run stays bounded. */
export const FIRST_RUN_WINDOW_MS = 30 * 86_400_000;

export function lastRunSince(lastSucceededStart: Date | null, now = new Date()): Date {
  return lastSucceededStart ? new Date(lastSucceededStart.getTime() - LAST_RUN_OVERLAP_MS) : new Date(now.getTime() - FIRST_RUN_WINDOW_MS);
}

/** Identifier namespace a source's external ids live in (live and fixture sources share namespaces). */
export function namespaceForSource(source: { key: string; kind: string }): string | null {
  if (source.kind === 'huggingface' || source.key.includes('huggingface')) return 'huggingface';
  if (source.kind === 'github' || source.key.includes('github')) return 'github';
  if (source.kind === 'arxiv') return 'arxiv';
  return null;
}

/** What an editor maps when resolving a review item by linking it to an existing entity. */
export function linkTarget(item: { reason: string; subject: string; externalId: string }): { value: string; kinds: string[] } | null {
  switch (item.reason) {
    case 'unknown_base':
    case 'base_not_variant':
      return { value: item.subject, kinds: ['model_variant'] };
    case 'new_first_party_model':
    case 'possible_reupload':
    case 'first_party_variant_kind':
      return { value: item.externalId, kinds: ['model_variant'] };
    case 'unknown_project':
      return { value: item.externalId, kinds: ['project'] };
    default:
      return null;
  }
}
