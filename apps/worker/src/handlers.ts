import { refreshSearchText, type Database } from '@mutinai/db';

export type JobHandler = (db: Database, payload: Record<string, unknown>, log: (msg: string) => void) => Promise<void>;

/**
 * Job handlers keyed by job kind. Unknown kinds fail and retry, so emitters can be deployed before handlers.
 */
export const handlers: Record<string, JobHandler> = {
  'search.reindex_entity': async (db, payload) => {
    await refreshSearchText(db, [String(payload.entityId)]);
  },
  // Compatibility is computed on read today. This is the hook for a precomputed compatibility table.
  'compat.invalidate': async (_db, payload, log) => {
    log(`compat.invalidate ${String(payload.entityId ?? payload.artifactId)}: no precomputed compatibility cache yet`);
  },
  // Extension point for AI enrichment. Output must go to ecosystem.derived_content, never canonical columns.
  'enrich.entity': async (_db, payload, log) => {
    log(`enrich.entity ${String(payload.entityId)}: AI enrichment not configured`);
  },
};
