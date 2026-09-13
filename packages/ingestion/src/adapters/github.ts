/**
 * GitHub repositories: normalizer, live adapter and fixture adapter.
 *
 * Live requests: `GET /repos/{owner}/{repo}` and `GET /repos/{owner}/{repo}/releases` (REST, API version 2022-11-28),
 * for repositories Mutinai already models as projects. Snapshots hold descriptive fields and release metadata (tag,
 * title, date, URL, first line of the notes); stars/forks/watchers are recorded as metrics.
 */
import { readFile } from 'node:fs/promises';
import type { NormalizedRecord, RawItem, ReleaseInfo, SourceAdapter, SourceDescriptor } from '../adapter';
import { HttpError, RateLimitError, type HttpClient, type HttpResponse } from '../http';

export interface GitHubReleaseSnapshot {
  tag_name: string;
  name: string | null;
  published_at: string | null;
  html_url: string;
  prerelease?: boolean;
  /** First non-empty line of the release notes, at most 280 characters. Full notes are never stored. */
  body: string | null;
}

export interface GitHubRepo {
  full_name: string;
  /** The repository as Mutinai requested it; identity stays stable if GitHub redirects to a renamed repo. */
  requested_full_name?: string;
  html_url: string;
  description: string | null;
  homepage: string | null;
  language: string | null;
  license: { spdx_id: string } | null;
  archived?: boolean;
  topics?: string[];
  /** Fixture shape. */
  pushed_at?: string;
  latest_release?: GitHubReleaseSnapshot | null;
  /** Live shape: most recent published releases. */
  releases?: GitHubReleaseSnapshot[];
  unavailable?: { status: number };
}

/**
 * A readable one-line summary of release notes: the first prose line, skipping headings, HTML, images, tables, rules and
 * code fences, with list markers and inline markdown removed. At most 280 characters; full notes are never stored.
 */
