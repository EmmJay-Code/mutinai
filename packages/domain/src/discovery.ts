/**
 * Discovery vocabulary: plain-language descriptions and intent-based entry points.
 * Beginners organise the catalog around questions ("what's good for coding?"); these pure functions translate
 * the same underlying data into decision-relevant statements without hiding or changing it.
 */
import { CAPABILITY_AXES, type CapabilityProfile } from './profile';

// ─── Plain-language statements ───────────────────────────────────────────────

export type LicenseOpenness = 'permissive' | 'restricted' | 'noncommercial' | 'unknown';

/**
 * How freely a model can be used, from its licenses' commercial-use terms. Every model in the catalog has
 * downloadable weights; this describes the license on them, which is not the same as being open source.
 */
export function licenseOpenness(licenses: readonly { commercialUse: string | null | undefined }[]): LicenseOpenness {
  const uses = licenses.map((l) => l.commercialUse);
  if (uses.includes('allowed')) return 'permissive';
  if (uses.includes('restricted')) return 'restricted';
  if (uses.includes('prohibited')) return 'noncommercial';
  return 'unknown';
}

export const OPENNESS_TEXT: Record<LicenseOpenness, { label: string; detail: string }> = {
  permissive: { label: 'Permissive license', detail: 'Free to use, including commercially' },
  restricted: { label: 'Restricted license', detail: 'Weights are downloadable; the license limits some uses' },
  noncommercial: { label: 'Non-commercial license', detail: 'Weights are downloadable; commercial use is not allowed' },
  unknown: { label: 'License unknown', detail: 'Check the source before using it' },
};

/** "~18 GB to run" plus a familiar machine it fits. Thresholds use usable, not nominal, memory. */
export function memoryPhrase(gb: number | null | undefined): { amount: string; fits: string } | null {
  if (gb == null) return null;
  const amount = `~${Math.ceil(gb)} GB to run`;
  const fits =
    gb <= 6 ? 'fits most laptops'
      : gb <= 15 ? 'fits a 16 GB graphics card'
        : gb <= 22 ? 'fits a 24 GB graphics card'
          : gb <= 30 ? 'fits a 32 GB graphics card'
            : gb <= 46 ? 'needs a 64 GB Mac or two graphics cards'
              : gb <= 92 ? 'needs a 128 GB workstation'
                : 'needs server-class memory';
  return { amount, fits };
}

export type ReachTone = 'good' | 'mixed' | 'limited';

/** Where a model runs, summarised over the reference systems. */
export function reachPhrase(s: { runsWell: number; slow: number; of: number } | null | undefined): { text: string; tone: ReachTone } | null {
  if (!s || s.of === 0) return null;
  const share = s.runsWell / s.of;
  if (share >= 0.75) return { text: 'Runs well on most reference systems', tone: 'good' };
  if (share >= 0.4) return { text: 'Runs well on many reference systems', tone: 'good' };
  if (s.runsWell > 0) return { text: 'Runs well only on high-memory systems', tone: 'mixed' };
  if (s.slow > 0) return { text: 'Runs only slowly on reference systems', tone: 'limited' };
  return { text: 'Needs server hardware', tone: 'limited' };
}

