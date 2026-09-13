import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { type DatabaseHandle } from '@mutinai/db';
import { createTestDatabase, resetAndSeed } from '@mutinai/db/testing';
import { createArxivAdapter, type ArxivQuery } from '../../src/adapters/arxiv';
import { MemoryObjectStore } from '../../src/object-store';
import { runAdapter } from '../../src/pipeline';
import { arxivAtom, offlineArxiv } from '../support/arxiv';

let h: DatabaseHandle;
const store = new MemoryObjectStore();
const queries: ArxivQuery[] = [{ key: 'family-reports', search: 'ti:"technical report"', categories: ['cs.CL'], mentionTerms: ['Qwen', 'Gemma', 'Llama'] }];
const papers = [
  { id: '2609.00001', title: 'Synthetic Qwen Technical Report', published: '2026-09-01T00:00:00Z' },
  { id: '2609.00002', title: 'A Synthetic Survey Without Catalog Names', published: '2026-09-02T00:00:00Z' },
];

async function paperEvents() {
  return h.db.execute<{ title: string; kind: string; url: string; links: string[] }>(sql`
    select e.title, e.event_kind::text as kind, e.url,
      coalesce((select array_agg(en.slug order by en.slug) from ecosystem.event_entity ee join ecosystem.entity en on en.id = ee.entity_id where ee.event_id = e.id), '{}') as links
    from ecosystem.event e where e.dedupe_key like 'arxiv:%' order by e.dedupe_key`);
}

beforeAll(async () => {
  h = createTestDatabase();
  await resetAndSeed(h.db, { community: false });
});
afterAll(() => h.close());

describe('arXiv ingestion (synthetic responses)', () => {
  it('creates research-paper events linked to catalog families by exact name', async () => {
    const { stats } = await runAdapter({ db: h.db, store }, createArxivAdapter({ client: offlineArxiv([arxivAtom(papers)]).client, queries }));
    expect(stats).toMatchObject({ seen: 2, new: 2, eventsCreated: 2, failed: 0 });
    expect(await paperEvents()).toEqual([
      { title: 'Synthetic Qwen Technical Report', kind: 'research_paper', url: 'https://arxiv.org/abs/2609.00001', links: ['qwen'] },
      { title: 'A Synthetic Survey Without Catalog Names', kind: 'research_paper', url: 'https://arxiv.org/abs/2609.00002', links: [] },
    ]);
  });

  it('is idempotent, and a new version refreshes the same event', async () => {
    const again = await runAdapter({ db: h.db, store }, createArxivAdapter({ client: offlineArxiv([arxivAtom(papers)]).client, queries }));
    expect(again.stats).toMatchObject({ new: 0, unchanged: 2, eventsCreated: 0 });

    const revised = [{ ...papers[0]!, version: 2, title: 'Synthetic Qwen Technical Report (revised)', updated: '2026-09-12T00:00:00Z' }, papers[1]!];
    const { stats } = await runAdapter({ db: h.db, store }, createArxivAdapter({ client: offlineArxiv([arxivAtom(revised)]).client, queries }));
    expect(stats).toMatchObject({ new: 1, eventsCreated: 0, eventsUpdated: 1 });
    expect((await paperEvents()).map((e) => e.title)).toEqual(['Synthetic Qwen Technical Report (revised)', 'A Synthetic Survey Without Catalog Names']);
  });
});
