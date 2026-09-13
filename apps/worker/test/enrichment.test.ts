import { describe, expect, it } from 'vitest';
import { enrichmentProviderFromEnv } from '../src/enrichment';

describe('enrichment provider selection', () => {
  it('is disabled when no provider is configured', () => {
    expect(enrichmentProviderFromEnv({})).toBeNull();
    expect(enrichmentProviderFromEnv({ MUTINAI_ENRICHMENT_PROVIDER: '  ' })).toBeNull();
  });

  it('fails clearly for providers without an implementation', () => {
    expect(() => enrichmentProviderFromEnv({ MUTINAI_ENRICHMENT_PROVIDER: 'some-vendor' })).toThrow(/has no implementation \(none are registered yet\)/);
  });

  it('builds a registered provider, which reads its own credentials', () => {
    const provider = enrichmentProviderFromEnv({ MUTINAI_ENRICHMENT_PROVIDER: 'fake', FAKE_KEY: 'k' }, {
      fake: (env) => {
        if (!env.FAKE_KEY) throw new Error('FAKE_KEY is not set');
        return { id: 'fake', generate: async () => ({ text: 'ok', model: 'fake-1' }) };
      },
    });
    expect(provider?.id).toBe('fake');
    expect(() => enrichmentProviderFromEnv({ MUTINAI_ENRICHMENT_PROVIDER: 'fake' }, { fake: (env) => { if (!env.FAKE_KEY) throw new Error('FAKE_KEY is not set'); return { id: 'fake', generate: async () => ({ text: '', model: '' }) }; } })).toThrow(/FAKE_KEY/);
  });
});
