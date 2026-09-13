import { describe, expect, it } from 'vitest';
import type { ProjectRecord, RawItem } from '../../src/adapter';
import { createGitHubAdapter, normalizeGitHubRepo, projectGitHubRepo, releaseSummaryLine, type GitHubRepo } from '../../src/adapters/github';
import { HttpError, RateLimitError } from '../../src/http';
import { memoryValidators, offlineGitHub, recordedGitHub } from '../support/github';

const llamaRepo = recordedGitHub('llama-cpp-repo') as Record<string, unknown>;
const llamaReleases = recordedGitHub('llama-cpp-releases') as Record<string, unknown>[];

async function collect(iterable: AsyncIterable<RawItem>) {
  const items: RawItem[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

describe('GitHub normalization (recorded responses)', () => {
  it('projects descriptive fields and release metadata without counters or full notes', () => {
    const snapshot = projectGitHubRepo(llamaRepo, llamaReleases, 'ggml-org/llama.cpp');
    const text = JSON.stringify(snapshot);
    for (const key of ['stargazers_count', 'forks_count', 'pushed_at', 'assets', 'author']) expect(text).not.toContain(key);
    expect(snapshot).toMatchObject({ full_name: 'ggml-org/llama.cpp', license: { spdx_id: 'MIT' }, language: 'C++', topics: ['ggml'] });
    expect(snapshot.releases).toHaveLength(3);
    for (const r of snapshot.releases!) expect((r.body ?? '').length).toBeLessThanOrEqual(280);
  });

  it('normalizes to a project with releases, keeping the prerelease flag for the pipeline to apply policy', () => {
    const [rec] = normalizeGitHubRepo({ externalId: 'x', fetchedAt: new Date(), contentType: 'application/json', payload: projectGitHubRepo(llamaRepo, llamaReleases, 'ggml-org/llama.cpp') }) as ProjectRecord[];
    expect(rec).toMatchObject({ type: 'project', identifier: { namespace: 'github', value: 'ggml-org/llama.cpp' }, fields: { summary: 'LLM inference in C/C++', homepageUrl: 'https://llama.app' } });
    expect(rec!.releases!.map((r) => r.prerelease)).toEqual([true, true, true]);
  });

  it('summarises release notes with their first prose line, not a markdown heading or image', () => {
    expect(releaseSummaryLine("## What's Changed\n* Fix KV cache reuse by @dev in https://github.com/x/y/pull/1")).toBe('Fix KV cache reuse by @dev in https://github.com/x/y/pull/1');
    expect(releaseSummaryLine('# v0.29.0\n\n## Highlights\nThis release features **1,200 commits** from `320` contributors.')).toBe('This release features 1,200 commits from 320 contributors.');
    expect(releaseSummaryLine('<img width="600" alt="ollama" src="x" />\n\n### Added\n- [ChatGPT Desktop](https://x) support')).toBe('ChatGPT Desktop support');
    expect(releaseSummaryLine('Keep num_ctx and top_k as written')).toBe('Keep num_ctx and top_k as written');
    expect(releaseSummaryLine('## Only headings\n---')).toBeNull();
    expect(releaseSummaryLine(null)).toBeNull();
  });

  it('keeps the requested identity when GitHub redirects to a renamed repository', () => {
    const payload: GitHubRepo = { ...projectGitHubRepo({ ...llamaRepo, full_name: 'ggml-org/llama-cpp-renamed' }, [], 'ggml-org/llama.cpp') };
    const [rec] = normalizeGitHubRepo({ externalId: 'x', fetchedAt: new Date(), contentType: 'application/json', payload });
    expect(rec).toMatchObject({ identifier: { value: 'ggml-org/llama.cpp' } });
  });
});

describe('live GitHub adapter', () => {
  const repos = { 'ggml-org/llama.cpp': { repo: llamaRepo, releases: llamaReleases }, 'ollama/ollama': { repo: recordedGitHub('ollama-repo'), releases: [] } };

  it('fetches repository and releases with GitHub headers and records counters as metrics', async () => {
    const { client, requested } = offlineGitHub({ repos });
    const items = await collect(createGitHubAdapter({ client, repos: ['ggml-org/llama.cpp', 'Ollama/Ollama'] }).fetch({}));
    expect(items.map((i) => i.externalId)).toEqual(['ggml-org/llama.cpp', 'ollama/ollama']);
    expect(items[0]!.metrics).toEqual([{ identifier: { namespace: 'github', value: 'ggml-org/llama.cpp' }, values: { stars: 128036, forks: 23106, watchers: 838 } }]);
    const repoRequest = requested.find((r) => r.url.endsWith('/repos/ggml-org/llama.cpp'))!;
    expect(repoRequest.headers).toMatchObject({ Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
    expect(requested.find((r) => r.url.includes('/releases'))!.url).toMatch(/per_page=10/);
  });

  it('uses conditional requests: unchanged repositories are skipped on the next run', async () => {
    const { client, requested } = offlineGitHub({ repos });
    const validators = memoryValidators();
    const adapter = createGitHubAdapter({ client, repos: ['ggml-org/llama.cpp'] });
    expect(await collect(adapter.fetch({ validators }))).toHaveLength(1);
    expect(validators.entries.size).toBe(2);
    requested.length = 0;
    expect(await collect(adapter.fetch({ validators }))).toHaveLength(0);
    expect(requested.filter((r) => r.headers['If-None-Match'])).toHaveLength(2);
  });

  it('does not store validators when processing the item fails', async () => {
    const { client } = offlineGitHub({ repos });
    const validators = memoryValidators();
    const iterator = createGitHubAdapter({ client, repos: ['ggml-org/llama.cpp'] }).fetch({ validators })[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.(undefined); // consumer stopped (e.g. processing threw) before the generator resumed
    expect(validators.entries.size).toBe(0);
  });

  it('reports missing repositories as unavailable', async () => {
    const { client } = offlineGitHub({ repos });
    const [item] = await collect(createGitHubAdapter({ client, repos: ['ggml-org/gone'] }).fetch({}));
    expect(item!.payload).toMatchObject({ requested_full_name: 'ggml-org/gone', unavailable: { status: 404 } });
    expect(normalizeGitHubRepo(item!)).toEqual([expect.objectContaining({ type: 'unsupported', reason: 'source_unavailable' })]);
  });

  it('stays within the remaining quota and fails clearly when it is exhausted', async () => {
    const logs: string[] = [];
    const tight = offlineGitHub({ repos, remaining: 3 });
    const items = await collect(createGitHubAdapter({ client: tight.client, repos: ['ggml-org/llama.cpp', 'ollama/ollama'] }).fetch({ log: (m) => logs.push(m) }));
    expect(items).toHaveLength(1);
    expect(logs.join('\n')).toMatch(/ingesting 1 of 2 repositories.*GITHUB_TOKEN/);

    const empty = offlineGitHub({ repos, remaining: 1 });
    await expect(collect(createGitHubAdapter({ client: empty.client, repos: ['ggml-org/llama.cpp'] }).fetch({}))).rejects.toBeInstanceOf(RateLimitError);
  });

  it('rejects malformed payloads', async () => {
    const { client } = offlineGitHub({ repos: { 'a/b': { repo: { nope: true }, releases: [] } } });
    await expect(collect(createGitHubAdapter({ client, repos: ['a/b'] }).fetch({}))).rejects.toBeInstanceOf(HttpError);
    expect(() => createGitHubAdapter({ client, repos: [] })).toThrow(/no repositories/);
  });
});
