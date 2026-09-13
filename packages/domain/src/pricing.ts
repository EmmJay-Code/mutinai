/**
 * Hardware prices are dated, sourced observations. Launch MSRPs are historical facts; retail and used prices are
 * market observations that go stale; editorial estimates are labelled as such. See docs/hardware-data.md.
 */
import type { ValidationResult } from './ontology';

export const PRICE_KINDS = ['launch_msrp', 'retail_new', 'used', 'editorial_estimate'] as const;
export type PriceObservationKind = (typeof PRICE_KINDS)[number];

export const PRICEABLE_ENTITY_KINDS = ['hardware_device', 'hardware_configuration'] as const;

/** Days after which an observation of this kind is no longer shown as current. Launch MSRPs never go stale. */
export const PRICE_STALE_AFTER_DAYS: Record<PriceObservationKind, number | null> = {
  launch_msrp: null,
  retail_new: 7,
  used: 14,
  editorial_estimate: 180,
};

export interface PriceObservationCandidate {
  entityKind: string;
  priceKind: PriceObservationKind;
  amount: number;
  currency: string;
  region?: string | null;
  observedAt: Date;
  sourceName: string;
  sourceUrl?: string | null;
}

export function validatePriceObservation(p: PriceObservationCandidate, now = new Date()): ValidationResult {
  const errors: string[] = [];
  if (!(PRICEABLE_ENTITY_KINDS as readonly string[]).includes(p.entityKind)) errors.push(`prices apply to hardware, not ${p.entityKind}`);
  if (!(PRICE_KINDS as readonly string[]).includes(p.priceKind)) errors.push(`unknown price kind ${p.priceKind}`);
  if (!Number.isFinite(p.amount) || p.amount <= 0 || p.amount >= 10_000_000) errors.push(`implausible amount ${p.amount}`);
  if (!/^[A-Z]{3}$/.test(p.currency)) errors.push(`currency must be an ISO 4217 code (got ${p.currency})`);
  if (p.region != null && !/^[A-Z]{2}$/.test(p.region)) errors.push(`region must be an ISO 3166-1 alpha-2 code (got ${p.region})`);
  if (Number.isNaN(p.observedAt.getTime()) || p.observedAt.getTime() > now.getTime() + 86_400_000) errors.push('observation time must be a real time, not in the future');
  if (!p.sourceName.trim()) errors.push('a price needs a named source');
  if ((p.priceKind === 'retail_new' || p.priceKind === 'used') && !p.sourceUrl) errors.push(`${p.priceKind} prices must cite where they were observed`);
  if ((p.priceKind === 'retail_new' || p.priceKind === 'used') && !p.region) errors.push(`${p.priceKind} prices are market-specific and need a region`);
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function priceFreshness(kind: PriceObservationKind, observedAt: Date, now = new Date()): 'historical' | 'current' | 'stale' {
  const days = PRICE_STALE_AFTER_DAYS[kind];
  if (days == null) return 'historical';
  return now.getTime() - observedAt.getTime() > days * 86_400_000 ? 'stale' : 'current';
}
