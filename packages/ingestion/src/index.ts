export * from './adapter';
export { canonicalJson, sha256 } from './hash';
export { FileSystemObjectStore, MemoryObjectStore, type ObjectStore } from './object-store';
export { processItem, runAdapter, type ItemOutcome, type PipelineDeps, type RunStats } from './pipeline';
export { createFixtureHuggingFaceAdapter, normalizeHuggingFaceModel, FIXTURE_HUGGINGFACE_SOURCE, type HfModel } from './adapters/huggingface';
export { createFixtureGitHubAdapter, normalizeGitHubRepo, FIXTURE_GITHUB_SOURCE, type GitHubRepo } from './adapters/github';
export { createFixtureRssAdapter, normalizeFeedItem, type FeedItem } from './adapters/rss';

import type { SourceAdapter } from './adapter';
import { createFixtureGitHubAdapter } from './adapters/github';
import { createFixtureHuggingFaceAdapter } from './adapters/huggingface';
import { createFixtureRssAdapter } from './adapters/rss';

/** Registry used by the worker CLI. Live adapters register here when they exist. */
export const ADAPTERS: Record<string, () => SourceAdapter> = {
  'fixture-huggingface': () => createFixtureHuggingFaceAdapter(),
  'fixture-github': () => createFixtureGitHubAdapter(),
  'fixture-rss': () => createFixtureRssAdapter(),
};
