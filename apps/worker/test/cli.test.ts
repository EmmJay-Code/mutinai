import { describe, expect, it } from 'vitest';
import { FIRST_RUN_WINDOW_MS, lastRunSince, LAST_RUN_OVERLAP_MS, linkTarget, namespaceForSource, parseCommand, parseSince } from '../src/cli';

describe('worker command line', () => {
  it('parses ingest options', () => {
    const { positionals, ingest } = parseCommand(['ingest', 'huggingface', '--limit', '25', '--since', '7d', '--dry-run', '--repos', 'Qwen/Qwen3-8B, meta-llama/Llama-3.1-8B', '--derivatives']);
    expect(positionals).toEqual(['ingest', 'huggingface']);
    expect(ingest).toEqual({ limit: 25, since: '7d', dryRun: true, repos: ['Qwen/Qwen3-8B', 'meta-llama/Llama-3.1-8B'], authors: undefined, known: false, derivatives: true, recheckUnresolved: false });
  });

  it('rejects invalid limits and unknown flags', () => {
    expect(() => parseCommand(['ingest', 'huggingface', '--limit', '0'])).toThrow(/positive integer/);
    expect(() => parseCommand(['ingest', 'huggingface', '--everything'])).toThrow();
  });

  it('parses since windows', () => {
    const now = new Date('2026-09-13T12:00:00Z');
    expect(parseSince('36h', now)).toEqual(new Date('2026-09-12T00:00:00Z'));
    expect(parseSince('7d', now)).toEqual(new Date('2026-09-06T12:00:00Z'));
    expect(parseSince('2026-09-01', now)).toEqual(new Date('2026-09-01T00:00:00Z'));
    expect(parseSince('last-run', now)).toBeNull();
    expect(() => parseSince('yesterday', now)).toThrow(/--since/);
  });

  it('derives last-run windows with overlap, bounded on the first run', () => {
    const now = new Date('2026-09-13T12:00:00Z');
    const last = new Date('2026-09-13T06:00:00Z');
    expect(lastRunSince(last, now).getTime()).toBe(last.getTime() - LAST_RUN_OVERLAP_MS);
    expect(lastRunSince(null, now).getTime()).toBe(now.getTime() - FIRST_RUN_WINDOW_MS);
  });

  it('maps review items to the identifier an editor links', () => {
    expect(linkTarget({ reason: 'unknown_base', subject: 'Qwen/Qwen3-8B-Base', externalId: 'Qwen/Qwen3-8B' })).toEqual({ value: 'Qwen/Qwen3-8B-Base', kinds: ['model_variant'] });
    expect(linkTarget({ reason: 'possible_reupload', subject: '', externalId: 'unsloth/Qwen3-8B' })).toEqual({ value: 'unsloth/Qwen3-8B', kinds: ['model_variant'] });
    expect(linkTarget({ reason: 'unknown_project', subject: '', externalId: 'ggml-org/whisper.cpp' })).toEqual({ value: 'ggml-org/whisper.cpp', kinds: ['project'] });
    expect(linkTarget({ reason: 'unmapped_license', subject: 'qwen', externalId: 'x' })).toBeNull();
    expect(namespaceForSource({ key: 'huggingface', kind: 'huggingface' })).toBe('huggingface');
    expect(namespaceForSource({ key: 'fixture-github', kind: 'fixture' })).toBe('github');
    expect(namespaceForSource({ key: 'fixture-rss', kind: 'fixture' })).toBeNull();
  });
});
