/**
 * Enrichment provider selection. No vendor is bundled: enrichment stays disabled until an implementation of
 * `EnrichmentProvider` is registered below and selected with MUTINAI_ENRICHMENT_PROVIDER. See docs/ai-enrichment.md.
 */
import type { EnrichmentProvider } from '@mutinai/domain';

export type ProviderFactory = (env: NodeJS.ProcessEnv) => EnrichmentProvider;

/** Register provider implementations here (each reads its own credentials from env and fails clearly without them). */
export const ENRICHMENT_PROVIDERS: Record<string, ProviderFactory> = {};

export function enrichmentProviderFromEnv(env: NodeJS.ProcessEnv = process.env, providers: Record<string, ProviderFactory> = ENRICHMENT_PROVIDERS): EnrichmentProvider | null {
  const name = env.MUTINAI_ENRICHMENT_PROVIDER?.trim();
  if (!name) return null;
  const factory = providers[name];
  if (!factory) {
    const known = Object.keys(providers);
    throw new Error(`MUTINAI_ENRICHMENT_PROVIDER=${name} has no implementation (${known.length ? `available: ${known.join(', ')}` : 'none are registered yet'}); unset it to keep enrichment disabled`);
  }
  return factory(env);
}
