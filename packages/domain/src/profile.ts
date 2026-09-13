/**
 * Capability profiles and benchmark frontiers derived from benchmark results.
 * Scores are relative to the best result in the given set, so they describe position within the catalog,
 * not absolute quality. Pure functions; callers decide which results are eligible.
 */

export const CAPABILITY_AXES = [
  { key: 'coding', label: 'Coding', benchmarks: ['humaneval', 'livecodebench'] },
  { key: 'reasoning', label: 'Reasoning', benchmarks: ['gpqa-diamond', 'math-500'] },
  { key: 'knowledge', label: 'Knowledge', benchmarks: ['mmlu-pro'] },
  { key: 'instruction', label: 'Instruction following', benchmarks: ['ifeval'] },
] as const;

export type CapabilityAxis = (typeof CAPABILITY_AXES)[number]['key'];

export interface BenchmarkScore {
  subject: string;
  benchmark: string;
  value: number;
}

export interface AxisScore {
  /** 0–100, relative to the best score for the same benchmark in the input set. */
  score: number;
  benchmark: string;
  value: number;
}

export type CapabilityProfile = Partial<Record<CapabilityAxis, AxisScore>>;

export function capabilityProfiles(scores: readonly BenchmarkScore[]): Map<string, CapabilityProfile> {
  const best = new Map<string, number>();
  for (const s of scores) best.set(s.benchmark, Math.max(best.get(s.benchmark) ?? -Infinity, s.value));
  const profiles = new Map<string, CapabilityProfile>();
  for (const s of scores) {
    const axis = CAPABILITY_AXES.find((a) => (a.benchmarks as readonly string[]).includes(s.benchmark));
    const top = best.get(s.benchmark);
    if (!axis || !top || top <= 0) continue;
    const score = Math.round((s.value / top) * 100);
    const profile = profiles.get(s.subject) ?? {};
    const current = profile[axis.key];
    if (!current || score > current.score) profile[axis.key] = { score, benchmark: s.benchmark, value: s.value };
    profiles.set(s.subject, profile);
  }
  return profiles;
}

export interface DatedScore {
  subject: string;
  date: string;
  value: number;
}

/** The sequence of results that set a new best when ordered by date (ties keep the earlier result). */
export function frontier(points: readonly DatedScore[]): DatedScore[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date) || b.value - a.value);
  const out: DatedScore[] = [];
  for (const p of sorted) {
    if (!out.length || p.value > out[out.length - 1]!.value) out.push(p);
  }
  return out;
}
