import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { HttpClient } from '../../src/http';

/** Real feed documents recorded September 2026, trimmed to their first three entries (see test/recorded/README.md). */
export function recordedFeed(name: 'huggingface-blog' | 'ollama-releases' | 'qwen-blog'): string {
  return readFileSync(new URL(`../recorded/feeds/${name}.xml`, import.meta.url), 'utf8');
}

/** Offline feed host: serves documents by URL with content-derived ETags; unknown URLs return 404. */
export function offlineFeeds(documents: Record<string, { body: string; contentType?: string } | { status: number }>) {
  const requested: string[] = [];
  const fetch = (async (input: string, init?: RequestInit) => {
    requested.push(input);
    const doc = documents[input];
    if (!doc) return new Response('Not Found', { status: 404 });
    if ('status' in doc) return new Response('error', { status: doc.status });
    const etag = `"${createHash('sha256').update(doc.body).digest('hex').slice(0, 16)}"`;
    if ((init?.headers as Record<string, string>)?.['If-None-Match'] === etag) return new Response(null, { status: 304, headers: { etag } });
    return new Response(doc.body, { status: 200, headers: { 'content-type': doc.contentType ?? 'application/rss+xml', etag } });
  }) as unknown as typeof globalThis.fetch;
  return { client: new HttpClient({ fetch, sleep: async () => {}, maxRetries: 0 }), requested };
}
