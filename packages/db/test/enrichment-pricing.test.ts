import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { enrichmentTask, type EnrichmentProvider, type EnrichmentRequest } from '@mutinai/domain';
import type { DatabaseHandle } from '../src/client';
import { runEnrichment } from '../src/enrichment';
import { listLatestDevicePrices, listLatestPrices } from '../src/queries/catalog';
import { createTestDatabase, resetAndSeed } from '../src/testing';
import { OntologyError, recordPriceObservation } from '../src/writers';

let h: DatabaseHandle;

const entityId = async (kind: string, slug: string) => (await h.db.execute<{ id: string }>(sql`select id from ecosystem.entity where kind::text = ${kind} and slug = ${slug}`))[0]!.id;

function fakeProvider(text = 'A mid-sized open model.'): EnrichmentProvider & { requests: EnrichmentRequest[] } {
  const requests: EnrichmentRequest[] = [];
  return { id: 'fake', requests, generate: async (request) => (requests.push(request), { text, model: 'fake-model-1' }) };
}

beforeAll(async () => {
  h = createTestDatabase();
  await resetAndSeed(h.db, { community: false });
});
afterAll(() => h.close());

describe('AI enrichment runner', () => {
  const task = enrichmentTask('entity.plain_summary')!;

  it('stores derived content apart from canonical facts, with full generation provenance', async () => {
    const id = await entityId('model_variant', 'qwen3-30b-a3b');
    const [before] = await h.db.execute<{ summary: string | null; updated_at: Date }>(sql`select summary, updated_at from ecosystem.entity where id = ${id}`);
    const provider = fakeProvider();
    const outcome = await runEnrichment(h.db, provider, task, { kind: 'entity', id });
    expect(outcome.status).toBe('generated');
    const [row] = await h.db.execute<Record<string, unknown>>(sql`select * from ecosystem.derived_content where entity_id = ${id}`);
    expect(row).toMatchObject({ content_kind: 'plain_summary', generator: 'entity.plain_summary', generator_version: task.promptVersion, provider: 'fake', model: 'fake-model-1', review_status: 'unreviewed', superseded_at: null });
    expect(String(row!.input_hash)).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(provider.requests[0]!.input)).toMatchObject({ subject: 'Qwen3 30B-A3B', facts: expect.objectContaining({ variantKind: 'instruct', publisher: expect.any(String) }) });
    const [after] = await h.db.execute<{ summary: string | null; updated_at: Date }>(sql`select summary, updated_at from ecosystem.entity where id = ${id}`);
    expect(after).toEqual(before);
  });

  it('does not regenerate for unchanged inputs, and supersedes when canonical facts change', async () => {
    const id = await entityId('model_variant', 'qwen3-30b-a3b');
    const provider = fakeProvider('Updated explanation.');
    expect((await runEnrichment(h.db, provider, task, { kind: 'entity', id })).status).toBe('unchanged');
    expect(provider.requests).toHaveLength(0);

    await h.db.execute(sql`update ecosystem.entity set summary = 'A changed canonical summary.' where id = ${id}`);
    expect((await runEnrichment(h.db, provider, task, { kind: 'entity', id })).status).toBe('generated');
    const rows = await h.db.execute<{ body: string; superseded: boolean }>(sql`select body, superseded_at is not null as superseded from ecosystem.derived_content where entity_id = ${id} order by created_at`);
    expect(rows.map((r) => [r.body, r.superseded])).toEqual([['A mid-sized open model.', true], ['Updated explanation.', false]]);
  });

  it('rejects invalid provider output and skips tasks that do not apply', async () => {
    const variant = await entityId('model_variant', 'phi-4');
    await expect(runEnrichment(h.db, fakeProvider('See https://example.com'), task, { kind: 'entity', id: variant })).rejects.toThrow(/output rejected.*links/);
    const scheme = await entityId('quantization_scheme', 'q4-k-m');
    expect((await runEnrichment(h.db, fakeProvider(), task, { kind: 'entity', id: scheme })).status).toBe('not_applicable');
    const [n] = await h.db.execute<{ n: number }>(sql`select count(*)::int as n from ecosystem.derived_content where entity_id in (${variant}, ${scheme})`);
    expect(n!.n).toBe(0);
  });

  it('enriches events as their own subjects', async () => {
    const [ev] = await h.db.execute<{ id: string }>(sql`select id from ecosystem.event order by occurred_at desc limit 1`);
    const outcome = await runEnrichment(h.db, fakeProvider('It adds a new runtime version.'), enrichmentTask('event.why_it_matters')!, { kind: 'event', id: ev!.id });
    expect(outcome.status).toBe('generated');
    const [row] = await h.db.execute<{ entity_id: string | null; event_id: string }>(sql`select entity_id, event_id from ecosystem.derived_content where event_id = ${ev!.id}`);
    expect(row).toEqual({ entity_id: null, event_id: ev!.id });
  });
});

