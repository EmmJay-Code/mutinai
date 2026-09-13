import { describe, expect, it } from 'vitest';
import type { EventRecord, RawItem } from '../../src/adapter';
import { arxivSearchQuery, createArxivAdapter, normalizeArxivEntry, parseArxivFeed, type ArxivQuery } from '../../src/adapters/arxiv';
import { HttpError } from '../../src/http';
import { ARXIV_ERROR_ATOM, arxivAtom, offlineArxiv } from '../support/arxiv';

const query: ArxivQuery = { key: 'family-reports', search: 'ti:"technical report" AND (ti:Qwen OR ti:Gemma)', categories: ['cs.CL', 'cs.LG'], mentionTerms: ['Qwen', 'Gemma', 'Llama'] };

async function collect(iterable: AsyncIterable<RawItem>) {
  const items: RawItem[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

describe('arXiv parsing (synthetic, documented schema)', () => {
  it('splits versioned ids and normalizes whitespace and dates', () => {
    const { totalResults, entries } = parseArxivFeed(arxivAtom([{ id: '2609.01234', version: 3, title: 'Synthetic   Qwen\n Technical Report', published: '2026-09-01T17:59:59Z', updated: '2026-09-10T12:00:00Z', authors: ['A. One', 'B. Two'], categories: ['cs.CL', 'cs.AI'] }]));
    expect(totalResults).toBe(1);
    expect(entries[0]).toEqual({ id: '2609.01234', version: 3, title: 'Synthetic Qwen Technical Report', summary: 'An abstract.', authors: ['A. One', 'B. Two'], primaryCategory: 'cs.CL', categories: ['cs.CL', 'cs.AI'], published: '2026-09-01T17:59:59.000Z', updated: '2026-09-10T12:00:00.000Z' });
  });

  it('handles empty results, error entries and throttling bodies', () => {
    expect(parseArxivFeed(arxivAtom([], 0))).toEqual({ totalResults: 0, entries: [] });
    expect(() => parseArxivFeed(ARXIV_ERROR_ATOM)).toThrow(/arXiv API error: incorrect id format/);
    expect(() => parseArxivFeed('Rate exceeded.')).toThrow(/non-Atom response: Rate exceeded/);
  });

  it('builds category-restricted queries', () => {
    expect(arxivSearchQuery(query)).toBe('(cat:cs.CL OR cat:cs.LG) AND (ti:"technical report" AND (ti:Qwen OR ti:Gemma))');
  });
});

describe('arXiv normalization', () => {
  it('creates a research_paper event with stable identity, abstract link and whole-word mentions', () => {
    const item: RawItem = {
      externalId: 'arxiv:2609.01234',
      fetchedAt: new Date(),
      contentType: 'application/json',
      payload: { query: { key: 'k', mentionTerms: ['Qwen', 'Llama', 'Phi', 'Mistral'] }, paper: { id: '2609.01234', version: 2, title: 'Qwen and Llama-3 Models: A Technical Report on Phi-losophy and Mistralized Training', authors: ['A', 'B', 'C', 'D'], primaryCategory: 'cs.CL', categories: ['cs.CL'], published: '2026-09-01T00:00:00.000Z', updated: '2026-09-02T00:00:00.000Z', abstractExcerpt: 'We report.', absUrl: 'https://arxiv.org/abs/2609.01234' } },
    };
    const [rec] = normalizeArxivEntry(item) as EventRecord[];
    expect(rec).toMatchObject({ kind: 'research_paper', dedupeKey: 'arxiv:2609.01234', url: 'https://arxiv.org/abs/2609.01234', occurredAt: '2026-09-01T00:00:00.000Z', summary: 'A, B, C et al. — We report.', mentions: ['Qwen', 'Llama'] });
    const [phi] = normalizeArxivEntry({ ...item, payload: { ...(item.payload as object), paper: { ...(item.payload as { paper: object }).paper, title: 'Phi-4 Technical Report' } } }) as EventRecord[];
    expect(phi!.mentions).toEqual(['Phi']);
  });
});

describe('arXiv adapter', () => {
  const papers = (n: number, from: number, updated: (i: number) => string) =>
    Array.from({ length: n }, (_, i) => ({ id: `2609.${String(from + i).padStart(5, '0')}`, title: `Synthetic Qwen Technical Report ${from + i}`, published: '2026-08-01T00:00:00Z', updated: updated(from + i) }));

  it('pages by start, sorted by last update, stopping at the since window', async () => {
    const page1 = arxivAtom(papers(50, 0, () => '2026-09-10T00:00:00Z'), 120);
    const page2 = arxivAtom([...papers(10, 50, () => '2026-09-05T00:00:00Z'), ...papers(40, 60, () => '2026-01-01T00:00:00Z')], 120);
    const { client, requested } = offlineArxiv([page1, page2]);
    const items = await collect(createArxivAdapter({ client, queries: [{ ...query, maxResults: 200 }] }).fetch({ since: new Date('2026-09-01T00:00:00Z') }));
    expect(items).toHaveLength(60);
    expect(requested.map((u) => [u.searchParams.get('start'), u.searchParams.get('sortBy'), u.searchParams.get('sortOrder')])).toEqual([['0', 'lastUpdatedDate', 'descending'], ['50', 'lastUpdatedDate', 'descending']]);
    expect(requested[0]!.searchParams.get('search_query')).toBe(arxivSearchQuery(query));
    expect(JSON.stringify(items[0]!.payload)).not.toMatch(/pdf/);
  });

  it('respects maxResults and limit', async () => {
    const { client, requested } = offlineArxiv([arxivAtom(papers(50, 0, () => '2026-09-10T00:00:00Z'), 500)]);
    expect(await collect(createArxivAdapter({ client, queries: [{ ...query, maxResults: 20 }] }).fetch({}))).toHaveLength(20);
    expect(requested[0]!.searchParams.get('max_results')).toBe('20');
    expect(await collect(createArxivAdapter({ client, queries: [query] }).fetch({ limit: 5 }))).toHaveLength(5);
  });

  it('fails clearly on API errors and persistent throttling', async () => {
    const error = offlineArxiv([ARXIV_ERROR_ATOM]);
    await expect(collect(createArxivAdapter({ client: error.client, queries: [query] }).fetch({}))).rejects.toThrow(/family-reports: arXiv API error/);
    const throttled = offlineArxiv([{ status: 429, body: 'Rate exceeded.' }]);
    await expect(collect(createArxivAdapter({ client: throttled.client, queries: [query] }).fetch({}))).rejects.toBeInstanceOf(HttpError);
  });
});
