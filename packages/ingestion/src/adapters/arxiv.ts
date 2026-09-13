/**
 * arXiv: curated queries over the export API (Atom), newest updates first.
 *
 * Request pacing follows arXiv's terms (one request every 3 seconds, one connection). Metadata is CC0; snapshots keep
 * identifier, version, title, authors, categories, dates and a short abstract excerpt, and events link to the abstract
 * page (never PDFs). Queries are narrow by design: Mutinai does not mirror arXiv.
 */
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { NormalizedRecord, RawItem, SourceAdapter, SourceDescriptor } from '../adapter';
import { HttpError, type HttpClient } from '../http';
import { excerpt } from './feed';

export interface ArxivQuery {
  /** Stable key for logs and snapshots. */
  key: string;
  /** arXiv `search_query` expression, e.g. `ti:"technical report" AND (ti:Qwen OR ti:Gemma)`. */
  search: string;
  /** Categories the query is restricted to (combined with OR, then AND-ed with `search`). */
  categories: string[];
  /** Catalog names to link when they appear as whole words in a title (resolved by exact alias). */
  mentionTerms: string[];
  /** Upper bound on entries considered per run. Default 100. */
  maxResults?: number;
}

export interface ArxivEntrySnapshot {
  query: { key: string; mentionTerms: string[] };
  paper: {
    id: string;
    version: number;
    title: string;
    authors: string[];
    primaryCategory: string | null;
    categories: string[];
    published: string;
    updated: string;
    abstractExcerpt: string | null;
    absUrl: string;
  };
}

export interface ArxivEntry {
  id: string;
  version: number;
  title: string;
  summary: string;
  authors: string[];
  primaryCategory: string | null;
  categories: string[];
  published: string;
  updated: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  trimValues: true,
  parseTagValue: false,
  isArray: (name) => ['entry', 'author', 'category', 'link'].includes(name),
});

const text = (v: unknown): string => (v == null ? '' : typeof v === 'object' ? String((v as Record<string, unknown>)['#text'] ?? '') : String(v)).replace(/\s+/g, ' ').trim();

/** Parses an arXiv API Atom response. Throws on non-Atom bodies and on arXiv's error entries. */
export function parseArxivFeed(xml: string): { totalResults: number; entries: ArxivEntry[] } {
  const valid = XMLValidator.validate(xml);
  if (valid !== true) throw new Error(`arXiv returned a non-Atom response: ${xml.slice(0, 80).replace(/\s+/g, ' ')}`);
  const feed = parser.parse(xml).feed;
  if (!feed) throw new Error('arXiv response has no Atom feed element');
  const entries: Record<string, any>[] = feed.entry ?? [];
  const error = entries.find((e) => text(e.title) === 'Error' && /api\/errors/.test(text(e.id)));
  if (error) throw new Error(`arXiv API error: ${text(error.summary)}`);
  return {
    totalResults: Number(text(feed['opensearch:totalResults'])) || 0,
    entries: entries.map((e) => {
      const m = /arxiv\.org\/abs\/(.+?)v(\d+)$/.exec(text(e.id));
      if (!m) throw new Error(`unexpected arXiv entry id ${text(e.id)}`);
      return {
        id: m[1]!,
        version: Number(m[2]),
        title: text(e.title),
        summary: text(e.summary),
        authors: ((e.author as Record<string, unknown>[]) ?? []).map((a) => text(a.name)).filter(Boolean),
        primaryCategory: e['arxiv:primary_category']?.['@term'] ?? null,
        categories: ((e.category as Record<string, string>[]) ?? []).map((c) => c['@term']).filter((c): c is string => Boolean(c)),
        published: new Date(text(e.published)).toISOString(),
        updated: new Date(text(e.updated)).toISOString(),
      };
    }),
  };
}