export function releaseSummaryLine(body: string | null | undefined): string | null {
  for (const raw of body?.split('\n') ?? []) {
    const line = raw.trim();
    if (!line || /^(#|<|!\[|\||```|[-*_=]{3,}$)/.test(line)) continue;
    const text = line
      .replace(/^([-*+]|\d+\.)\s+/, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/(\*\*|\*|`)(.+?)\1/g, '$2')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length >= 3) return text.slice(0, 280);
  }
  return null;
}

const toRelease = (r: GitHubReleaseSnapshot): ReleaseInfo | null =>
  r.published_at ? { tag: r.tag_name, title: r.name ?? r.tag_name, publishedAt: r.published_at, url: r.html_url, body: r.body ?? undefined, prerelease: r.prerelease ?? false } : null;

export function normalizeGitHubRepo(item: RawItem): NormalizedRecord[] {
  const repo = item.payload as GitHubRepo;
  const name = (repo.requested_full_name ?? repo.full_name)?.toLowerCase();
  if (!name || !name.includes('/')) throw new Error('payload has no repository name');
  const identifier = { namespace: 'github', value: name, url: repo.html_url ?? `https://github.com/${name}` };
  if (repo.unavailable) {
    return [{ type: 'unsupported', identifier, reason: 'source_unavailable', detail: `GitHub returned HTTP ${repo.unavailable.status} (deleted, renamed or private)` }];
  }
  return [
    {
      type: 'project',
      identifier,
      fields: {
        summary: repo.description ?? undefined,
        homepageUrl: repo.homepage || null,
        primaryLanguage: repo.language,
      },
      release: repo.latest_release ? (toRelease(repo.latest_release) ?? undefined) : undefined,
      releases: repo.releases?.map(toRelease).filter((r): r is ReleaseInfo => r !== null),
    },
  ];
}

/** The retained snapshot: descriptive fields and release metadata; no counters, timestamps of activity, or full notes. */
export function projectGitHubRepo(repo: Record<string, unknown>, releases: Record<string, unknown>[], requested: string): GitHubRepo {
  const license = repo.license as { spdx_id?: string } | null;
  return {
    full_name: String(repo.full_name),
    requested_full_name: requested,
    html_url: String(repo.html_url),
    description: (repo.description as string | null) ?? null,
    homepage: (repo.homepage as string | null) || null,
    language: (repo.language as string | null) ?? null,
    license: license?.spdx_id ? { spdx_id: license.spdx_id } : null,
    archived: Boolean(repo.archived),
    topics: Array.isArray(repo.topics) ? [...(repo.topics as string[])].sort() : [],
    releases: releases
      .filter((r) => !r.draft)
      .map((r) => ({
        tag_name: String(r.tag_name),
        name: (r.name as string | null) || null,
        published_at: (r.published_at as string | null) ?? null,
        html_url: String(r.html_url),
        prerelease: Boolean(r.prerelease),
        body: releaseSummaryLine(r.body as string | null),
      })),
  };
}

// ─── Live adapter ────────────────────────────────────────────────────────────

export const GITHUB_SOURCE: SourceDescriptor = {
  key: 'github',
  name: 'GitHub',
  kind: 'github',
  baseUrl: 'https://github.com',
  priority: 60,
};

export const GITHUB_API_HEADERS = { 'X-GitHub-Api-Version': '2022-11-28' };
const ACCEPT = 'application/vnd.github+json';
const REQUESTS_PER_REPO = 2;

export interface GitHubAdapterOptions {
  client: HttpClient;
  /** `owner/repo` names, normally the projects Mutinai already models. No discovery crawl. */
  repos: string[];
  apiUrl?: string;
  releasesPerRepo?: number;
}

export function createGitHubAdapter(opts: GitHubAdapterOptions): SourceAdapter {
  const repos = [...new Set(opts.repos.map((r) => r.toLowerCase()))];
  if (!repos.length) throw new Error('github: no repositories selected');
  const api = (opts.apiUrl ?? 'https://api.github.com').replace(/\/$/, '');
  const perRepo = Math.min(opts.releasesPerRepo ?? 10, 100);

  const getJson = async (response: HttpResponse) => {
    try {
      return JSON.parse(response.body) as unknown;
    } catch {
      throw new HttpError(response.url, response.status, `GET ${response.url} returned malformed JSON`);
    }
  };

  return {
    source: GITHUB_SOURCE,
    normalize: normalizeGitHubRepo,
    async *fetch(ctx) {
      // /rate_limit does not count against the quota; use it to stay within budget instead of failing mid-run.
      const quota = await opts.client.get(`${api}/rate_limit`, { accept: ACCEPT, headers: GITHUB_API_HEADERS, signal: ctx.signal });
      const core = ((await getJson(quota)) as { resources?: { core?: { remaining?: number; reset?: number } } }).resources?.core;
      let selected = repos;
      if (core?.remaining != null && core.remaining < repos.length * REQUESTS_PER_REPO) {
        const fits = Math.floor(core.remaining / REQUESTS_PER_REPO);
        const resetAt = core.reset ? new Date(core.reset * 1000) : null;
        const hint = opts.client.authenticated ? '' : '; set GITHUB_TOKEN to raise the limit to 5,000/hour';
        if (fits === 0) throw new RateLimitError(`${api}/rate_limit`, 200, resetAt, `GitHub quota exhausted${resetAt ? ` until ${resetAt.toISOString()}` : ''}${hint}`);
        ctx.log?.(`github: ${core.remaining} requests left; ingesting ${fits} of ${repos.length} repositories this run${hint}`);
        selected = repos.slice(0, fits);
      }

      let yielded = 0;
      for (const name of selected) {
        if (ctx.limit != null && yielded >= ctx.limit) return;
        const repoUrl = `${api}/repos/${name}`;
        const releasesUrl = `${api}/repos/${name}/releases?per_page=${perRepo}`;
        const request = async (url: string, conditional: boolean) =>
          opts.client.get(url, { accept: ACCEPT, headers: GITHUB_API_HEADERS, signal: ctx.signal, validators: conditional ? await ctx.validators?.get(url) : null });

        let repoRes: HttpResponse;
        try {
          repoRes = await request(repoUrl, true);
        } catch (error) {
          if (error instanceof HttpError && !(error instanceof RateLimitError) && (error.status === 404 || error.status === 451)) {
            yielded += 1;
            yield { externalId: name, url: `https://github.com/${name}`, fetchedAt: new Date(), contentType: 'application/json', payload: { full_name: name, requested_full_name: name, html_url: `https://github.com/${name}`, unavailable: { status: error.status } } };
            continue;
          }
          throw error;
        }
        let releasesRes = await request(releasesUrl, true);
        if (repoRes.notModified && releasesRes.notModified) {
          ctx.log?.(`github: ${name} not modified`);
          continue;
        }
        if (repoRes.notModified) repoRes = await request(repoUrl, false);
        if (releasesRes.notModified) releasesRes = await request(releasesUrl, false);

        const repo = (await getJson(repoRes)) as Record<string, unknown>;
        const releases = await getJson(releasesRes);
        if (typeof repo?.full_name !== 'string') throw new HttpError(repoUrl, repoRes.status, `unexpected repository payload for ${name}`);
        if (!Array.isArray(releases)) throw new HttpError(releasesUrl, releasesRes.status, `expected a JSON array of releases for ${name}`);

        const values = Object.fromEntries(
          Object.entries({ stars: repo.stargazers_count, forks: repo.forks_count, watchers: repo.subscribers_count }).filter(([, v]) => typeof v === 'number'),
        ) as Record<string, number>;
        yielded += 1;
        yield {
          externalId: name,
          url: String(repo.html_url),
          fetchedAt: new Date(),
          contentType: 'application/json',
          payload: projectGitHubRepo(repo, releases as Record<string, unknown>[], name),
          metrics: [{ identifier: { namespace: 'github', value: name }, values }],
        };
        // Only after the item was processed: a failed run must not leave validators that skip unprocessed data.
        await ctx.validators?.set(repoUrl, repoRes.validators);
        await ctx.validators?.set(releasesUrl, releasesRes.validators);
      }
    },
  };
}

// ─── Fixture adapter ─────────────────────────────────────────────────────────

export const FIXTURE_GITHUB_SOURCE: SourceDescriptor = {
  key: 'fixture-github',
  name: 'GitHub (fixture)',
  kind: 'fixture',
  baseUrl: 'https://github.com',
  priority: 40,
};

export function createFixtureGitHubAdapter(opts: { repos?: GitHubRepo[]; source?: SourceDescriptor } = {}): SourceAdapter {
  return {
    source: opts.source ?? FIXTURE_GITHUB_SOURCE,
    async *fetch() {
      const repos: GitHubRepo[] = opts.repos ?? JSON.parse(await readFile(new URL('../../fixtures/github-repos.json', import.meta.url), 'utf8'));
      for (const repo of repos) {
        yield { externalId: repo.full_name.toLowerCase(), url: repo.html_url, fetchedAt: new Date(), contentType: 'application/json', payload: repo };
      }
    },
    normalize: normalizeGitHubRepo,
  };
}
