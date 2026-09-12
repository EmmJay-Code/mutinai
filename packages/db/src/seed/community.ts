/**
 * Seed community data. Designed to exercise privacy boundaries: private configurations, private and rejected
 * submissions, unlisted and removed reviews, and accounts with and without email.
 */
import type { ComputeBackend, ModerationStatus, Role, VerificationState, Visibility } from '@mutinai/domain';

export const users: { handle: string; displayName: string; email: string | null; bio: string | null; roles: Role[] }[] = [
  { handle: 'kestrel', displayName: 'Kestrel', email: 'kestrel@example.org', bio: 'Community moderator. Mostly Apple silicon benchmarks.', roles: ['moderator'] },
  { handle: 'tokenwright', displayName: 'Tokenwright', email: null, bio: 'Local coding agents on a single 4090.', roles: [] },
  { handle: 'basement-cluster', displayName: 'Basement Cluster', email: 'ops@basement.example', bio: 'Used 3090s and loud fans.', roles: [] },
  { handle: 'quietmodel', displayName: 'quietmodel', email: null, bio: null, roles: [] },
];

export const userConfigs: {
  owner: string; key: string; name: string; visibility: Visibility; components: { device: string; count: number }[];
  systemRamGb: number; systemRamBandwidthGbps?: number; unifiedMemoryGb?: number;
}[] = [
  { owner: 'quietmodel', key: 'office-mac', name: 'Office Mac mini (do not share)', visibility: 'private', components: [{ device: 'apple-m4-pro-20c', count: 1 }], systemRamGb: 0, unifiedMemoryGb: 48 },
  { owner: 'basement-cluster', key: 'triple-3090', name: 'Triple 3090 rack', visibility: 'public', components: [{ device: 'nvidia-rtx-3090', count: 3 }, { device: 'amd-ryzen-9-7950x', count: 1 }], systemRamGb: 128, systemRamBandwidthGbps: 83 },
];

export const reviews: {
  author: string; subject: { kind: 'model_variant' | 'hardware_device' | 'project' | 'hardware_configuration' | 'model_artifact'; slug: string };
  title: string; body: string; ratings: Record<string, number>; hardware?: string; visibility?: Visibility; status?: ModerationStatus;
}[] = [
  {
    author: 'tokenwright', subject: { kind: 'model_variant', slug: 'qwen2-5-coder-32b-instruct' }, hardware: 'rtx-4090-workstation',
    title: 'Best local coding model I have used at 24 GB',
    body: 'Q4_K_M with 16K context fits on the 4090 with room to spare. Excellent at targeted edits in Aider; weaker at long agentic loops where it sometimes loses the plan.',
    ratings: { coding: 5, reasoning: 3, agentic: 3, quality: 4, hardware_efficiency: 4 },
  },
  {
    author: 'basement-cluster', subject: { kind: 'hardware_device', slug: 'nvidia-rtx-3090' },
    title: 'Still the value pick for VRAM per dollar',
    body: 'Bought three used. Power limits at 280W lose very little generation speed. Budget time for riser cables and airflow.',
    ratings: { value: 5, reliability: 4, ease_of_setup: 3, speed: 4 },
  },
  {
    author: 'kestrel', subject: { kind: 'project', slug: 'llama-cpp' },
    title: 'The foundation everything else runs on',
    body: 'Fastest path to new model support and runs on everything. The flags surface is huge; defaults change between builds, so pin versions when benchmarking.',
    ratings: { quality: 5, reliability: 4, ease_of_setup: 3, speed: 5 },
  },
  {
    author: 'tokenwright', subject: { kind: 'project', slug: 'ollama' },
    title: 'Easy setup, fewer knobs',
    body: 'Great for getting teammates started. I switch to llama.cpp directly when I need specific KV cache or offload settings.',
    ratings: { ease_of_setup: 5, speed: 3, reliability: 4 },
  },
  {
    author: 'quietmodel', subject: { kind: 'model_variant', slug: 'qwen3-30b-a3b' },
    title: 'MoE makes a 48 GB Mac feel fast',
    body: 'Runs at interactive speeds in MLX 4-bit. Thinking mode helps on multi-step problems; turn it off for quick chat.',
    ratings: { reasoning: 4, agentic: 4, coding: 4, hardware_efficiency: 5 },
  },
  {
    author: 'quietmodel', subject: { kind: 'hardware_configuration', slug: 'mac-mini-m4-pro-48gb' },
    title: 'Notes on my mini (shared by link only)',
    body: 'Quiet and efficient. Prompt processing is the bottleneck for long documents.',
    ratings: { value: 4, speed: 3, ease_of_setup: 5 }, visibility: 'unlisted',
  },
  {
    author: 'kestrel', subject: { kind: 'model_variant', slug: 'deepseek-r1-distill-qwen-32b' },
    title: 'Strong reasoning, verbose',
    body: 'Good on math and planning tasks. Produces long reasoning traces, so budget context and generation time accordingly.',
    ratings: { reasoning: 4, coding: 3, hardware_efficiency: 3 },
  },
  {
    author: 'basement-cluster', subject: { kind: 'model_variant', slug: 'phi-4' },
    title: 'Check out my discount GPU store',
    body: 'Removed by moderators for spam.',
    ratings: { quality: 5 }, status: 'removed',
  },
];

