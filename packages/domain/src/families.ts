/**
 * Family-level summaries.
 *
 * People follow families ("Qwen", "Llama", "Gemma"), not the dozens of models, variants and quantizations inside
 * them. These pure functions fold a family's models into the few facts worth showing before anyone drills in.
 * Everything here is derived from recorded facts — capabilities, parameter counts, architectures, release dates.
 * Nothing is inferred from reputation, popularity or text.
 */

export interface FamilyModel {
  capabilities: readonly string[];
  architecture: 'dense' | 'moe';
  paramsTotal: number;
  paramsActive: number | null;
  releasedOn: string | null;
}

export interface FamilySummary {
  /** What the family's published models are built for, from their recorded capabilities. */
  knownFor: string;
  /** Smallest and largest recorded parameter counts, for the caller to format. */
  paramsMin: number | null;
  paramsMax: number | null;
  /** `mixed` when the family publishes both dense and mixture-of-experts models. */
  architecture: 'dense' | 'moe' | 'mixed' | null;
  /** Newest release date among the models, as recorded (ISO date). */
  latestReleasedOn: string | null;
  modelCount: number;
}

/** Capability → the words a reader who has never run a model would use. Ordered, so summaries read consistently. */
const CAPABILITY_PHRASE: readonly (readonly [string, string])[] = [
  ['code', 'coding'],
  ['reasoning', 'reasoning'],
  ['vision', 'images'],
  ['tool_use', 'tool use'],
  ['long_context', 'long documents'],
  ['multilingual', 'many languages'],
];

const joinWords = (words: readonly string[]) => (words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`);

/**
 * One phrase for what a family's models do, from the capabilities recorded on them. Capabilities every model in the
 * catalog has (plain chat) are never the headline unless there is nothing else to say. Never more than three, so the
 * line stays scannable.
 */
export function familyKnownFor(models: readonly FamilyModel[]): string {
  const present = new Set(models.flatMap((m) => m.capabilities));
  const words = CAPABILITY_PHRASE.filter(([key]) => present.has(key)).map(([, word]) => word);
  if (!words.length) return 'Everyday chat';
  const text = joinWords(words.slice(0, 3));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function summariseFamily(models: readonly FamilyModel[]): FamilySummary {
  const sizes = models.map((m) => m.paramsTotal).filter((n) => Number.isFinite(n) && n > 0);
  const dates = models.map((m) => m.releasedOn).filter((d): d is string => !!d);
  const dense = models.some((m) => m.architecture === 'dense');
  const moe = models.some((m) => m.architecture === 'moe');
  return {
    knownFor: familyKnownFor(models),
    paramsMin: sizes.length ? Math.min(...sizes) : null,
    paramsMax: sizes.length ? Math.max(...sizes) : null,
    architecture: dense && moe ? 'mixed' : moe ? 'moe' : dense ? 'dense' : null,
    latestReleasedOn: dates.length ? dates.sort().at(-1)! : null,
    modelCount: models.length,
  };
}

export const ARCHITECTURE_PHRASE: Record<NonNullable<FamilySummary['architecture']>, string> = {
  dense: 'Dense',
  moe: 'Mixture of experts',
  mixed: 'Dense and mixture of experts',
};

/**
 * Families ordered the way a reader wants them: whoever released most recently first, then the family with the most
 * models. Families without a recorded release date sort last rather than being dropped.
 */
export function rankFamilies<F extends { summary: FamilySummary }>(families: readonly F[]): F[] {
  return [...families].sort(
    (a, b) =>
      (b.summary.latestReleasedOn ?? '').localeCompare(a.summary.latestReleasedOn ?? '') ||
      b.summary.modelCount - a.summary.modelCount,
  );
}
