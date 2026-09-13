import { refreshSearchText, runEnrichment, type Database } from '@mutinai/db';
import { ENRICHMENT_TASKS } from '@mutinai/domain';
import { enrichmentProviderFromEnv } from './enrichment';

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
  // AI enrichment writes ecosystem.derived_content only (never canonical columns). Disabled unless a provider is configured.
  'enrich.entity': async (db, payload, log) => {
    const provider = enrichmentProviderFromEnv();
    if (!provider) {
      log(`enrich.entity ${String(payload.entityId)}: AI enrichment not configured`);
      return;
    }
    for (const task of ENRICHMENT_TASKS) {
      const outcome = await runEnrichment(db, provider, task, { kind: 'entity', id: String(payload.entityId) });
      if (outcome.status !== 'not_applicable') log(`enrich.entity ${String(payload.entityId)} ${task.id}: ${outcome.status}`);
    }
  },
};
