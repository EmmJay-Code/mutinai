import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ValidatorCache } from '../../src/adapter';
import { HttpClient } from '../../src/http';

/** Real GitHub REST responses recorded September 2026 (unauthenticated). */
export function recordedGitHub(file: 'llama-cpp-repo' | 'llama-cpp-releases' | 'ollama-repo'): unknown {
  return JSON.parse(readFileSync(new URL(`../recorded/github/${file}.json`, import.meta.url), 'utf8'));
}

export interface GitHubReply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Offline GitHub API. `repos` maps `owner/repo` to { repo, releases } bodies; unknown repos return 404. ETags are
 * derived from body content so conditional requests behave like the real API.
 */
export function offlineGitHub(opts: { repos: Record<string, { repo: unknown; releases: unknown }>; remaining?: number }) {
  const requested: { url: string; headers: Record<string, string> }[] = [];
  const fetch = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    requested.push({ url: input, headers });
    if (url.pathname === '/rate_limit') return reply({ status: 200, body: { resources: { core: { limit: 60, remaining: opts.remaining ?? 60, reset: 1789283932 } } } });
    const m = /^\/repos\/([^/]+\/[^/]+)(\/releases)?$/.exec(url.pathname);
    const entry = m && opts.repos[m[1]!];
    if (!entry) return reply({ status: 404, body: { message: 'Not Found' } });
    const body = m![2] ? entry.releases : entry.repo;
    const etag = `W/"${createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 32)}"`;
    if (headers['If-None-Match'] === etag) return reply({ status: 304, headers: { etag } });
    return reply({ status: 200, body, headers: { etag, 'x-ratelimit-remaining': '50', 'x-ratelimit-reset': '1789283932' } });
  }) as unknown as typeof globalThis.fetch;
  return { client: new HttpClient({ fetch, sleep: async () => {}, maxRetries: 0 }), requested };
}

function reply(r: GitHubReply) {
  return new Response(r.status === 304 ? null : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json', ...r.headers } });
}

export function memoryValidators(): ValidatorCache & { entries: Map<string, { etag?: string; lastModified?: string }> } {
  const entries = new Map<string, { etag?: string; lastModified?: string }>();
  return { entries, get: async (url) => entries.get(url) ?? null, set: async (url, v) => void entries.set(url, v) };
}