export function communityPhrase(runs: number, reviews: number): string | null {
  const parts = [runs ? `${runs} community run${runs === 1 ? '' : 's'}` : null, reviews ? `${reviews} review${reviews === 1 ? '' : 's'}` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

const USE_WORD: Record<string, string> = { code: 'coding', reasoning: 'reasoning', vision: 'images', tool_use: 'tool use' };
/** A single specialism reads better as its own phrase than as “model for images”. */
const SINGLE_USE: Record<string, string> = { coding: 'model for coding', reasoning: 'model for maths and reasoning', images: 'chat model that also understands images', 'tool use': 'chat model that can call tools' };
const AXIS_WORD: Record<string, string> = { coding: 'coding', reasoning: 'reasoning', knowledge: 'general knowledge', instruction: 'following instructions' };

const joinWords = (words: string[]) => (words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`);

export interface DescribableModel {
  capabilities: readonly string[];
  architecture: 'dense' | 'moe';
  paramsTotal: number;
  paramsActive: number | null;
}

/** One sentence on what a model is for, and — when the benchmarks support it — what it is strongest at. */
export function describeModel(m: DescribableModel, profile?: CapabilityProfile): { summary: string; strength: string | null } {
  const uses = m.capabilities.flatMap((c) => (USE_WORD[c] ? [USE_WORD[c]!] : []));
  const perToken = m.paramsActive ?? m.paramsTotal;
  const adjective = m.paramsTotal >= 200e9 ? 'very large' : m.architecture === 'moe' && perToken <= 15e9 ? 'efficient' : m.paramsTotal <= 10e9 ? 'compact' : '';
  const phrase = uses.length >= 2 ? `general-purpose model for ${joinWords(uses)}` : uses.length === 1 ? SINGLE_USE[uses[0]!]! : 'model for everyday chat';
  const text = `${adjective ? `${adjective} ` : ''}${phrase}.`;
  const best = CAPABILITY_AXES.map((a) => ({ key: a.key, s: profile?.[a.key]?.score ?? 0 })).sort((a, b) => b.s - a.s)[0];
  // Only the best or near-best result in the catalog earns the claim; otherwise it stops meaning anything.
  const strength = best && best.s >= 97 ? `Among the strongest open models at ${AXIS_WORD[best.key]}.` : null;
  return { summary: text.charAt(0).toUpperCase() + text.slice(1), strength };
}

export function profileMean(profile: CapabilityProfile | undefined): number {
  const scores = CAPABILITY_AXES.flatMap((a) => (profile?.[a.key] ? [profile[a.key]!.score] : []));
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
}

// ─── Model intents ───────────────────────────────────────────────────────────

export interface IntentModel extends DescribableModel {
  minMemoryGb: number | null;
  licenses: readonly { commercialUse: string | null | undefined }[];
}

export interface IntentContext {
  profile?: CapabilityProfile;
  reach?: { runsWell: number; slow: number; of: number };
}

export interface ModelIntent {
  key: string;
  label: string;
  /** What the path answers, in the reader's words. */
  hint: string;
  /** How results are chosen and ordered — shown once the path is taken. */
  explain: string;
  test: (m: IntentModel) => boolean;
  score: (m: IntentModel, ctx: IntentContext) => number;
}

const axis = (ctx: IntentContext, key: keyof CapabilityProfile) => ctx.profile?.[key]?.score ?? 0;
const reachShare = (ctx: IntentContext) => (ctx.reach?.of ? ctx.reach.runsWell / ctx.reach.of : 0);

export const MODEL_INTENTS: readonly ModelIntent[] = [
  {
    key: 'coding', label: 'Coding', hint: 'Write, fix and explain code',
    explain: 'Models trained for code, strongest coding benchmark results first.',
    test: (m) => m.capabilities.includes('code'),
    score: (_m, ctx) => axis(ctx, 'coding') * 10 + reachShare(ctx),
  },
  {
    key: 'local', label: 'Run locally', hint: 'Fits a 24 GB graphics card or Mac',
    explain: 'Needs 22 GB or less at 8K context. Ordered by how many reference systems run it well.',
    test: (m) => m.minMemoryGb != null && m.minMemoryGb <= 22,
    score: (_m, ctx) => reachShare(ctx) * 100 + profileMean(ctx.profile) / 10,
  },
  {
    key: 'reasoning', label: 'Reasoning', hint: 'Maths, logic and hard problems',
    explain: 'Models with reasoning ability, strongest reasoning benchmark results first.',
    test: (m) => m.capabilities.includes('reasoning'),
    score: (_m, ctx) => axis(ctx, 'reasoning') * 10 + reachShare(ctx),
  },
  {
    key: 'vision', label: 'Vision', hint: 'Understand images and screenshots',
    explain: 'Models that accept images as well as text.',
    test: (m) => m.capabilities.includes('vision'),
    score: (_m, ctx) => profileMean(ctx.profile) + reachShare(ctx),
  },
  {
    key: 'agents', label: 'Agents & tool use', hint: 'Call tools, APIs and functions',
    explain: 'Models that support tool calling, best at following instructions first.',
    test: (m) => m.capabilities.includes('tool_use'),
    score: (_m, ctx) => axis(ctx, 'instruction') * 10 + reachShare(ctx),
  },
  {
    key: 'fast', label: 'Fast models', hint: 'Quick replies on ordinary hardware',
    explain: '15B or fewer parameters used per token — including mixture-of-experts models. Fewest first.',
    test: (m) => (m.paramsActive ?? m.paramsTotal) <= 15e9,
    score: (m, ctx) => -(m.paramsActive ?? m.paramsTotal) / 1e9 + reachShare(ctx),
  },
  {
    key: 'small', label: 'Small models', hint: 'Laptops and 8–16 GB machines',
    explain: '10B parameters or fewer. Most capable first.',
    test: (m) => m.paramsTotal <= 10e9,
    score: (_m, ctx) => profileMean(ctx.profile) + reachShare(ctx),
  },
  {
    key: 'open', label: 'Permissive licenses', hint: 'Free to use commercially',
    explain: 'At least one variant under a license that allows commercial use. Most capable first.',
    test: (m) => licenseOpenness(m.licenses) === 'permissive',
    score: (_m, ctx) => profileMean(ctx.profile) + reachShare(ctx),
  },
];

export const modelIntent = (key: string | null | undefined) => MODEL_INTENTS.find((i) => i.key === key);

// ─── Hardware organisation ───────────────────────────────────────────────────

export type HardwareCategory = 'gpu' | 'unified' | 'systems' | 'server';

export const HARDWARE_CATEGORIES: readonly { key: HardwareCategory; label: string }[] = [
  { key: 'gpu', label: 'Graphics cards' },
  { key: 'unified', label: 'Apple silicon & unified memory' },
  { key: 'systems', label: 'Complete systems' },
  { key: 'server', label: 'Server & multi-GPU' },
];

/** The buying context a device belongs to. CPUs have no category of their own; they appear in the full list. */
export function deviceCategory(d: { deviceKind: string; memoryKind: string }): HardwareCategory | null {
  if (d.deviceKind === 'accelerator') return 'server';
  if (d.memoryKind === 'unified') return 'unified';
  if (d.deviceKind === 'gpu') return 'gpu';
  return null;
}

/** A system can serve several contexts: a dual-GPU desktop is both a complete system and a multi-GPU build. */
export function systemCategories(c: { formFactor: string; unifiedMemoryGb: number | null; components: readonly { deviceKind: string; memoryKind: string; count: number }[] }): HardwareCategory[] {
  const gpus = c.components.reduce((n, x) => n + (x.memoryKind === 'dedicated' ? x.count : 0), 0);
  const out: HardwareCategory[] = [];
  if (c.formFactor !== 'server') out.push('systems');
  if (c.unifiedMemoryGb) out.push('unified');
  if (c.formFactor === 'server' || gpus >= 2 || c.components.some((x) => x.deviceKind === 'accelerator')) out.push('server');
  return out;
}

export interface HardwareGoal {
  key: string;
  label: string;
  hint: string;
  category: HardwareCategory;
  explain: string;
}

export const HARDWARE_GOALS: readonly HardwareGoal[] = [
  { key: 'first', label: 'My first local-AI machine', hint: 'Complete systems around $2,500 or less', category: 'systems', explain: 'Complete systems priced at about $2,500 or less, cheapest first.' },
  { key: 'upgrade', label: 'Upgrade my GPU', hint: 'More video memory runs bigger models', category: 'gpu', explain: 'Graphics cards with the most usable memory first. Memory decides what fits; memory speed decides how fast it replies.' },
  { key: 'apple', label: 'Apple / unified memory', hint: 'One large memory pool, quiet and efficient', category: 'unified', explain: 'Chips that share one pool of memory between CPU and GPU, and the systems built on them.' },
  { key: 'workstation', label: 'Workstation', hint: '48 GB+ for 70B-class models', category: 'systems', explain: 'Desktop and compact systems with about 40 GB or more usable for models, largest first.' },
  { key: 'server', label: 'Server / multi-GPU', hint: 'Datacenter cards and multi-GPU builds', category: 'server', explain: 'Datacenter accelerators, servers and builds with more than one graphics card.' },
];

export const hardwareGoal = (key: string | null | undefined) => HARDWARE_GOALS.find((g) => g.key === key);

export function systemMatchesGoal(goal: HardwareGoal, c: { formFactor: string; approxPriceUsd: number | null }, usableGb: number): boolean {
  if (goal.key === 'first') return c.approxPriceUsd != null && c.approxPriceUsd <= 2500;
  if (goal.key === 'workstation') return c.formFactor !== 'server' && usableGb >= 40;
  return true;
}

/** Typical generation speed implied by memory bandwidth, for a mid-sized (~30B, 4-bit) model. */
export function speedPhrase(bandwidthGbps: number | null | undefined): { text: string; tone: ReachTone } | null {
  if (!bandwidthGbps) return null;
  if (bandwidthGbps >= 800) return { text: 'Very fast replies', tone: 'good' };
  if (bandwidthGbps >= 400) return { text: 'Fast replies', tone: 'good' };
  if (bandwidthGbps >= 200) return { text: 'Moderate speed', tone: 'mixed' };
  return { text: 'Slow replies', tone: 'limited' };
}
