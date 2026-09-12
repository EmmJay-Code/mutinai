/**
 * RSS/Atom item normalizer + fixture adapter. Items are expected already parsed (guid, title, link, pubDate,
 * description, categories). A live adapter adds XML fetching/parsing in `fetch`.
 */
import { readFile } from 'node:fs/promises';
import { EVENT_KINDS, type EventKind } from '@mutinai/domain';
import type { NormalizedRecord, RawItem, SourceAdapter, SourceDescriptor } from '../adapter';

export interface FeedItem {
  guid: string;
  title: string;
  link: string;
  pubDate: string;
  description?: string;
  categories?: string[];
  /** Optional per-feed classification; defaults to `announcement`. */
  kind?: string;
}

export function normalizeFeedItem(item: RawItem): NormalizedRecord[] {
  const entry = item.payload as FeedItem;
  const occurredAt = new Date(entry.pubDate);
  if (Number.isNaN(occurredAt.getTime())) throw new Error(`invalid pubDate ${entry.pubDate}`);
  const kind = (EVENT_KINDS as readonly string[]).includes(entry.kind ?? '') ? (entry.kind as EventKind) : 'announcement';
  const identifiers = (entry.categories ?? []).filter((c) => /^[\w.-]+\/[\w.-]+$/.test(c)).map((value) => ({ namespace: 'huggingface', value }));
  const mentions = (entry.categories ?? []).filter((c) => !/^[\w.-]+\/[\w.-]+$/.test(c));
  return [
    {
      type: 'event',
      kind,
      title: entry.title,
      summary: entry.description,
      occurredAt: occurredAt.toISOString(),
      url: entry.link,
      identifiers,
      mentions,
    },
  ];
}

export function createFixtureRssAdapter(opts: { key?: string; name?: string; items?: FeedItem[] } = {}): SourceAdapter {
  const source: SourceDescriptor = {
    key: opts.key ?? 'fixture-rss-release-notes',
    name: opts.name ?? 'Release notes feed (fixture)',
    kind: 'fixture',
    priority: 20,
  };
  return {
    source,
    async *fetch() {
      const items: FeedItem[] = opts.items ?? JSON.parse(await readFile(new URL('../../fixtures/rss-feed.json', import.meta.url), 'utf8')).items;
      for (const entry of items) {
        yield { externalId: entry.guid, url: entry.link, fetchedAt: new Date(), contentType: 'application/json', payload: entry };
      }
    },
    normalize: normalizeFeedItem,
  };
}