export const submissions: {
  key: string; submitter: string; artifact: string; benchmark: 'llama-bench' | 'interactive-throughput';
  hardware: { reference: string } | { user: string }; runtime: string; runtimeVersion: string; backend: ComputeBackend;
  contextLength: number; batchSize?: number; gpuLayers?: number | null; kvCacheType?: string; flashAttention?: boolean; os?: string; driverVersion?: string;
  parameters?: Record<string, string | number | boolean>; notes?: string; values: Record<string, number>;
  visibility?: Visibility; status?: ModerationStatus; verification?: VerificationState; createdAt: string;
}[] = [
  {
    key: 'tw-4090-l8', submitter: 'tokenwright', artifact: 'llama-3-1-8b-instruct--q4-k-m', benchmark: 'llama-bench', hardware: { reference: 'rtx-4090-workstation' },
    runtime: 'llama-cpp', runtimeVersion: 'b4610', backend: 'cuda', contextLength: 4096, batchSize: 512, kvCacheType: 'f16', flashAttention: true, os: 'Ubuntu 24.04', driverVersion: '565.77',
    values: { pp512: 11850, tg128: 131 }, verification: 'verified', createdAt: '2025-02-10T18:22:00Z',
  },
  {
    key: 'bc-3090-l70', submitter: 'basement-cluster', artifact: 'llama-3-3-70b-instruct--q4-k-m', benchmark: 'llama-bench', hardware: { reference: 'dual-rtx-3090' },
    runtime: 'llama-cpp', runtimeVersion: 'b4610', backend: 'cuda', contextLength: 4096, kvCacheType: 'f16', flashAttention: true, os: 'Debian 12', driverVersion: '560.35',
    parameters: { split_mode: 'layer', power_limit_w: 280 }, notes: 'Both cards power limited to 280W.',
    values: { pp512: 372, tg128: 17.1 }, verification: 'verified', createdAt: '2025-01-05T09:10:00Z',
  },
  {
    key: 'bc-triple-q32-vllm', submitter: 'basement-cluster', artifact: 'qwen2-5-32b-instruct--awq-4bit', benchmark: 'interactive-throughput', hardware: { user: 'triple-3090' },
    runtime: 'vllm', runtimeVersion: '0.7.2', backend: 'cuda', contextLength: 16384, os: 'Debian 12', driverVersion: '560.35', parameters: { tensor_parallel_size: 2 },
    values: { prompt_tps: 1780, gen_tps: 36.5, ttft_ms: 240, peak_memory_gb: 44 }, createdAt: '2025-02-20T21:00:00Z',
  },
  {
    key: 'qm-private-q14', submitter: 'quietmodel', artifact: 'qwen2-5-14b-instruct--mlx-4bit', benchmark: 'interactive-throughput', hardware: { user: 'office-mac' },
    runtime: 'mlx-lm', runtimeVersion: '0.21.1', backend: 'metal', contextLength: 8192, os: 'macOS 15.3',
    values: { prompt_tps: 310, gen_tps: 21.8, ttft_ms: 950, peak_memory_gb: 9.4 }, visibility: 'private', createdAt: '2025-03-02T12:00:00Z',
  },
  {
    key: 'qm-public-q3', submitter: 'quietmodel', artifact: 'qwen3-30b-a3b--mlx-4bit', benchmark: 'interactive-throughput', hardware: { user: 'office-mac' },
    runtime: 'mlx-lm', runtimeVersion: '0.24.0', backend: 'metal', contextLength: 8192, os: 'macOS 15.4',
    notes: 'Thinking disabled.', values: { prompt_tps: 520, gen_tps: 54.2, ttft_ms: 610, peak_memory_gb: 17.8 }, createdAt: '2025-05-03T08:30:00Z',
  },
  {
    key: 'ks-m3max-q3', submitter: 'kestrel', artifact: 'qwen3-30b-a3b--q4-k-m', benchmark: 'llama-bench', hardware: { reference: 'macbook-pro-m3-max-64gb' },
    runtime: 'llama-cpp', runtimeVersion: 'b5310', backend: 'metal', contextLength: 4096, flashAttention: true, os: 'macOS 15.4',
    values: { pp512: 485, tg128: 61.5 }, verification: 'verified', createdAt: '2025-05-04T16:45:00Z',
  },
  {
    key: 'tw-rejected', submitter: 'tokenwright', artifact: 'qwen2-5-14b-instruct--q4-k-m', benchmark: 'llama-bench', hardware: { reference: 'rtx-4060-ti-16gb-budget' },
    runtime: 'llama-cpp', runtimeVersion: 'b4610', backend: 'cuda', contextLength: 4096, notes: 'Copied wrong column.',
    values: { pp512: 1300, tg128: 910 }, status: 'rejected', createdAt: '2025-02-11T10:00:00Z',
  },
];

export const votes: ({ voter: string; value: 1 | -1 } & ({ review: { author: string; subjectSlug: string } } | { submission: string }))[] = [
  { voter: 'kestrel', value: 1, review: { author: 'tokenwright', subjectSlug: 'qwen2-5-coder-32b-instruct' } },
  { voter: 'basement-cluster', value: 1, review: { author: 'tokenwright', subjectSlug: 'qwen2-5-coder-32b-instruct' } },
  { voter: 'quietmodel', value: 1, review: { author: 'kestrel', subjectSlug: 'llama-cpp' } },
  { voter: 'tokenwright', value: 1, submission: 'bc-3090-l70' },
  { voter: 'kestrel', value: 1, submission: 'bc-3090-l70' },
  { voter: 'kestrel', value: 1, submission: 'qm-public-q3' },
];
