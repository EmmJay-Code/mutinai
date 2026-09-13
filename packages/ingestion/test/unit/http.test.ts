import { describe, expect, it } from 'vitest';
import { HttpClient, HttpError, nextLink, parseRateLimit, RateLimitError } from '../../src/http';

type Reply = { status: number; body?: string | null; headers?: Record<string, string> } | Error;

function fakeFetch(replies: Reply[]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: init?.headers as Record<string, string> });
    const reply = replies.shift();
    if (!reply) throw new Error('no more replies');
    if (reply instanceof Error) throw reply;
    return new Response(reply.status === 304 ? null : (reply.body ?? ''), { status: reply.status, headers: reply.headers });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

function client(replies: Reply[], opts: { token?: string; maxRetries?: number; maxWaitMs?: number } = {}) {
  const { fetch, calls } = fakeFetch(replies);
  const sleeps: number[] = [];
  let now = 1_700_000_000_000;
  const http = new HttpClient({ fetch, sleep: async (ms) => { sleeps.push(ms); now += ms; }, now: () => now, userAgent: 'Test-UA/1', ...opts });
  return { http, calls, sleeps };
}

describe('HttpClient', () => {
  it('sends an explicit user agent and bearer token', async () => {
    const { http, calls } = client([{ status: 200, body: '{"ok":true}' }], { token: 'secret' });
    const { data } = await http.getJson<{ ok: boolean }>('https://example.test/a');
    expect(data).toEqual({ ok: true });
    expect(calls[0]!.headers).toMatchObject({ 'User-Agent': 'Test-UA/1', Authorization: 'Bearer secret' });
    expect(http.authenticated).toBe(true);
  });

  it('retries transient server errors with backoff, then succeeds', async () => {
    const { http, calls, sleeps } = client([{ status: 503 }, { status: 502 }, { status: 200, body: '[]' }]);
    const { data } = await http.getJson('https://example.test/a');
    expect(data).toEqual([]);
    expect(calls).toHaveLength(3);
    expect(sleeps).toHaveLength(2);
    expect(sleeps[1]!).toBeGreaterThan(sleeps[0]!);
  });

  it('retries network failures and fails clearly after the retry budget', async () => {
    const { http, calls } = client([new TypeError('fetch failed'), new TypeError('fetch failed')], { maxRetries: 1 });
    await expect(http.get('https://example.test/a')).rejects.toThrow(/request failed after 2 attempts: fetch failed/);
    expect(calls).toHaveLength(2);
  });

  it('honours Retry-After on 429', async () => {
    const { http, sleeps } = client([{ status: 429, headers: { 'retry-after': '7' } }, { status: 200, body: '{}' }]);
    await http.get('https://example.test/a');
    expect(sleeps).toEqual([7000]);
  });

  it('honours the IETF RateLimit reset (Hugging Face) on 429', async () => {
    const { http, sleeps } = client([{ status: 429, headers: { ratelimit: '"api";r=0;t=42' } }, { status: 200, body: '{}' }]);
    await http.get('https://huggingface.co/api/models');
    expect(sleeps).toEqual([42_000]);
  });

  it('fails with RateLimitError instead of sleeping for a long reset window', async () => {
    const { http, calls } = client([{ status: 429, headers: { 'retry-after': '3600' } }], { maxWaitMs: 60_000 });
    const error = await http.get('https://example.test/a').catch((e) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.message).toMatch(/retry after 3600s/);
    expect(calls).toHaveLength(1);
  });

  it('reports exhausted GitHub quota and suggests a token when unauthenticated', async () => {
    const reset = String(Math.floor(1_700_000_000_000 / 1000) + 1800);
    const { http } = client([{ status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset } }], { maxWaitMs: 60_000 });
    const error = await http.get('https://api.github.com/repos/a/b').catch((e) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.message).toMatch(/set a token/);
    expect(error.resetAt).toBeInstanceOf(Date);
  });

  it('does not retry client errors', async () => {
    const { http, calls } = client([{ status: 404, body: 'Not Found' }]);
    const error = await http.get('https://example.test/missing').catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  it('rejects malformed JSON with a clear error', async () => {
    const { http } = client([{ status: 200, body: '<html>maintenance</html>' }]);
    await expect(http.getJson('https://example.test/a')).rejects.toThrow(/malformed JSON/);
  });

  it('makes conditional requests and reports 304 as not modified', async () => {
    const { http, calls } = client([{ status: 304, headers: { etag: 'W/"1"' } }]);
    const { data, response } = await http.getJson('https://example.test/feed', { validators: { etag: 'W/"1"', lastModified: 'Tue, 01 Sep 2026 00:00:00 GMT' } });
    expect(data).toBeNull();
    expect(response.notModified).toBe(true);
    expect(calls[0]!.headers).toMatchObject({ 'If-None-Match': 'W/"1"', 'If-Modified-Since': 'Tue, 01 Sep 2026 00:00:00 GMT' });
  });

  it('spaces requests by the minimum interval', async () => {
    const { fetch } = fakeFetch([{ status: 200 }, { status: 200 }]);
    const sleeps: number[] = [];
    let now = 0;
    const http = new HttpClient({ fetch, minIntervalMs: 3000, sleep: async (ms) => { sleeps.push(ms); now += ms; }, now: () => now });
    await http.get('https://export.arxiv.org/api/query');
    now += 500;
    await http.get('https://export.arxiv.org/api/query');
    expect(sleeps).toEqual([2500]);
  });
});

describe('header parsing', () => {
  it('parses RateLimit and GitHub rate headers', () => {
    expect(parseRateLimit(new Headers({ ratelimit: '"api";r=499;t=200' }), 0)).toEqual({ remaining: 499, resetSeconds: 200 });
    expect(parseRateLimit(new Headers({ 'x-ratelimit-remaining': '12', 'x-ratelimit-reset': '1100' }), 1_000_000)).toEqual({ remaining: 12, resetSeconds: 100 });
    expect(parseRateLimit(new Headers(), 0)).toEqual({ remaining: null, resetSeconds: null });
  });

  it('finds rel="next" in Link headers', () => {
    expect(nextLink('<https://huggingface.co/api/models?cursor=abc%3D>; rel="next"')).toBe('https://huggingface.co/api/models?cursor=abc%3D');
    expect(nextLink('<https://api.github.com/x?page=1>; rel="prev", <https://api.github.com/x?page=3>; rel="next", <https://api.github.com/x?page=9>; rel="last"')).toBe('https://api.github.com/x?page=3');
    expect(nextLink('<https://api.github.com/x?page=9>; rel="last"')).toBeNull();
    expect(nextLink(null)).toBeNull();
  });
});