describe('hardware price observations', () => {
  it('records sourced observations and returns the latest per kind and market', async () => {
    const gpu = await entityId('hardware_device', 'nvidia-rtx-4090');
    await recordPriceObservation(h.db, { entityId: gpu, priceKind: 'launch_msrp', amount: 1599, currency: 'USD', observedAt: new Date('2022-10-12T00:00:00Z'), sourceName: 'NVIDIA launch announcement' });
    await recordPriceObservation(h.db, { entityId: gpu, priceKind: 'used', amount: 1500, currency: 'USD', region: 'US', observedAt: new Date('2026-09-01T00:00:00Z'), sourceName: 'Marketplace API', sourceUrl: 'https://example.com/a' });
    await recordPriceObservation(h.db, { entityId: gpu, priceKind: 'used', amount: 1450, currency: 'USD', region: 'US', observedAt: new Date('2026-09-10T00:00:00Z'), sourceName: 'Marketplace API', sourceUrl: 'https://example.com/b' });
    const prices = await listLatestPrices(h.db, gpu);
    expect(prices.map((p) => [p.priceKind, p.amount, p.region])).toEqual([['launch_msrp', 1599, null], ['used', 1450, 'US']]);
  });

  it('lists the newest market observation per device, and never a launch price', async () => {
    const gpu = await entityId('hardware_device', 'nvidia-rtx-5090');
    expect((await listLatestDevicePrices(h.db))['nvidia-rtx-5090'], 'nothing until a market source is recorded').toBeUndefined();
    await recordPriceObservation(h.db, { entityId: gpu, priceKind: 'launch_msrp', amount: 1999, currency: 'USD', observedAt: new Date('2025-01-30T00:00:00Z'), sourceName: 'NVIDIA launch announcement' });
    expect((await listLatestDevicePrices(h.db))['nvidia-rtx-5090'], 'a launch MSRP is a historical fact, not a market observation').toBeUndefined();
    await recordPriceObservation(h.db, { entityId: gpu, priceKind: 'retail_new', amount: 2399, currency: 'USD', region: 'US', observedAt: new Date('2026-09-01T00:00:00Z'), sourceName: 'Retailer API', sourceUrl: 'https://example.com/a' });
    await recordPriceObservation(h.db, { entityId: gpu, priceKind: 'retail_new', amount: 2199, currency: 'USD', region: 'US', observedAt: new Date('2026-09-10T00:00:00Z'), sourceName: 'Retailer API', sourceUrl: 'https://example.com/b' });
    expect((await listLatestDevicePrices(h.db))['nvidia-rtx-5090']).toMatchObject({ priceKind: 'retail_new', amount: 2199, sourceName: 'Retailer API' });
  });

  it('rejects unsourced market prices and non-hardware subjects', async () => {
    const gpu = await entityId('hardware_device', 'nvidia-rtx-4090');
    await expect(recordPriceObservation(h.db, { entityId: gpu, priceKind: 'retail_new', amount: 1999, currency: 'USD', region: 'US', observedAt: new Date(), sourceName: 'Someone said' })).rejects.toBeInstanceOf(OntologyError);
    const model = await entityId('model', 'qwen3-30b-a3b');
    await expect(recordPriceObservation(h.db, { entityId: model, priceKind: 'launch_msrp', amount: 1, currency: 'USD', observedAt: new Date(), sourceName: 'x' })).rejects.toThrow(/hardware, not model/);
    await expect(h.db.execute(sql`insert into ecosystem.price_observation (entity_id, price_kind, amount, currency, observed_at, source_name) values (${gpu}, 'launch_msrp', -1, 'usd', now(), 'x')`)).rejects.toThrow();
  });
});
