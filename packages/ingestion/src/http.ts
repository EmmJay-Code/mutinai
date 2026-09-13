/**
 * HTTP client for live source adapters: explicit User-Agent, timeouts, bounded retries with backoff, rate-limit
 * awareness (Retry-After, IETF `RateLimit`, GitHub `x-ratelimit-*`), conditional requests and clear errors.
 * No silent fallbacks: a request either returns a real response or throws.
 */

export const DEFAULT_USER_AGENT = 'Mutinai-Ingest/0.1 (+https://mutinai.com)';

export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    message: string,
    readonly bodySnippet?: string,
  ) {
    super(message);
  }
}

/** The source asked us to wait longer than we are willing to (or the quota is exhausted). Retry after `resetAt`. */
export class RateLimitError extends HttpError {
  constructor(url: string, status: number, readonly resetAt: Date | null, message: string) {
    super(url, status, message);
  }
}

export interface RateLimitInfo {
  remaining: number | null;
  /** Seconds until the window resets. */
  resetSeconds: number | null;
}

export interface HttpClientOptions {
  userAgent?: string;
  /** Sent as `Authorization: Bearer …` when present. */
  token?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRetries?: number;
  /** Longest single wait we accept for a rate limit or Retry-After before failing with RateLimitError. */
  maxWaitMs?: number;
  /** Minimum spacing between requests (politeness; e.g. arXiv asks for 3 s). */
  minIntervalMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (message: string) => void;
}

export interface RequestOptions {
  accept?: string;
  /** Validators from a previous response; a 304 returns `notModified: true` with no body. */
  validators?: { etag?: string; lastModified?: string } | null;
  signal?: AbortSignal;
}

export interface HttpResponse {
  url: string;
  status: number;
  headers: Headers;
  notModified: boolean;
  body: string;
  validators: { etag?: string; lastModified?: string };
  rateLimit: RateLimitInfo;
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

export class HttpClient {
  private readonly opts: Required<Omit<HttpClientOptions, 'token' | 'headers' | 'log'>> & Pick<HttpClientOptions, 'token' | 'headers' | 'log'>;
  private lastRequestAt = Number.NEGATIVE_INFINITY;

  constructor(opts: HttpClientOptions = {}) {
    this.opts = {
      userAgent: opts.userAgent ?? DEFAULT_USER_AGENT,
      token: opts.token,
      headers: opts.headers,
      timeoutMs: opts.timeoutMs ?? 30_000,
      maxRetries: opts.maxRetries ?? 4,
      maxWaitMs: opts.maxWaitMs ?? 120_000,
      minIntervalMs: opts.minIntervalMs ?? 0,
      fetch: opts.fetch ?? globalThis.fetch.bind(globalThis),
      sleep: opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
      now: opts.now ?? Date.now,
      log: opts.log,
    };
  }

  get authenticated(): boolean {
    return Boolean(this.opts.token);
  }

  async get(url: string, req: RequestOptions = {}): Promise<HttpResponse> {
    const headers: Record<string, string> = { 'User-Agent': this.opts.userAgent, Accept: req.accept ?? 'application/json', ...this.opts.headers };
    if (this.opts.token) headers.Authorization = `Bearer ${this.opts.token}`;
    if (req.validators?.etag) headers['If-None-Match'] = req.validators.etag;
    if (req.validators?.lastModified) headers['If-Modified-Since'] = req.validators.lastModified;

    for (let attempt = 0; ; attempt++) {
      await this.pace();
      let res: Response;
      try {
        const signal = req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(this.opts.timeoutMs)]) : AbortSignal.timeout(this.opts.timeoutMs);
        res = await this.opts.fetch(url, { headers, signal, redirect: 'follow' });
      } catch (error) {
        if (req.signal?.aborted) throw error;
        if (attempt >= this.opts.maxRetries) throw new HttpError(url, 0, `request failed after ${attempt + 1} attempts: ${describe(error)}`);
        await this.backoff(url, attempt, null, describe(error));
        continue;
      }

      const rateLimit = parseRateLimit(res.headers, this.opts.now());
      const validators = { etag: res.headers.get('etag') ?? undefined, lastModified: res.headers.get('last-modified') ?? undefined };
      if (res.status === 304) return { url, status: 304, headers: res.headers, notModified: true, body: '', validators, rateLimit };
      if (res.ok) {
        const body = await res.text();
        // Quota just ran out: wait for the window to reset before the next request when that is short, rather than
        // spending the next request on a guaranteed 429.
        if (rateLimit.remaining === 0 && rateLimit.resetSeconds != null && rateLimit.resetSeconds * 1000 <= this.opts.maxWaitMs) {
          this.opts.log?.(`${hostOf(url)}: rate-limit window exhausted; waiting ${rateLimit.resetSeconds}s`);
          this.lastRequestAt = this.opts.now() + rateLimit.resetSeconds * 1000 - this.opts.minIntervalMs;
        }
        return { url, status: res.status, headers: res.headers, notModified: false, body, validators, rateLimit };
      }

