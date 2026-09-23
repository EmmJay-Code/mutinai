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

/**
 * The machine classes that group both directories. A model belongs to the first tier whose `maxGb` holds its memory
 * need; a machine belongs to the largest tier it runs completely. Thresholds are usable, not nominal, memory: a 24 GB
 * card keeps about 22.8 GB for a model, a 64 GB Mac about 48 GB. One scale, so "a 24 GB graphics card" means the same
 * models on the Models page and the same machines on the Hardware page.
 */
export interface MemoryTier {
  key: string;
  /** Largest usable memory need, in GB, that belongs to this tier. */
  maxGb: number;
  /** The machine class, as a heading. */
  label: string;
  /** Short form for jump links. */
  short: string;
  /** Plain-English range of the tier. */
  range: string;
  /** Other machines in the same class. */
  alsoRuns: string;
  /** How a model in this tier is described next to its memory need. */
  fits: string;
}

export const MEMORY_TIERS: readonly MemoryTier[] = [
  { key: 'laptop', maxGb: 6, label: 'Most laptops', short: 'Laptops', range: 'up to 6 GB', alsoRuns: 'Runs on most laptops, even without a graphics card.', fits: 'fits most laptops' },
  { key: 'gpu-16', maxGb: 15, label: 'A 16 GB graphics card', short: '16 GB card', range: '6–15 GB', alsoRuns: 'Or a Mac with 24 GB of memory.', fits: 'fits a 16 GB graphics card' },
  { key: 'gpu-24', maxGb: 22, label: 'A 24 GB graphics card', short: '24 GB card', range: '15–22 GB', alsoRuns: 'Or a Mac with 32 GB of memory.', fits: 'fits a 24 GB graphics card' },
  { key: 'gpu-32', maxGb: 30, label: 'A 32 GB graphics card', short: '32 GB card', range: '22–30 GB', alsoRuns: 'Or a Mac with 48 GB of memory.', fits: 'fits a 32 GB graphics card' },
  { key: 'workstation', maxGb: 46, label: 'A 64 GB Mac or two graphics cards', short: 'Workstation', range: '30–46 GB', alsoRuns: 'Where 70B-class models start to fit.', fits: 'needs a 64 GB Mac or two graphics cards' },
  { key: 'large', maxGb: 92, label: 'A 128 GB workstation', short: '128 GB', range: '46–92 GB', alsoRuns: 'Large unified-memory machines or several cards.', fits: 'needs a 128 GB workstation' },
  { key: 'server', maxGb: Infinity, label: 'Server-class memory', short: 'Server', range: 'over 92 GB', alsoRuns: 'Datacenter accelerators and multi-GPU servers.', fits: 'needs server-class memory' },
];

/** The tier a model needing `gb` of memory belongs to. */
export function modelMemoryTier(gb: number | null | undefined): MemoryTier | null {
  if (gb == null) return null;
  return MEMORY_TIERS.find((t) => gb <= t.maxGb)!;
}

/**
 * The largest tier a machine with `usableGb` runs completely, or null when it cannot hold even the smallest tier.
 * The last tier has no upper bound, so a machine reaches it once it holds everything the tier before it holds.
 */
export function hardwareMemoryTier(usableGb: number | null | undefined): MemoryTier | null {
  if (usableGb == null) return null;
  let reached: MemoryTier | null = null;
  for (const [i, t] of MEMORY_TIERS.entries()) {
    const ceiling = Number.isFinite(t.maxGb) ? t.maxGb : MEMORY_TIERS[i - 1]!.maxGb;
    if (Number.isFinite(t.maxGb) ? usableGb >= ceiling : usableGb > ceiling) reached = t;
  }
  return reached;
}

