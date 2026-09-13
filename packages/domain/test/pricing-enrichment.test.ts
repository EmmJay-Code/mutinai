import { describe, expect, it } from 'vitest';
import { ENRICHMENT_TASKS, enrichmentTask, validateEnrichmentOutput } from '../src/enrichment';
import { priceFreshness, validatePriceObservation, type PriceObservationCandidate } from '../src/pricing';

const now = new Date('2026-09-13T00:00:00Z');
const base: PriceObservationCandidate = { entityKind: 'hardware_device', priceKind: 'retail_new', amount: 1999, currency: 'USD', region: 'US', observedAt: new Date('2026-09-12T00:00:00Z'), sourceName: 'Retailer API', sourceUrl: 'https://example.com/p/1' };

describe('price observations', () => {
  it('accepts sourced, dated, market-specific retail prices', () => {
    expect(validatePriceObservation(base, now)).toEqual({ ok: true });
    expect(validatePriceObservation({ ...base, priceKind: 'launch_msrp', region: null, sourceUrl: null, sourceName: 'NVIDIA announcement' }, now)).toEqual({ ok: true });
  });

  it('rejects unsourced market prices, bad codes, future times and non-hardware subjects', () => {
    const result = validatePriceObservation({ ...base, entityKind: 'model', currency: 'usd', region: 'USA', sourceUrl: null, observedAt: new Date('2027-01-01T00:00:00Z'), amount: -5 }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toMatch(/hardware, not model/);
      expect(result.errors.join('\n')).toMatch(/ISO 4217/);
      expect(result.errors.join('\n')).toMatch(/ISO 3166/);
      expect(result.errors.join('\n')).toMatch(/must cite/);
      expect(result.errors.join('\n')).toMatch(/future/);
      expect(result.errors.join('\n')).toMatch(/implausible amount/);
    }
    const noRegion = validatePriceObservation({ ...base, priceKind: 'used', region: null }, now);
    expect(noRegion.ok).toBe(false);
  });

  it('treats launch prices as historical and market prices as perishable', () => {
    expect(priceFreshness('launch_msrp', new Date('2020-01-01'), now)).toBe('historical');
    expect(priceFreshness('retail_new', new Date('2026-09-10'), now)).toBe('current');
    expect(priceFreshness('retail_new', new Date('2026-08-01'), now)).toBe('stale');
    expect(priceFreshness('used', new Date('2026-09-01'), now)).toBe('current');
  });
});

describe('enrichment contract', () => {
  it('defines grounded tasks with explicit prompt versions', () => {
    for (const task of ENRICHMENT_TASKS) {
      expect(task.promptVersion).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
      const request = task.build({ subject: { kind: task.id.startsWith('event') ? 'event' : 'entity', id: 'x', type: task.id.startsWith('event') ? 'runtime_release' : 'model', name: 'Thing' }, facts: { a: 1 }, sourceRecordIds: [] });
      expect(request.instructions).toMatch(/Use only the facts provided/);
      expect(JSON.parse(request.input)).toMatchObject({ facts: { a: 1 } });
    }
    expect(enrichmentTask('entity.plain_summary')!.appliesTo({ kind: 'entity', id: 'x', type: 'quantization_scheme', name: 'Q4_K_M' })).toBe(false);
  });

  it('rejects empty, overlong or link-introducing output', () => {
    expect(validateEnrichmentOutput('A small model.', { maxOutputChars: 100 })).toEqual({ ok: true });
    expect(validateEnrichmentOutput('  ', { maxOutputChars: 100 }).ok).toBe(false);
    expect(validateEnrichmentOutput('x'.repeat(101), { maxOutputChars: 100 }).ok).toBe(false);
    expect(validateEnrichmentOutput('See https://example.com', { maxOutputChars: 100 }).ok).toBe(false);
  });
});
