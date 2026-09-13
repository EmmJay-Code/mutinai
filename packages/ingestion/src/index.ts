export * from './adapter';
export { canonicalJson, sha256 } from './hash';
export { FileSystemObjectStore, MemoryObjectStore, type ObjectStore } from './object-store';
export {
  dryRunAdapter,
  emptyStats,
  IngestionBusyError,
  processItem,
  releaseDedupeKey,
  REVIEW_REASONS,
  runAdapter,
  type ItemOutcome,
  type PipelineDeps,
  type ReviewReason,
  type ReviewRequest,
  type RunStats,
} from './pipeline';
export { DEFAULT_USER_AGENT, HttpClient, HttpError, nextLink, parseRateLimit, RateLimitError, type HttpClientOptions, type HttpResponse } from './http';
export {
  createFixtureHuggingFaceAdapter,
  createHuggingFaceAdapter,
  FIXTURE_HUGGINGFACE_SOURCE,
  ggufSchemes,
  HUGGINGFACE_SOURCE,
  normalizeHuggingFaceModel,
  projectHfModel,
  suggestVariantKind,
  type HfModel,
  type HuggingFaceAdapterOptions,
} from './adapters/huggingface';
export {
  createFixtureGitHubAdapter,
  createGitHubAdapter,
  FIXTURE_GITHUB_SOURCE,
  GITHUB_API_HEADERS,
  GITHUB_SOURCE,
  normalizeGitHubRepo,
  projectGitHubRepo,
  type GitHubAdapterOptions,
  type GitHubRepo,
} from './adapters/github';
export { createFixtureRssAdapter, normalizeFeedItem, type FeedItem } from './adapters/rss';
export { canonicalUrl, createFeedAdapter, excerpt, FEEDS_SOURCE, normalizeFeedEntry, parseFeed, type FeedConfig, type FeedEntrySnapshot } from './adapters/feed';

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
