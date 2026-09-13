/**
 * Generic RSS 2.0 / RSS 1.0 / Atom adapter for a curated list of official feeds.
 *
 * Stores what identifies and dates an entry (id, title, canonical URL, author, categories, published/updated) and an
 * excerpt of at most 280 characters. Article bodies are never stored or republished; events link to the original.
 * Each feed is fetched with conditional requests; a broken feed does not stop the others but fails the run clearly.
 */
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { EventKind } from '@mutinai/domain';
import type { Identifier, NormalizedRecord, RawItem, SourceAdapter, SourceDescriptor } from '../adapter';
import type { HttpClient } from '../http';
import { releaseDedupeKey } from '../pipeline';

export interface FeedConfig {
  /** Stable key; part of every entry's identity. */
  key: string;
  name: string;
  url: string;
  /** Event kind for entries. Default `announcement`. */
  kind?: EventKind;
  /** Entities every entry relates to, resolved by external identifier (e.g. the publishing organization). */
  identifiers?: Identifier[];
  /** For GitHub `releases.atom` feeds: `owner/repo`, so events share identity with the GitHub API adapter. */
  githubReleasesOf?: string;
  /** Newest entries considered per fetch. Default 20. */
  maxItems?: number;
}

export interface FeedEntrySnapshot {
  feed: Pick<FeedConfig, 'key' | 'name' | 'kind' | 'identifiers' | 'githubReleasesOf'>;
  entry: {
    id: string;
    title: string;
    url: string | null;
    published: string | null;
    updated: string | null;
    author: string | null;
    excerpt: string | null;
    categories: string[];
  };
}

export interface ParsedEntry {
  id: string | null;
  title: string;
  url: string | null;
  published: string | null;
  updated: string | null;
  author: string | null;
  summary: string | null;
  categories: string[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
  parseTagValue: false,
  isArray: (name) => ['item', 'entry', 'link', 'category', 'author', 'dc:creator', 'dc:subject'].includes(name),
});

const text = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) return text(value[0]);
  if (typeof value === 'object') return text((value as Record<string, unknown>)['#text'] ?? (value as Record<string, unknown>).name ?? '');
  return '';
};

const isoDate = (value: string): string | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** Parses RSS 2.0, RSS 1.0 (RDF) and Atom. Throws for documents that are not feeds. */
export function parseFeed(xml: string): { title: string; entries: ParsedEntry[] } {
  // The parser is lenient; validate first so truncated or broken documents fail instead of yielding partial entries.
  const valid = XMLValidator.validate(xml);
  if (valid !== true) throw new Error(`malformed XML: ${valid.err.msg} (line ${valid.err.line})`);
  let doc: Record<string, any>;
  try {
    doc = parser.parse(xml);
  } catch (error) {
    throw new Error(`malformed XML: ${error instanceof Error ? error.message : String(error)}`);
  }
  const channel = doc.rss?.channel ?? doc['rdf:RDF']?.channel;
  if (channel) {
    const items: Record<string, unknown>[] = doc.rss?.channel?.item ?? doc['rdf:RDF']?.item ?? [];
    return {
      title: text(channel.title),
      entries: items.map((item) => ({
        id: text(item.guid) || text(item.link) || null,
        title: text(item.title),
        url: text(item.link) || null,
        published: isoDate(text(item.pubDate) || text(item['dc:date'])),
        updated: null,
        author: text(item.author) || text(item['dc:creator']) || null,
        summary: text(item.description) || null,
        categories: [...((item.category as unknown[]) ?? []), ...((item['dc:subject'] as unknown[]) ?? [])].map(text).filter(Boolean),
      })),
    };
  }
  if (doc.feed) {
    const entries: Record<string, any>[] = doc.feed.entry ?? [];
    return {
      title: text(doc.feed.title),
      entries: entries.map((entry) => {
        const links: Record<string, string>[] = entry.link ?? [];
        const link = links.find((l) => !l['@rel'] || l['@rel'] === 'alternate') ?? links[0];
        const updated = isoDate(text(entry.updated));
        return {
          id: text(entry.id) || link?.['@href'] || null,
          title: text(entry.title),
          url: link?.['@href'] ?? null,
          published: isoDate(text(entry.published)) ?? updated,
          updated,
          author: text(entry.author) || null,
          summary: text(entry.summary) || text(entry.content) || null,
          categories: ((entry.category as Record<string, string>[]) ?? []).map((c) => c['@term'] ?? text(c)).filter(Boolean),
        };
      }),
    };
  }
  throw new Error('not an RSS or Atom document');
}