/** "~18 GB to run" plus a familiar machine it fits. Thresholds use usable, not nominal, memory. */
export function memoryPhrase(gb: number | null | undefined): { amount: string; fits: string } | null {
  const tier = modelMemoryTier(gb);
  if (gb == null || !tier) return null;
  return { amount: `~${Math.ceil(gb)} GB to run`, fits: tier.fits };
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

// ─── Search by intent ────────────────────────────────────────────────────────

export interface SearchIntent {
  key: string;
  /** Heading for the results block, in the reader's words. */
  label: string;
  explain: string;
  /** A model intent that selects and orders the models, when one fits. */
  modelIntent?: string;
  /** Otherwise, models with this capability. */
  capability?: string;
  /** Leave out single-purpose specialists (a coding-only or maths-only model is not what "like ChatGPT" means). */
  generalOnly?: boolean;
  words: readonly string[];
}

/**
 * What someone means when they search for a purpose rather than a name ("like chatgpt", "something for coding").
 * Checked in order, most specific first, so "coding assistant" is about coding rather than chat.
 */
export const SEARCH_INTENTS: readonly SearchIntent[] = [
  { key: 'coding', label: 'Models for coding', explain: 'Trained for code: writing, fixing and explaining it.', modelIntent: 'coding', words: ['code', 'coding', 'coder', 'programming', 'programmer', 'copilot', 'cursor', 'python', 'javascript', 'typescript'] },
  { key: 'vision', label: 'Models that understand images', explain: 'Accept images and screenshots as well as text.', modelIntent: 'vision', words: ['image', 'images', 'photo', 'photos', 'picture', 'pictures', 'vision', 'screenshot', 'screenshots', 'multimodal'] },
  { key: 'reasoning', label: 'Models for maths and reasoning', explain: 'Built to work through multi-step problems.', modelIntent: 'reasoning', words: ['math', 'maths', 'reasoning', 'logic', 'thinking', 'puzzle', 'puzzles'] },
  { key: 'agents', label: 'Models that can use tools', explain: 'Support tool and function calling, for agents and automation.', modelIntent: 'agents', words: ['agent', 'agents', 'agentic', 'tool use', 'tool calling', 'function calling', 'automation'] },
  { key: 'small', label: 'Small models for ordinary computers', explain: '10B parameters or fewer: they run on laptops and 8–16 GB machines.', modelIntent: 'small', words: ['small', 'tiny', 'lightweight', 'laptop', 'weak computer', 'old computer', 'low memory'] },
  { key: 'chat', label: 'Chat models, like ChatGPT', explain: 'General models you talk to: they answer questions, write, summarise and explain — on your own computer.', capability: 'chat', generalOnly: true, words: ['chatgpt', 'chat gpt', 'gpt', 'claude', 'gemini', 'chatbot', 'chat bot', 'chat', 'assistant', 'conversation', 'talk to'] },
];

/** A model whose only specialism is code or maths: good at that, but not a general assistant. */
export function isSpecialist(m: { capabilities: readonly string[] }): boolean {
  const uses = m.capabilities.filter((c) => !['chat', 'multilingual', 'long_context'].includes(c));
  return uses.length === 1 && (uses[0] === 'code' || uses[0] === 'reasoning');
}

/** The purpose a query expresses, if it expresses one. Whole words only: "gpt" matches "like gpt" but not "gpt2-medium". */
export function searchIntent(query: string): SearchIntent | null {
  const q = ` ${query.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
  if (q.trim() === '') return null;
  return SEARCH_INTENTS.find((i) => i.words.some((w) => q.includes(` ${w} `))) ?? null;
}

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

// ─── First steps ─────────────────────────────────────────────────────────────

/** Comfortable to use: comfortably faster than reading (five to six tokens a second). */
const COMFORTABLE_TPS = 8;

/**
 * Generation speed in reading terms. People read roughly four words, or five to six tokens, a second, so speed is
 * said against that first; the tok/s figure stays beside it for anyone who wants the number.
 */
export function readingSpeed(tokensPerSecond: number | null | undefined): { text: string; tone: ReachTone } | null {
  if (tokensPerSecond == null || !Number.isFinite(tokensPerSecond) || tokensPerSecond <= 0) return null;
  if (tokensPerSecond >= 25) return { text: 'Much faster than you can read', tone: 'good' };
  if (tokensPerSecond >= COMFORTABLE_TPS) return { text: 'Types faster than you can read', tone: 'good' };
  if (tokensPerSecond >= 5) return { text: 'About as fast as you read', tone: 'mixed' };
  return { text: 'Slower than you read — expect to wait for answers', tone: 'limited' };
}

export interface StarterCandidate {
  variantKind: string;
  capabilities: readonly string[];
  /** Where the recommended download runs: `accelerator`, `cpu`, `hybrid`, or null when it does not run. */
  placement: string | null;
  fit: string;
  genTps: number | null;
  /** Benchmark quality, e.g. `profileMean` of the model's capability profile (0 when unknown). */
  quality: number;
  paramsTotal: number;
}

/** Tuned for conversation, and not a specialist that would surprise someone asking an everyday question. */
const GENERAL_KINDS = new Set(['instruct', 'vision']);
/**
 * The one model to suggest to someone who has never run one: a general chat model that runs entirely in memory
 * (no offload), is comfortable to use, and has the best benchmark profile among those. Falls back to anything general
 * that runs in memory when nothing is comfortably fast. Null when no general model runs.
 */
export function pickStarter<T extends StarterCandidate>(candidates: readonly T[]): T | null {
  const general = candidates.filter(
    (c) => GENERAL_KINDS.has(c.variantKind) && c.capabilities.includes('chat') && (c.placement === 'accelerator' || c.placement === 'cpu') && (c.fit === 'full' || c.fit === 'tight'),
  );
  if (!general.length) return null;
  const comfortable = general.filter((c) => (c.genTps ?? 0) >= COMFORTABLE_TPS);
  const pool = comfortable.length ? comfortable : general;
  return [...pool].sort(
    (a, b) =>
      Number(b.fit === 'full') - Number(a.fit === 'full') ||
      b.quality - a.quality ||
      (b.genTps ?? 0) - (a.genTps ?? 0) ||
      a.paramsTotal - b.paramsTotal,
  )[0]!;
}

/** A first model should feel quick: below this, a beginner's first impression of local AI is waiting for it to type. */
export const STARTER_MIN_TPS = 15;

export interface DownloadOption {
  bitsPerWeight: number;
  fit: string;
  placement: string | null;
  genTps: number | null;
  measured: boolean;
}

/**
 * The download to suggest with the "start with this one" pick. Elsewhere the highest-precision file that fits is
 * recommended; for a first run that can mean a file that types slowly. If the recommended file would run under
 * STARTER_MIN_TPS, prefer the highest-precision alternative that stays in memory and reaches it (measured before
 * estimated at equal precision). If none does, the recommendation stands.
 */
export function balanceStarterDownload<T extends DownloadOption>(recommended: T, alternatives: readonly T[]): { pick: T; swappedFrom: T | null } {
  if ((recommended.genTps ?? 0) >= STARTER_MIN_TPS) return { pick: recommended, swappedFrom: null };
  const quick = alternatives.filter(
    (a) => (a.fit === 'full' || a.fit === 'tight') && (a.placement === 'accelerator' || a.placement === 'cpu') && (a.genTps ?? 0) >= STARTER_MIN_TPS,
  );
  if (!quick.length) return { pick: recommended, swappedFrom: null };
  const pick = [...quick].sort(
    (a, b) =>
      Math.min(b.bitsPerWeight, 8.5) - Math.min(a.bitsPerWeight, 8.5) ||
      Number(b.fit === 'full') - Number(a.fit === 'full') ||
      Number(b.measured) - Number(a.measured) ||
      (b.genTps ?? 0) - (a.genTps ?? 0),
  )[0]!;
  return { pick, swappedFrom: recommended };
}

/** "3×" or "1.6×": how many times faster one speed is than another, for a sentence. */
export function speedupPhrase(faster: number, slower: number): string {
  const x = faster / slower;
  return x >= 1.95 ? `${Math.round(x)}×` : `${x.toFixed(1)}×`;
}

// ─── Hardware presentation ───────────────────────────────────────────────────

/**
 * What a price means. Prices are time-sensitive claims, never timeless facts: a launch MSRP, a price observed at a
 * retailer on a date, a typical used price, or an editorial estimate (e.g. the cost of a reference build).
 */
export type PriceKind = 'msrp' | 'observed' | 'used' | 'estimate';

export interface PriceQuote {
  amount: number;
  /** ISO 4217 code. */
  currency: string;
  kind: PriceKind;
  source?: string | null;
  /** ISO date the price was observed. Only meaningful for observed and used prices. */
  checkedOn?: string | null;
}

const CURRENCY_SYMBOL: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };
const PRICE_QUALIFIER: Record<PriceKind, string> = { msrp: 'MSRP', observed: 'observed', used: 'used', estimate: 'build estimate' };
const PRICE_DESCRIPTION: Record<PriceKind, string> = {
  msrp: 'Launch price set by the manufacturer. Current prices vary.',
  observed: 'Price seen at a retailer on the date shown.',
  used: 'Typical second-hand price on the date shown.',
  estimate: 'Approximate cost to buy or build. Not a quoted price.',
};

/** "$1,999" + "MSRP", or "~$1,649" + "observed · checked Sep 2026". The qualifier is never omitted. */
export function formatPrice(q: PriceQuote): { value: string; qualifier: string; description: string } {
  const symbol = CURRENCY_SYMBOL[q.currency];
  const n = Math.round(q.amount).toLocaleString('en-US');
  const amount = symbol ? `${symbol}${n}` : `${n} ${q.currency}`;
  const dated = (q.kind === 'observed' || q.kind === 'used') && q.checkedOn
    ? ` · checked ${new Date(`${q.checkedOn.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`
    : '';
  return {
    value: `${q.kind === 'msrp' ? '' : '~'}${amount}`,
    qualifier: `${PRICE_QUALIFIER[q.kind]}${dated}`,
    description: `${PRICE_DESCRIPTION[q.kind]}${q.source ? ` Source: ${q.source}.` : ''}`,
  };
}

export function deviceClassLabel(d: { deviceKind: string; memoryKind: string }): string {
  if (d.deviceKind === 'accelerator') return 'Datacenter GPU';
  if (d.memoryKind === 'unified') return 'Unified-memory chip';
  if (d.deviceKind === 'gpu') return 'Graphics card';
  if (d.deviceKind === 'cpu') return 'Processor';
  return 'Device';
}

const FORM_FACTOR_SINGULAR: Record<string, string> = { laptop: 'Laptop', desktop: 'Desktop', mini_pc: 'Mini PC', server: 'Server' };
export const systemClassLabel = (c: { formFactor: string }) => FORM_FACTOR_SINGULAR[c.formFactor] ?? 'System';

/** One plain line on what a device is for, from its class and the largest dense model it holds at 4-bit. */
export function devicePositioning(d: { deviceKind: string; memoryKind: string }, maxParamsB: number | null): string {
  if (d.deviceKind === 'accelerator') return 'Datacenter card for large models and many users.';
  if (d.memoryKind === 'unified') return 'One large shared memory pool; capacity is chosen when the system is bought.';
  if (d.deviceKind === 'cpu' || maxParamsB == null) return 'Runs small models without a graphics card, slowly.';
  if (maxParamsB >= 40) return 'Top consumer card: 30B-class models with room for long context.';
  if (maxParamsB >= 30) return 'Runs 30B-class models on a single card.';
  if (maxParamsB >= 18) return 'Comfortable with 14B–24B models.';
  return 'Entry card for 7B–14B models.';
}

export function systemPositioning(placement: 'accelerator' | 'unified' | 'ram', maxParamsB: number, gpuCount: number): string {
  if (placement === 'ram') return 'Budget build without a graphics card; best for small models.';
  if (gpuCount >= 2) return 'Multi-GPU build that splits 70B-class models across cards.';
  if (maxParamsB >= 100) return 'Holds 70B-class and larger models in memory.';
  if (maxParamsB >= 60) return 'Holds 70B-class models.';
  if (maxParamsB >= 30) return 'Handles 30B-class models comfortably.';
  return 'Entry system for 7B–14B models.';
}