export function arxivSearchQuery(q: Pick<ArxivQuery, 'search' | 'categories'>): string {
  const cats = q.categories.map((c) => `cat:${c}`).join(' OR ');
  return cats ? `(${cats}) AND (${q.search})` : q.search;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function normalizeArxivEntry(item: RawItem): NormalizedRecord[] {
  const { query, paper } = item.payload as ArxivEntrySnapshot;
  if (!paper?.id || !paper.title || !paper.published) throw new Error('arXiv snapshot is missing id, title or dates');
  // Whole words only; a hyphen ends a word only before a digit ("Phi-4" mentions Phi, "Phi-losophy" does not).
  const mentions = query.mentionTerms.filter((term) => new RegExp(`(^|[^\\w-])${escapeRegExp(term)}($|[^\\w-]|-(?=\\d))`, 'i').test(paper.title));
  const authors = paper.authors.length > 3 ? `${paper.authors.slice(0, 3).join(', ')} et al.` : paper.authors.join(', ');
  return [
    {
      type: 'event',
      kind: 'research_paper',
      title: paper.title,
      summary: [authors, paper.abstractExcerpt].filter(Boolean).join(' — ').slice(0, 280) || undefined,
      occurredAt: paper.published,
      url: paper.absUrl,
      dedupeKey: `arxiv:${paper.id}`,
      mentions,
    },
  ];
}

export const ARXIV_SOURCE: SourceDescriptor = {
  key: 'arxiv',
  name: 'arXiv',
  kind: 'arxiv',
  baseUrl: 'https://arxiv.org',
  priority: 50,
};

/** arXiv asks for at most one request every three seconds. */
export const ARXIV_MIN_INTERVAL_MS = 3100;
const PAGE_SIZE = 50;

export function createArxivAdapter(opts: { client: HttpClient; queries: ArxivQuery[]; apiUrl?: string }): SourceAdapter {
  if (!opts.queries.length) throw new Error('arxiv: no queries configured');
  const api = opts.apiUrl ?? 'https://export.arxiv.org/api/query';
  return {
    source: ARXIV_SOURCE,
    normalize: normalizeArxivEntry,
    async *fetch(ctx) {
      const seen = new Set<string>();
      let yielded = 0;
      for (const q of opts.queries) {
        const max = q.maxResults ?? 100;
        let considered = 0;
        pages: for (let start = 0; considered < max; start += PAGE_SIZE) {
          const params = new URLSearchParams({ search_query: arxivSearchQuery(q), sortBy: 'lastUpdatedDate', sortOrder: 'descending', start: String(start), max_results: String(Math.min(PAGE_SIZE, max - considered)) });
          const url = `${api}?${params}`;
          const res = await opts.client.get(url, { accept: 'application/atom+xml', signal: ctx.signal });
          let parsed: ReturnType<typeof parseArxivFeed>;
          try {
            parsed = parseArxivFeed(res.body);
          } catch (error) {
            throw new HttpError(url, res.status, `${q.key}: ${error instanceof Error ? error.message : String(error)}`, res.body.slice(0, 300));
          }
          if (!parsed.entries.length) break;
          for (const e of parsed.entries) {
            if (considered >= max) break pages;
            considered += 1;
            if (ctx.since && new Date(e.updated) < ctx.since) break pages;
            if (seen.has(e.id)) continue;
            seen.add(e.id);
            if (ctx.limit != null && yielded >= ctx.limit) return;
            const snapshot: ArxivEntrySnapshot = {
              query: { key: q.key, mentionTerms: q.mentionTerms },
              paper: {
                id: e.id,
                version: e.version,
                title: e.title,
                authors: e.authors.slice(0, 20),
                primaryCategory: e.primaryCategory,
                categories: [...e.categories].sort(),
                published: e.published,
                updated: e.updated,
                abstractExcerpt: excerpt(e.summary, 240),
                absUrl: `https://arxiv.org/abs/${e.id}`,
              },
            };
            yielded += 1;
            yield { externalId: `arxiv:${e.id}`, url: snapshot.paper.absUrl, fetchedAt: new Date(), contentType: 'application/json', payload: snapshot };
          }
          if (start + PAGE_SIZE >= parsed.totalResults) break;
        }
      }
    },
  };
}
