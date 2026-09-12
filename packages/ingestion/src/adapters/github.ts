/**
 * GitHub repository normalizer + fixture adapter, written against `GET /repos/{owner}/{repo}` plus the latest release.
 */
import { readFile } from 'node:fs/promises';
import type { NormalizedRecord, RawItem, SourceAdapter, SourceDescriptor } from '../adapter';

export interface GitHubRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  homepage: string | null;
  language: string | null;
  license: { spdx_id: string } | null;
  pushed_at: string;
  latest_release: { tag_name: string; name: string | null; published_at: string; html_url: string; body: string | null } | null;
}

export function normalizeGitHubRepo(item: RawItem): NormalizedRecord[] {
  const repo = item.payload as GitHubRepo;
  return [
    {
      type: 'project',
      identifier: { namespace: 'github', value: repo.full_name.toLowerCase(), url: repo.html_url },
      fields: {
        summary: repo.description ?? undefined,
        homepageUrl: repo.homepage || null,
        primaryLanguage: repo.language,
      },
      release: repo.latest_release
        ? {
            tag: repo.latest_release.tag_name,
            title: repo.latest_release.name ?? repo.latest_release.tag_name,
            publishedAt: repo.latest_release.published_at,
            url: repo.latest_release.html_url,
            body: repo.latest_release.body ?? undefined,
          }
        : undefined,
    },
  ];
}

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
