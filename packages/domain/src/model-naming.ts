/**
 * First-party model repository names, e.g. `Qwen3.8-27B`, `Qwen3-30B-A3B-Instruct-2507`, `Qwen2.5-Coder-32B-Instruct`,
 * `Llama-3.1-8B-Instruct`, `gemma-4-12B-it`. A parsed name is only ever used together with source facts (developer
 * identity, config.json, parameter counts); see docs/live-ingestion.md#first-party-releases.
 */
import type { VariantKind } from './ontology';

export interface ParsedModelName {
  /** Words before the version: `['Qwen']`, `['Mistral', 'Small']`. */
  brand: string[];
  version: string;
  /** Brand and version written without a separator (`Qwen3.8`). */
  joined: boolean;
  /** Words between version and size: `['Coder']`. */
  line: string[];
  /** The size token as written (`27B`) and its value in billions. */
  sizeToken: string;
  sizeB: number;
  /** Active parameters of a mixture-of-experts model in billions (`A3B`), when the name states them. */
  activeB: number | null;
  activeToken: string | null;
  /** Tokens after size and active parameters: `['Instruct', '2507']`. */
  suffix: string[];
}

const SIZE = /^(\d+(?:\.\d+)?)b$/i;
const ACTIVE = /^a(\d+(?:\.\d+)?)b$/i;
const WORD = /^[a-z]+$/i;

/** Parses `<brand><version>[-<line>]-<size>B[-A<active>B][-<suffix>]`. Returns null for anything else. */
export function parseModelRepoName(repo: string): ParsedModelName | null {
  const tokens = repo.split(/[-_]/).filter(Boolean);
  const sizeAt = tokens.findIndex((t) => SIZE.test(t));
  if (sizeAt < 1) return null;
  const head = tokens.slice(0, sizeAt);
  const versionAt = head.findIndex((t) => /\d/.test(t));
  if (versionAt < 0) return null;
  const brand = head.slice(0, versionAt);
  const token = head[versionAt]!;
  let version: string;
  let joined: boolean;
  const glued = /^([a-z]+)(\d+(?:\.\d+)*)$/i.exec(token);
  const bare = /^v?(\d+(?:\.\d+)*)$/i.exec(token);
  if (glued) {
    brand.push(glued[1]!);
    version = glued[2]!;
    joined = brand.length === 1;
  } else if (bare) {
    version = bare[1]!;
    joined = false;
  } else return null;
  const line = head.slice(versionAt + 1);
  if (!brand.length || !brand.every((w) => WORD.test(w)) || !line.every((w) => WORD.test(w))) return null;
  const rest = tokens.slice(sizeAt + 1);
  const active = rest[0] && ACTIVE.exec(rest[0]);
  return {
    brand,
    version,
    joined,
    line,
    sizeToken: tokens[sizeAt]!.toUpperCase(),
    sizeB: Number(SIZE.exec(tokens[sizeAt]!)![1]),
    activeB: active ? Number(active[1]) : null,
    activeToken: active ? rest[0]!.toUpperCase() : null,
    suffix: active ? rest.slice(1) : rest,
  };
}

const KIND_TOKENS: Record<string, VariantKind> = {
  base: 'base',
  instruct: 'instruct',
  it: 'instruct',
  chat: 'instruct',
  thinking: 'reasoning',
  reasoning: 'reasoning',
  coder: 'coder',
  vl: 'vision',
  vision: 'vision',
};
/** Date codes (`2507`) and version tokens (`v0.3`) carry no identity beyond the repo name. */
const NEUTRAL = /^(\d{4}|v\d+(?:\.\d+)*)$/i;

/** Variant kind stated by name suffix tokens. `kind` is null when no token states it or tokens conflict; unknown tokens are reported. */
export function variantKindFromSuffix(suffix: readonly string[]): { kind: VariantKind | null; unrecognized: string[]; conflicting: boolean } {
  const kinds = new Set<VariantKind>();
  const unrecognized: string[] = [];
  for (const t of suffix) {
    const kind = KIND_TOKENS[t.toLowerCase()];
    if (kind) kinds.add(kind);
    else if (!NEUTRAL.test(t)) unrecognized.push(t);
  }
  return { kind: kinds.size === 1 ? [...kinds][0]! : null, unrecognized, conflicting: kinds.size > 1 };
}

const words = (s: string) => s.split(/[\s\-_]+/).map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean);
const sameWords = (a: string[], b: string[]) => a.length === b.length && a.every((w, i) => w === b[i]);

export type FamilyMatch<F> = { family: F; includesLine: boolean } | { ambiguous: F[] } | null;

/**
 * The developer's family a parsed name belongs to: a family named by the brand's leading words (`Mistral` for
 * `Mistral-Small`), or by brand plus line (`Qwen Coder` for `Qwen2.5-Coder`). The longest match wins; equal-length
 * matches are ambiguous.
 */
export function matchFamily<F extends { name: string }>(parsed: ParsedModelName, families: readonly F[]): FamilyMatch<F> {
  const brand = parsed.brand.map((w) => w.toLowerCase());
  const withLine = [...brand, ...parsed.line.map((w) => w.toLowerCase())];
  const scored = families
    .map((family) => {
      const fw = words(family.name);
      if (parsed.line.length && sameWords(fw, withLine)) return { family, score: fw.length, includesLine: true };
      if (fw.length && fw.length <= brand.length && sameWords(fw, brand.slice(0, fw.length))) return { family, score: fw.length, includesLine: false };
      return null;
    })
    .filter((m): m is { family: F; score: number; includesLine: boolean } => m !== null)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  const best = scored.filter((m) => m.score === scored[0]!.score);
  return best.length === 1 ? { family: best[0]!.family, includesLine: best[0]!.includesLine } : { ambiguous: best.map((m) => m.family) };
}

/** Release name in the developer's own style: `Qwen3.8`, `Qwen2.5-Coder`, `Mistral Small 4`, `Gemma 4` (family casing for brand words). */
export function releaseNameFor(parsed: ParsedModelName, familyName: string): string {
  const familyWords = familyName.split(/[\s\-_]+/);
  const brand = parsed.brand.map((w, i) => (familyWords[i] && familyWords[i]!.toLowerCase() === w.toLowerCase() ? familyWords[i]! : w)).join(' ');
  const base = parsed.joined ? `${brand}${parsed.version}` : `${brand} ${parsed.version}`;
  return parsed.line.length ? `${base}-${parsed.line.join('-')}` : base;
}

/** Model name within a release: `Qwen3.8 27B`, `Qwen3 30B-A3B`. */
export const modelNameFor = (parsed: ParsedModelName, releaseName: string) => `${releaseName} ${parsed.sizeToken}${parsed.activeToken ? `-${parsed.activeToken}` : ''}`;
