import { readFileSync } from 'node:fs';
import { HttpClient } from '../../src/http';
import type { HfModel } from '../../src/adapters/huggingface';

/** Real Hugging Face API responses recorded September 2026 (see test/recorded/README.md). */
export const RECORDED_HF: Record<string, string> = {
  'Qwen/Qwen3-8B': 'qwen3-8b',
  'Qwen/Qwen3-8B-GGUF': 'qwen3-8b-gguf',
  'Qwen/Qwen3-30B-A3B': 'qwen3-30b-a3b',
  'mlx-community/Qwen3-8B-4bit': 'mlx-qwen3-8b-4bit',
  'unsloth/Qwen3-235B-A22B-GGUF': 'unsloth-qwen3-235b-gguf',
  'NousResearch/Hermes-3-Llama-3.1-8B': 'hermes-3-llama-3.1-8b',
};

export function recordedHf(file: string): HfModel {
  return JSON.parse(readFileSync(new URL(`../recorded/huggingface/${file}.json`, import.meta.url), 'utf8'));
}

export type Route = (url: URL) => { status: number; body?: unknown; headers?: Record<string, string> } | undefined;

/**
 * An offline Hub: serves recorded model responses by repo id (with optional overrides), 401 for unknown repos
 * (as the real Hub does), and whatever extra routes a test adds. Records every URL requested.
 */
export function offlineHub(opts: { overrides?: Record<string, HfModel | { status: number }>; routes?: Route[] } = {}) {
  const requested: string[] = [];
  const fetch = (async (input: string) => {
    const url = new URL(input);
    requested.push(input);
    for (const route of opts.routes ?? []) {
      const reply = route(url);
      if (reply) return json(reply.status, reply.body, reply.headers);
    }
    const m = /^\/api\/models\/(.+)$/.exec(decodeURIComponent(url.pathname));
    if (m) {
      const override = opts.overrides?.[m[1]!];
      if (override && 'status' in override && !('id' in override)) return json(override.status, { error: 'Repository not found' });
      if (override) return json(200, override);
      const file = RECORDED_HF[m[1]!];
      return file ? json(200, recordedHf(file)) : json(401, { error: 'Repository not found' });
    }
    return json(404, { error: 'not found' });
  }) as unknown as typeof globalThis.fetch;
  const client = new HttpClient({ fetch, sleep: async () => {}, maxRetries: 1 });
  return { client, requested };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}