      const body = (await res.text().catch(() => '')).slice(0, 300);
      const limited = res.status === 429 || (res.status === 403 && rateLimit.remaining === 0);
      if ((RETRYABLE.has(res.status) || limited) && attempt < this.opts.maxRetries) {
        const waitMs = retryDelayMs(res.headers, rateLimit, this.opts.now());
        if (waitMs != null && waitMs > this.opts.maxWaitMs) {
          throw new RateLimitError(url, res.status, new Date(this.opts.now() + waitMs), `${hostOf(url)} rate limit: retry after ${Math.ceil(waitMs / 1000)}s (longer than the ${Math.round(this.opts.maxWaitMs / 1000)}s we wait)${this.opts.token ? '' : '; unauthenticated: set a token to raise the limit'}`);
        }
        await this.backoff(url, attempt, waitMs, `HTTP ${res.status}`);
        continue;
      }
      if (limited) {
        const reset = rateLimit.resetSeconds != null ? new Date(this.opts.now() + rateLimit.resetSeconds * 1000) : null;
        throw new RateLimitError(url, res.status, reset, `${hostOf(url)} rate limit exhausted${reset ? `; resets at ${reset.toISOString()}` : ''}${this.opts.token ? '' : ' (unauthenticated: set a token to raise the limit)'}`);
      }
      throw new HttpError(url, res.status, `GET ${url} → HTTP ${res.status}${body ? `: ${body.replace(/\s+/g, ' ')}` : ''}`, body);
    }
  }

  async getJson<T>(url: string, req: RequestOptions = {}): Promise<{ data: T | null; response: HttpResponse }> {
    const response = await this.get(url, req);
    if (response.notModified) return { data: null, response };
    try {
      return { data: JSON.parse(response.body) as T, response };
    } catch {
      throw new HttpError(url, response.status, `GET ${url} returned malformed JSON`, response.body.slice(0, 300));
    }
  }

  private async pace() {
    const wait = this.lastRequestAt + this.opts.minIntervalMs - this.opts.now();
    if (wait > 0) await this.opts.sleep(wait);
    this.lastRequestAt = this.opts.now();
  }

  private async backoff(url: string, attempt: number, waitMs: number | null, why: string) {
    const ms = waitMs ?? Math.min(this.opts.maxWaitMs, 1000 * 2 ** attempt + Math.floor(Math.random() * 250));
    this.opts.log?.(`${hostOf(url)}: ${why}; retrying in ${Math.ceil(ms / 1000)}s (attempt ${attempt + 2}/${this.opts.maxRetries + 1})`);
    await this.opts.sleep(ms);
  }
}

/** Reads `RateLimit: "api";r=499;t=200` (IETF draft, Hugging Face) or `x-ratelimit-remaining/reset` (GitHub). */
export function parseRateLimit(headers: Headers, now: number): RateLimitInfo {
  const ietf = headers.get('ratelimit');
  if (ietf) {
    const r = /(?:^|;)\s*r=(\d+)/.exec(ietf)?.[1];
    const t = /(?:^|;)\s*t=(\d+)/.exec(ietf)?.[1];
    return { remaining: r != null ? Number(r) : null, resetSeconds: t != null ? Number(t) : null };
  }
  const remaining = headers.get('x-ratelimit-remaining');
  const reset = headers.get('x-ratelimit-reset');
  return {
    remaining: remaining != null ? Number(remaining) : null,
    resetSeconds: reset != null ? Math.max(0, Number(reset) - Math.floor(now / 1000)) : null,
  };
}

function retryDelayMs(headers: Headers, rateLimit: RateLimitInfo, now: number): number | null {
  const retryAfter = headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1000;
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.max(0, date - now);
  }
  if (rateLimit.remaining === 0 && rateLimit.resetSeconds != null) return rateLimit.resetSeconds * 1000;
  return null;
}

/** Returns the `rel="next"` URL from an RFC 8288 Link header. */
export function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(/,(?=\s*<)/)) {
    const m = /<([^>]+)>\s*;(.*)/.exec(part.trim());
    if (m && /\brel="?next"?/.test(m[2]!)) return m[1]!;
  }
  return null;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

function describe(error: unknown): string {
  if (error instanceof Error) return error.name === 'TimeoutError' ? 'timed out' : `${error.message}${error.cause instanceof Error ? ` (${error.cause.message})` : ''}`;
  return String(error);
}