/** Plain-text excerpt: tags and whitespace removed, at most `max` characters, cut at a word boundary. */
export function excerpt(html: string | null, max = 280): string | null {
  if (!html) return null;
  const plain = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return null;
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max * 0.6)).trimEnd()}…`;
}

/** Removes tracking parameters and fragments so the same article has one URL. */
export function canonicalUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|ref$|source$)/i.test(key)) u.searchParams.delete(key);
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

/** Pre-release tags such as `v0.34.0-rc5`, `v0.29.1rc0`, `1.2.0.dev3`, `2.0.0-beta.1`. */
export const PRERELEASE_TAG = /\d[-.]?(rc|alpha|beta|pre|dev|nightly)[.-]?\d*$/i;
const releaseTag = (url: string | null) => {
  const m = url ? /\/releases\/tag\/([^/?#]+)/.exec(url) : null;
  return m ? decodeURIComponent(m[1]!) : null;
};

export function normalizeFeedEntry(item: RawItem): NormalizedRecord[] {
  const { feed, entry } = item.payload as FeedEntrySnapshot;
  if (!feed?.key || !entry?.id) throw new Error('feed entry snapshot has no feed key or entry id');
  if (!entry.title) throw new Error(`${feed.key}: entry ${entry.id} has no title`);
  const occurredAt = entry.published ?? entry.updated;
  if (!occurredAt) throw new Error(`${feed.key}: entry ${entry.id} has no publication date`);

  if (feed.githubReleasesOf) {
    const tag = releaseTag(entry.url);
    if (!tag) throw new Error(`${feed.key}: entry ${entry.id} does not link to a GitHub release`);
    const repo: Identifier = { namespace: 'github', value: feed.githubReleasesOf.toLowerCase() };
    return [{ type: 'event', kind: feed.kind ?? 'runtime_release', title: entry.title, summary: entry.excerpt ?? undefined, occurredAt, url: entry.url ?? undefined, dedupeKey: releaseDedupeKey(repo, tag), identifiers: [repo], releaseTag: tag }];
  }
  return [
    {
      type: 'event',
      kind: feed.kind ?? 'announcement',
      title: entry.title,
      summary: entry.excerpt ?? undefined,
      occurredAt,
      url: entry.url ?? undefined,
      dedupeKey: `feeds:${feed.key}:${entry.id}`,
      identifiers: feed.identifiers ?? [],
      mentions: entry.categories,
    },
  ];
}

export const FEEDS_SOURCE: SourceDescriptor = {
  key: 'feeds',
  name: 'Official feeds (RSS/Atom)',
  kind: 'rss',
  priority: 50,
};

const ACCEPT = 'application/rss+xml, application/atom+xml, application/rdf+xml;q=0.9, application/xml;q=0.8, text/xml;q=0.8, */*;q=0.1';

export function createFeedAdapter(opts: { client: HttpClient; feeds: FeedConfig[] }): SourceAdapter {
  if (!opts.feeds.length) throw new Error('feeds: no feeds configured');
  const keys = new Set<string>();
  for (const feed of opts.feeds) {
    if (keys.has(feed.key)) throw new Error(`feeds: duplicate feed key ${feed.key}`);
    keys.add(feed.key);
  }
  return {
    source: FEEDS_SOURCE,
    normalize: normalizeFeedEntry,
    async *fetch(ctx) {
      const errors: string[] = [];
      let yielded = 0;
      for (const feed of opts.feeds) {
        if (ctx.limit != null && yielded >= ctx.limit) break;
        let parsed: ReturnType<typeof parseFeed>;
        let validators: { etag?: string; lastModified?: string };
        try {
          const res = await opts.client.get(feed.url, { accept: ACCEPT, validators: await ctx.validators?.get(feed.url), signal: ctx.signal });
          if (res.notModified) {
            ctx.log?.(`feeds: ${feed.key} not modified`);
            continue;
          }
          // Content-Type is not trusted (some official feeds are served as text/plain); the document is parsed.
          parsed = parseFeed(res.body);
          validators = res.validators;
        } catch (error) {
          const message = `${feed.key}: ${error instanceof Error ? error.message : String(error)}`;
          ctx.log?.(`feeds: FAILED ${message}`);
          errors.push(message);
          continue;
        }
        const entries = parsed.entries
          .filter((e) => e.id && e.title && (e.published || e.updated))
          .sort((a, b) => (b.published ?? b.updated ?? '').localeCompare(a.published ?? a.updated ?? ''))
          .slice(0, feed.maxItems ?? 20)
          .filter((e) => !ctx.since || new Date(e.updated ?? e.published!) >= ctx.since)
          .filter((e) => !feed.githubReleasesOf || !PRERELEASE_TAG.test(releaseTag(e.url) ?? ''));
        for (const e of entries) {
          if (ctx.limit != null && yielded >= ctx.limit) break;
          const url = canonicalUrl(e.url);
          const snapshot: FeedEntrySnapshot = {
            feed: { key: feed.key, name: feed.name, kind: feed.kind, identifiers: feed.identifiers, githubReleasesOf: feed.githubReleasesOf },
            entry: { id: e.id!, title: e.title, url, published: e.published, updated: e.updated, author: e.author, excerpt: excerpt(e.summary), categories: [...e.categories].sort() },
          };
          yielded += 1;
          yield { externalId: `${feed.key}:${e.id}`, url: url ?? feed.url, fetchedAt: new Date(), contentType: 'application/json', payload: snapshot };
        }
        // Stored only once every entry of this response was processed.
        await ctx.validators?.set(feed.url, validators);
      }
      if (errors.length) throw new Error(`${errors.length} feed(s) failed: ${errors.join('; ')}`);
    },
  };
}
